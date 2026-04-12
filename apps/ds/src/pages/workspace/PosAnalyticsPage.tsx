import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useParams } from 'react-router';
import { BarChart2, TrendingUp, ShoppingBag, DollarSign } from 'lucide-react';
import { api } from '../../lib/api.js';
import { FilterChip, PageHeader, Skeleton } from '../../components/UiPrimitives.js';

interface AnalyticsSummary {
  totalOrders:  number;
  totalRevenue: number;
  avgTicket:    number;
  byDay:   { date: string; orders: number; revenue: number }[];
  topItems: { name: string | null; qty: number; revenue: number }[];
}

type Range = '7' | '30' | '90';

function fmt(cents: number) { return `$${(cents / 100).toFixed(2)}`; }
function fmtK(cents: number) {
  const d = cents / 100;
  return d >= 1000 ? `$${(d / 1000).toFixed(1)}k` : `$${d.toFixed(0)}`;
}

export default function PosAnalyticsPage() {
  const { wsId } = useParams<{ wsId: string }>();
  const [range, setRange] = useState<Range>('30');

  const from = new Date(Date.now() - parseInt(range) * 86_400_000).toISOString().slice(0, 10);
  const to   = new Date().toISOString().slice(0, 10);

  const { data, isLoading } = useQuery<AnalyticsSummary>({
    queryKey: ['pos-analytics', wsId, range],
    queryFn: () => api.get(`/pos/analytics/summary?workspaceId=${wsId}&from=${from}&to=${to}`),
  });

  const maxRevenue = data ? Math.max(...data.byDay.map((d) => d.revenue), 1) : 1;

  return (
    <div className="flex flex-col gap-6 p-4 sm:p-6 max-w-screen-xl mx-auto">
      <PageHeader
        icon={<BarChart2 size={22} />}
        title="Analytics"
        subtitle="Sales performance and trends"
        action={
          <div className="flex gap-1.5">
            {(['7', '30', '90'] as Range[]).map((r) => (
              <FilterChip key={r} active={range === r} onClick={() => setRange(r)}>Last {r}d</FilterChip>
            ))}
          </div>
        }
      />

      {/* Stat cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {[
          { label: 'Total Orders',  value: isLoading ? null : data?.totalOrders.toLocaleString() ?? '0', icon: <ShoppingBag size={18} /> },
          { label: 'Total Revenue', value: isLoading ? null : fmtK(data?.totalRevenue ?? 0),              icon: <DollarSign size={18} /> },
          { label: 'Avg Ticket',    value: isLoading ? null : fmt(data?.avgTicket ?? 0),                  icon: <TrendingUp size={18} /> },
        ].map(({ label, value, icon }) => (
          <div key={label} className="flex flex-col gap-1.5 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4">
            <div className="flex items-center gap-2 text-[var(--text-muted)] text-sm">{icon}{label}</div>
            {isLoading
              ? <Skeleton className="h-8 w-24 rounded" />
              : <p className="text-2xl font-semibold text-[var(--text)]">{value}</p>}
          </div>
        ))}
      </div>

      {/* Revenue by day mini bar chart */}
      <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4">
        <h3 className="text-sm font-medium text-[var(--text)] mb-4">Revenue by Day</h3>
        {isLoading ? (
          <Skeleton className="h-32 rounded" />
        ) : !data || data.byDay.length === 0 ? (
          <p className="text-sm text-[var(--text-muted)] py-8 text-center">No data for this period.</p>
        ) : (
          <div className="flex items-end gap-1 h-32 overflow-x-auto">
            {data.byDay.map((d) => {
              const pct = Math.max(4, Math.round((d.revenue / maxRevenue) * 100));
              return (
                <div key={d.date} className="flex flex-col items-center gap-1 min-w-[28px] group">
                  <div className="relative flex-1 w-full flex items-end">
                    <div
                      className="w-full rounded-t bg-[var(--accent)] opacity-80 group-hover:opacity-100 transition-opacity cursor-default"
                      style={{ height: `${pct}%` }}
                      title={`${d.date}: ${fmt(d.revenue)} (${d.orders} orders)`}
                    />
                  </div>
                  <span className="text-[10px] text-[var(--text-muted)] rotate-45 origin-left whitespace-nowrap">
                    {d.date.slice(5)}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Top items table */}
      {!isLoading && data && data.topItems.length > 0 && (
        <div className="rounded-xl border border-[var(--border)] overflow-hidden">
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
              {data.topItems.map((item, i) => (
                <tr key={i} className="hover:bg-[var(--surface-raised)] transition-colors">
                  <td className="px-4 py-2.5 text-[var(--text)]">{item.name ?? 'Unknown'}</td>
                  <td className="px-4 py-2.5 text-right font-mono text-[var(--text)]">{item.qty.toLocaleString()}</td>
                  <td className="px-4 py-2.5 text-right font-mono text-[var(--text)]">{fmt(item.revenue)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
