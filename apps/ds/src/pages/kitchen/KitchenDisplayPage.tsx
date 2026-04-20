import { useEffect, useState, useCallback, useRef } from 'react';
import { useParams, useSearchParams } from 'react-router';
import { buildWebSocketUrl } from '../../lib/api.js';

// â”€â”€â”€ Types â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
type OrderStatus = 'pending' | 'preparing' | 'ready' | 'completed' | 'cancelled';

interface KitchenOrderItem {
  id: string;
  itemName: string;
  quantity: number;
  notes: string | null;
  lineTotalCents: number;
}

interface KitchenOrder {
  id: string;
  orderNumber: number;
  status: OrderStatus;
  customerName: string | null;
  notes: string | null;
  totalCents: number;
  createdAt: string;
  items: KitchenOrderItem[];
}

interface KitchenConfig {
  columnCount: number;       // 2 | 3
  soundEnabled: boolean;
  alertIntervalSec: number;
  theme: 'dark' | 'light';
}

// â”€â”€â”€ Helpers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function resolveApiBase() { return '/api'; }

function timeAgo(isoString: string): string {
  const diff = Math.floor((Date.now() - new Date(isoString).getTime()) / 1000);
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  return `${Math.floor(diff / 3600)}h ago`;
}

function playBeep() {
  try {
    const ctx = new AudioContext();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.type = 'sine';
    osc.frequency.setValueAtTime(880, ctx.currentTime);
    gain.gain.setValueAtTime(0.3, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.4);
    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + 0.4);
  } catch {
    // AudioContext not available
  }
}

// â”€â”€â”€ Main Component â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
export default function KitchenDisplayPage() {
  const { wsId } = useParams<{ wsId: string }>();
  const [searchParams] = useSearchParams();
  const routeToken = searchParams.get('dt') ?? '';
  const storedToken = localStorage.getItem('kitchen.deviceToken') ?? '';
  const displayToken = routeToken || storedToken;

  const [orders, setOrders] = useState<KitchenOrder[]>([]);
  const [config, setConfig] = useState<KitchenConfig>({ columnCount: 2, soundEnabled: true, alertIntervalSec: 30, theme: 'dark' });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [wsConnected, setWsConnected] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const prevOrderIdsRef = useRef<Set<string>>(new Set());
  const alertTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Persist token
  useEffect(() => {
    if (routeToken) localStorage.setItem('kitchen.deviceToken', routeToken);
  }, [routeToken]);

  // Fetch kitchen config on mount
  useEffect(() => {
    if (!displayToken) return;
    fetch(`${resolveApiBase()}/pos/kiosk/kitchen-config?dt=${displayToken}`)
      .then((r) => r.ok ? r.json() : null)
      .then((data: KitchenConfig | null) => { if (data) setConfig(data); })
      .catch(() => {});
  }, [displayToken]);

  async function fetchOrders(silent = false): Promise<void> {
    if (!wsId || !displayToken) return;
    if (!silent) setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `${resolveApiBase()}/pos/kiosk/kitchen-orders?dt=${displayToken}`,
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data: KitchenOrder[] = await res.json();
      applyOrders(data);
    } catch (e: unknown) {
      if (!silent) setError(e instanceof Error ? e.message : 'Failed to load orders');
    } finally {
      if (!silent) setLoading(false);
    }
  }

  function applyOrders(data: KitchenOrder[]) {
    const prevIds = prevOrderIdsRef.current;
    const hasNew = data.some((o) => !prevIds.has(o.id) && o.status === 'pending');
    if (hasNew && config.soundEnabled) playBeep();
    prevOrderIdsRef.current = new Set(data.map((o) => o.id));
    setOrders(data);
  }

  // â”€â”€ WebSocket connection â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  useEffect(() => {
    if (!wsId || !displayToken) return;

    let unmounted = false;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

    function connect() {
      if (unmounted) return;
      try {
        const url = buildWebSocketUrl(`/pos/ws/kitchen-public?dt=${displayToken}`);
        const ws = new WebSocket(url);
        wsRef.current = ws;

        ws.addEventListener('open', () => {
          if (unmounted) { ws.close(); return; }
          setWsConnected(true);
          // WS connected â€” clear fallback poll
          if (pollRef.current !== null) { clearInterval(pollRef.current); pollRef.current = null; }
        });

        ws.addEventListener('message', (evt) => {
          try {
            const msg = JSON.parse(String(evt.data)) as { type?: string; orders?: KitchenOrder[] };
            if (msg.type === 'order_created' || msg.type === 'order_updated' || msg.type === 'kitchen_update') {
              void fetchOrders(true);
            }
          } catch { /* ignore */ }
        });

        ws.addEventListener('close', () => {
          setWsConnected(false);
          wsRef.current = null;
          // Start fallback poll while disconnected
          if (!pollRef.current) {
            pollRef.current = setInterval(() => void fetchOrders(true), 5_000);
          }
          if (!unmounted) reconnectTimer = setTimeout(connect, 3_000);
        });

        ws.addEventListener('error', () => {
          ws.close();
        });
      } catch {
        if (!unmounted) reconnectTimer = setTimeout(connect, 3_000);
      }
    }

    void fetchOrders(false);
    connect();

    return () => {
      unmounted = true;
      if (reconnectTimer !== null) clearTimeout(reconnectTimer);
      if (pollRef.current !== null) { clearInterval(pollRef.current); pollRef.current = null; }
      if (wsRef.current?.readyState === WebSocket.OPEN) wsRef.current.close();
    };
  }, [wsId, displayToken]);

  // â”€â”€ Periodic sound alert for pending orders â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  useEffect(() => {
    if (alertTimerRef.current) clearInterval(alertTimerRef.current);
    if (!config.soundEnabled) return;
    alertTimerRef.current = setInterval(() => {
      setOrders((cur) => {
        if (cur.some((o) => o.status === 'pending')) playBeep();
        return cur;
      });
    }, config.alertIntervalSec * 1000);
    return () => { if (alertTimerRef.current) clearInterval(alertTimerRef.current); };
  }, [config.soundEnabled, config.alertIntervalSec]);

  // â”€â”€ Update order status â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  async function updateStatus(orderId: string, newStatus: OrderStatus) {
    setUpdatingId(orderId);
    try {
      const res = await fetch(
        `${resolveApiBase()}/pos/kiosk/kitchen-orders/${orderId}/status?dt=${displayToken}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ status: newStatus }),
        },
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      if (newStatus === 'completed' || newStatus === 'cancelled') {
        setOrders((prev) => prev.filter((o) => o.id !== orderId));
      } else {
        setOrders((prev) => prev.map((o) => (o.id === orderId ? { ...o, status: newStatus } : o)));
      }
    } catch (e: unknown) {
      alert('Failed to update: ' + (e instanceof Error ? e.message : String(e)));
    } finally {
      setUpdatingId(null);
    }
  }

  const pending   = orders.filter((o) => o.status === 'pending');
  const preparing = orders.filter((o) => o.status === 'preparing');
  const ready     = orders.filter((o) => o.status === 'ready');
  const showReady = config.columnCount >= 3;

  const isDark = config.theme !== 'light';
  const T = isDark ? DARK : LIGHT;

  // â”€â”€ Loading / Error â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  if (loading) {
    return (
      <div style={{ ...S.root, background: T.bg, color: T.text }}>
        <div style={S.centered}>
          <div style={{ ...S.spinner, borderTopColor: '#f59e0b' }} />
          <p style={{ fontSize: 16, color: T.dim }}>Loading ordersâ€¦</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ ...S.root, background: T.bg, color: T.text }}>
        <div style={S.centered}>
          <div style={{ fontSize: 64 }}>âš </div>
          <h2 style={{ color: '#ff3ea5', fontSize: 28, fontWeight: 700 }}>Display Error</h2>
          <p style={{ fontSize: 16, color: T.dim }}>{error}</p>
          <button style={S.retryBtn} onClick={() => void fetchOrders(false)}>Retry</button>
        </div>
      </div>
    );
  }

  // â”€â”€ Main display â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  return (
    <div style={{ ...S.root, background: T.bg, color: T.text }}>
      {/* Header */}
      <div style={{ ...S.header, background: T.headerBg, borderColor: T.border }}>
        <span style={{ fontSize: 22, fontWeight: 800 }}>Kitchen Display</span>
        <span style={{ fontSize: 14, color: T.dim, flex: 1 }}>
          {orders.length === 0 ? 'All clear' : `${orders.length} active order${orders.length !== 1 ? 's' : ''}`}
        </span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 700, color: wsConnected ? '#22c55e' : '#f59e0b', letterSpacing: '0.1em' }}>
          <span style={{ width: 8, height: 8, borderRadius: '50%', background: wsConnected ? '#22c55e' : '#f59e0b', animation: 'kitchen-pulse 1.5s ease-in-out infinite', display: 'inline-block' }} />
          {wsConnected ? 'LIVE' : 'POLLING'}
        </div>
      </div>

      {/* Columns */}
      <div style={{ ...S.columns, gridTemplateColumns: `repeat(${config.columnCount}, 1fr)` }}>

        {/* NEW ORDERS */}
        <div style={{ ...S.column, borderColor: T.border }}>
          <div style={{ ...S.columnHeader, borderColor: '#f59e0b' }}>
            <span style={{ color: '#f59e0b' }}>NEW ORDERS</span>
            <span style={{ ...S.columnCount, background: T.badge, color: T.text }}>{pending.length}</span>
          </div>
          <div style={S.cardList}>
            {pending.length === 0 && <div style={{ textAlign: 'center', color: T.dim, fontSize: 15, padding: '40px 0' }}>No new orders</div>}
            {pending.map((order) => (
              <OrderCard key={order.id} order={order} theme={T} updating={updatingId === order.id}
                primaryAction={{ label: 'Start Preparing', status: 'preparing', color: '#3a7bff' }}
                secondaryAction={{ label: 'Cancel', status: 'cancelled', color: '#ff3ea5' }}
                onAction={updateStatus}
              />
            ))}
          </div>
        </div>

        {/* PREPARING */}
        <div style={{ ...S.column, borderColor: T.border }}>
          <div style={{ ...S.columnHeader, borderColor: '#3a7bff' }}>
            <span style={{ color: '#3a7bff' }}>PREPARING</span>
            <span style={{ ...S.columnCount, background: T.badge, color: T.text }}>{preparing.length}</span>
          </div>
          <div style={S.cardList}>
            {preparing.length === 0 && <div style={{ textAlign: 'center', color: T.dim, fontSize: 15, padding: '40px 0' }}>Nothing preparing</div>}
            {preparing.map((order) => (
              <OrderCard key={order.id} order={order} theme={T} updating={updatingId === order.id}
                primaryAction={{ label: 'Mark Ready', status: 'ready', color: '#22c55e' }}
                secondaryAction={{ label: 'Cancel', status: 'cancelled', color: '#ff3ea5' }}
                onAction={updateStatus}
              />
            ))}
          </div>
        </div>

        {/* READY (optional 3rd column) */}
        {showReady && (
          <div style={{ ...S.column, borderColor: T.border }}>
            <div style={{ ...S.columnHeader, borderColor: '#22c55e' }}>
              <span style={{ color: '#22c55e' }}>READY</span>
              <span style={{ ...S.columnCount, background: T.badge, color: T.text }}>{ready.length}</span>
            </div>
            <div style={S.cardList}>
              {ready.length === 0 && <div style={{ textAlign: 'center', color: T.dim, fontSize: 15, padding: '40px 0' }}>Nothing ready yet</div>}
              {ready.map((order) => (
                <OrderCard key={order.id} order={order} theme={T} updating={updatingId === order.id}
                  primaryAction={{ label: 'Complete', status: 'completed', color: '#7c3aed' }}
                  secondaryAction={{ label: 'Back to Prep', status: 'preparing', color: '#3a7bff' }}
                  onAction={updateStatus}
                />
              ))}
            </div>
          </div>
        )}

      </div>
    </div>
  );
}

// â”€â”€â”€ Order Card â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
interface Theme {
  bg: string; text: string; dim: string; border: string;
  badge: string; headerBg: string; card: string; cardBorder: string;
  itemNote: string; orderNote: string; orderNoteBg: string; orderNoteBorder: string;
}

interface OrderCardProps {
  order: KitchenOrder;
  updating: boolean;
  theme: Theme;
  primaryAction:   { label: string; status: OrderStatus; color: string };
  secondaryAction: { label: string; status: OrderStatus; color: string };
  onAction: (orderId: string, status: OrderStatus) => void;
}

function OrderCard({ order, updating, theme: T, primaryAction, secondaryAction, onAction }: OrderCardProps) {
  const urgent = (Date.now() - new Date(order.createdAt).getTime()) > 10 * 60 * 1000;

  return (
    <div style={{ ...S.card, background: T.card, border: `1px solid ${urgent ? 'rgba(245,158,11,0.5)' : T.cardBorder}`, boxShadow: urgent ? '0 0 16px rgba(245,158,11,0.15)' : 'none' }}>
      <div style={S.cardTop}>
        <span style={{ fontSize: 28, fontWeight: 900, color: '#f59e0b', letterSpacing: '0.05em' }}>#{String(order.orderNumber).padStart(3, '0')}</span>
        {order.customerName && <span style={{ fontSize: 16, fontWeight: 600, flex: 1 }}>{order.customerName}</span>}
        <span style={{ fontSize: 13, color: urgent ? '#f59e0b' : T.dim, marginLeft: 'auto' }}>
          {urgent ? 'âš  ' : ''}{timeAgo(order.createdAt)}
        </span>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {order.items.map((item) => (
          <div key={item.id} style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
            <span style={{ fontSize: 16, fontWeight: 800, color: '#4ff2d1', minWidth: 36, textAlign: 'right' }}>x{item.quantity}</span>
            <span style={{ fontSize: 18, fontWeight: 600 }}>{item.itemName}</span>
            {item.notes && <span style={{ fontSize: 13, color: T.itemNote, fontStyle: 'italic' }}>{item.notes}</span>}
          </div>
        ))}
      </div>

      {order.notes && (
        <div style={{ fontSize: 14, color: T.orderNote, background: T.orderNoteBg, border: `1px solid ${T.orderNoteBorder}`, borderRadius: 8, padding: '8px 12px' }}>
          ðŸ“ {order.notes}
        </div>
      )}

      <div style={{ display: 'flex', gap: 10, marginTop: 4 }}>
        <button
          style={{ flex: 1, border: 'none', borderRadius: 12, background: primaryAction.color, color: '#0f1115', cursor: 'pointer', fontSize: 15, fontWeight: 700, padding: '12px', opacity: updating ? 0.5 : 1 }}
          disabled={updating}
          onClick={() => onAction(order.id, primaryAction.status)}
        >
          {updating ? 'â€¦' : primaryAction.label}
        </button>
        <button
          style={{ flex: 0.5, background: 'transparent', borderRadius: 12, border: `2px solid ${secondaryAction.color}`, color: secondaryAction.color, cursor: 'pointer', fontSize: 15, fontWeight: 700, padding: '12px', opacity: updating ? 0.5 : 1 }}
          disabled={updating}
          onClick={() => onAction(order.id, secondaryAction.status)}
        >
          {secondaryAction.label}
        </button>
      </div>
    </div>
  );
}

// â”€â”€â”€ Themes â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const DARK: Theme = {
  bg: '#0b0d11', text: '#e8eaf0', dim: '#7a8299',
  border: 'rgba(255,255,255,0.08)', badge: 'rgba(255,255,255,0.08)',
  headerBg: 'rgba(255,255,255,0.04)', card: 'rgba(255,255,255,0.06)',
  cardBorder: 'rgba(255,255,255,0.1)', itemNote: '#7a8299',
  orderNote: '#f59e0b', orderNoteBg: 'rgba(245,158,11,0.1)', orderNoteBorder: 'rgba(245,158,11,0.2)',
};
const LIGHT: Theme = {
  bg: '#f5f5f5', text: '#1a1a1a', dim: '#6b7280',
  border: '#e5e7eb', badge: '#e5e7eb',
  headerBg: '#ffffff', card: '#ffffff',
  cardBorder: '#e5e7eb', itemNote: '#6b7280',
  orderNote: '#92400e', orderNoteBg: '#fef3c7', orderNoteBorder: '#fde68a',
};

// â”€â”€â”€ Styles â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const S: Record<string, React.CSSProperties> = {
  root: { display: 'flex', flexDirection: 'column', width: '100vw', height: '100vh', overflow: 'hidden', fontFamily: "'Inter', 'Segoe UI', system-ui, sans-serif" },
  centered: { display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', width: '100vw', height: '100vh', gap: 16 },
  spinner: { width: 56, height: 56, border: '4px solid rgba(255,255,255,0.1)', borderRadius: '50%', animation: 'kitchen-spin 0.8s linear infinite' },
  retryBtn: { background: '#f59e0b', border: 'none', borderRadius: 12, color: '#0f1115', cursor: 'pointer', fontSize: 16, fontWeight: 700, padding: '14px 36px' },
  header: { display: 'flex', alignItems: 'center', gap: 16, padding: '14px 24px', borderBottom: '1px solid', flexShrink: 0 },
  columns: { display: 'grid', flex: 1, overflow: 'hidden' },
  column: { display: 'flex', flexDirection: 'column', overflow: 'hidden', borderRight: '1px solid' },
  columnHeader: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 20px', borderBottom: '3px solid', fontSize: 18, fontWeight: 800, flexShrink: 0, letterSpacing: '0.03em' },
  columnCount: { borderRadius: 20, fontSize: 14, fontWeight: 700, padding: '3px 12px' },
  cardList: { flex: 1, overflowY: 'auto', padding: 16, display: 'flex', flexDirection: 'column', gap: 14 },
  card: { borderRadius: 16, padding: 18, display: 'flex', flexDirection: 'column', gap: 12 },
  cardTop: { display: 'flex', alignItems: 'baseline', gap: 10 },
};

// Inject keyframes once
if (typeof document !== 'undefined') {
  const existing = document.getElementById('kitchen-keyframes');
  if (!existing) {
    const style = document.createElement('style');
    style.id = 'kitchen-keyframes';
    style.textContent = `
      @keyframes kitchen-spin  { to { transform: rotate(360deg); } }
      @keyframes kitchen-pulse { 0%,100% { opacity: 1; } 50% { opacity: 0.3; } }
    `;
    document.head.appendChild(style);
  }
}
