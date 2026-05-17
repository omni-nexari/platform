import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useParams, useNavigate } from 'react-router';
import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { api, buildWebSocketUrl } from '../../lib/api.js';
import { ChefHat, CreditCard, ExternalLink, Settings2 } from 'lucide-react';
import { formatDistanceToNow } from '../utils/time.js';
import {
  Badge,
  Callout,
  EmptyState,
  PageHeader,
  SectionCard,
  SectionCardBody,
  SectionCardHeader,
  Skeleton,
} from '../../components/UiPrimitives.js';

interface DisplayTokens {
  kiosk: string | null;
  kitchen: string | null;
}

interface KitchenConfig {
  columnCount: number;
  soundEnabled: boolean;
  alertIntervalSec: number;
  theme: string;
}

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

  const { data: displayTokens } = useQuery<DisplayTokens>({
    queryKey: ['pos-display-tokens', wsId],
    queryFn: () => api.get(`/pos/mgmt/display-tokens?workspaceId=${wsId}`),
    enabled: !!wsId,
  });

  const { data: kitchenConfig } = useQuery<KitchenConfig | null>({
    queryKey: ['pos-kitchen-config', wsId],
    queryFn: () => api.get(`/pos/kitchen-config?workspaceId=${wsId}`),
    enabled: !!wsId,
  });

  const [configDraft, setConfigDraft] = useState<Partial<KitchenConfig>>({});

  const generateTokenMut = useMutation({
    mutationFn: () =>
      api.post<{ token: string }>(`/pos/mgmt/display-tokens`, { displayType: 'kitchen', workspaceId: wsId }),
    onSuccess: (data) => {
      void queryClient.invalidateQueries({ queryKey: ['pos-display-tokens', wsId] });
      window.open(`/kitchen/${wsId}?dt=${data.token}`, '_blank');
    },
    onError: () => toast.error('Failed to generate display token'),
  });

  const saveConfigMut = useMutation({
    mutationFn: (patch: Partial<KitchenConfig>) =>
      api.put(`/pos/kitchen-config?workspaceId=${wsId}`, patch),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['pos-kitchen-config', wsId] });
      setConfigDraft({});
      toast.success('Kitchen config saved');
    },
    onError: () => toast.error('Failed to save kitchen config'),
  });

  const merged = { columnCount: 2, soundEnabled: true, alertIntervalSec: 30, theme: 'dark', ...kitchenConfig, ...configDraft } as KitchenConfig;
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
        const url = buildWebSocketUrl(`/pos/ws/kitchen?workspaceId=${wsId}`);
        const ws = new WebSocket(url);
        wsRef.current = ws;

        // If the effect was cleaned up while the socket was still CONNECTING,
        // close it once the handshake completes to avoid the "closed before
        // connection established" browser error.
        ws.addEventListener('open', () => {
          if (unmounted) { ws.close(); return; }
        });

        ws.addEventListener('message', () => {
          // Any kitchen event → immediately refetch
          void queryClient.invalidateQueries({ queryKey: ['pos-orders-kitchen', wsId] });
        });

        ws.addEventListener('close', () => {
          if (wsRef.current === ws) wsRef.current = null;
          if (!unmounted) reconnectTimer = setTimeout(connect, 5_000);
        });

        ws.addEventListener('error', () => {
          // Don't call ws.close() here — the browser fires 'close' right after
          // 'error', which triggers the reconnect logic above.
        });
      } catch {
        if (!unmounted) reconnectTimer = setTimeout(connect, 5_000);
      }
    }

    connect();

    return () => {
      unmounted = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      const ws = wsRef.current;
      wsRef.current = null;
      // Only close OPEN sockets; CONNECTING ones are handled by the open handler.
      if (ws && ws.readyState === WebSocket.OPEN) ws.close();
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
            disabled={generateTokenMut.isPending}
            onClick={() => {
              const token = displayTokens?.kitchen;
              if (token) {
                window.open(`/kitchen/${wsId}?dt=${token}`, '_blank');
              } else {
                generateTokenMut.mutate();
              }
            }}
          >
            <ExternalLink className="w-4 h-4" />
            Open Display
          </button>
        }
      />

      {/* Kitchen Display Settings */}
      <SectionCard>
        <SectionCardHeader>
          <div className="flex items-center gap-2">
            <Settings2 className="h-4 w-4 text-[var(--accent)]" />
            <div>
              <h2 className="text-sm font-semibold text-[var(--text)]">Kitchen Display Settings</h2>
              <p className="mt-0.5 text-xs text-[var(--text-muted)]">Configure the public kitchen screen layout, sound alerts, and theme.</p>
            </div>
          </div>
        </SectionCardHeader>
        <SectionCardBody>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-[var(--text-muted)] uppercase tracking-[0.16em]">Columns</label>
              <select
                value={merged.columnCount}
                onChange={(e) => setConfigDraft((d) => ({ ...d, columnCount: Number(e.target.value) }))}
                className="w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2.5 text-sm text-[var(--text)] outline-none focus:border-[var(--accent)]"
              >
                <option value={2}>2 — New / Preparing</option>
                <option value={3}>3 — New / Preparing / Ready</option>
              </select>
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-[var(--text-muted)] uppercase tracking-[0.16em]">Sound Alerts</label>
              <select
                value={merged.soundEnabled ? 'on' : 'off'}
                onChange={(e) => setConfigDraft((d) => ({ ...d, soundEnabled: e.target.value === 'on' }))}
                className="w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2.5 text-sm text-[var(--text)] outline-none focus:border-[var(--accent)]"
              >
                <option value="on">On</option>
                <option value="off">Off</option>
              </select>
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-[var(--text-muted)] uppercase tracking-[0.16em]">Alert Every (sec)</label>
              <input
                type="number"
                min={10}
                max={300}
                step={10}
                value={merged.alertIntervalSec}
                onChange={(e) => setConfigDraft((d) => ({ ...d, alertIntervalSec: Number(e.target.value) }))}
                className="w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2.5 text-sm text-[var(--text)] outline-none focus:border-[var(--accent)]"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-[var(--text-muted)] uppercase tracking-[0.16em]">Theme</label>
              <select
                value={merged.theme}
                onChange={(e) => setConfigDraft((d) => ({ ...d, theme: e.target.value }))}
                className="w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2.5 text-sm text-[var(--text)] outline-none focus:border-[var(--accent)]"
              >
                <option value="dark">Dark</option>
                <option value="light">Light</option>
              </select>
            </div>
          </div>
          {Object.keys(configDraft).length > 0 && (
            <div className="flex justify-end mt-4">
              <button
                className="ui-btn-primary"
                disabled={saveConfigMut.isPending}
                onClick={() => saveConfigMut.mutate(configDraft)}
              >
                {saveConfigMut.isPending ? 'Saving…' : 'Save Settings'}
              </button>
            </div>
          )}
        </SectionCardBody>
      </SectionCard>

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
