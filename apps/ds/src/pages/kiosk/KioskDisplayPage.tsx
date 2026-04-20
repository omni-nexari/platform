import { useEffect, useState, useCallback, useRef } from 'react';
import { useParams, useSearchParams } from 'react-router';

// â”€â”€â”€ Types â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
interface ModifierOption { id: string; name: string; priceCents: number }
interface ModifierGroup {
  id: string; name: string; required: boolean;
  maxSelect: number; options: ModifierOption[];
}

interface PosItem {
  id: string; name: string; description: string | null;
  imageUrl: string | null; priceCents: number;
  isAvailable: boolean; tags: string[];
  modifiers: ModifierGroup[];
}

interface PosCategory {
  id: string; name: string; description: string | null;
  imageUrl: string | null; color: string | null; items: PosItem[];
}

interface PosMenu { id: string; name: string; currency: string; categories: PosCategory[] }

interface CartItem {
  itemId: string; itemName: string; itemPriceCents: number;
  quantity: number; notes: string;
  selectedModifiers: { groupName: string; optionName: string; priceCents: number }[];
  lineTotalCents: number;
}

interface KioskConfig {
  orientation: string; welcomeMessage: string | null;
  idleTimeoutSeconds: number; logoUrl: string | null;
  primaryColor: string | null; qrOrderingEnabled: boolean;
}

interface StoreStatus { isOpen: boolean; note: string | null }

interface LoyaltyCustomer { id: string; name: string | null; points: number; tier: string }
interface LoyaltyVerifyResponse {
  found: boolean; customer: LoyaltyCustomer | null;
  loyaltyEnabled: boolean; loyaltyPointsPerDollar: number; loyaltyRedemptionRate: number;
  maxRedeemablePoints: number;
}

// â”€â”€â”€ Helpers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function formatPrice(cents: number, currency = 'USD') {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(cents / 100);
}

function resolveApiBase() { return '/api'; }

// â”€â”€â”€ Main Component â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
export default function KioskDisplayPage() {
  const { wsId, orientation: routeOrientation = 'portrait' } = useParams<{ wsId: string; orientation: string }>();
  const [searchParams] = useSearchParams();
  const routeToken = searchParams.get('dt') ?? '';
  const displayToken = routeToken || localStorage.getItem('kiosk.deviceToken') || '';

  // Config
  const [kioskConfig, setKioskConfig] = useState<KioskConfig | null>(null);
  const [storeStatus, setStoreStatus] = useState<StoreStatus | null>(null);
  const [menu, setMenu] = useState<PosMenu | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeCategoryId, setActiveCategoryId] = useState<string | null>(null);
  const [cart, setCart] = useState<CartItem[]>([]);
  const [cartOpen, setCartOpen] = useState(false);
  const [orderPlaced, setOrderPlaced] = useState<{ orderNumber: number } | null>(null);
  const [placing, setPlacing] = useState(false);
  const [customerName, setCustomerName] = useState('');

  // Modifier picker
  const [modifierItem, setModifierItem] = useState<PosItem | null>(null);
  const [selectedOpts, setSelectedOpts] = useState<Record<string, string[]>>({});

  // Loyalty
  const [loyaltyPhone, setLoyaltyPhone] = useState('');
  const [loyaltyEmail, setLoyaltyEmail] = useState('');
  const [loyaltyResult, setLoyaltyResult] = useState<LoyaltyVerifyResponse | null>(null);
  const [loyaltyVerifying, setLoyaltyVerifying] = useState(false);
  const [loyaltyDiscountCents, setLoyaltyDiscountCents] = useState(0);
  const [loyaltyCustomerId, setLoyaltyCustomerId] = useState<string | null>(null);

  // Idle
  const idleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [isIdle, setIsIdle] = useState(false);

  // Persist token
  useEffect(() => {
    if (routeToken) localStorage.setItem('kiosk.deviceToken', routeToken);
  }, [routeToken]);

  const primaryColor = kioskConfig?.primaryColor ?? '#3a7bff';
  const accentColor  = '#4ff2d1';
  const orientation  = kioskConfig?.orientation ?? routeOrientation;
  const idleTimeout  = (kioskConfig?.idleTimeoutSeconds ?? 60) * 1000;

  // â”€â”€ Idle timeout â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const resetIdle = useCallback(() => {
    if (isIdle) setIsIdle(false);
    if (idleTimer.current) clearTimeout(idleTimer.current);
    idleTimer.current = setTimeout(() => setIsIdle(true), idleTimeout);
  }, [idleTimeout, isIdle]);

  useEffect(() => {
    resetIdle();
    const events = ['mousemove', 'mousedown', 'keydown', 'touchstart', 'pointerdown'];
    events.forEach((e) => document.addEventListener(e, resetIdle, { passive: true }));
    return () => {
      events.forEach((e) => document.removeEventListener(e, resetIdle));
      if (idleTimer.current) clearTimeout(idleTimer.current);
    };
  }, [idleTimeout]);

  // When idle, reset to welcome state
  useEffect(() => {
    if (isIdle) {
      setCart([]); setCartOpen(false); setOrderPlaced(null);
      setLoyaltyResult(null); setLoyaltyDiscountCents(0); setLoyaltyCustomerId(null);
      setLoyaltyPhone(''); setLoyaltyEmail('');
      setCustomerName(''); setModifierItem(null);
    }
  }, [isIdle]);

  // â”€â”€ Fetch config + menu + store status â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const loadAll = useCallback(async () => {
    if (!wsId) return;
    setLoading(true); setError(null);
    try {
      const headers: Record<string, string> = {};
      if (displayToken) headers['X-Display-Token'] = displayToken;

      const [configRes, storeRes, menuRes] = await Promise.all([
        displayToken
          ? fetch(`${resolveApiBase()}/pos/kiosk/kiosk-config?dt=${displayToken}`, { headers }).catch(() => null)
          : Promise.resolve(null),
        fetch(`${resolveApiBase()}/pos/store/status?workspaceId=${wsId}`),
        fetch(`${resolveApiBase()}/pos/menu?workspaceId=${wsId}`),
      ]);

      if (configRes?.ok) {
        const cfg = await configRes.json() as KioskConfig | null;
        if (cfg) setKioskConfig(cfg);
      }
      if (storeRes.ok) setStoreStatus(await storeRes.json() as StoreStatus);
      if (!menuRes.ok) throw new Error(`Menu HTTP ${menuRes.status}`);
      const menuData: PosMenu = await menuRes.json();
      setMenu(menuData);
      if (menuData.categories.length > 0) setActiveCategoryId(menuData.categories[0]!.id);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, [wsId, displayToken]);

  useEffect(() => { void loadAll(); }, [loadAll]);

  // Poll menu every 60s
  useEffect(() => {
    const timer = setInterval(() => {
      if (!wsId) return;
      fetch(`${resolveApiBase()}/pos/menu?workspaceId=${wsId}`)
        .then((r) => r.ok ? r.json() : null)
        .then((data: PosMenu | null) => { if (data) setMenu(data); })
        .catch(() => {});
    }, 60_000);
    return () => clearInterval(timer);
  }, [wsId]);

  // â”€â”€ Modifier picker â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  function openModifierPicker(item: PosItem) {
    if (item.modifiers.length === 0) { addItemToCart(item, []); return; }
    setModifierItem(item);
    setSelectedOpts({});
  }

  function toggleModifierOption(group: ModifierGroup, optId: string) {
    setSelectedOpts((prev) => {
      const current = prev[group.id] ?? [];
      if (group.maxSelect === 1) {
        return { ...prev, [group.id]: current[0] === optId ? [] : [optId] };
      }
      if (current.includes(optId)) {
        return { ...prev, [group.id]: current.filter((id) => id !== optId) };
      }
      if (current.length >= group.maxSelect) return prev;
      return { ...prev, [group.id]: [...current, optId] };
    });
  }

  function confirmModifiers() {
    if (!modifierItem) return;
    const requiredGroups = modifierItem.modifiers.filter((g) => g.required);
    for (const group of requiredGroups) {
      if (!selectedOpts[group.id]?.length) {
        alert(`Please select an option for "${group.name}"`);
        return;
      }
    }
    const mods: CartItem['selectedModifiers'] = [];
    for (const group of modifierItem.modifiers) {
      for (const optId of selectedOpts[group.id] ?? []) {
        const opt = group.options.find((o) => o.id === optId);
        if (opt) mods.push({ groupName: group.name, optionName: opt.name, priceCents: opt.priceCents });
      }
    }
    addItemToCart(modifierItem, mods);
    setModifierItem(null);
  }

  // â”€â”€ Cart helpers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  function addItemToCart(item: PosItem, mods: CartItem['selectedModifiers']) {
    const modExtra = mods.reduce((s, m) => s + m.priceCents, 0);
    const unitPrice = item.priceCents + modExtra;
    setCart((prev) => {
      // Only merge if identical item + zero modifiers
      if (mods.length === 0) {
        const existing = prev.find((c) => c.itemId === item.id && c.selectedModifiers.length === 0);
        if (existing) {
          return prev.map((c) => c === existing
            ? { ...c, quantity: c.quantity + 1, lineTotalCents: (c.quantity + 1) * unitPrice }
            : c,
          );
        }
      }
      return [...prev, {
        itemId: item.id, itemName: item.name, itemPriceCents: unitPrice,
        quantity: 1, notes: '', selectedModifiers: mods, lineTotalCents: unitPrice,
      }];
    });
  }

  function removeFromCart(idx: number) { setCart((p) => p.filter((_, i) => i !== idx)); }
  function updateQty(idx: number, delta: number) {
    setCart((prev) => prev
      .map((c, i) => i === idx
        ? { ...c, quantity: c.quantity + delta, lineTotalCents: (c.quantity + delta) * c.itemPriceCents }
        : c)
      .filter((c) => c.quantity > 0));
  }

  const cartTotal = cart.reduce((s, c) => s + c.lineTotalCents, 0);
  const cartCount = cart.reduce((s, c) => s + c.quantity, 0);
  const finalTotal = Math.max(0, cartTotal - loyaltyDiscountCents);

  // â”€â”€ Loyalty verify â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  async function verifyLoyalty() {
    if (!loyaltyPhone.trim() && !loyaltyEmail.trim()) return;
    setLoyaltyVerifying(true);
    try {
      const res = await fetch(`${resolveApiBase()}/pos/kiosk/loyalty/verify?dt=${displayToken}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          workspaceId: wsId,
          phone: loyaltyPhone.trim() || undefined,
          email: loyaltyEmail.trim() || undefined,
        }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data: LoyaltyVerifyResponse = await res.json();
      setLoyaltyResult(data);
    } catch { /* ignore */ } finally {
      setLoyaltyVerifying(false);
    }
  }

  function applyLoyaltyDiscount(points: number) {
    if (!loyaltyResult?.customer) return;
    const rate = Math.max(1, loyaltyResult.loyaltyRedemptionRate);
    const redeemable = Math.floor(Math.min(points, loyaltyResult.maxRedeemablePoints) / rate) * rate;
    const discountCents = Math.floor(redeemable / rate) * 100;
    setLoyaltyDiscountCents(discountCents);
    setLoyaltyCustomerId(loyaltyResult.customer.id);
  }

  // â”€â”€ Place order â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  async function placeOrder() {
    if (cart.length === 0 || !wsId) return;
    setPlacing(true);
    try {
      const res = await fetch(`${resolveApiBase()}/pos/orders?dt=${displayToken}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          workspaceId: wsId,
          customerName: customerName.trim() || null,
          items: cart,
          loyaltyCustomerId: loyaltyCustomerId ?? undefined,
          loyaltyDiscountCents: loyaltyDiscountCents > 0 ? loyaltyDiscountCents : undefined,
        }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json() as { orderNumber: number };
      setOrderPlaced({ orderNumber: data.orderNumber });
      setCart([]); setCartOpen(false); setCustomerName('');
      setLoyaltyDiscountCents(0); setLoyaltyCustomerId(null); setLoyaltyResult(null);
      setTimeout(() => { setOrderPlaced(null); setIsIdle(false); }, 8000);
    } catch (e: unknown) {
      alert('Failed to place order: ' + (e instanceof Error ? e.message : String(e)));
    } finally {
      setPlacing(false);
    }
  }

  const isPortrait = orientation === 'portrait';
  const activeCategory = menu?.categories.find((c) => c.id === activeCategoryId) ?? null;

  // â”€â”€ Idle / welcome screen â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  if (isIdle && !loading) {
    return (
      <div style={{ ...S.root, background: '#0b0d11', cursor: 'pointer' }} onClick={() => setIsIdle(false)}>
        <div style={S.centered}>
          {kioskConfig?.logoUrl
            ? <img src={kioskConfig.logoUrl} alt="Logo" style={{ height: 80, objectFit: 'contain', marginBottom: 16 }} />
            : <div style={{ fontSize: 64, marginBottom: 16 }}>ðŸ½ï¸</div>}
          <h1 style={{ fontSize: 48, fontWeight: 900, color: primaryColor }}>
            {kioskConfig?.welcomeMessage ?? 'Touch to Order'}
          </h1>
          <p style={{ fontSize: 18, color: '#7a8299', marginTop: 12 }}>Tap anywhere to get started</p>
        </div>
      </div>
    );
  }

  // â”€â”€ Store closed â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  if (storeStatus && !storeStatus.isOpen) {
    return (
      <div style={{ ...S.root, background: '#0b0d11' }}>
        <div style={S.centered}>
          <div style={{ fontSize: 80 }}>ðŸ”’</div>
          <h1 style={{ fontSize: 40, fontWeight: 800 }}>We're Closed</h1>
          {storeStatus.note && <p style={{ fontSize: 18, color: '#7a8299' }}>{storeStatus.note}</p>}
        </div>
      </div>
    );
  }

  // â”€â”€ Loading / error â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  if (loading) {
    return (
      <div style={S.root}>
        <div style={S.centered}>
          <div style={{ ...S.spinner, borderTopColor: primaryColor }} />
          <p style={S.spinnerText}>Loading menu...</p>
        </div>
      </div>
    );
  }

  if (error || !menu) {
    return (
      <div style={S.root}>
        <div style={S.centered}>
          <div style={{ fontSize: 72 }}>âš </div>
          <h2 style={S.errorTitle}>Menu Unavailable</h2>
          <p style={S.errorMsg}>{error ?? 'No active menu found.'}</p>
          <button style={{ ...S.retryBtn, background: primaryColor }} onClick={() => void loadAll()}>Retry</button>
        </div>
      </div>
    );
  }

  // â”€â”€ Thank-you screen â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  if (orderPlaced) {
    return (
      <div style={S.root}>
        <div style={S.centered}>
          <div style={{ fontSize: 80 }}>âœ…</div>
          <h1 style={{ fontSize: 40, fontWeight: 800, marginTop: 24 }}>Order Placed!</h1>
          <div style={{ fontSize: 96, fontWeight: 900, color: accentColor, textShadow: '0 0 32px rgba(79,242,209,0.4)' }}>
            #{String(orderPlaced.orderNumber).padStart(3, '0')}
          </div>
          <p style={S.spinnerText}>Please wait for your order to be called.</p>
        </div>
      </div>
    );
  }

  // â”€â”€ Main kiosk UI â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  return (
    <div style={{ ...S.root, flexDirection: isPortrait ? 'column' : 'row' }}>

      {/* Header */}
      <div style={isPortrait ? S.headerPortrait : S.headerLandscape}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          {kioskConfig?.logoUrl && <img src={kioskConfig.logoUrl} alt="" style={{ height: 36, objectFit: 'contain' }} />}
          <span style={S.headerTitle}>{menu.name}</span>
        </div>
        <button style={{ ...S.cartBtn, background: primaryColor }} onClick={() => setCartOpen(true)}>
          ðŸ›’{cartCount > 0 ? <span style={{ ...S.cartBadge, background: accentColor }}>{cartCount}</span> : null}
          {formatPrice(cartTotal, menu.currency)}
        </button>
      </div>

      {/* Category tabs */}
      <div style={isPortrait ? S.tabsPortrait : S.tabsLandscape}>
        {menu.categories.map((cat) => (
          <button
            key={cat.id}
            style={{ ...S.tabBtn, ...(activeCategoryId === cat.id ? { ...S.tabBtnActive, background: primaryColor, borderColor: primaryColor } : {}) }}
            onClick={() => setActiveCategoryId(cat.id)}
          >
            {cat.name}
          </button>
        ))}
      </div>

      {/* Items grid */}
      <div style={S.itemsGrid}>
        {(activeCategory?.items ?? []).filter((i) => i.isAvailable).map((item) => (
          <button key={item.id} style={S.itemCard} onClick={() => openModifierPicker(item)}>
            {item.imageUrl && <img src={item.imageUrl} alt={item.name} style={S.itemImg} />}
            <div style={S.itemBody}>
              <div style={S.itemName}>{item.name}</div>
              {item.description && <div style={S.itemDesc}>{item.description}</div>}
              {item.modifiers.length > 0 && <div style={{ fontSize: 11, color: '#7a8299', marginTop: 2 }}>Customizable</div>}
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                {item.tags.map((t) => <span key={t} style={S.tag}>{t}</span>)}
              </div>
              <div style={{ ...S.itemPrice, color: accentColor }}>{formatPrice(item.priceCents, menu.currency)}</div>
            </div>
            <div style={{ ...S.addIcon, background: primaryColor }}>ï¼‹</div>
          </button>
        ))}
      </div>

      {/* Modifier picker modal */}
      {modifierItem && (
        <div style={S.overlay} onClick={() => setModifierItem(null)}>
          <div style={{ ...S.drawer, width: 'min(94vw, 520px)', height: 'auto', maxHeight: '85vh', borderRadius: 20 }} onClick={(e) => e.stopPropagation()}>
            <div style={S.drawerHeader}>
              <div>
                <div style={{ fontSize: 18, fontWeight: 700 }}>{modifierItem.name}</div>
                <div style={{ fontSize: 14, color: '#7a8299', marginTop: 4 }}>{formatPrice(modifierItem.priceCents, menu.currency)} + options</div>
              </div>
              <button style={S.closeBtn} onClick={() => setModifierItem(null)}>âœ•</button>
            </div>
            <div style={{ flex: 1, overflowY: 'auto', padding: '16px 24px', display: 'flex', flexDirection: 'column', gap: 20 }}>
              {modifierItem.modifiers.map((group) => (
                <div key={group.id}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: '#7a8299', textTransform: 'uppercase', letterSpacing: '0.12em', marginBottom: 10 }}>
                    {group.name}{group.required ? ' *' : ''} {group.maxSelect > 1 ? `(up to ${group.maxSelect})` : ''}
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {group.options.map((opt) => {
                      const isSelected = selectedOpts[group.id]?.includes(opt.id) ?? false;
                      return (
                        <button
                          key={opt.id}
                          style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 16px', borderRadius: 12, border: `2px solid ${isSelected ? primaryColor : 'rgba(255,255,255,0.1)'}`, background: isSelected ? `${primaryColor}22` : 'rgba(255,255,255,0.04)', cursor: 'pointer', color: '#e8eaf0' }}
                          onClick={() => toggleModifierOption(group, opt.id)}
                        >
                          <span style={{ fontSize: 15, fontWeight: 500 }}>{opt.name}</span>
                          <span style={{ fontSize: 14, color: accentColor }}>{opt.priceCents > 0 ? `+${formatPrice(opt.priceCents, menu.currency)}` : 'Free'}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
            <div style={{ padding: '16px 24px', borderTop: '1px solid rgba(255,255,255,0.08)' }}>
              <button
                style={{ ...S.orderBtn, background: primaryColor, width: '100%' }}
                onClick={confirmModifiers}
              >
                Add to Order
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Cart drawer */}
      {cartOpen && (
        <div style={S.overlay} onClick={() => setCartOpen(false)}>
          <div style={S.drawer} onClick={(e) => e.stopPropagation()}>
            <div style={S.drawerHeader}>
              <span style={S.drawerTitle}>Your Order</span>
              <button style={S.closeBtn} onClick={() => setCartOpen(false)}>âœ•</button>
            </div>

            <div style={S.cartItems}>
              {cart.length === 0 ? (
                <p style={{ color: '#7a8299', textAlign: 'center', padding: 24 }}>Cart is empty</p>
              ) : cart.map((c, idx) => (
                <div key={idx} style={S.cartRow}>
                  <div style={{ flex: 1 }}>
                    <div style={S.cartItemName}>{c.itemName}</div>
                    {c.selectedModifiers.length > 0 && (
                      <div style={{ fontSize: 12, color: '#7a8299', marginTop: 2 }}>
                        {c.selectedModifiers.map((m) => m.optionName).join(', ')}
                      </div>
                    )}
                    <div style={{ ...S.cartItemPrice, color: accentColor }}>{formatPrice(c.lineTotalCents, menu.currency)}</div>
                  </div>
                  <div style={S.qtyRow}>
                    <button style={S.qtyBtn} onClick={() => updateQty(idx, -1)}>âˆ’</button>
                    <span style={S.qtyNum}>{c.quantity}</span>
                    <button style={S.qtyBtn} onClick={() => updateQty(idx, +1)}>ï¼‹</button>
                    <button style={{ ...S.qtyBtn, color: '#ff3ea5' }} onClick={() => removeFromCart(idx)}>âœ•</button>
                  </div>
                </div>
              ))}

              {/* Loyalty section */}
              <div style={{ marginTop: 16, padding: '16px', borderRadius: 12, border: '1px solid rgba(255,255,255,0.08)', background: 'rgba(255,255,255,0.03)' }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: '#7a8299', textTransform: 'uppercase', letterSpacing: '0.12em', marginBottom: 12 }}>Loyalty Rewards</div>
                {!loyaltyResult ? (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    <input style={S.nameInput} placeholder="Phone number" value={loyaltyPhone}
                      onChange={(e) => setLoyaltyPhone(e.target.value)} />
                    <input style={S.nameInput} placeholder="Email" type="email" value={loyaltyEmail}
                      onChange={(e) => setLoyaltyEmail(e.target.value)} />
                    <button
                      style={{ ...S.orderBtn, background: '#6366f1', padding: '12px', fontSize: 14, opacity: loyaltyVerifying ? 0.5 : 1 }}
                      disabled={loyaltyVerifying || (!loyaltyPhone.trim() && !loyaltyEmail.trim())}
                      onClick={() => void verifyLoyalty()}
                    >
                      {loyaltyVerifying ? 'Looking upâ€¦' : 'Look up loyalty account'}
                    </button>
                  </div>
                ) : loyaltyResult.found && loyaltyResult.customer ? (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    <div style={{ fontSize: 15, fontWeight: 600 }}>
                      {loyaltyResult.customer.name ?? 'Loyalty Member'} â€” {loyaltyResult.customer.points.toLocaleString()} pts
                    </div>
                    {loyaltyDiscountCents > 0 ? (
                      <div style={{ color: '#22c55e', fontSize: 14, fontWeight: 600 }}>
                        âœ“ {formatPrice(loyaltyDiscountCents, menu.currency)} discount applied
                        <button style={{ marginLeft: 8, background: 'none', border: 'none', color: '#ff3ea5', cursor: 'pointer', fontSize: 12 }}
                          onClick={() => { setLoyaltyDiscountCents(0); setLoyaltyCustomerId(null); }}>
                          Remove
                        </button>
                      </div>
                    ) : loyaltyResult.maxRedeemablePoints > 0 ? (
                      <button
                        style={{ ...S.orderBtn, background: '#22c55e', padding: '10px', fontSize: 14 }}
                        onClick={() => applyLoyaltyDiscount(loyaltyResult.maxRedeemablePoints)}
                      >
                        Redeem {loyaltyResult.maxRedeemablePoints} pts = {formatPrice(Math.floor(loyaltyResult.maxRedeemablePoints / Math.max(1, loyaltyResult.loyaltyRedemptionRate)) * 100, menu.currency)}
                      </button>
                    ) : (
                      <div style={{ fontSize: 13, color: '#7a8299' }}>Not enough points to redeem yet.</div>
                    )}
                    <button style={{ background: 'none', border: 'none', color: '#7a8299', cursor: 'pointer', fontSize: 12, textAlign: 'left' }}
                      onClick={() => { setLoyaltyResult(null); setLoyaltyPhone(''); setLoyaltyEmail(''); setLoyaltyDiscountCents(0); }}>
                      Use different account
                    </button>
                  </div>
                ) : (
                  <div style={{ fontSize: 13, color: '#7a8299' }}>
                    No account found.{' '}
                    <button style={{ background: 'none', border: 'none', color: '#7a8299', cursor: 'pointer', textDecoration: 'underline', fontSize: 13 }}
                      onClick={() => { setLoyaltyResult(null); setLoyaltyPhone(''); setLoyaltyEmail(''); }}>Try again</button>
                  </div>
                )}
              </div>
            </div>

            <div style={S.drawerFooter}>
              <input style={S.nameInput} placeholder="Your name (optional)" value={customerName}
                onChange={(e) => setCustomerName(e.target.value)} maxLength={50} />
              <div style={{ fontSize: 18, textAlign: 'right' }}>
                {loyaltyDiscountCents > 0 && (
                  <div style={{ fontSize: 14, color: '#22c55e', marginBottom: 4 }}>
                    Discount: âˆ’{formatPrice(loyaltyDiscountCents, menu.currency)}
                  </div>
                )}
                Total: <strong>{formatPrice(finalTotal, menu.currency)}</strong>
              </div>
              <button
                style={{ ...S.orderBtn, background: primaryColor, opacity: cart.length === 0 || placing ? 0.5 : 1 }}
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

// â”€â”€â”€ Inline styles â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const S: Record<string, React.CSSProperties> = {
  root: { display: 'flex', width: '100vw', height: '100vh', background: '#0b0d11', color: '#e8eaf0', fontFamily: "'Inter', 'Segoe UI', system-ui, sans-serif", overflow: 'hidden', position: 'relative' },
  centered: { display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', width: '100vw', height: '100vh', gap: 16, textAlign: 'center', padding: 32 },
  spinner: { width: 56, height: 56, border: '4px solid rgba(255,255,255,0.1)', borderRadius: '50%', animation: 'kiosk-spin 0.8s linear infinite' },
  spinnerText: { fontSize: 16, color: '#7a8299' },
  errorTitle: { fontSize: 28, fontWeight: 700, color: '#ff3ea5' },
  errorMsg: { fontSize: 16, color: '#7a8299', maxWidth: 480 },
  retryBtn: { border: 'none', borderRadius: 12, color: '#fff', cursor: 'pointer', fontSize: 16, fontWeight: 600, padding: '14px 36px', marginTop: 8 },
  headerPortrait: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 20px', background: 'rgba(255,255,255,0.04)', borderBottom: '1px solid rgba(255,255,255,0.08)', flexShrink: 0 },
  headerLandscape: { display: 'flex', flexDirection: 'column', justifyContent: 'space-between', padding: '20px 16px', background: 'rgba(255,255,255,0.04)', borderRight: '1px solid rgba(255,255,255,0.08)', width: 200, flexShrink: 0 },
  headerTitle: { fontSize: 20, fontWeight: 800 },
  cartBtn: { display: 'flex', alignItems: 'center', gap: 8, border: 'none', borderRadius: 12, color: '#fff', cursor: 'pointer', fontSize: 15, fontWeight: 600, padding: '10px 20px' },
  cartBadge: { color: '#0f1115', borderRadius: '50%', width: 22, height: 22, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 800 },
  tabsPortrait: { display: 'flex', overflowX: 'auto', gap: 8, padding: '12px 16px', flexShrink: 0, borderBottom: '1px solid rgba(255,255,255,0.08)' },
  tabsLandscape: { display: 'flex', flexDirection: 'column', gap: 6, padding: '12px', overflowY: 'auto', flexShrink: 0, width: 160, borderRight: '1px solid rgba(255,255,255,0.08)' },
  tabBtn: { background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 10, color: '#7a8299', cursor: 'pointer', fontSize: 14, fontWeight: 500, padding: '10px 18px', whiteSpace: 'nowrap', flexShrink: 0 },
  tabBtnActive: { color: '#fff' },
  itemsGrid: { flex: 1, overflowY: 'auto', display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 16, padding: 16, alignContent: 'start' },
  itemCard: { display: 'flex', flexDirection: 'column', background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 16, cursor: 'pointer', overflow: 'hidden', textAlign: 'left', position: 'relative' },
  itemImg: { width: '100%', aspectRatio: '16/9', objectFit: 'cover' },
  itemBody: { padding: '12px 14px', flex: 1, display: 'flex', flexDirection: 'column', gap: 6 },
  itemName: { fontSize: 15, fontWeight: 700 },
  itemDesc: { fontSize: 13, color: '#7a8299', lineHeight: 1.4 },
  tag: { background: 'rgba(79,242,209,0.12)', border: '1px solid rgba(79,242,209,0.2)', borderRadius: 6, color: '#4ff2d1', fontSize: 11, fontWeight: 600, padding: '2px 8px' },
  itemPrice: { fontSize: 16, fontWeight: 800, marginTop: 4 },
  addIcon: { position: 'absolute', bottom: 12, right: 12, borderRadius: '50%', width: 32, height: 32, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20, color: '#fff', fontWeight: 800 },
  overlay: { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)', display: 'flex', alignItems: 'flex-end', justifyContent: 'flex-end', zIndex: 100 },
  drawer: { background: '#12151c', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '20px 0 0 0', display: 'flex', flexDirection: 'column', width: 'min(90vw, 480px)', height: '85vh', overflow: 'hidden' },
  drawerHeader: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '20px 24px', borderBottom: '1px solid rgba(255,255,255,0.08)' },
  drawerTitle: { fontSize: 20, fontWeight: 700 },
  closeBtn: { background: 'none', border: 'none', color: '#7a8299', cursor: 'pointer', fontSize: 20, padding: 4 },
  cartItems: { flex: 1, overflowY: 'auto', padding: '12px 24px' },
  cartRow: { display: 'flex', alignItems: 'center', gap: 12, padding: '12px 0', borderBottom: '1px solid rgba(255,255,255,0.06)' },
  cartItemName: { fontSize: 15, fontWeight: 600 },
  cartItemPrice: { fontSize: 14, marginTop: 2 },
  qtyRow: { display: 'flex', alignItems: 'center', gap: 8 },
  qtyBtn: { background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8, color: '#e8eaf0', cursor: 'pointer', fontSize: 16, fontWeight: 700, width: 36, height: 36 },
  qtyNum: { fontSize: 16, fontWeight: 700, minWidth: 24, textAlign: 'center' },
  drawerFooter: { padding: '16px 24px', borderTop: '1px solid rgba(255,255,255,0.08)', display: 'flex', flexDirection: 'column', gap: 12 },
  nameInput: { background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 10, color: '#e8eaf0', fontSize: 15, padding: '12px 16px', outline: 'none', width: '100%', boxSizing: 'border-box' },
  orderBtn: { border: 'none', borderRadius: 14, color: '#fff', cursor: 'pointer', fontSize: 18, fontWeight: 700, padding: '16px', transition: 'opacity 0.15s' },
};

if (typeof document !== 'undefined') {
  const existing = document.getElementById('kiosk-keyframes');
  if (!existing) {
    const style = document.createElement('style');
    style.id = 'kiosk-keyframes';
    style.textContent = '@keyframes kiosk-spin { to { transform: rotate(360deg); } }';
    document.head.appendChild(style);
  }
}

