import { useState, useMemo } from 'react';
import { useNavigate, useParams } from 'react-router';
import { useQuery, useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  ShoppingCart, Plus, Minus, Trash2, UtensilsCrossed, ChevronRight,
  LayoutGrid, Users, X,
} from 'lucide-react';
import { api } from '../../lib/api.js';
import { Badge, EmptyState, PageHeader, Skeleton } from '../../components/UiPrimitives.js';

// ─── Types ───────────────────────────────────────────────────────────────────

interface PosTable {
  id: string;
  number: number;
  name: string | null;
  seats: number;
  location: string | null;
  status: string;
}

interface ModifierGroup {
  id: string;
  name: string;
  required: boolean;
  maxSelect: number;
  options: { id: string; name: string; priceCents: number }[];
}

interface MenuItem {
  id: string;
  name: string;
  description: string | null;
  imageUrl: string | null;
  priceCents: number;
  isAvailable: boolean;
  tags: string[];
  modifiers: ModifierGroup[];
}

interface MenuCategory {
  id: string;
  name: string;
  description: string | null;
  imageUrl: string | null;
  color: string | null;
  items: MenuItem[];
}

interface Menu {
  id: string;
  name: string;
  currency: string;
  categories: MenuCategory[];
}

interface CartLine {
  itemId: string;
  itemName: string;
  priceCents: number;
  quantity: number;
  notes: string;
  selectedModifiers: { groupName: string; optionName: string; priceCents: number }[];
}

type OrderType = 'dine-in' | 'takeout';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function fmt(cents: number, currency = 'USD') {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(cents / 100);
}

// ─── Table Picker Modal ───────────────────────────────────────────────────────

function TablePickerModal({
  tables,
  onSelect,
  onClose,
}: {
  tables: PosTable[];
  onSelect: (table: PosTable) => void;
  onClose: () => void;
}) {
  const [locationFilter, setLocationFilter] = useState<string>('all');

  const locations = useMemo(() => {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const t of tables) {
      if (t.location && !seen.has(t.location)) { seen.add(t.location); out.push(t.location); }
    }
    return out;
  }, [tables]);

  const filtered = locationFilter === 'all'
    ? tables
    : tables.filter((t) => t.location === locationFilter);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="w-full max-w-2xl bg-[var(--bg)] rounded-2xl border border-[var(--border)] shadow-2xl overflow-hidden flex flex-col"
        style={{ maxHeight: '85vh' }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--border)] shrink-0">
          <h2 className="font-semibold text-[var(--text)] flex items-center gap-2">
            <LayoutGrid size={18} />
            Pick a Table
          </h2>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-[var(--surface)] text-[var(--text-muted)] transition-colors"
          >
            <X size={18} />
          </button>
        </div>

        {/* Location filter chips */}
        {locations.length > 0 && (
          <div className="flex items-center gap-2 px-5 py-3 border-b border-[var(--border)] flex-wrap shrink-0">
            {['all', ...locations].map((loc) => (
              <button
                key={loc}
                onClick={() => setLocationFilter(loc)}
                className={`px-3 py-1 rounded-full text-xs font-medium transition-colors capitalize ${
                  locationFilter === loc
                    ? 'bg-[var(--accent)] text-white'
                    : 'bg-[var(--surface)] text-[var(--text-muted)] hover:bg-[var(--surface-raised)]'
                }`}
              >
                {loc === 'all' ? 'All Zones' : loc}
              </button>
            ))}
          </div>
        )}

        {/* Table grid */}
        <div className="p-5 overflow-y-auto flex-1">
          {filtered.length === 0 ? (
            <div className="text-center py-12 text-[var(--text-muted)] text-sm">No tables in this zone</div>
          ) : (
            <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 gap-3">
              {filtered.map((table) => {
                const isAvailable = table.status === 'available';
                const isOccupied  = table.status === 'occupied';
                return (
                  <button
                    key={table.id}
                    onClick={() => isAvailable && onSelect(table)}
                    disabled={!isAvailable}
                    className={`flex flex-col items-center gap-1.5 rounded-xl border-2 p-3 transition-all ${
                      isAvailable
                        ? 'border-emerald-500 bg-emerald-500/5 hover:bg-emerald-500/15 hover:scale-105 cursor-pointer'
                        : isOccupied
                        ? 'border-amber-400 bg-amber-400/5 opacity-70 cursor-not-allowed'
                        : 'border-[var(--border)] bg-[var(--surface)] opacity-50 cursor-not-allowed'
                    }`}
                  >
                    <span className={`text-2xl font-bold leading-none ${
                      isAvailable ? 'text-emerald-500' : isOccupied ? 'text-amber-500' : 'text-[var(--text-muted)]'
                    }`}>
                      {table.number}
                    </span>
                    {table.name && (
                      <span className="text-[10px] text-[var(--text-muted)] truncate w-full text-center leading-tight">{table.name}</span>
                    )}
                    <div className="flex items-center gap-1 text-[var(--text-muted)]">
                      <Users size={10} />
                      <span className="text-[10px]">{table.seats ?? 4}</span>
                    </div>
                    <span className={`text-[9px] font-bold uppercase tracking-wider ${
                      isAvailable ? 'text-emerald-500' : isOccupied ? 'text-amber-500' : 'text-[var(--text-muted)]'
                    }`}>
                      {table.status}
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* Legend */}
        <div className="flex items-center gap-5 px-5 py-3 border-t border-[var(--border)] bg-[var(--surface-raised)] shrink-0">
          <div className="flex items-center gap-1.5 text-xs text-[var(--text-muted)]">
            <div className="w-3 h-3 rounded border-2 border-emerald-500" />
            Available
          </div>
          <div className="flex items-center gap-1.5 text-xs text-[var(--text-muted)]">
            <div className="w-3 h-3 rounded border-2 border-amber-400" />
            Occupied
          </div>
          <div className="flex items-center gap-1.5 text-xs text-[var(--text-muted)]">
            <div className="w-3 h-3 rounded border-2 border-[var(--border)]" />
            Reserved
          </div>
        </div>
      </div>
    </div>
  );
}

function cartLineTotal(line: CartLine) {
  const modTotal = line.selectedModifiers.reduce((s, m) => s + m.priceCents, 0);
  return (line.priceCents + modTotal) * line.quantity;
}

// ─── Component ───────────────────────────────────────────────────────────────

export default function PosOrderPage() {
  const { wsId } = useParams<{ wsId: string }>();
  const navigate = useNavigate();

  const [orderType, setOrderType] = useState<OrderType>('dine-in');
  const [selectedTableId, setSelectedTableId] = useState<string>('');
  const [showTablePicker, setShowTablePicker] = useState(false);
  const [selectedCategoryId, setSelectedCategoryId] = useState<string>('');
  const [cart, setCart] = useState<CartLine[]>([]);
  const [customerName, setCustomerName] = useState('');
  const [orderNotes, setOrderNotes] = useState('');

  // Modifier picker
  const [modifierTarget, setModifierTarget] = useState<MenuItem | null>(null);
  const [modifierSelections, setModifierSelections] = useState<Record<string, string[]>>({});

  // ─── Data ───────────────────────────────────────────────────────────────

  const { data: tables = [] } = useQuery<PosTable[]>({
    queryKey: ['pos-tables', wsId],
    queryFn: () => api.get(`/pos/tables?workspaceId=${wsId}`),
  });

  const { data: menu, isLoading: menuLoading, isError: menuError } = useQuery<Menu>({
    queryKey: ['pos-menu-full', wsId],
    queryFn: () => api.get(`/pos/menu?workspaceId=${wsId}`),
    retry: false,
  });

  const categories = menu?.categories ?? [];
  const activeCategory = categories.find((c) => c.id === selectedCategoryId) ?? categories[0];

  const cartTotal = useMemo(() => cart.reduce((s, li) => s + cartLineTotal(li), 0), [cart]);
  const cartCount = useMemo(() => cart.reduce((s, li) => s + li.quantity, 0), [cart]);

  // ─── Cart helpers ────────────────────────────────────────────────────────

  function openItemPicker(item: MenuItem) {
    if (item.modifiers.length === 0) { addItem(item, []); return; }
    setModifierTarget(item);
    setModifierSelections({});
  }

  function toggleModOpt(group: ModifierGroup, optId: string) {
    setModifierSelections((prev) => {
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
    if (!modifierTarget) return;
    const required = modifierTarget.modifiers.filter((g) => g.required);
    for (const g of required) {
      if (!modifierSelections[g.id]?.length) {
        toast.error(`Please select an option for "${g.name}"`);
        return;
      }
    }
    const mods: CartLine['selectedModifiers'] = [];
    for (const g of modifierTarget.modifiers) {
      for (const optId of modifierSelections[g.id] ?? []) {
        const opt = g.options.find((o) => o.id === optId);
        if (opt) mods.push({ groupName: g.name, optionName: opt.name, priceCents: opt.priceCents });
      }
    }
    addItem(modifierTarget, mods);
    setModifierTarget(null);
  }

  function addItem(item: MenuItem, mods: CartLine['selectedModifiers']) {
    setCart((prev) => {
      if (mods.length === 0) {
        const idx = prev.findIndex((l) => l.itemId === item.id && l.selectedModifiers.length === 0);
        if (idx >= 0) {
          return prev.map((l, i) => i === idx ? { ...l, quantity: l.quantity + 1 } : l);
        }
      }
      return [...prev, {
        itemId: item.id, itemName: item.name, priceCents: item.priceCents,
        quantity: 1, notes: '', selectedModifiers: mods,
      }];
    });
  }

  function adjustQty(idx: number, delta: number) {
    setCart((prev) => {
      const next = [...prev];
      const line = next[idx]!;
      const newQty = line.quantity + delta;
      if (newQty <= 0) {
        next.splice(idx, 1);
      } else {
        next[idx] = { ...line, quantity: newQty };
      }
      return next;
    });
  }

  function removeItem(idx: number) {
    setCart((prev) => prev.filter((_, i) => i !== idx));
  }

  // ─── Submit ──────────────────────────────────────────────────────────────

  const createOrderMut = useMutation({
    mutationFn: (body: object) => api.post<{ id: string; orderNumber: number; totalCents: number }>('/pos/mgmt/orders', body),
    onSuccess: (data: { id: string; orderNumber: number; totalCents: number }) => {
      toast.success(`Order #${data.orderNumber} created`);
      navigate(`/workspaces/${wsId}/pos/payment?orderId=${data.id}&total=${data.totalCents}`);
    },
    onError: () => toast.error('Failed to place order'),
  });

  function handlePlaceOrder() {
    if (cart.length === 0) { toast.error('Add at least one item'); return; }
    if (orderType === 'dine-in' && !selectedTableId) { toast.error('Select a table'); return; }

    createOrderMut.mutate({
      workspaceId: wsId,
      tableId: orderType === 'dine-in' ? selectedTableId : undefined,
      orderType,
      customerName: customerName.trim() || undefined,
      notes: orderNotes.trim() || undefined,
      items: cart.map((li) => ({
        itemId: li.itemId,
        quantity: li.quantity,
        notes: li.notes || undefined,
        selectedModifiers: li.selectedModifiers,
      })),
    });
  }

  // ─── Render ──────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col h-full max-w-screen-2xl mx-auto">
      {/* Header */}
      <div className="px-4 sm:px-6 py-4 border-b border-[var(--border)]">
        <PageHeader
          icon={<UtensilsCrossed size={22} />}
          title="New Order"
          subtitle="Browse the menu and build the order"
          className="mb-0"
        />
      </div>

      <div className="flex flex-1 overflow-hidden">
        {/* ── Left: Menu browser ───────────────────────────────────────── */}
        <div className="flex flex-1 flex-col overflow-hidden border-r border-[var(--border)]">

          {/* Order type + table */}
          <div className="flex flex-wrap items-center gap-3 px-4 py-3 border-b border-[var(--border)] bg-[var(--surface-raised)]">
            <div className="flex rounded-lg overflow-hidden border border-[var(--border)]">
              {(['dine-in', 'takeout'] as const).map((t) => (
                <button
                  key={t}
                  onClick={() => { setOrderType(t); if (t === 'takeout') setSelectedTableId(''); }}
                  className={`px-3 py-1.5 text-sm font-medium capitalize transition-colors ${
                    orderType === t
                      ? 'bg-[var(--accent)] text-white'
                      : 'bg-[var(--surface)] text-[var(--text-muted)] hover:bg-[var(--surface-raised)]'
                  }`}
                >
                  {t}
                </button>
              ))}
            </div>

            {orderType === 'dine-in' && (
              <>
                <button
                  onClick={() => setShowTablePicker(true)}
                  className={`flex items-center gap-2 text-sm px-3 py-1.5 rounded-lg border transition-colors ${
                    selectedTableId
                      ? 'border-emerald-500 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
                      : 'border-[var(--border)] bg-[var(--surface)] text-[var(--text-muted)] hover:bg-[var(--surface-raised)]'
                  }`}
                >
                  <LayoutGrid size={14} />
                  {selectedTableId
                    ? (() => {
                        const t = tables.find((tb) => tb.id === selectedTableId);
                        return t ? `Table ${t.number}${t.name ? ` · ${t.name}` : ''}` : 'Table selected';
                      })()
                    : 'Pick Table'
                  }
                </button>
                {selectedTableId && (
                  <button
                    onClick={() => setSelectedTableId('')}
                    className="p-1.5 rounded-lg text-[var(--text-muted)] hover:text-[var(--text)] hover:bg-[var(--surface)] transition-colors"
                    title="Clear table selection"
                  >
                    <X size={14} />
                  </button>
                )}
                {showTablePicker && (
                  <TablePickerModal
                    tables={tables}
                    onSelect={(t) => { setSelectedTableId(t.id); setShowTablePicker(false); }}
                    onClose={() => setShowTablePicker(false)}
                  />
                )}

      {/* Modifier picker modal */}
      {modifierTarget && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
          onClick={() => setModifierTarget(null)}
        >
          <div
            className="w-full max-w-md bg-[var(--bg)] rounded-2xl border border-[var(--border)] shadow-2xl flex flex-col overflow-hidden"
            style={{ maxHeight: '80vh' }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between px-5 py-4 border-b border-[var(--border)] shrink-0">
              <div>
                <h2 className="font-semibold text-[var(--text)]">{modifierTarget.name}</h2>
                <p className="text-xs text-[var(--text-muted)] mt-0.5">{fmt(modifierTarget.priceCents, menu?.currency)} + options</p>
              </div>
              <button onClick={() => setModifierTarget(null)} className="p-1.5 rounded-lg hover:bg-[var(--surface)] text-[var(--text-muted)] transition-colors">
                <X size={18} />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-5 space-y-5">
              {modifierTarget.modifiers.map((group) => (
                <div key={group.id}>
                  <p className="text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)] mb-2">
                    {group.name}{group.required ? ' *' : ''}
                    {group.maxSelect > 1 ? ` (up to ${group.maxSelect})` : ''}
                  </p>
                  <div className="flex flex-col gap-2">
                    {group.options.map((opt) => {
                      const selected = modifierSelections[group.id]?.includes(opt.id) ?? false;
                      return (
                        <button
                          key={opt.id}
                          onClick={() => toggleModOpt(group, opt.id)}
                          className={`flex items-center justify-between px-3 py-2.5 rounded-xl border-2 text-sm transition-all text-left ${
                            selected
                              ? 'border-[var(--accent)] bg-[var(--accent)]/10 text-[var(--text)]'
                              : 'border-[var(--border)] bg-[var(--surface)] text-[var(--text-muted)] hover:border-[var(--accent)]/50'
                          }`}
                        >
                          <span className="font-medium">{opt.name}</span>
                          <span className="text-xs text-[var(--accent)] font-medium">
                            {opt.priceCents > 0 ? `+${fmt(opt.priceCents, menu?.currency)}` : 'Free'}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
            <div className="px-5 py-4 border-t border-[var(--border)] shrink-0">
              <button
                onClick={confirmModifiers}
                className="w-full flex items-center justify-center gap-2 rounded-xl bg-[var(--accent)] px-4 py-3 text-sm font-semibold text-white transition-opacity hover:opacity-90"
              >
                <Plus size={16} /> Add to Order
              </button>
            </div>
          </div>
        </div>
      )}
              </>
            )}

            <input
              type="text"
              placeholder="Customer name (optional)"
              value={customerName}
              onChange={(e) => setCustomerName(e.target.value)}
              maxLength={80}
              className="text-sm px-2 py-1.5 rounded-lg border border-[var(--border)] bg-[var(--surface)] text-[var(--text)] focus:outline-none focus:ring-1 focus:ring-[var(--accent)] w-44"
            />
          </div>

          <div className="flex flex-1 overflow-hidden">
            {/* Category sidebar */}
            <div className="w-36 sm:w-44 shrink-0 overflow-y-auto border-r border-[var(--border)] bg-[var(--surface-raised)]">
              {menuLoading
                ? Array.from({ length: 5 }).map((_, i) => (
                    <Skeleton key={i} className="mx-3 my-2 h-8 rounded" />
                  ))
                : categories.map((cat) => (
                    <button
                      key={cat.id}
                      onClick={() => setSelectedCategoryId(cat.id)}
                      className={`w-full text-left px-3 py-2.5 text-sm font-medium truncate transition-colors ${
                        activeCategory?.id === cat.id
                          ? 'bg-[var(--accent)] text-white'
                          : 'text-[var(--text)] hover:bg-[var(--surface)]'
                      }`}
                    >
                      {cat.name}
                    </button>
                  ))
              }
            </div>

            {/* Items grid */}
            <div className="flex-1 overflow-y-auto p-3">
              {menuLoading ? (
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                  {Array.from({ length: 6 }).map((_, i) => (
                    <Skeleton key={i} className="h-28 rounded-xl" />
                  ))}
                </div>
              ) : menuError ? (
                <div className="flex flex-col items-center justify-center h-full gap-4 p-8 text-center">
                  <p className="text-[var(--text-muted)] text-sm">No active menu found for this workspace.</p>
                  <button
                    onClick={() => navigate(`/workspaces/${wsId}/pos/menu`)}
                    className="ui-btn-primary text-sm"
                  >
                    Set up Menu
                  </button>
                </div>
              ) : !activeCategory || activeCategory.items.length === 0 ? (
                <EmptyState title="No items" subtitle="This category has no available items." />
              ) : (
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
                  {activeCategory.items.filter((it) => it.isAvailable).map((item) => (
                    <button
                      key={item.id}
                      onClick={() => openItemPicker(item)}
                      className="group relative flex flex-col gap-1.5 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-3 text-left transition-all hover:border-[var(--accent)] hover:shadow-sm active:scale-[0.98]"
                    >
                      {item.imageUrl ? (
                        <img
                          src={item.imageUrl}
                          alt={item.name}
                          className="w-full h-20 object-cover rounded-lg mb-1"
                        />
                      ) : (
                        <div className="w-full h-20 rounded-lg bg-[var(--surface-raised)] flex items-center justify-center mb-1">
                          <UtensilsCrossed size={28} className="text-[var(--text-muted)] opacity-40" />
                        </div>
                      )}
                      <span className="text-sm font-semibold text-[var(--text)] leading-tight line-clamp-2">{item.name}</span>
                      <span className="text-xs text-[var(--accent)] font-medium">{fmt(item.priceCents, menu?.currency)}</span>
                      {item.modifiers.length > 0 && (
                        <span className="text-[10px] text-[var(--text-muted)]">Customizable</span>
                      )}
                      <div className="absolute top-2 right-2 bg-[var(--accent)] rounded-full p-0.5 text-white opacity-0 group-hover:opacity-100 transition-opacity">
                        <Plus size={14} />
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* ── Right: Cart ──────────────────────────────────────────────── */}
        <div className="w-72 xl:w-80 shrink-0 flex flex-col bg-[var(--surface-raised)]">
          <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--border)]">
            <h2 className="font-semibold text-[var(--text)] flex items-center gap-2">
              <ShoppingCart size={18} />
              Cart
            </h2>
            {cartCount > 0 && (
              <Badge tone="accent">{cartCount} item{cartCount !== 1 ? 's' : ''}</Badge>
            )}
          </div>

          {/* Cart lines */}
          <div className="flex-1 overflow-y-auto divide-y divide-[var(--border)]">
            {cart.length === 0 ? (
              <div className="flex flex-col items-center justify-center gap-2 py-12 text-[var(--text-muted)]">
                <ShoppingCart size={36} className="opacity-30" />
                <span className="text-sm">Cart is empty</span>
              </div>
            ) : (
              cart.map((line, idx) => (
                <div key={idx} className="flex items-start gap-2 px-3 py-2.5">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-[var(--text)] truncate">{line.itemName}</p>
                    {line.selectedModifiers.length > 0 && (
                      <p className="text-[10px] text-[var(--text-muted)] truncate">
                        {line.selectedModifiers.map((m) => m.optionName).join(', ')}
                      </p>
                    )}
                    <p className="text-xs text-[var(--text-muted)]">{fmt(cartLineTotal(line), menu?.currency)}</p>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <button onClick={() => adjustQty(idx, -1)} className="p-1 rounded hover:bg-[var(--surface)] text-[var(--text-muted)] hover:text-[var(--text)]">
                      <Minus size={13} />
                    </button>
                    <span className="w-6 text-center text-sm font-semibold text-[var(--text)]">{line.quantity}</span>
                    <button onClick={() => adjustQty(idx, 1)} className="p-1 rounded hover:bg-[var(--surface)] text-[var(--text-muted)] hover:text-[var(--text)]">
                      <Plus size={13} />
                    </button>
                    <button onClick={() => removeItem(idx)} className="p-1 rounded hover:bg-red-50 text-[var(--text-muted)] hover:text-red-500 ml-1">
                      <Trash2 size={13} />
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>

          {/* Notes + totals + place order */}
          <div className="border-t border-[var(--border)] p-3 flex flex-col gap-3">
            <textarea
              rows={2}
              placeholder="Order notes…"
              value={orderNotes}
              onChange={(e) => setOrderNotes(e.target.value)}
              maxLength={500}
              className="text-sm w-full px-2 py-1.5 rounded-lg border border-[var(--border)] bg-[var(--surface)] text-[var(--text)] resize-none focus:outline-none focus:ring-1 focus:ring-[var(--accent)]"
            />

            <div className="flex items-center justify-between text-sm text-[var(--text-muted)]">
              <span>Subtotal</span>
              <span className="font-medium text-[var(--text)]">{fmt(cartTotal, menu?.currency)}</span>
            </div>

            <button
              onClick={handlePlaceOrder}
              disabled={cart.length === 0 || createOrderMut.isPending}
              className="w-full flex items-center justify-center gap-2 rounded-xl bg-[var(--accent)] px-4 py-3 text-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-50"
            >
              {createOrderMut.isPending ? 'Placing…' : 'Place Order'}
              {!createOrderMut.isPending && <ChevronRight size={16} />}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
