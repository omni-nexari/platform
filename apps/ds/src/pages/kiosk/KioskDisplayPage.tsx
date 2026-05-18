import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react';
import { useParams, useSearchParams } from 'react-router';

interface ModifierOption {
  id: string;
  name: string;
  priceCents: number;
}

interface ModifierGroup {
  id: string;
  name: string;
  required: boolean;
  maxSelect: number;
  options: ModifierOption[];
}

interface PosItem {
  id: string;
  name: string;
  description: string | null;
  imageUrl: string | null;
  priceCents: number;
  isAvailable: boolean;
  tags: string[];
  modifiers: ModifierGroup[];
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

interface KioskConfig {
  orientation: string;
  welcomeMessage: string | null;
  idleTimeoutSeconds: number;
  logoUrl: string | null;
  primaryColor: string | null;
  qrOrderingEnabled: boolean;
}

interface StoreStatus {
  isOpen: boolean;
  note: string | null;
}

interface LoyaltyCustomer {
  id: string;
  name: string | null;
  points: number;
  tier: string;
}

interface LoyaltyVerifyResponse {
  found: boolean;
  customer: LoyaltyCustomer | null;
  loyaltyEnabled: boolean;
  loyaltyPointsPerDollar: number;
  loyaltyRedemptionRate: number;
  maxRedeemablePoints: number;
}

const BADGE_COLORS: Record<string, string> = {
  new: '#22c55e',
  best: '#f59e0b',
  popular: '#06b6d4',
  hot: '#ef4444',
  featured: '#8b5cf6',
};

const DESCRIPTION_CLAMP: CSSProperties = {
  display: '-webkit-box',
  WebkitLineClamp: 2,
  WebkitBoxOrient: 'vertical',
  overflow: 'hidden',
};

function formatPrice(cents: number, currency = 'USD') {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(cents / 100);
}

function resolveApiBase() {
  // Use /api/v1 directly so this works when served from the API server (port 3000)
  // as well as from the dev/preview server (proxy forwards /api/v1 unchanged to port 3000).
  return '/api/v1';
}

function hexWithAlpha(color: string, alphaHex: string) {
  if (!color.startsWith('#')) return color;
  if (color.length === 7) return `${color}${alphaHex}`;
  return color;
}

function readDensity(value: string | null, fallback: 'compact' | 'comfortable') {
  if (value === 'compact' || value === 'comfortable') return value;
  return fallback;
}

function readFlavor(value: string | null) {
  if (value === 'sample') return 'sample';
  return 'classic';
}

export default function KioskDisplayPage() {
  const { wsId, orientation: routeOrientation = 'portrait' } = useParams<{ wsId: string; orientation: string }>();
  const [searchParams] = useSearchParams();
  const routeToken = searchParams.get('dt') ?? '';
  const displayToken = routeToken || localStorage.getItem('kiosk.deviceToken') || '';
  const flavor = readFlavor(searchParams.get('kf'));
  const portraitDensity = readDensity(searchParams.get('pd'), 'comfortable');
  const landscapeDensity = readDensity(searchParams.get('ld'), 'compact');

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

  const [modifierItem, setModifierItem] = useState<PosItem | null>(null);
  const [selectedOpts, setSelectedOpts] = useState<Record<string, string[]>>({});

  const [loyaltyPhone, setLoyaltyPhone] = useState('');
  const [loyaltyEmail, setLoyaltyEmail] = useState('');
  const [loyaltyResult, setLoyaltyResult] = useState<LoyaltyVerifyResponse | null>(null);
  const [loyaltyVerifying, setLoyaltyVerifying] = useState(false);
  const [loyaltyDiscountCents, setLoyaltyDiscountCents] = useState(0);
  const [loyaltyCustomerId, setLoyaltyCustomerId] = useState<string | null>(null);

  const idleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [isIdle, setIsIdle] = useState(false);

  useEffect(() => {
    if (routeToken) localStorage.setItem('kiosk.deviceToken', routeToken);
  }, [routeToken]);

  const primaryColor = kioskConfig?.primaryColor ?? '#ea5c25';
  const accentColor = '#72c54a';
  const orientation = kioskConfig?.orientation ?? routeOrientation;
  const isPortrait = orientation === 'portrait';
  const density = isPortrait ? portraitDensity : landscapeDensity;
  const idleTimeout = (kioskConfig?.idleTimeoutSeconds ?? 60) * 1000;

  const resetIdle = useCallback(() => {
    if (isIdle) setIsIdle(false);
    if (idleTimer.current) clearTimeout(idleTimer.current);
    idleTimer.current = setTimeout(() => setIsIdle(true), idleTimeout);
  }, [idleTimeout, isIdle]);

  useEffect(() => {
    resetIdle();
    const events = ['mousemove', 'mousedown', 'keydown', 'touchstart', 'pointerdown'];
    events.forEach((event) => document.addEventListener(event, resetIdle, { passive: true }));
    return () => {
      events.forEach((event) => document.removeEventListener(event, resetIdle));
      if (idleTimer.current) clearTimeout(idleTimer.current);
    };
  }, [resetIdle, idleTimeout]);

  useEffect(() => {
    if (!isIdle) return;
    setCart([]);
    setCartOpen(false);
    setOrderPlaced(null);
    setLoyaltyResult(null);
    setLoyaltyDiscountCents(0);
    setLoyaltyCustomerId(null);
    setLoyaltyPhone('');
    setLoyaltyEmail('');
    setCustomerName('');
    setModifierItem(null);
  }, [isIdle]);

  const loadAll = useCallback(async () => {
    if (!wsId) { setLoading(false); return; }

    setLoading(true);
    setError(null);

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
        const cfg = (await configRes.json()) as KioskConfig | null;
        if (cfg) setKioskConfig(cfg);
      }

      if (storeRes.ok) {
        setStoreStatus((await storeRes.json()) as StoreStatus);
      }

      if (!menuRes.ok) {
        throw new Error(`Menu HTTP ${menuRes.status}`);
      }

      const menuData = (await menuRes.json()) as PosMenu;
      setMenu(menuData);
      if (menuData.categories.length > 0) {
        setActiveCategoryId(menuData.categories[0]!.id);
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, [displayToken, wsId]);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  useEffect(() => {
    if (!wsId) return;
    const timer = setInterval(() => {
      fetch(`${resolveApiBase()}/pos/menu?workspaceId=${wsId}`)
        .then((response) => (response.ok ? response.json() : null))
        .then((data: PosMenu | null) => {
          if (data) setMenu(data);
        })
        .catch(() => {});
    }, 60_000);

    return () => clearInterval(timer);
  }, [wsId]);

  function openModifierPicker(item: PosItem) {
    if (item.modifiers.length === 0) {
      addItemToCart(item, []);
      return;
    }

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

      if (current.length >= group.maxSelect) {
        return prev;
      }

      return { ...prev, [group.id]: [...current, optId] };
    });
  }

  function confirmModifiers() {
    if (!modifierItem) return;

    const requiredGroups = modifierItem.modifiers.filter((group) => group.required);
    for (const group of requiredGroups) {
      if (!selectedOpts[group.id]?.length) {
        alert(`Please select an option for "${group.name}"`);
        return;
      }
    }

    const mods: CartItem['selectedModifiers'] = [];
    for (const group of modifierItem.modifiers) {
      for (const optId of selectedOpts[group.id] ?? []) {
        const found = group.options.find((option) => option.id === optId);
        if (found) {
          mods.push({
            groupName: group.name,
            optionName: found.name,
            priceCents: found.priceCents,
          });
        }
      }
    }

    addItemToCart(modifierItem, mods);
    setModifierItem(null);
  }

  function addItemToCart(item: PosItem, mods: CartItem['selectedModifiers']) {
    const modifierExtra = mods.reduce((sum, modifier) => sum + modifier.priceCents, 0);
    const unitPrice = item.priceCents + modifierExtra;

    setCart((prev) => {
      if (mods.length === 0) {
        const existing = prev.find((entry) => entry.itemId === item.id && entry.selectedModifiers.length === 0);
        if (existing) {
          return prev.map((entry) => {
            if (entry !== existing) return entry;
            const quantity = entry.quantity + 1;
            return {
              ...entry,
              quantity,
              lineTotalCents: quantity * unitPrice,
            };
          });
        }
      }

      return [
        ...prev,
        {
          itemId: item.id,
          itemName: item.name,
          itemPriceCents: unitPrice,
          quantity: 1,
          notes: '',
          selectedModifiers: mods,
          lineTotalCents: unitPrice,
        },
      ];
    });
  }

  function removeFromCart(index: number) {
    setCart((prev) => prev.filter((_, idx) => idx !== index));
  }

  function updateQty(index: number, delta: number) {
    setCart((prev) =>
      prev
        .map((entry, idx) => {
          if (idx !== index) return entry;
          const quantity = entry.quantity + delta;
          return {
            ...entry,
            quantity,
            lineTotalCents: quantity * entry.itemPriceCents,
          };
        })
        .filter((entry) => entry.quantity > 0),
    );
  }

  const cartTotal = cart.reduce((sum, entry) => sum + entry.lineTotalCents, 0);
  const cartCount = cart.reduce((sum, entry) => sum + entry.quantity, 0);
  const finalTotal = Math.max(0, cartTotal - loyaltyDiscountCents);

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

      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }

      setLoyaltyResult((await res.json()) as LoyaltyVerifyResponse);
    } catch {
      // Ignore verify failures to keep kiosk flow smooth.
    } finally {
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

      if (!res.ok) {
        let message = `HTTP ${res.status}`;
        try {
          const payload = (await res.json()) as { error?: string; details?: unknown };
          message = payload.error ?? message;
          if (payload.details) message += `: ${JSON.stringify(payload.details)}`;
        } catch {
          // Ignore JSON parse errors and keep fallback message.
        }
        throw new Error(message);
      }

      const data = (await res.json()) as { orderNumber: number };
      setOrderPlaced({ orderNumber: data.orderNumber });
      setCart([]);
      setCartOpen(false);
      setCustomerName('');
      setLoyaltyDiscountCents(0);
      setLoyaltyCustomerId(null);
      setLoyaltyResult(null);

      setTimeout(() => {
        setOrderPlaced(null);
        setIsIdle(false);
      }, 8000);
    } catch (err: unknown) {
      alert(`Failed to place order: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setPlacing(false);
    }
  }

  const activeCategory = menu?.categories.find((category) => category.id === activeCategoryId) ?? null;
  const availableItems = (activeCategory?.items ?? []).filter((item) => item.isAvailable);
  const menuItemCount = menu?.categories.reduce((sum, category) => sum + category.items.filter((item) => item.isAvailable).length, 0) ?? 0;

  const rootStyle = {
    '--kiosk-primary': primaryColor,
    '--kiosk-primary-soft': hexWithAlpha(primaryColor, '22'),
    '--kiosk-accent': accentColor,
  } as CSSProperties;

  if (isIdle && !loading) {
    return (
      <div className={`kiosk kiosk-idle ${isPortrait ? 'portrait' : 'landscape'}`} style={rootStyle} onClick={() => setIsIdle(false)}>
        <style>{KIOSK_CSS}</style>
        <div className="kiosk-idle-video-glow" />
        <div className="kiosk-idle-center">
          {kioskConfig?.logoUrl ? (
            <img src={kioskConfig.logoUrl} alt="logo" className="kiosk-idle-logo kiosk-float" />
          ) : (
            <div className="kiosk-idle-badge kiosk-float">
              <span>ORDER</span>
            </div>
          )}
          <h1 className="kiosk-idle-title">{menu?.name ?? 'Welcome'}</h1>
          <p className="kiosk-idle-subtitle">Fresh meals, quick pickup, zero waiting.</p>
        </div>
        <div className="kiosk-idle-strip kiosk-blink">
          <div className="kiosk-idle-strip-main">{(kioskConfig?.welcomeMessage ?? 'Touch To Order').toUpperCase()}</div>
          <div className="kiosk-idle-strip-sub">Tap anywhere to start</div>
        </div>
      </div>
    );
  }

  if (storeStatus && !storeStatus.isOpen) {
    return (
      <div className={`kiosk kiosk-state ${isPortrait ? 'portrait' : 'landscape'}`} style={rootStyle}>
        <style>{KIOSK_CSS}</style>
        <div className="kiosk-state-card">
          <div className="kiosk-state-icon danger">X</div>
          <h1>We Are Closed</h1>
          {storeStatus.note ? <p>{storeStatus.note}</p> : null}
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className={`kiosk kiosk-state ${isPortrait ? 'portrait' : 'landscape'}`} style={rootStyle}>
        <style>{KIOSK_CSS}</style>
        <div className="kiosk-state-card">
          <div className="kiosk-spinner" />
          <h1>Loading Menu</h1>
          <p>Please wait...</p>
        </div>
      </div>
    );
  }

  if (error || !menu) {
    return (
      <div className={`kiosk kiosk-state ${isPortrait ? 'portrait' : 'landscape'}`} style={rootStyle}>
        <style>{KIOSK_CSS}</style>
        <div className="kiosk-state-card">
          <div className="kiosk-state-icon danger">!</div>
          <h1>Menu Unavailable</h1>
          <p>{error ?? 'No active menu found.'}</p>
          <button className="kiosk-btn primary" onClick={() => void loadAll()}>
            Try Again
          </button>
        </div>
      </div>
    );
  }

  if (orderPlaced) {
    return (
      <div className={`kiosk kiosk-state ${isPortrait ? 'portrait' : 'landscape'}`} style={rootStyle}>
        <style>{KIOSK_CSS}</style>
        <div className="kiosk-state-card success">
          <div className="kiosk-state-icon success">OK</div>
          <h1>Order Placed</h1>
          <div className="kiosk-order-number">#{String(orderPlaced.orderNumber).padStart(3, '0')}</div>
          <p>Please wait while we prepare your order.</p>
        </div>
      </div>
    );
  }

  return (
    <div className={`kiosk kiosk-main ${isPortrait ? 'portrait' : 'landscape'} density-${density} flavor-${flavor}`} style={rootStyle}>
      <style>{KIOSK_CSS}</style>

      <header className="k-header">
        <div className="k-brand">
          {kioskConfig?.logoUrl ? <img src={kioskConfig.logoUrl} alt="logo" className="k-brand-logo" /> : null}
          <div className="k-brand-text">
            <div className="k-brand-name">{menu.name}</div>
            <div className="k-brand-sub">Dynamic Kiosk Mode</div>
          </div>
        </div>
        <button className="k-cart-pill" onClick={() => setCartOpen(true)}>
          <span className="k-cart-pill-label">Cart</span>
          <span className="k-cart-pill-count">{cartCount}</span>
          <span>{formatPrice(cartTotal, menu.currency)}</span>
        </button>
      </header>

      <section className="k-hero">
        <div>
          <div className="k-overline">Self Service</div>
          <h1>Order Here</h1>
          <p>{kioskConfig?.welcomeMessage ?? 'Build your meal and check out in seconds.'}</p>
        </div>
        <div className="k-hero-stats">
          <div className="k-stat-box">
            <span className="k-stat-label">Items</span>
            <span className="k-stat-value">{menuItemCount}</span>
          </div>
          <div className="k-stat-box">
            <span className="k-stat-label">Categories</span>
            <span className="k-stat-value">{menu.categories.length}</span>
          </div>
        </div>
      </section>

      <div className="k-ticker-wrap">
        <div className="k-ticker-track">
          <span>Freshly prepared</span>
          <span>Fast pickup</span>
          <span>Customizable orders</span>
          <span>Loyalty rewards</span>
          <span>Freshly prepared</span>
          <span>Fast pickup</span>
          <span>Customizable orders</span>
          <span>Loyalty rewards</span>
        </div>
      </div>

      <nav className="k-categories">
        {menu.categories.map((category) => {
          const isActive = category.id === activeCategoryId;
          const categoryColor = category.color ?? primaryColor;
          return (
            <button
              key={category.id}
              className={`k-category-pill ${isActive ? 'active' : ''}`}
              style={
                {
                  '--cat-color': categoryColor,
                } as CSSProperties
              }
              onClick={() => setActiveCategoryId(category.id)}
            >
              {category.imageUrl ? <img src={category.imageUrl} alt="" /> : null}
              <span>{category.name}</span>
            </button>
          );
        })}
      </nav>

      <main className="k-items-grid">
        {availableItems.map((item) => {
          const badge = item.tags.find((tag) => Object.prototype.hasOwnProperty.call(BADGE_COLORS, tag.toLowerCase()));
          const badgeColor = badge ? BADGE_COLORS[badge.toLowerCase()] : null;
          const categoryColor = activeCategory?.color ?? primaryColor;

          return (
            <button key={item.id} className="k-item-card" onClick={() => openModifierPicker(item)}>
              <div className="k-item-image-wrap">
                {item.imageUrl ? (
                  <img src={item.imageUrl} alt={item.name} className="k-item-image" />
                ) : (
                  <div className="k-item-image-placeholder" style={{ background: `linear-gradient(135deg, ${hexWithAlpha(categoryColor, '33')}, ${hexWithAlpha(categoryColor, '14')})` }}>
                    <span>{item.name.charAt(0).toUpperCase()}</span>
                  </div>
                )}
                {badge && badgeColor ? (
                  <div className="k-badge" style={{ background: badgeColor }}>
                    {badge}
                  </div>
                ) : null}
                {item.modifiers.length > 0 ? <div className="k-custom-pill">Customize</div> : null}
              </div>
              <div className="k-item-body">
                <div className="k-item-name">{item.name}</div>
                {item.description ? <div className="k-item-description" style={DESCRIPTION_CLAMP}>{item.description}</div> : null}
                <div className="k-item-bottom">
                  <div className="k-item-price">{formatPrice(item.priceCents, menu.currency)}</div>
                  <div className="k-item-add">+</div>
                </div>
              </div>
            </button>
          );
        })}
      </main>

      {modifierItem ? (
        <div className="k-overlay k-overlay-center" onClick={() => setModifierItem(null)}>
          <div className="k-modal" onClick={(event) => event.stopPropagation()}>
            <div className="k-modal-header">
              <div>
                <h3>{modifierItem.name}</h3>
                <p>{formatPrice(modifierItem.priceCents, menu.currency)} base price</p>
              </div>
              <button className="k-icon-btn" onClick={() => setModifierItem(null)}>
                X
              </button>
            </div>
            <div className="k-modal-body">
              {modifierItem.modifiers.map((group) => (
                <div key={group.id} className="k-modifier-group">
                  <div className="k-modifier-title">
                    {group.name}
                    {group.required ? ' (required)' : ''}
                    {group.maxSelect > 1 ? ` - up to ${group.maxSelect}` : ''}
                  </div>
                  <div className="k-modifier-options">
                    {group.options.map((opt) => {
                      const selected = selectedOpts[group.id]?.includes(opt.id) ?? false;
                      return (
                        <button
                          key={opt.id}
                          className={`k-modifier-option ${selected ? 'selected' : ''}`}
                          onClick={() => toggleModifierOption(group, opt.id)}
                        >
                          <span>{opt.name}</span>
                          <span>{opt.priceCents > 0 ? `+${formatPrice(opt.priceCents, menu.currency)}` : 'Free'}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
            <div className="k-modal-footer">
              <button className="kiosk-btn primary full" onClick={confirmModifiers}>
                Add To Order
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {cartOpen ? (
        <div className="k-overlay k-overlay-end" onClick={() => setCartOpen(false)}>
          <aside className={`k-cart-drawer ${isPortrait ? 'portrait' : 'landscape'}`} onClick={(event) => event.stopPropagation()}>
            <div className="k-drawer-header">
              <h3>Your Order</h3>
              <button className="k-icon-btn" onClick={() => setCartOpen(false)}>
                X
              </button>
            </div>

            <div className="k-drawer-items">
              {cart.length === 0 ? (
                <div className="k-empty-cart">Your cart is empty.</div>
              ) : (
                cart.map((entry, idx) => (
                  <div key={idx} className="k-cart-row">
                    <div className="k-cart-row-main">
                      <div className="k-cart-item-name">{entry.itemName}</div>
                      {entry.selectedModifiers.length > 0 ? (
                        <div className="k-cart-item-mods">{entry.selectedModifiers.map((modifier) => modifier.optionName).join(', ')}</div>
                      ) : null}
                      <div className="k-cart-item-price">{formatPrice(entry.lineTotalCents, menu.currency)}</div>
                    </div>
                    <div className="k-qty-controls">
                      <button onClick={() => updateQty(idx, -1)}>-</button>
                      <span>{entry.quantity}</span>
                      <button onClick={() => updateQty(idx, +1)}>+</button>
                      <button onClick={() => removeFromCart(idx)}>x</button>
                    </div>
                  </div>
                ))
              )}

              <div className="k-loyalty-card">
                <div className="k-loyalty-title">Loyalty Rewards</div>
                {!loyaltyResult ? (
                  <div className="k-loyalty-form">
                    <input
                      className="k-text-input"
                      placeholder="Phone number"
                      value={loyaltyPhone}
                      onChange={(event) => setLoyaltyPhone(event.target.value)}
                    />
                    <input
                      className="k-text-input"
                      type="email"
                      placeholder="Email"
                      value={loyaltyEmail}
                      onChange={(event) => setLoyaltyEmail(event.target.value)}
                    />
                    <button
                      className="kiosk-btn"
                      disabled={loyaltyVerifying || (!loyaltyPhone.trim() && !loyaltyEmail.trim())}
                      onClick={() => void verifyLoyalty()}
                    >
                      {loyaltyVerifying ? 'Looking up...' : 'Look up loyalty account'}
                    </button>
                  </div>
                ) : loyaltyResult.found && loyaltyResult.customer ? (
                  <div className="k-loyalty-found">
                    <div className="k-loyalty-user">
                      {(loyaltyResult.customer.name ?? 'Loyalty Member') +
                        ` - ${loyaltyResult.customer.points.toLocaleString()} pts`}
                    </div>

                    {loyaltyDiscountCents > 0 ? (
                      <div className="k-loyalty-discount-row">
                        <span>Discount applied: {formatPrice(loyaltyDiscountCents, menu.currency)}</span>
                        <button
                          onClick={() => {
                            setLoyaltyDiscountCents(0);
                            setLoyaltyCustomerId(null);
                          }}
                        >
                          Remove
                        </button>
                      </div>
                    ) : loyaltyResult.maxRedeemablePoints > 0 ? (
                      <button className="kiosk-btn success" onClick={() => applyLoyaltyDiscount(loyaltyResult.maxRedeemablePoints)}>
                        Redeem {loyaltyResult.maxRedeemablePoints} pts ={' '}
                        {formatPrice(
                          Math.floor(loyaltyResult.maxRedeemablePoints / Math.max(1, loyaltyResult.loyaltyRedemptionRate)) * 100,
                          menu.currency,
                        )}
                      </button>
                    ) : (
                      <div className="k-loyalty-muted">Not enough points to redeem yet.</div>
                    )}

                    <button
                      className="k-link-btn"
                      onClick={() => {
                        setLoyaltyResult(null);
                        setLoyaltyPhone('');
                        setLoyaltyEmail('');
                        setLoyaltyDiscountCents(0);
                      }}
                    >
                      Use different account
                    </button>
                  </div>
                ) : (
                  <div className="k-loyalty-muted">
                    No account found.{' '}
                    <button
                      className="k-link-btn inline"
                      onClick={() => {
                        setLoyaltyResult(null);
                        setLoyaltyPhone('');
                        setLoyaltyEmail('');
                      }}
                    >
                      Try again
                    </button>
                  </div>
                )}
              </div>
            </div>

            <div className="k-drawer-footer">
              <input
                className="k-text-input"
                placeholder="Your name (optional)"
                maxLength={50}
                value={customerName}
                onChange={(event) => setCustomerName(event.target.value)}
              />

              {loyaltyDiscountCents > 0 ? (
                <div className="k-total-row discount">
                  <span>Loyalty discount</span>
                  <span>-{formatPrice(loyaltyDiscountCents, menu.currency)}</span>
                </div>
              ) : null}

              <div className="k-total-row total">
                <span>Total</span>
                <span>{formatPrice(finalTotal, menu.currency)}</span>
              </div>

              <button className="kiosk-btn primary full" disabled={cart.length === 0 || placing} onClick={() => void placeOrder()}>
                {placing ? 'Placing...' : 'Place Order'}
              </button>
            </div>
          </aside>
        </div>
      ) : null}
    </div>
  );
}

const KIOSK_CSS = `
  .kiosk {
    width: 100vw;
    height: 100vh;
    overflow: hidden;
    position: relative;
    color: #ffffff;
    background: radial-gradient(circle at 12% 14%, rgba(234,92,37,0.24), transparent 44%),
      radial-gradient(circle at 86% 4%, rgba(114,197,74,0.22), transparent 36%),
      linear-gradient(165deg, #090a10 0%, #10131b 58%, #111722 100%);
    font-family: 'Samsung Sharp Sans', 'Avenir Next', 'Futura', 'Trebuchet MS', sans-serif;
  }

  .kiosk.flavor-sample {
    background: radial-gradient(circle at 10% 16%, rgba(242,120,45,0.3), transparent 48%),
      radial-gradient(circle at 88% 8%, rgba(114,197,67,0.24), transparent 40%),
      linear-gradient(160deg, #07090f 0%, #0d111a 52%, #111827 100%);
  }

  .kiosk button,
  .kiosk input {
    font-family: inherit;
  }

  .kiosk-state {
    display: grid;
    place-items: center;
    padding: 24px;
  }

  .kiosk-state-card {
    width: min(92vw, 640px);
    border-radius: 22px;
    border: 1px solid rgba(255,255,255,0.14);
    background: rgba(16,20,30,0.86);
    box-shadow: 0 28px 56px rgba(0,0,0,0.45);
    text-align: center;
    padding: 30px;
  }

  .kiosk-state-card h1 {
    margin: 14px 0 8px;
    font-size: clamp(28px, 4vw, 42px);
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }

  .kiosk-state-card p {
    margin: 0;
    color: #a6afc2;
    font-size: clamp(16px, 2vw, 20px);
  }

  .kiosk-state-icon {
    width: 82px;
    height: 82px;
    margin: 0 auto;
    border-radius: 50%;
    display: grid;
    place-items: center;
    font-size: 24px;
    font-weight: 900;
  }

  .kiosk-state-icon.danger {
    color: #ff9ca2;
    background: rgba(239,68,68,0.2);
    border: 2px solid rgba(239,68,68,0.5);
  }

  .kiosk-state-icon.success {
    color: #98f5b5;
    background: rgba(34,197,94,0.2);
    border: 2px solid rgba(34,197,94,0.5);
  }

  .kiosk-order-number {
    font-size: clamp(62px, 10vw, 118px);
    font-weight: 900;
    letter-spacing: 0.03em;
    color: var(--kiosk-accent);
    margin: 10px 0;
    text-shadow: 0 0 34px rgba(114,197,74,0.45);
  }

  .kiosk-spinner {
    width: 64px;
    height: 64px;
    border-radius: 50%;
    border: 4px solid rgba(255,255,255,0.16);
    border-top-color: var(--kiosk-primary);
    margin: 0 auto;
    animation: kiosk-spin 0.9s linear infinite;
  }

  .kiosk-idle {
    cursor: pointer;
  }

  .kiosk-idle-video-glow {
    position: absolute;
    inset: 0;
    background: radial-gradient(circle at 50% 40%, rgba(255,255,255,0.08), transparent 62%);
  }

  .kiosk-idle-center {
    position: absolute;
    left: 50%;
    top: 42%;
    transform: translate(-50%, -50%);
    text-align: center;
    width: min(84vw, 900px);
  }

  .kiosk-idle-logo {
    height: clamp(90px, 17vw, 140px);
    object-fit: contain;
  }

  .kiosk-idle-badge {
    margin: 0 auto;
    width: 132px;
    height: 132px;
    border-radius: 50%;
    display: grid;
    place-items: center;
    font-size: 24px;
    font-weight: 900;
    letter-spacing: 0.05em;
    background: linear-gradient(145deg, var(--kiosk-primary), #ff8a4d);
    box-shadow: 0 0 44px rgba(234,92,37,0.45);
  }

  .kiosk-idle-title {
    font-size: clamp(40px, 8vw, 76px);
    margin: 18px 0 8px;
    line-height: 1;
    letter-spacing: 0.04em;
    text-transform: uppercase;
  }

  .kiosk-idle-subtitle {
    margin: 0;
    color: #d9deeb;
    font-size: clamp(18px, 2.8vw, 30px);
  }

  .kiosk-idle-strip {
    position: absolute;
    left: 0;
    right: 0;
    bottom: 0;
    padding: 24px 10px;
    text-align: center;
    background: #ffffff;
    color: #0f1220;
  }

  .kiosk-idle-strip-main {
    font-size: clamp(36px, 8vw, 68px);
    font-weight: 900;
    letter-spacing: 0.05em;
    line-height: 1;
  }

  .kiosk-idle-strip-sub {
    margin-top: 8px;
    color: #4d5569;
    font-size: clamp(14px, 2.4vw, 22px);
  }

  .kiosk-main {
    display: grid;
    grid-template-rows: auto auto auto auto minmax(0, 1fr);
  }

  .k-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 12px 18px;
    border-bottom: 1px solid rgba(255,255,255,0.08);
    background: rgba(8,10,18,0.46);
    backdrop-filter: blur(8px);
    gap: 10px;
  }

  .k-brand {
    display: flex;
    align-items: center;
    gap: 12px;
    min-width: 0;
  }

  .k-brand-logo {
    height: 42px;
    width: auto;
    object-fit: contain;
  }

  .k-brand-text {
    min-width: 0;
  }

  .k-brand-name {
    font-size: clamp(20px, 2.8vw, 32px);
    line-height: 1;
    font-weight: 900;
    text-transform: uppercase;
    letter-spacing: 0.03em;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .k-brand-sub {
    margin-top: 4px;
    font-size: clamp(11px, 1.5vw, 14px);
    color: #9ba4b8;
    letter-spacing: 0.08em;
    text-transform: uppercase;
  }

  .k-cart-pill {
    border: none;
    border-radius: 999px;
    background: var(--kiosk-primary);
    color: #fff;
    font-size: clamp(13px, 1.8vw, 17px);
    font-weight: 700;
    padding: 10px 16px;
    display: inline-flex;
    align-items: center;
    gap: 9px;
    cursor: pointer;
    white-space: nowrap;
    box-shadow: 0 14px 28px rgba(0,0,0,0.3);
  }

  .k-cart-pill-label {
    opacity: 0.9;
  }

  .k-cart-pill-count {
    min-width: 24px;
    height: 24px;
    border-radius: 50%;
    background: rgba(255,255,255,0.92);
    color: #122;
    display: inline-grid;
    place-items: center;
    font-size: 12px;
    font-weight: 900;
  }

  .k-hero {
    display: flex;
    justify-content: space-between;
    gap: 14px;
    align-items: stretch;
    border-bottom: 1px solid rgba(255,255,255,0.08);
    background: linear-gradient(120deg, rgba(234,92,37,0.2), rgba(10,13,22,0.78));
    padding: 12px 18px;
  }

  .k-overline {
    font-size: 12px;
    letter-spacing: 0.14em;
    text-transform: uppercase;
    color: #ffd7c7;
    font-weight: 700;
  }

  .k-hero h1 {
    margin: 3px 0 6px;
    font-size: clamp(28px, 5vw, 56px);
    line-height: 1;
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }

  .k-hero p {
    margin: 0;
    color: #dee4f2;
    font-size: clamp(13px, 1.9vw, 19px);
  }

  .k-hero-stats {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 10px;
    min-width: min(44vw, 280px);
  }

  .k-stat-box {
    border-radius: 14px;
    border: 1px solid rgba(255,255,255,0.16);
    background: rgba(7,9,14,0.5);
    padding: 10px;
    display: flex;
    flex-direction: column;
    justify-content: center;
    min-height: 64px;
  }

  .k-stat-label {
    font-size: 11px;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: #97a0b5;
  }

  .k-stat-value {
    margin-top: 6px;
    font-size: clamp(24px, 4.2vw, 36px);
    line-height: 1;
    font-weight: 900;
  }

  .k-ticker-wrap {
    border-bottom: 1px solid rgba(255,255,255,0.08);
    overflow: hidden;
    white-space: nowrap;
    background: rgba(15,19,29,0.92);
  }

  .k-ticker-track {
    display: inline-flex;
    gap: 24px;
    padding: 10px 0;
    animation: kiosk-ticker 24s linear infinite;
  }

  .k-ticker-track span {
    color: #c5d0e4;
    font-size: clamp(13px, 1.7vw, 17px);
    letter-spacing: 0.06em;
    text-transform: uppercase;
  }

  .k-categories {
    display: flex;
    gap: 10px;
    padding: 12px 16px;
    overflow-x: auto;
    border-bottom: 1px solid rgba(255,255,255,0.08);
    background: rgba(7,10,16,0.78);
    scrollbar-width: none;
  }

  .k-categories::-webkit-scrollbar {
    display: none;
  }

  .k-category-pill {
    border: 2px solid rgba(255,255,255,0.14);
    background: rgba(255,255,255,0.06);
    color: #e5ebf9;
    border-radius: 999px;
    padding: 14px 22px;
    display: inline-flex;
    gap: 10px;
    align-items: center;
    font-size: clamp(16px, 2.2vw, 22px);
    font-weight: 700;
    cursor: pointer;
    white-space: nowrap;
    min-height: 58px;
    transition: background 120ms ease, border-color 120ms ease, box-shadow 120ms ease;
  }

  .k-category-pill:active {
    transform: scale(0.96);
  }

  .k-category-pill.active {
    background: var(--cat-color);
    border-color: var(--cat-color);
    color: #fff;
    box-shadow: 0 10px 28px rgba(0,0,0,0.38);
  }

  .k-category-pill img {
    width: 34px;
    height: 34px;
    border-radius: 50%;
    object-fit: cover;
  }

  .k-items-grid {
    min-height: 0;
    overflow-y: auto;
    display: grid;
    gap: 12px;
    padding: 12px;
    align-content: start;
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .kiosk.portrait.density-compact .k-items-grid {
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 10px;
    padding: 10px;
  }

  .kiosk.portrait.density-compact .k-item-image-wrap {
    height: 110px;
  }

  .kiosk.portrait.density-compact .k-item-card {
    grid-template-rows: 110px auto;
    min-height: 220px;
  }

  .kiosk.portrait.density-compact .k-item-name {
    font-size: clamp(14px, 1.8vw, 18px);
  }

  .kiosk.portrait.density-compact .k-item-price {
    font-size: clamp(16px, 2.1vw, 22px);
  }

  .k-item-card {
    border: 1px solid rgba(255,255,255,0.12);
    background: linear-gradient(170deg, rgba(23,28,40,0.95), rgba(16,21,30,0.95));
    border-radius: 18px;
    overflow: hidden;
    text-align: left;
    cursor: pointer;
    display: grid;
    grid-template-rows: 140px auto;
    min-height: 250px;
    transition: transform 120ms ease, box-shadow 120ms ease;
    position: relative;
  }

  .k-item-card:active {
    transform: scale(0.985);
  }

  .k-item-image-wrap {
    position: relative;
    height: 140px;
    overflow: hidden;
  }

  .k-item-image {
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;
  }

  .k-item-image-placeholder {
    width: 100%;
    height: 100%;
    display: grid;
    place-items: center;
    color: rgba(255,255,255,0.65);
  }

  .k-item-image-placeholder span {
    font-size: clamp(46px, 7vw, 74px);
    font-weight: 900;
  }

  .k-badge {
    position: absolute;
    top: 10px;
    left: 10px;
    border-radius: 999px;
    padding: 4px 10px;
    font-size: 11px;
    font-weight: 800;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: #fff;
  }

  .k-custom-pill {
    position: absolute;
    top: 10px;
    right: 10px;
    border-radius: 999px;
    padding: 3px 8px;
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    font-weight: 700;
    color: #f4f7ff;
    background: rgba(5,8,14,0.72);
    border: 1px solid rgba(255,255,255,0.14);
  }

  .k-item-body {
    padding: 10px 11px;
    display: flex;
    flex-direction: column;
    gap: 6px;
    min-height: 100px;
  }

  .k-item-name {
    font-size: clamp(14px, 1.9vw, 18px);
    font-weight: 800;
    line-height: 1.2;
  }

  .k-item-description {
    color: #a2acc0;
    font-size: clamp(12px, 1.6vw, 15px);
    line-height: 1.35;
  }

  .k-item-bottom {
    margin-top: auto;
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 10px;
  }

  .k-item-price {
    color: var(--kiosk-primary);
    font-size: clamp(16px, 2.2vw, 22px);
    font-weight: 900;
  }

  .k-item-add {
    width: 38px;
    height: 38px;
    border-radius: 50%;
    background: var(--kiosk-primary);
    color: #fff;
    display: grid;
    place-items: center;
    font-size: 24px;
    font-weight: 800;
    box-shadow: 0 8px 16px rgba(0,0,0,0.35);
  }

  .k-overlay {
    position: fixed;
    inset: 0;
    background: rgba(0,0,0,0.72);
    backdrop-filter: blur(5px);
    z-index: 120;
    display: flex;
  }

  .k-overlay-center {
    align-items: center;
    justify-content: center;
    padding: 16px;
  }

  .k-overlay-end {
    align-items: flex-end;
    justify-content: flex-end;
  }

  .k-modal {
    width: min(96vw, 560px);
    max-height: 88vh;
    border-radius: 20px;
    overflow: hidden;
    border: 1px solid rgba(255,255,255,0.12);
    background: #121827;
    display: flex;
    flex-direction: column;
  }

  .k-modal-header {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    padding: 18px;
    border-bottom: 1px solid rgba(255,255,255,0.12);
  }

  .k-modal-header h3 {
    margin: 0;
    font-size: clamp(20px, 2.6vw, 28px);
  }

  .k-modal-header p {
    margin: 6px 0 0;
    color: #96a2b8;
    font-size: 14px;
  }

  .k-icon-btn {
    border: 1px solid rgba(255,255,255,0.2);
    border-radius: 10px;
    width: 36px;
    height: 36px;
    background: rgba(255,255,255,0.04);
    color: #d7dfef;
    cursor: pointer;
    font-weight: 700;
  }

  .k-modal-body {
    overflow: auto;
    padding: 16px 18px;
    display: flex;
    flex-direction: column;
    gap: 16px;
    min-height: 0;
  }

  .k-modifier-title {
    font-size: 11px;
    letter-spacing: 0.11em;
    text-transform: uppercase;
    color: #96a2b8;
    margin-bottom: 8px;
    font-weight: 800;
  }

  .k-modifier-options {
    display: grid;
    gap: 8px;
  }

  .k-modifier-option {
    border: 1px solid rgba(255,255,255,0.12);
    border-radius: 12px;
    background: rgba(255,255,255,0.04);
    color: #ecf2ff;
    cursor: pointer;
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 10px;
    padding: 11px 12px;
    font-size: 14px;
  }

  .k-modifier-option.selected {
    border-color: var(--kiosk-primary);
    background: var(--kiosk-primary-soft);
  }

  .k-modal-footer {
    padding: 14px 18px;
    border-top: 1px solid rgba(255,255,255,0.12);
  }

  .k-cart-drawer {
    border: 1px solid rgba(255,255,255,0.14);
    background: #121827;
    display: flex;
    flex-direction: column;
    min-height: 0;
    overflow: hidden;
  }

  .k-cart-drawer.landscape {
    width: min(90vw, 480px);
    height: 100vh;
    border-radius: 0;
  }

  .k-cart-drawer.portrait {
    width: 100%;
    height: 88vh;
    border-radius: 20px 20px 0 0;
  }

  .k-drawer-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 14px 16px;
    border-bottom: 1px solid rgba(255,255,255,0.12);
  }

  .k-drawer-header h3 {
    margin: 0;
    font-size: clamp(22px, 2.8vw, 30px);
    letter-spacing: 0.02em;
    text-transform: uppercase;
  }

  .k-drawer-items {
    flex: 1;
    overflow: auto;
    padding: 8px 16px 14px;
    min-height: 0;
  }

  .k-empty-cart {
    text-align: center;
    color: #99a4ba;
    padding: 22px 0;
    font-size: 16px;
  }

  .k-cart-row {
    padding: 12px 0;
    border-bottom: 1px solid rgba(255,255,255,0.08);
    display: flex;
    gap: 10px;
  }

  .k-cart-row-main {
    flex: 1;
    min-width: 0;
  }

  .k-cart-item-name {
    font-size: 15px;
    font-weight: 700;
  }

  .k-cart-item-mods {
    margin-top: 3px;
    color: #95a0b6;
    font-size: 12px;
    line-height: 1.4;
  }

  .k-cart-item-price {
    margin-top: 5px;
    color: var(--kiosk-primary);
    font-size: 15px;
    font-weight: 800;
  }

  .k-qty-controls {
    display: flex;
    align-items: center;
    gap: 6px;
  }

  .k-qty-controls button {
    width: 30px;
    height: 30px;
    border-radius: 8px;
    border: 1px solid rgba(255,255,255,0.16);
    background: rgba(255,255,255,0.07);
    color: #e8eeff;
    font-size: 16px;
    font-weight: 700;
    cursor: pointer;
  }

  .k-qty-controls span {
    min-width: 20px;
    text-align: center;
    font-size: 14px;
    font-weight: 700;
  }

  .k-loyalty-card {
    margin-top: 12px;
    border: 1px solid rgba(255,255,255,0.12);
    border-radius: 14px;
    background: rgba(255,255,255,0.04);
    padding: 12px;
  }

  .k-loyalty-title {
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.12em;
    color: #9ca7bc;
    font-weight: 800;
    margin-bottom: 9px;
  }

  .k-loyalty-form {
    display: grid;
    gap: 8px;
  }

  .k-loyalty-user {
    font-size: 14px;
    font-weight: 700;
    margin-bottom: 8px;
  }

  .k-loyalty-discount-row {
    display: flex;
    gap: 8px;
    justify-content: space-between;
    align-items: center;
    font-size: 13px;
    color: #98f5b5;
    margin-bottom: 8px;
  }

  .k-loyalty-discount-row button {
    border: none;
    background: transparent;
    color: #ff9ca2;
    font-size: 12px;
    cursor: pointer;
  }

  .k-loyalty-muted {
    color: #9ca8c0;
    font-size: 13px;
    line-height: 1.4;
  }

  .k-link-btn {
    border: none;
    background: none;
    color: #b9c4db;
    cursor: pointer;
    font-size: 12px;
    text-decoration: underline;
    padding: 0;
    margin-top: 8px;
  }

  .k-link-btn.inline {
    margin-top: 0;
    font-size: 13px;
  }

  .k-drawer-footer {
    padding: 12px 16px 14px;
    border-top: 1px solid rgba(255,255,255,0.12);
    display: grid;
    gap: 10px;
    flex-shrink: 0;
  }

  .k-text-input {
    width: 100%;
    box-sizing: border-box;
    border-radius: 11px;
    border: 1px solid rgba(255,255,255,0.16);
    background: rgba(255,255,255,0.06);
    color: #f0f5ff;
    font-size: 15px;
    padding: 10px 12px;
    outline: none;
  }

  .kiosk-btn {
    border: 1px solid rgba(255,255,255,0.2);
    border-radius: 12px;
    background: rgba(255,255,255,0.08);
    color: #fff;
    cursor: pointer;
    font-weight: 700;
    font-size: 14px;
    padding: 10px 12px;
  }

  .kiosk-btn:disabled {
    opacity: 0.55;
    cursor: default;
  }

  .kiosk-btn.primary {
    border: none;
    background: var(--kiosk-primary);
  }

  .kiosk-btn.success {
    border: none;
    background: #22c55e;
  }

  .kiosk-btn.full {
    width: 100%;
    padding: 13px 16px;
    font-size: 16px;
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }

  .k-total-row {
    display: flex;
    justify-content: space-between;
    align-items: center;
    font-size: 14px;
  }

  .k-total-row.discount {
    color: #98f5b5;
  }

  .k-total-row.total {
    font-size: clamp(22px, 3vw, 30px);
    font-weight: 900;
    text-transform: uppercase;
    letter-spacing: 0.03em;
  }

  .kiosk.landscape.kiosk-main {
    grid-template-rows: auto auto auto auto minmax(0,1fr);
  }

  .kiosk.landscape .k-header {
    padding: 14px 24px;
  }

  .kiosk.landscape .k-hero {
    padding: 12px 24px;
    align-items: center;
  }

  .kiosk.landscape .k-hero h1 {
    font-size: clamp(28px, 4vw, 48px);
  }

  .kiosk.landscape .k-items-grid {
    grid-template-columns: repeat(auto-fill, minmax(210px, 1fr));
    padding: 14px 16px;
    gap: 11px;
  }

  .kiosk.landscape .k-item-image-wrap {
    height: 130px;
  }

  .kiosk.landscape .k-item-card {
    grid-template-rows: 130px auto;
    min-height: 240px;
  }

  .kiosk.landscape.density-comfortable .k-items-grid {
    grid-template-columns: repeat(auto-fill, minmax(232px, 1fr));
    gap: 13px;
  }

  .kiosk.landscape.density-comfortable .k-item-image-wrap {
    height: 145px;
  }

  .kiosk.landscape.density-comfortable .k-item-card {
    grid-template-rows: 145px auto;
    min-height: 260px;
  }

  .kiosk.landscape.density-comfortable .k-item-name {
    font-size: clamp(15px, 2vw, 20px);
  }

  .kiosk.flavor-sample .k-brand-sub,
  .kiosk.flavor-sample .k-stat-label,
  .kiosk.flavor-sample .k-overline {
    color: #ffd8c0;
  }

  .kiosk.flavor-sample .k-cart-pill {
    background: linear-gradient(140deg, #ea5c25, #f28d3f);
  }

  .kiosk.flavor-sample .k-item-card {
    background: linear-gradient(170deg, rgba(29,35,51,0.97), rgba(18,24,36,0.97));
  }

  .kiosk.landscape .k-idle-center {
    top: 38%;
  }

  .kiosk.landscape .kiosk-idle-strip {
    padding: 18px 10px;
  }

  @media (max-width: 900px) {
    .k-hero {
      flex-direction: column;
    }

    .k-hero-stats {
      min-width: 0;
    }
  }

  @keyframes kiosk-spin {
    to { transform: rotate(360deg); }
  }

  @keyframes kiosk-float {
    0%, 100% { transform: translateY(0); }
    50% { transform: translateY(-11px); }
  }

  @keyframes kiosk-blink {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.84; }
  }

  @keyframes kiosk-ticker {
    0% { transform: translateX(0); }
    100% { transform: translateX(-50%); }
  }

  .kiosk-float {
    animation: kiosk-float 3.4s ease-in-out infinite;
  }

  .kiosk-blink {
    animation: kiosk-blink 2.2s ease-in-out infinite;
  }
`;
