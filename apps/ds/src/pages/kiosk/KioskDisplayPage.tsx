import { useEffect, useState, useCallback } from 'react';
import { useParams, useSearchParams } from 'react-router';

// ─── Types ─────────────────────────────────────────────────────────────────────
interface PosItem {
  id: string;
  name: string;
  description: string | null;
  imageUrl: string | null;
  priceCents: number;
  isAvailable: boolean;
  tags: string[];
  modifiers: {
    id: string;
    name: string;
    required: boolean;
    maxSelect: number;
    options: { id: string; name: string; priceCents: number }[];
  }[];
}

interface PosCategory {
  id: string;
  name: string;
  description: string | null;
  imageUrl: string | null;
  color: string | null;
  items: PosItem[];
}

interface PosMenu {
  id: string;
  name: string;
  currency: string;
  categories: PosCategory[];
}

interface CartItem {
  itemId: string;
  itemName: string;
  itemPriceCents: number;
  quantity: number;
  notes: string;
  selectedModifiers: { groupName: string; optionName: string; priceCents: number }[];
  lineTotalCents: number;
}

// ─── Helpers ───────────────────────────────────────────────────────────────────
function formatPrice(cents: number, currency = 'USD') {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(cents / 100);
}

function resolveApiBase() {
  // In Tizen webview, the ds app runs at the server origin
  return '/api/v1';
}

// ─── Main Component ────────────────────────────────────────────────────────────
export default function KioskDisplayPage() {
  const { wsId, orientation = 'portrait' } = useParams<{ wsId: string; orientation: string }>();
  const [searchParams] = useSearchParams();
  const deviceToken = searchParams.get('dt') ?? '';

  const [menu, setMenu] = useState<PosMenu | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeCategoryId, setActiveCategoryId] = useState<string | null>(null);
  const [cart, setCart] = useState<CartItem[]>([]);
  const [cartOpen, setCartOpen] = useState(false);
  const [orderPlaced, setOrderPlaced] = useState<{ orderNumber: number } | null>(null);
  const [placing, setPlacing] = useState(false);
  const [customerName, setCustomerName] = useState('');

  // Persist device token to localStorage so refreshes don't lose it
  useEffect(() => {
    if (deviceToken) {
      localStorage.setItem('kiosk.deviceToken', deviceToken);
    }
  }, [deviceToken]);

  // ── Fetch menu ────────────────────────────────────────────────────────────────
  const loadMenu = useCallback(async () => {
    if (!wsId) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${resolveApiBase()}/pos/menu?workspaceId=${wsId}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data: PosMenu = await res.json();
      setMenu(data);
      if (data.categories.length > 0) {
        setActiveCategoryId(data.categories[0]!.id);
      }
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to load menu');
    } finally {
      setLoading(false);
    }
  }, [wsId]);

  useEffect(() => { void loadMenu(); }, [loadMenu]);

  // ── Cart helpers ──────────────────────────────────────────────────────────────
  function addToCart(item: PosItem) {
    setCart((prev) => {
      const existing = prev.find((c) => c.itemId === item.id && c.notes === '' && c.selectedModifiers.length === 0);
      if (existing) {
        return prev.map((c) =>
          c === existing
            ? { ...c, quantity: c.quantity + 1, lineTotalCents: (c.quantity + 1) * c.itemPriceCents }
            : c,
        );
      }
      return [
        ...prev,
        {
          itemId: item.id,
          itemName: item.name,
          itemPriceCents: item.priceCents,
          quantity: 1,
          notes: '',
          selectedModifiers: [],
          lineTotalCents: item.priceCents,
        },
      ];
    });
  }

  function removeFromCart(itemId: string) {
    setCart((prev) => prev.filter((c) => c.itemId !== itemId));
  }

  function updateQty(itemId: string, delta: number) {
    setCart((prev) =>
      prev
        .map((c) =>
          c.itemId === itemId
            ? { ...c, quantity: c.quantity + delta, lineTotalCents: (c.quantity + delta) * c.itemPriceCents }
            : c,
        )
        .filter((c) => c.quantity > 0),
    );
  }

  const cartTotal = cart.reduce((sum, c) => sum + c.lineTotalCents, 0);
  const cartCount = cart.reduce((sum, c) => sum + c.quantity, 0);

  // ── Place order ───────────────────────────────────────────────────────────────
  async function placeOrder() {
    if (cart.length === 0 || !wsId) return;
    setPlacing(true);
    try {
      const storedToken = deviceToken || localStorage.getItem('kiosk.deviceToken') || '';
      const res = await fetch(`${resolveApiBase()}/pos/orders`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(storedToken ? { 'X-Device-Token': storedToken } : {}),
        },
        body: JSON.stringify({
          workspaceId: wsId,
          customerName: customerName.trim() || null,
          items: cart,
        }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setOrderPlaced({ orderNumber: data.orderNumber });
      setCart([]);
      setCartOpen(false);
      setCustomerName('');
      // Auto-dismiss thank-you screen after 8 seconds
      setTimeout(() => setOrderPlaced(null), 8000);
    } catch (e: unknown) {
      alert('Failed to place order: ' + (e instanceof Error ? e.message : String(e)));
    } finally {
      setPlacing(false);
    }
  }

  const isPortrait = orientation === 'portrait';
  const activeCategory = menu?.categories.find((c) => c.id === activeCategoryId) ?? null;

  // ── Render: loading / error ──────────────────────────────────────────────────
  if (loading) {
    return (
      <div style={S.root}>
        <div style={S.centered}>
          <div style={S.spinner} />
          <p style={S.spinnerText}>Loading menu...</p>
        </div>
      </div>
    );
  }

  if (error || !menu) {
    return (
      <div style={S.root}>
        <div style={S.centered}>
          <div style={S.errorIcon}>⚠</div>
          <h2 style={S.errorTitle}>Menu Unavailable</h2>
          <p style={S.errorMsg}>{error ?? 'No active menu found for this workspace.'}</p>
          <button style={S.retryBtn} onClick={() => void loadMenu()}>Retry</button>
        </div>
      </div>
    );
  }

  // ── Render: order placed ───────────────────────────────────────────────────
  if (orderPlaced) {
    return (
      <div style={S.root}>
        <div style={S.centered}>
          <div style={{ fontSize: 80 }}>✅</div>
          <h1 style={{ ...S.headline, marginTop: 24 }}>Order Placed!</h1>
          <div style={S.orderNumber}>#{String(orderPlaced.orderNumber).padStart(3, '0')}</div>
          <p style={S.spinnerText}>Please wait for your order to be called.</p>
        </div>
      </div>
    );
  }

  // ── Render: main kiosk UI ─────────────────────────────────────────────────
  return (
    <div style={{ ...S.root, flexDirection: isPortrait ? 'column' : 'row' }}>

      {/* Header */}
      <div style={isPortrait ? S.headerPortrait : S.headerLandscape}>
        <span style={S.headerTitle}>{menu.name}</span>
        <button style={S.cartBtn} onClick={() => setCartOpen(true)}>
          🛒 {cartCount > 0 ? <span style={S.cartBadge}>{cartCount}</span> : null}
          {formatPrice(cartTotal, menu.currency)}
        </button>
      </div>

      {/* Category tabs */}
      <div style={isPortrait ? S.tabsPortrait : S.tabsLandscape}>
        {menu.categories.map((cat) => (
          <button
            key={cat.id}
            style={{
              ...S.tabBtn,
              ...(activeCategoryId === cat.id ? S.tabBtnActive : {}),
              ...(cat.color ? { borderColor: cat.color } : {}),
            }}
            onClick={() => setActiveCategoryId(cat.id)}
          >
            {cat.name}
          </button>
        ))}
      </div>

      {/* Items grid */}
      <div style={S.itemsGrid}>
        {(activeCategory?.items ?? []).filter((i) => i.isAvailable).map((item) => (
          <button key={item.id} style={S.itemCard} onClick={() => addToCart(item)}>
            {item.imageUrl && (
              <img src={item.imageUrl} alt={item.name} style={S.itemImg} />
            )}
            <div style={S.itemBody}>
              <div style={S.itemName}>{item.name}</div>
              {item.description && <div style={S.itemDesc}>{item.description}</div>}
              <div style={S.itemTags}>
                {item.tags.map((t) => (
                  <span key={t} style={S.tag}>{t}</span>
                ))}
              </div>
              <div style={S.itemPrice}>{formatPrice(item.priceCents, menu.currency)}</div>
            </div>
            <div style={S.addIcon}>＋</div>
          </button>
        ))}
      </div>

      {/* Cart drawer */}
      {cartOpen && (
        <div style={S.overlay} onClick={() => setCartOpen(false)}>
          <div style={S.drawer} onClick={(e) => e.stopPropagation()}>
            <div style={S.drawerHeader}>
              <span style={S.drawerTitle}>Your Order</span>
              <button style={S.closeBtn} onClick={() => setCartOpen(false)}>✕</button>
            </div>

            <div style={S.cartItems}>
              {cart.length === 0 ? (
                <p style={{ color: 'var(--text-muted)', textAlign: 'center', padding: 24 }}>
                  Cart is empty
                </p>
              ) : cart.map((c) => (
                <div key={c.itemId} style={S.cartRow}>
                  <div style={{ flex: 1 }}>
                    <div style={S.cartItemName}>{c.itemName}</div>
                    <div style={S.cartItemPrice}>{formatPrice(c.lineTotalCents, menu.currency)}</div>
                  </div>
                  <div style={S.qtyRow}>
                    <button style={S.qtyBtn} onClick={() => updateQty(c.itemId, -1)}>−</button>
                    <span style={S.qtyNum}>{c.quantity}</span>
                    <button style={S.qtyBtn} onClick={() => updateQty(c.itemId, +1)}>＋</button>
                    <button style={{ ...S.qtyBtn, color: 'var(--danger)' }} onClick={() => removeFromCart(c.itemId)}>✕</button>
                  </div>
                </div>
              ))}
            </div>

            <div style={S.drawerFooter}>
              <input
                style={S.nameInput}
                placeholder="Your name (optional)"
                value={customerName}
                onChange={(e) => setCustomerName(e.target.value)}
                maxLength={50}
              />
              <div style={S.cartTotal}>
                Total: <strong>{formatPrice(cartTotal, menu.currency)}</strong>
              </div>
              <button
                style={{ ...S.orderBtn, opacity: cart.length === 0 || placing ? 0.5 : 1 }}
                disabled={cart.length === 0 || placing}
                onClick={() => void placeOrder()}
              >
                {placing ? 'Placing...' : 'Place Order'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Inline styles (avoids Tailwind dependency for public pages) ──────────────
const S: Record<string, React.CSSProperties> = {
  root: {
    display: 'flex',
    width: '100vw',
    height: '100vh',
    background: 'var(--bg2, #0b0d11)',
    color: 'var(--text, #e8eaf0)',
    fontFamily: "'Inter', 'Segoe UI', system-ui, sans-serif",
    overflow: 'hidden',
    position: 'relative',
  },
  centered: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    width: '100vw',
    height: '100vh',
    gap: 16,
    textAlign: 'center',
    padding: 32,
  },
  spinner: {
    width: 56, height: 56,
    border: '4px solid rgba(255,255,255,0.1)',
    borderTopColor: '#4ff2d1',
    borderRadius: '50%',
    animation: 'kiosk-spin 0.8s linear infinite',
  },
  spinnerText: { fontSize: 16, color: 'var(--text-muted, #7a8299)' },
  errorIcon:  { fontSize: 72 },
  errorTitle: { fontSize: 28, fontWeight: 700, color: '#ff3ea5' },
  errorMsg:   { fontSize: 16, color: 'var(--text-muted, #7a8299)', maxWidth: 480 },
  retryBtn: {
    background: '#3a7bff', border: 'none', borderRadius: 12,
    color: '#fff', cursor: 'pointer', fontSize: 16, fontWeight: 600,
    padding: '14px 36px', marginTop: 8,
  },
  headline: { fontSize: 40, fontWeight: 800 },
  orderNumber: {
    fontSize: 96, fontWeight: 900, color: '#4ff2d1',
    textShadow: '0 0 32px rgba(79,242,209,0.4)',
  },

  // Layout
  headerPortrait: {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    padding: '16px 20px',
    background: 'rgba(255,255,255,0.04)',
    borderBottom: '1px solid rgba(255,255,255,0.08)',
    flexShrink: 0,
  },
  headerLandscape: {
    display: 'flex', flexDirection: 'column', justifyContent: 'space-between',
    padding: '20px 16px',
    background: 'rgba(255,255,255,0.04)',
    borderRight: '1px solid rgba(255,255,255,0.08)',
    width: 200, flexShrink: 0,
  },
  headerTitle: { fontSize: 20, fontWeight: 800 },
  cartBtn: {
    display: 'flex', alignItems: 'center', gap: 8,
    background: '#3a7bff', border: 'none', borderRadius: 12,
    color: '#fff', cursor: 'pointer', fontSize: 15, fontWeight: 600,
    padding: '10px 20px',
  },
  cartBadge: {
    background: '#4ff2d1', color: '#0f1115', borderRadius: '50%',
    width: 22, height: 22, display: 'inline-flex', alignItems: 'center',
    justifyContent: 'center', fontSize: 12, fontWeight: 800,
  },
  tabsPortrait: {
    display: 'flex', overflowX: 'auto', gap: 8,
    padding: '12px 16px', flexShrink: 0,
    borderBottom: '1px solid rgba(255,255,255,0.08)',
  },
  tabsLandscape: {
    display: 'flex', flexDirection: 'column', gap: 6,
    padding: '12px 12px', overflowY: 'auto', flexShrink: 0,
    width: 160, borderRight: '1px solid rgba(255,255,255,0.08)',
  },
  tabBtn: {
    background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.08)',
    borderRadius: 10, color: 'var(--text-muted, #7a8299)',
    cursor: 'pointer', fontSize: 14, fontWeight: 500, padding: '10px 18px',
    whiteSpace: 'nowrap', flexShrink: 0,
  },
  tabBtnActive: {
    background: '#3a7bff', borderColor: '#3a7bff', color: '#fff',
  },
  itemsGrid: {
    flex: 1, overflowY: 'auto',
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))',
    gap: 16, padding: 16, alignContent: 'start',
  },
  itemCard: {
    display: 'flex', flexDirection: 'column',
    background: 'rgba(255,255,255,0.06)',
    border: '1px solid rgba(255,255,255,0.08)',
    borderRadius: 16, cursor: 'pointer', overflow: 'hidden',
    textAlign: 'left', position: 'relative',
    transition: 'transform 0.1s, border-color 0.15s',
  },
  itemImg:  { width: '100%', aspectRatio: '16/9', objectFit: 'cover' },
  itemBody: { padding: '12px 14px', flex: 1, display: 'flex', flexDirection: 'column', gap: 6 },
  itemName: { fontSize: 15, fontWeight: 700, color: 'var(--text, #e8eaf0)' },
  itemDesc: { fontSize: 13, color: 'var(--text-muted, #7a8299)', lineHeight: 1.4 },
  itemTags: { display: 'flex', flexWrap: 'wrap', gap: 4 },
  tag: {
    background: 'rgba(79,242,209,0.12)', border: '1px solid rgba(79,242,209,0.2)',
    borderRadius: 6, color: '#4ff2d1', fontSize: 11, fontWeight: 600,
    padding: '2px 8px',
  },
  itemPrice: { fontSize: 16, fontWeight: 800, color: '#4ff2d1', marginTop: 4 },
  addIcon: {
    position: 'absolute', bottom: 12, right: 12,
    background: '#3a7bff', borderRadius: '50%',
    width: 32, height: 32, display: 'flex', alignItems: 'center',
    justifyContent: 'center', fontSize: 20, color: '#fff', fontWeight: 800,
  },

  // Cart overlay
  overlay: {
    position: 'fixed', inset: 0,
    background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)',
    display: 'flex', alignItems: 'flex-end', justifyContent: 'flex-end',
    zIndex: 100,
  },
  drawer: {
    background: 'var(--surface, #12151c)',
    border: '1px solid rgba(255,255,255,0.08)',
    borderRadius: '20px 0 0 0',
    display: 'flex', flexDirection: 'column',
    width: 'min(90vw, 480px)', height: '80vh',
    overflow: 'hidden',
  },
  drawerHeader: {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    padding: '20px 24px',
    borderBottom: '1px solid rgba(255,255,255,0.08)',
  },
  drawerTitle: { fontSize: 20, fontWeight: 700 },
  closeBtn: {
    background: 'none', border: 'none', color: 'var(--text-muted, #7a8299)',
    cursor: 'pointer', fontSize: 20, padding: 4,
  },
  cartItems: { flex: 1, overflowY: 'auto', padding: '12px 24px' },
  cartRow: {
    display: 'flex', alignItems: 'center', gap: 12,
    padding: '12px 0',
    borderBottom: '1px solid rgba(255,255,255,0.06)',
  },
  cartItemName:  { fontSize: 15, fontWeight: 600 },
  cartItemPrice: { fontSize: 14, color: '#4ff2d1', marginTop: 2 },
  qtyRow:  { display: 'flex', alignItems: 'center', gap: 8 },
  qtyBtn: {
    background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.1)',
    borderRadius: 8, color: 'var(--text, #e8eaf0)', cursor: 'pointer',
    fontSize: 16, fontWeight: 700, width: 36, height: 36,
  },
  qtyNum:   { fontSize: 16, fontWeight: 700, minWidth: 24, textAlign: 'center' },
  drawerFooter: {
    padding: '16px 24px',
    borderTop: '1px solid rgba(255,255,255,0.08)',
    display: 'flex', flexDirection: 'column', gap: 12,
  },
  nameInput: {
    background: 'rgba(255,255,255,0.06)',
    border: '1px solid rgba(255,255,255,0.1)',
    borderRadius: 10, color: 'var(--text, #e8eaf0)',
    fontSize: 15, padding: '12px 16px', outline: 'none',
  },
  cartTotal:  { fontSize: 18, textAlign: 'right' },
  orderBtn: {
    background: '#3a7bff', border: 'none', borderRadius: 14,
    color: '#fff', cursor: 'pointer', fontSize: 18, fontWeight: 700,
    padding: '16px', transition: 'opacity 0.15s',
  },
};

// Inject keyframe once
if (typeof document !== 'undefined') {
  const style = document.createElement('style');
  style.textContent = '@keyframes kiosk-spin { to { transform: rotate(360deg); } }';
  document.head.appendChild(style);
}
