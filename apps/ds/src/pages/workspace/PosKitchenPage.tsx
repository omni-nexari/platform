import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useParams, useNavigate } from 'react-router';
import { toast } from 'sonner';
import { api } from '../../lib/api.js';
import { ChefHat, ExternalLink } from 'lucide-react';
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

export default function PosKitchenPage() {
  const { wsId } = useParams<{ wsId: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const { data: active = [], isLoading } = useQuery<PosOrder[]>({
    queryKey: ['pos-orders-kitchen', wsId],
    queryFn: () => api.get(`/pos/mgmt/orders?workspaceId=${wsId}&status=pending,preparing`),
    refetchInterval: 5_000,
  });

  const advanceMut = useMutation({
    mutationFn: ({ orderId, status }: { orderId: string; status: string }) =>
      api.patch(`/pos/mgmt/orders/${orderId}/status`, { status }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['pos-orders-kitchen', wsId] }),
    onError: () => toast.error('Failed to update order'),
  });

  return (
    <div className="flex flex-col gap-6 p-4 sm:p-6 max-w-screen-xl mx-auto">
      <PageHeader
        title="Kitchen Monitor"
        description="Active orders — auto-refreshes every 5s"
        actions={
          <button
            className="ui-btn-secondary flex items-center gap-1.5"
            onClick={() => window.open(`/kitchen/${wsId}`, '_blank')}
          >
            <ExternalLink className="w-4 h-4" />
            Open Display
          </button>
        }
      />

      {isLoading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-40 rounded-xl" />
          ))}
        </div>
      ) : active.length === 0 ? (
        <EmptyState
          icon={<ChefHat className="w-8 h-8" />}
          title="Queue clear"
          description="No pending or preparing orders right now."
        />
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {active.map((order) => (
            <div
              key={order.id}
              className={`ui-card p-4 space-y-3 border-l-4 ${
                order.status === 'preparing'
                  ? 'border-l-[var(--blue)]'
                  : 'border-l-[var(--warning)]'
              }`}
            >
              <div className="flex items-center justify-between">
                <span className="text-xl font-bold tabular-nums text-[var(--text)]">
                  #{order.orderNumber}
                </span>
                <Badge tone={order.status === 'preparing' ? 'info' : 'warning'}>
                  {order.status}
                </Badge>
              </div>
              {order.customerName && (
                <p className="text-xs text-[var(--text-muted)]">{order.customerName}</p>
              )}
              <ul className="space-y-1 text-sm text-[var(--text)]">
                {order.items.map((item) => (
                  <li key={item.id}>
                    <span className="font-medium">{item.quantity}×</span> {item.itemName}
                  </li>
                ))}
              </ul>
              <p className="text-xs text-[var(--text-muted)]">{formatDistanceToNow(order.createdAt)}</p>
              <div className="flex gap-2">
                {order.status === 'pending' && (
                  <button
                    className="flex-1 ui-btn-primary text-xs py-1.5"
                    onClick={() => advanceMut.mutate({ orderId: order.id, status: 'preparing' })}
                  >
                    Start
                  </button>
                )}
                {order.status === 'preparing' && (
                  <button
                    className="flex-1 ui-btn-primary text-xs py-1.5"
                    onClick={() => advanceMut.mutate({ orderId: order.id, status: 'ready' })}
                  >
                    Ready
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
