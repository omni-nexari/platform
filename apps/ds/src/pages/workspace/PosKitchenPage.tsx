import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useParams, useNavigate } from 'react-router';
import { useEffect, useRef } from 'react';
import { toast } from 'sonner';
import { api, buildWebSocketUrl } from '../../lib/api.js';
import { ChefHat, CreditCard, ExternalLink } from 'lucide-react';
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
  const wsRef = useRef<WebSocket | null>(null);

  const { data: active = [], isLoading } = useQuery<PosOrder[]>({
    queryKey: ['pos-orders-kitchen', wsId],
    queryFn: () => api.get(`/pos/mgmt/orders/in-kitchen/list?workspaceId=${wsId}`),
    refetchInterval: 30_000, // fallback poll — WS handles real-time
  });

  // ── WebSocket for real-time kitchen updates ────────────────────────────────
  useEffect(() => {
    if (!wsId) return;

    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let unmounted = false;

    function connect() {
      if (unmounted) return;
      try {
        const url = buildWebSocketUrl(`/api/pos/ws/kitchen?workspaceId=${wsId}`);
        const ws = new WebSocket(url);
        wsRef.current = ws;

        ws.addEventListener('message', () => {
          // Any kitchen event → immediately refetch
          void queryClient.invalidateQueries({ queryKey: ['pos-orders-kitchen', wsId] });
        });

        ws.addEventListener('close', () => {
          wsRef.current = null;
          if (!unmounted) reconnectTimer = setTimeout(connect, 5_000);
        });

        ws.addEventListener('error', () => {
          ws.close();
        });
      } catch {
        if (!unmounted) reconnectTimer = setTimeout(connect, 5_000);
      }
    }

    connect();

    return () => {
      unmounted = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      wsRef.current?.close();
      wsRef.current = null;
    };
  }, [wsId, queryClient]);

  const advanceMut = useMutation({
    mutationFn: ({ orderId, action }: { orderId: string; action: 'confirm' | 'ready' }) => {
      if (action === 'confirm') {
        return api.post(`/pos/mgmt/orders/${orderId}/confirm`);
      }

      return api.patch(`/pos/mgmt/orders/${orderId}/status`, { status: 'ready' });
    },
    onSuccess: async (_data, variables) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['pos-orders'] }),
        queryClient.invalidateQueries({ queryKey: ['pos-orders-kitchen'] }),
        queryClient.invalidateQueries({ queryKey: ['pos-order-history'] }),
        queryClient.invalidateQueries({ queryKey: ['pos-orders-stats'] }),
      ]);
      toast.success(variables.action === 'confirm' ? 'Order started' : 'Order marked ready');
    },
    onError: () => toast.error('Failed to update order'),
  });

  return (
    <div className="flex flex-col gap-6 p-4 sm:p-6 max-w-screen-xl mx-auto">
      <PageHeader
        title="Kitchen Monitor"
        subtitle="Pending, preparing, and ready orders — live via WebSocket"
        action={
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
          description="No pending, preparing, or ready orders right now."
        />
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {active.map((order) => (
            <div
              key={order.id}
              className={`ui-card p-4 space-y-3 border-l-4 ${
                order.status === 'ready'
                  ? 'border-l-emerald-500'
                  : order.status === 'preparing'
                    ? 'border-l-[var(--accent)]'
                    : 'border-l-[var(--warning)]'
              }`}
            >
              <div className="flex items-center justify-between">
                <span className="text-xl font-bold tabular-nums text-[var(--text)]">
                  #{order.orderNumber}
                </span>
                <Badge tone={order.status === 'ready' ? 'success' : order.status === 'preparing' ? 'accent' : 'warning'}>
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
                    onClick={() => advanceMut.mutate({ orderId: order.id, action: 'confirm' })}
                  >
                    Start
                  </button>
                )}
                {order.status === 'preparing' && (
                  <button
                    className="flex-1 ui-btn-primary text-xs py-1.5"
                    onClick={() => advanceMut.mutate({ orderId: order.id, action: 'ready' })}
                  >
                    Ready
                  </button>
                )}
                {order.status === 'ready' && (
                  <button
                    className="flex-1 ui-btn-primary text-xs py-1.5 flex items-center justify-center gap-1.5"
                    onClick={() => navigate(`/workspaces/${wsId}/pos/payment?orderId=${order.id}&total=${order.totalCents}`)}
                  >
                    <CreditCard className="h-3.5 w-3.5" />
                    Payment
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
