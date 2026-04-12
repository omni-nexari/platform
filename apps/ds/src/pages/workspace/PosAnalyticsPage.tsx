import { Fragment, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useParams } from 'react-router';
import { Activity, BarChart2, Clock3, DollarSign, ShoppingBag, TimerReset } from 'lucide-react';
import { api } from '../../lib/api.js';
import { Badge, FilterChip, PageHeader, Skeleton } from '../../components/UiPrimitives.js';

interface PosRestaurant {
  currency: string;
}

interface OrdersStatsSummary {
  totalOrders: number;
  pendingOrders: number;
  preparingOrders: number;
  readyOrders: number;
  completedOrders: number;
  cancelledOrders: number;
  revenueCents: number;
  avgTicketCents: number;
}

interface TimingMetrics {
  completedCount: number;
  avgCompletionMinutes: number;
  medianCompletionMinutes: number;
  activeCount: number;
  avgActiveMinutes: number;
}

interface HourlyHeatmapCell {
  weekday: number;
  hour: number;
  orders: number;
  revenueCents: number;
}

interface TopItemsSummary {
  topItems: Array<{
    name: string | null;
    qty: number;
    revenue: number;
  }>;
}

type Range = '7' | '30' | '90';

const WEEKDAYS = [
  { id: 1, label: 'Mon' },
  { id: 2, label: 'Tue' },
  { id: 3, label: 'Wed' },
  { id: 4, label: 'Thu' },
  { id: 5, label: 'Fri' },
  { id: 6, label: 'Sat' },
  { id: 7, label: 'Sun' },
] as const;

const HOURS = Array.from({ length: 24 }, (_, hour) => hour);

function formatPrice(cents: number, currency = 'USD') {
  return new Intl.NumberFormat(undefined, { style: 'currency', currency }).format(cents / 100);
}

function formatCompactPrice(cents: number, currency = 'USD') {
  const dollars = cents / 100;
  return new Intl.NumberFormat(undefined, {
    style: 'currency',
    currency,
    notation: dollars >= 1000 ? 'compact' : 'standard',
    maximumFractionDigits: dollars >= 1000 ? 1 : 0,
  }).format(dollars);
}

function formatMinutes(value: number) {
  if (!Number.isFinite(value) || value <= 0) return '—';
  if (value >= 60) return `${(value / 60).toFixed(1)}h`;
  return `${Math.round(value)}m`;
}

function formatHourLabel(hour: number) {
  const hour12 = hour % 12 || 12;
  const suffix = hour < 12 ? 'AM' : 'PM';
  return `${hour12}${suffix}`;
}

function buildDateRange(range: Range) {
  const end = new Date();
  end.setHours(23, 59, 59, 999);

  const start = new Date(end);
  start.setDate(end.getDate() - Number(range) + 1);
  start.setHours(0, 0, 0, 0);

  return {
    from: start.toISOString(),
    to: end.toISOString(),
  };
}

export default function PosAnalyticsPage() {
  const { wsId } = useParams<{ wsId: string }>();
  const [range, setRange] = useState<Range>('30');

  const { from, to } = useMemo(() => buildDateRange(range), [range]);

  const { data: restaurant } = useQuery<PosRestaurant | null>({
    queryKey: ['pos-restaurant', wsId],
    queryFn: () => api.get(`/pos/restaurant?workspaceId=${wsId}`),
    enabled: !!wsId,
  });

  const currency = restaurant?.currency ?? 'USD';

  const summaryQuery = useQuery<OrdersStatsSummary>({
    queryKey: ['pos-orders-stats', 'summary', wsId, from, to],
    queryFn: () => api.get(`/pos/mgmt/orders/stats/summary?workspaceId=${wsId}&from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`),
    enabled: !!wsId,
  });

  const timingQuery = useQuery<TimingMetrics>({
    queryKey: ['pos-orders-stats', 'timing', wsId, from, to],
    queryFn: () => api.get(`/pos/mgmt/orders/stats/timing-metrics?workspaceId=${wsId}&from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`),
    enabled: !!wsId,
  });

  const heatmapQuery = useQuery<HourlyHeatmapCell[]>({
    queryKey: ['pos-orders-stats', 'heatmap', wsId, from, to],
    queryFn: () => api.get(`/pos/mgmt/orders/stats/hourly-heatmap?workspaceId=${wsId}&from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`),
    enabled: !!wsId,
  });

  const topItemsQuery = useQuery<TopItemsSummary>({
    queryKey: ['pos-analytics-top-items', wsId, from, to],
    queryFn: () => api.get(`/pos/analytics/summary?workspaceId=${wsId}&from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`),
    enabled: !!wsId,
  });

  const summary = summaryQuery.data;
  const timing = timingQuery.data;
  const heatmap = heatmapQuery.data ?? [];
  const topItems = topItemsQuery.data?.topItems ?? [];

  const heatmapMap = useMemo(() => {
    return new Map(heatmap.map((cell) => [`${cell.weekday}-${cell.hour}`, cell]));
  }, [heatmap]);

  const maxOrders = useMemo(() => Math.max(...heatmap.map((cell) => cell.orders), 1), [heatmap]);

  const busiestCell = useMemo(() => {
    return heatmap.reduce<HourlyHeatmapCell | null>((current, cell) => {
      if (!current || cell.orders > current.orders) {
        return cell;
      }
      return current;
    }, null);
  }, [heatmap]);

  const statusRows = summary
    ? [
        { label: 'Pending', value: summary.pendingOrders, color: '#f59e0b' },
        { label: 'Preparing', value: summary.preparingOrders, color: 'var(--accent)' },
        { label: 'Ready', value: summary.readyOrders, color: '#10b981' },
        { label: 'Completed', value: summary.completedOrders, color: '#64748b' },
        { label: 'Cancelled', value: summary.cancelledOrders, color: '#ef4444' },
      ]
    : [];

  return (
    <div className="flex flex-col gap-6 p-4 sm:p-6 max-w-screen-xl mx-auto">
      <PageHeader
        icon={<BarChart2 size={22} />}
        title="Analytics"
        subtitle="Service timing, demand concentration, and order mix"
        action={
          <div className="flex gap-1.5">
            {(['7', '30', '90'] as Range[]).map((value) => (
              <FilterChip key={value} active={range === value} onClick={() => setRange(value)}>
                Last {value}d
              </FilterChip>
            ))}
          </div>
        }
      />

      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        {[
          {
            label: 'Orders',
            value: summary ? summary.totalOrders.toLocaleString() : null,
            icon: <ShoppingBag size={18} />,
          },
          {
            label: 'Revenue',
            value: summary ? formatCompactPrice(summary.revenueCents, currency) : null,
            icon: <DollarSign size={18} />,
          },
          {
            label: 'Avg Ticket',
            value: summary ? formatPrice(summary.avgTicketCents, currency) : null,
            icon: <Activity size={18} />,
          },
          {
            label: 'Live Queue',
            value: timing ? timing.activeCount.toLocaleString() : null,
            icon: <TimerReset size={18} />,
          },
        ].map((card) => (
          <div key={card.label} className="flex flex-col gap-1.5 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4">
            <div className="flex items-center gap-2 text-[var(--text-muted)] text-sm">{card.icon}{card.label}</div>
            {summaryQuery.isLoading || timingQuery.isLoading ? (
              <Skeleton className="h-8 w-24 rounded" />
            ) : (
              <p className="text-2xl font-semibold text-[var(--text)]">{card.value ?? '0'}</p>
            )}
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1.1fr)_minmax(320px,0.9fr)] gap-4">
        <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4">
          <div className="flex items-center justify-between gap-3 mb-4">
            <div>
              <h3 className="text-sm font-medium text-[var(--text)]">Service Timing</h3>
              <p className="mt-1 text-xs text-[var(--text-muted)]">How quickly orders move from created to completed.</p>
            </div>
            <Clock3 className="h-4 w-4 text-[var(--text-muted)]" />
          </div>

          {timingQuery.isLoading ? (
            <Skeleton className="h-40 rounded-xl" />
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {[
                { label: 'Completed Orders', value: timing?.completedCount?.toLocaleString() ?? '0' },
                { label: 'Avg Completion', value: formatMinutes(timing?.avgCompletionMinutes ?? 0) },
                { label: 'Median Completion', value: formatMinutes(timing?.medianCompletionMinutes ?? 0) },
                { label: 'Avg Active Age', value: formatMinutes(timing?.avgActiveMinutes ?? 0) },
              ].map((metric) => (
                <div key={metric.label} className="rounded-xl border border-[var(--border)] bg-[var(--surface-raised)] px-4 py-3">
                  <p className="text-xs uppercase tracking-[0.16em] text-[var(--text-muted)]">{metric.label}</p>
                  <p className="mt-2 text-lg font-semibold text-[var(--text)]">{metric.value}</p>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4">
          <div className="flex items-center justify-between gap-3 mb-4">
            <div>
              <h3 className="text-sm font-medium text-[var(--text)]">Status Mix</h3>
              <p className="mt-1 text-xs text-[var(--text-muted)]">Breakdown of order states in the selected range.</p>
            </div>
            {summary ? <Badge tone="accent">{summary.totalOrders} total</Badge> : null}
          </div>

          {summaryQuery.isLoading ? (
            <Skeleton className="h-40 rounded-xl" />
          ) : (
            <div className="space-y-3">
              {statusRows.map((row) => {
                const percentage = summary && summary.totalOrders > 0 ? (row.value / summary.totalOrders) * 100 : 0;

                return (
                  <div key={row.label} className="space-y-1.5">
                    <div className="flex items-center justify-between gap-3 text-sm">
                      <span className="font-medium text-[var(--text)]">{row.label}</span>
                      <span className="text-[var(--text-muted)]">{row.value.toLocaleString()}</span>
                    </div>
                    <div className="h-2.5 rounded-full bg-[var(--surface-raised)] overflow-hidden">
                      <div
                        className="h-full rounded-full"
                        style={{ width: `${Math.max(percentage, row.value > 0 ? 6 : 0)}%`, backgroundColor: row.color }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between mb-4">
          <div>
            <h3 className="text-sm font-medium text-[var(--text)]">Hourly Demand Heatmap</h3>
            <p className="mt-1 text-xs text-[var(--text-muted)]">Orders by weekday and hour. Darker cells indicate heavier throughput.</p>
          </div>
          {busiestCell ? (
            <Badge tone="accent">
              Peak {WEEKDAYS.find((day) => day.id === busiestCell.weekday)?.label} {formatHourLabel(busiestCell.hour)}
            </Badge>
          ) : null}
        </div>

        {heatmapQuery.isLoading ? (
          <Skeleton className="h-56 rounded-xl" />
        ) : heatmap.length === 0 ? (
          <p className="py-10 text-center text-sm text-[var(--text-muted)]">No heatmap data for this period.</p>
        ) : (
          <div className="overflow-x-auto">
            <div className="min-w-[920px] space-y-2">
              <div className="grid grid-cols-[72px_repeat(24,minmax(0,1fr))] gap-1">
                <div />
                {HOURS.map((hour) => (
                  <div key={hour} className="text-center text-[10px] text-[var(--text-muted)]">
                    {formatHourLabel(hour)}
                  </div>
                ))}

                {WEEKDAYS.map((day) => (
                  <Fragment key={day.id}>
                    <div className="pr-2 pt-1 text-xs font-medium text-[var(--text-muted)]">
                      {day.label}
                    </div>
                    {HOURS.map((hour) => {
                      const cell = heatmapMap.get(`${day.id}-${hour}`);
                      const orders = cell?.orders ?? 0;
                      const intensity = orders > 0 ? orders / maxOrders : 0;
                      const alpha = intensity > 0 ? 0.16 + intensity * 0.72 : 0.04;

                      return (
                        <div
                          key={`${day.id}-${hour}`}
                          className="flex h-8 items-center justify-center rounded-md border border-[var(--border)] text-[10px] font-medium text-[var(--text)]"
                          style={{ backgroundColor: `rgba(58, 123, 255, ${alpha})` }}
                          title={`${day.label} ${formatHourLabel(hour)}: ${orders} order${orders === 1 ? '' : 's'}${cell ? ` · ${formatPrice(cell.revenueCents, currency)}` : ''}`}
                        >
                          {orders > 0 ? orders : ''}
                        </div>
                      );
                    })}
                  </Fragment>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>

      {!topItemsQuery.isLoading && topItems.length > 0 ? (
        <div className="rounded-xl border border-[var(--border)] overflow-hidden bg-[var(--surface)]">
          <div className="px-4 py-3 bg-[var(--surface-raised)] text-sm font-medium text-[var(--text)]">Top Items</div>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-[var(--text-muted)] bg-[var(--surface-raised)] border-b border-[var(--border)]">
                <th className="px-4 py-2 font-medium">Item</th>
                <th className="px-4 py-2 font-medium text-right">Qty Sold</th>
                <th className="px-4 py-2 font-medium text-right">Revenue</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--border)]">
              {topItems.map((item, index) => (
                <tr key={`${item.name ?? 'unknown'}-${index}`} className="hover:bg-[var(--surface-raised)] transition-colors">
                  <td className="px-4 py-2.5 text-[var(--text)]">{item.name ?? 'Unknown'}</td>
                  <td className="px-4 py-2.5 text-right font-mono text-[var(--text)]">{item.qty.toLocaleString()}</td>
                  <td className="px-4 py-2.5 text-right font-mono text-[var(--text)]">{formatPrice(item.revenue, currency)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  );
}
