import { Outlet, useNavigate, useParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { RefreshCw } from 'lucide-react';
import { api } from '../../lib/api.js';
import { formatDistanceToNow } from '../utils/time.js';

type ActiveStatus = 'pending' | 'preparing' | 'ready';

interface OrderItem {
  id: string;
  itemName: string;
  quantity: number;
}

interface ActiveOrder {
  id: string;
  orderNumber: number;
  status: ActiveStatus;
  totalCents: number;
  customerName: string | null;
  source: string | null;
  createdAt: string;
  items: OrderItem[];
}

const STATUS_LABEL: Record<ActiveStatus, string> = {
  pending: 'Pending',
  preparing: 'Preparing',
  ready: 'Ready ↑',
};

const STATUS_STYLES: Record<ActiveStatus, string> = {
  pending: 'border-amber-400/40 bg-amber-400/5 text-amber-400',
  preparing: 'border-blue-400/40 bg-blue-400/5 text-blue-400',
  ready: 'border-emerald-400/40 bg-emerald-400/5 text-emerald-400',
};

const GROUP_LABEL_STYLES: Record<ActiveStatus, string> = {
  pending: 'text-amber-400',
  preparing: 'text-blue-400',
  ready: 'text-emerald-400',
};

function OrderCard({ order }: { order: ActiveOrder }) {
  const topItems = order.items.slice(0, 3);
  const extra = order.items.length - 3;

  return (
    <div className={`rounded-xl border px-3 py-2.5 space-y-1.5 ${STATUS_STYLES[order.status]}`}>
      <div className="flex items-center justify-between gap-1">
        <span className="text-xs font-bold text-[var(--text)]">#{order.orderNumber}</span>
        <div className="flex items-center gap-1">
          {order.source === 'uber-eats' && (
            <span className="text-[9px] font-bold bg-cyan-400/15 text-cyan-400 rounded px-1 py-0.5">🚴 Uber</span>
          )}
          <span className={`text-[9px] font-bold uppercase tracking-wider ${GROUP_LABEL_STYLES[order.status]}`}>
            {STATUS_LABEL[order.status]}
          </span>
        </div>
      </div>
      {order.customerName && (
        <p className="text-[11px] text-[var(--text-muted)] truncate">{order.customerName}</p>
      )}
      <div className="space-y-0.5">
        {topItems.map((item, i) => (
          <p key={i} className="text-[11px] text-[var(--text)] truncate">
            {item.quantity}× {item.itemName}
          </p>
        ))}
        {extra > 0 && (
          <p className="text-[10px] text-[var(--text-muted)]">+{extra} more item{extra > 1 ? 's' : ''}</p>
        )}
      </div>
      <p className="text-[10px] text-[var(--text-muted)]">{formatDistanceToNow(order.createdAt)}</p>
    </div>
  );
}

const STATUS_ORDER: ActiveStatus[] = ['ready', 'preparing', 'pending'];

export default function PosWaiterLayout() {
  const { wsId } = useParams<{ wsId: string }>();
  const navigate = useNavigate();

  const { data: orders = [], refetch, isFetching } = useQuery<ActiveOrder[]>({
    queryKey: ['pos-waiter-orders', wsId],
    queryFn: () => api.get(`/pos/mgmt/orders?workspaceId=${wsId}&status=pending,preparing,ready`),
    enabled: !!wsId,
    refetchInterval: 10_000,
  });

  const grouped = STATUS_ORDER.reduce<Record<ActiveStatus, ActiveOrder[]>>((acc, status) => {
    acc[status] = orders.filter((o) => o.status === status);
    return acc;
  }, { ready: [], preparing: [], pending: [] });

  return (
    <div className="flex h-screen bg-[var(--surface)] overflow-hidden">

      {/* ── Left: Order Status Panel ───────────────────────────────── */}
      <aside className="w-52 shrink-0 flex flex-col border-r border-[var(--border)] bg-[var(--card)] overflow-hidden">
        {/* Branding */}
        <div className="px-4 py-4 border-b border-[var(--border)] flex items-center justify-between">
          <button
            className="text-base font-bold text-[var(--text)] hover:opacity-80 transition-opacity"
            onClick={() => navigate(`/workspaces/${wsId}/pos/orders`)}
            title="Back to Orders"
          >
            Nexari<span className="text-[var(--blue)]">.</span>
          </button>
        </div>

        {/* Order queue */}
        <div className="flex-1 overflow-y-auto px-2 py-3 space-y-4">
          {STATUS_ORDER.map((status) => {
            const group = grouped[status];
            if (group.length === 0) return null;
            return (
              <section key={status}>
                <p className={`text-[10px] font-semibold uppercase tracking-wider px-2 pb-1.5 ${GROUP_LABEL_STYLES[status]}`}>
                  {status === 'ready' ? 'Ready to Pick Up' : status === 'preparing' ? 'Preparing' : 'Pending'}
                </p>
                <div className="space-y-2">
                  {group.map((order) => (
                    <OrderCard key={order.id} order={order} />
                  ))}
                </div>
              </section>
            );
          })}

          {orders.length === 0 && (
            <p className="px-2 text-xs text-[var(--text-muted)]">No active orders</p>
          )}
        </div>

        {/* Refresh */}
        <div className="border-t border-[var(--border)] p-2">
          <button
            onClick={() => void refetch()}
            disabled={isFetching}
            className="w-full flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg text-xs text-[var(--text-muted)] hover:text-[var(--text)] hover:bg-[var(--surface)] transition-colors"
          >
            <RefreshCw className={`h-3 w-3 ${isFetching ? 'animate-spin' : ''}`} />
            Refresh
          </button>
        </div>
      </aside>

      {/* ── Main content ───────────────────────────────────────────── */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        <Outlet />
      </div>
    </div>
  );
}
