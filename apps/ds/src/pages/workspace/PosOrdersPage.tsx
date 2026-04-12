import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useParams } from 'react-router';
import { useState } from 'react';
import { toast } from 'sonner';
import { api } from '../../lib/api.js';
import { ClipboardList, RotateCcw } from 'lucide-react';
import { formatDistanceToNow } from '../utils/time.js';
import {
  Badge,
  EmptyState,
  PageHeader,
  Skeleton,
} from '../../components/UiPrimitives.js';

interface PosOrder {
  id: string;
  orderNumber: number;
  status: 'pending' | 'preparing' | 'ready' | 'completed' | 'cancelled';
  totalCents: number;
  customerName: string | null;
  createdAt: string;
  items: {
    id: string;
    itemName: string;
    quantity: number;
    unitPriceCents: number;
  }[];
}

const STATUS_TONES = {
  pending: 'warning',
  preparing: 'info',
  ready: 'success',
  completed: 'neutral',
  cancelled: 'danger',
} as const;

const NEXT_STATUS: Partial<Record<PosOrder['status'], PosOrder['status']>> = {
  pending: 'preparing',
  preparing: 'ready',
  ready: 'completed',
};

function formatPrice(cents: number) {
  return `$${(cents / 100).toFixed(2)}`;
}

const STATUS_FILTERS = ['all', 'pending', 'preparing', 'ready', 'completed', 'cancelled'] as const;
type StatusFilter = (typeof STATUS_FILTERS)[number];

export default function PosOrdersPage() {
  const { wsId } = useParams<{ wsId: string }>();
  const queryClient = useQueryClient();
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('pending');

  const { data: orders = [], isLoading } = useQuery<PosOrder[]>({
    queryKey: ['pos-orders', wsId, statusFilter],
    queryFn: () =>
      api.get(`/pos/mgmt/orders?workspaceId=${wsId}${statusFilter !== 'all' ? `&status=${statusFilter}` : ''}`),
    refetchInterval: 10_000,
  });

  const advanceMut = useMutation({
    mutationFn: ({ orderId, status }: { orderId: string; status: string }) =>
      api.patch(`/pos/mgmt/orders/${orderId}/status`, { status }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['pos-orders', wsId] }),
    onError: () => toast.error('Failed to update order status'),
  });

  return (
    <div className="flex flex-col gap-6 p-4 sm:p-6 max-w-screen-xl mx-auto">
      <PageHeader
        title="Orders"
        description="Live order queue"
        actions={
          <button
            className="ui-btn-secondary flex items-center gap-1.5"
            onClick={() => void queryClient.invalidateQueries({ queryKey: ['pos-orders', wsId] })}
          >
            <RotateCcw className="w-4 h-4" />
            Refresh
          </button>
        }
      />

      {/* Status filter tabs */}
      <div className="flex items-center gap-1 rounded-lg border border-[var(--card-border)] overflow-hidden text-xs w-fit">
        {STATUS_FILTERS.map((s) => (
          <button
            key={s}
            onClick={() => setStatusFilter(s)}
            className={`px-3 py-1.5 capitalize transition-colors ${
              statusFilter === s
                ? 'bg-[var(--blue)] text-white'
                : 'text-[var(--text-muted)] hover:text-[var(--text)] hover:bg-[var(--surface)]'
            }`}
          >
            {s === 'all' ? 'All' : s}
          </button>
        ))}
      </div>

      {isLoading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-40 rounded-xl" />
          ))}
        </div>
      ) : orders.length === 0 ? (
        <EmptyState
          icon={<ClipboardList className="w-8 h-8" />}
          title="No orders"
          description={statusFilter === 'all' ? 'No orders yet.' : `No ${statusFilter} orders.`}
        />
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {orders.map((order) => (
            <div key={order.id} className="ui-card p-4 space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <span className="text-lg font-bold tabular-nums text-[var(--text)]">
                    #{order.orderNumber}
                  </span>
                  {order.customerName && (
                    <p className="text-xs text-[var(--text-muted)]">{order.customerName}</p>
                  )}
                </div>
                <Badge tone={STATUS_TONES[order.status] ?? 'neutral'}>
                  {order.status}
                </Badge>
              </div>

              <ul className="space-y-0.5 text-sm text-[var(--text)]">
                {order.items.map((item) => (
                  <li key={item.id} className="flex justify-between gap-2">
                    <span className="truncate">
                      {item.quantity}× {item.itemName}
                    </span>
                    <span className="text-[var(--text-muted)] shrink-0">
                      {formatPrice(item.unitPriceCents * item.quantity)}
                    </span>
                  </li>
                ))}
              </ul>

              <div className="flex items-center justify-between text-xs text-[var(--text-muted)] border-t border-[var(--border)] pt-2">
                <span>{formatDistanceToNow(order.createdAt)}</span>
                <span className="font-semibold text-[var(--text)]">{formatPrice(order.totalCents)}</span>
              </div>

              {NEXT_STATUS[order.status] && (
                <button
                  className="w-full ui-btn-primary text-xs py-1.5"
                  disabled={advanceMut.isPending}
                  onClick={() =>
                    advanceMut.mutate({ orderId: order.id, status: NEXT_STATUS[order.status]! })
                  }
                >
                  Mark {NEXT_STATUS[order.status]}
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
