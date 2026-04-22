import { useState, useMemo } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { CreditCard, Banknote, CheckCircle2, ArrowLeft, Star, Search, X, Printer } from 'lucide-react';
import { api } from '../../lib/api.js';
import { Badge, Callout, PageHeader, Skeleton } from '../../components/UiPrimitives.js';

// ─── Types ───────────────────────────────────────────────────────────────────

interface OrderDetail {
  id: string;
  orderNumber: number;
  status: string;
  totalCents: number;
  customerName: string | null;
  notes: string | null;
  items: {
    id: string;
    itemName: string;
    quantity: number;
    unitPriceCents: number;
    lineTotalCents: number;
    notes: string | null;
  }[];
}

interface Restaurant {
  name: string;
  taxRatePct: number;
  currency: string;
  receiptHeader: string | null;
  receiptFooter: string | null;
}

interface LoyaltyCustomer {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  points: number;
  tier: string;
}

type PayMethod = 'cash' | 'card';

const TIP_PRESETS = [0, 15, 18, 20] as const;

// ─── Helpers ─────────────────────────────────────────────────────────────────

function fmt(cents: number, currency = 'USD') {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(cents / 100);
}

function parseCents(value: string): number {
  const n = parseFloat(value.replace(/[^0-9.]/g, ''));
  return isNaN(n) ? 0 : Math.round(n * 100);
}

// ─── Receipt Modal ────────────────────────────────────────────────────────────

function ReceiptModal({
  order,
  restaurant,
  taxCents,
  tipCents,
  grandTotal,
  payMethod,
  currency,
  loyaltyPointsEarned,
  onDone,
}: {
  order: OrderDetail;
  restaurant: Restaurant | null | undefined;
  taxCents: number;
  tipCents: number;
  grandTotal: number;
  payMethod: string;
  currency: string;
  loyaltyPointsEarned: number;
  onDone: () => void;
}) {
  const now = new Date();
  const dateStr = now.toLocaleDateString();
  const timeStr = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  return (
    <>
      {/* Print-only CSS injected via style tag */}
      <style>{`
        @media print {
          body > *:not(#pos-receipt-root) { display: none !important; }
          #pos-receipt-root { display: block !important; position: fixed; inset: 0; }
          #pos-receipt-modal-backdrop { background: white !important; }
          #pos-receipt-no-print { display: none !important; }
          #pos-receipt-content { box-shadow: none !important; border: none !important; max-height: none !important; overflow: visible !important; }
        }
      `}</style>

      <div
        id="pos-receipt-root"
        className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
      >
        <div
          id="pos-receipt-modal-backdrop"
          className="w-full max-w-sm bg-white rounded-2xl shadow-2xl flex flex-col overflow-hidden"
          style={{ maxHeight: '92vh' }}
        >
          {/* Action bar — hidden when printing */}
          <div
            id="pos-receipt-no-print"
            className="flex items-center justify-between px-4 py-3 border-b border-gray-100 shrink-0"
          >
            <span className="text-sm font-semibold text-gray-700">Receipt</span>
            <div className="flex gap-2">
              <button
                onClick={() => window.print()}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-gray-900 text-white text-xs font-medium hover:bg-gray-700 transition-colors"
              >
                <Printer size={13} />
                Print
              </button>
              <button
                onClick={onDone}
                className="px-3 py-1.5 rounded-lg border border-gray-200 text-xs font-medium text-gray-600 hover:bg-gray-50 transition-colors"
              >
                Done
              </button>
            </div>
          </div>

          {/* Receipt content */}
          <div
            id="pos-receipt-content"
            className="overflow-y-auto p-6 font-mono text-[13px] text-gray-900 flex flex-col gap-1"
          >
            {/* Header */}
            <div className="text-center mb-3">
              {restaurant?.name && (
                <p className="text-base font-bold uppercase tracking-widest">{restaurant.name}</p>
              )}
              {restaurant?.receiptHeader && (
                <p className="text-xs text-gray-500 mt-1 whitespace-pre-line">{restaurant.receiptHeader}</p>
              )}
              <div className="border-t border-dashed border-gray-300 mt-3" />
            </div>

            {/* Order info */}
            <div className="flex justify-between text-xs text-gray-500 mb-1">
              <span>Order #{order.orderNumber}</span>
              <span>{dateStr} {timeStr}</span>
            </div>
            {order.notes && (
              <p className="text-xs text-gray-500 mb-1">{order.notes}</p>
            )}
            {order.customerName && (
              <p className="text-xs text-gray-500 mb-1">Customer: {order.customerName}</p>
            )}

            <div className="border-t border-dashed border-gray-300 my-2" />

            {/* Line items */}
            {order.items.map((li) => (
              <div key={li.id} className="flex justify-between gap-2">
                <span className="flex-1">{li.quantity}x {li.itemName}</span>
                <span className="shrink-0">{fmt(li.lineTotalCents, currency)}</span>
              </div>
            ))}

            <div className="border-t border-dashed border-gray-300 my-2" />

            {/* Totals */}
            <div className="flex justify-between text-xs text-gray-500">
              <span>Subtotal</span>
              <span>{fmt(order.totalCents, currency)}</span>
            </div>
            {taxCents > 0 && (
              <div className="flex justify-between text-xs text-gray-500">
                <span>Tax</span>
                <span>{fmt(taxCents, currency)}</span>
              </div>
            )}
            {tipCents > 0 && (
              <div className="flex justify-between text-xs text-gray-500">
                <span>Tip</span>
                <span>{fmt(tipCents, currency)}</span>
              </div>
            )}
            <div className="flex justify-between font-bold text-sm mt-1">
              <span>TOTAL</span>
              <span>{fmt(grandTotal, currency)}</span>
            </div>
            <div className="flex justify-between text-xs text-gray-500 mt-0.5">
              <span>Paid ({payMethod})</span>
              <span>{fmt(grandTotal, currency)}</span>
            </div>

            {loyaltyPointsEarned > 0 && (
              <>
                <div className="border-t border-dashed border-gray-300 my-2" />
                <p className="text-center text-xs text-gray-600">⭐ {loyaltyPointsEarned} loyalty points earned</p>
              </>
            )}

            {/* Footer */}
            {restaurant?.receiptFooter && (
              <>
                <div className="border-t border-dashed border-gray-300 my-2" />
                <p className="text-center text-xs text-gray-500 whitespace-pre-line">{restaurant.receiptFooter}</p>
              </>
            )}
          </div>
        </div>
      </div>
    </>
  );
}

// ─── Component ───────────────────────────────────────────────────────────────

export default function PosPaymentPage() {
  const { wsId } = useParams<{ wsId: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [searchParams] = useSearchParams();

  const orderId    = searchParams.get('orderId') ?? '';
  const totalHint  = Number(searchParams.get('total') ?? '0');

  const [method, setMethod]             = useState<PayMethod>('cash');
  const [tipPreset, setTipPreset]       = useState<number>(0);
  const [customTip, setCustomTip]       = useState('');
  const [tenderedInput, setTendered]    = useState('');
  const [cardRef, setCardRef]           = useState('');
  const [done, setDone]                 = useState(false);
  const [showReceipt, setShowReceipt]   = useState(false);
  const [changeCents, setChangeCents]   = useState(0);
  const [orderNumber, setOrderNumber]   = useState<number | null>(null);
  const [loyaltySearch, setLoyaltySearch] = useState('');
  const [loyaltyCustomer, setLoyaltyCustomer] = useState<LoyaltyCustomer | null>(null);
  const [loyaltyPointsEarned, setLoyaltyPointsEarned] = useState(0);

  // ─── Data ────────────────────────────────────────────────────────────────

  const { data: order, isLoading: orderLoading } = useQuery<OrderDetail>({
    queryKey: ['pos-order-detail', orderId],
    queryFn:  () => api.get(`/pos/mgmt/orders/${orderId}`),
    enabled: !!orderId,
  });

  const { data: restaurant } = useQuery<Restaurant | null>({
    queryKey: ['pos-restaurant', wsId],
    queryFn:  () => api.get(`/pos/restaurant?workspaceId=${wsId}`),
  });

  const { data: loyaltyResults = [], isFetching: loyaltyFetching } = useQuery<LoyaltyCustomer[]>({
    queryKey: ['pos-loyalty-search', wsId, loyaltySearch],
    queryFn: () => api.get(`/pos/mgmt/loyalty/customers?workspaceId=${wsId}&q=${encodeURIComponent(loyaltySearch)}`),
    enabled: !!wsId && loyaltySearch.trim().length >= 2,
    staleTime: 10_000,
  });

  const currency = restaurant?.currency ?? 'USD';
  // Tax in basis points: 1000 = 10%
  const taxBps   = restaurant?.taxRatePct ?? 0;
  const subtotal = order?.totalCents ?? totalHint;
  const taxCents = Math.round(subtotal * taxBps / 10000);

  const tipBps    = tipPreset > 0 ? tipPreset : 0;
  const tipFromPreset = Math.round(subtotal * tipBps / 100);
  const tipFromCustom = customTip ? parseCents(customTip) : 0;
  const tipCents  = tipPreset === -1 ? tipFromCustom : tipFromPreset;

  const grandTotal = subtotal + taxCents + tipCents;

  const tenderedCents = parseCents(tenderedInput);
  const calculatedChange = useMemo(
    () => (method === 'cash' ? Math.max(0, tenderedCents - grandTotal) : 0),
    [method, tenderedCents, grandTotal],
  );

  // ─── Submit ──────────────────────────────────────────────────────────────

  const payMut = useMutation({
    mutationFn: (body: object) => api.post<{ paymentId: string; changeCents: number; orderId: string; loyaltyPointsEarned: number }>(`/pos/mgmt/orders/${orderId}/mark-paid`, body),
    onSuccess: async (data: { paymentId: string; changeCents: number; orderId: string; loyaltyPointsEarned: number }) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['pos-orders'] }),
        queryClient.invalidateQueries({ queryKey: ['pos-order-detail'] }),
        queryClient.invalidateQueries({ queryKey: ['pos-order-history'] }),
        queryClient.invalidateQueries({ queryKey: ['pos-orders-kitchen'] }),
        queryClient.invalidateQueries({ queryKey: ['pos-orders-stats'] }),
        queryClient.invalidateQueries({ queryKey: ['pos-analytics-top-items'] }),
      ]);
      setChangeCents(data.changeCents);
      setOrderNumber(order?.orderNumber ?? null);
      setLoyaltyPointsEarned(data.loyaltyPointsEarned ?? 0);
      setShowReceipt(true);
      toast.success('Payment recorded');
    },
    onError: () => toast.error('Failed to record payment'),
  });

  function handlePay() {
    if (method === 'cash' && tenderedCents < grandTotal) {
      toast.error('Tendered amount is less than total');
      return;
    }
    payMut.mutate({
      method,
      amountCents: method === 'cash' ? tenderedCents : grandTotal,
      tipCents,
      taxCents,
      reference: cardRef.trim() || undefined,
      ...(loyaltyCustomer ? { loyaltyCustomerId: loyaltyCustomer.id } : {}),
    });
  }

  // ─── Done screen ─────────────────────────────────────────────────────────

  if (showReceipt && order) {
    return (
      <ReceiptModal
        order={order}
        restaurant={restaurant}
        taxCents={taxCents}
        tipCents={tipCents}
        grandTotal={grandTotal}
        payMethod={method}
        currency={currency}
        loyaltyPointsEarned={loyaltyPointsEarned}
        onDone={() => { setShowReceipt(false); setDone(true); }}
      />
    );
  }

  if (done) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] gap-6 p-8 text-center">
        <CheckCircle2 size={64} className="text-emerald-500" />
        <div>
          <h2 className="text-2xl font-bold text-[var(--text)]">Payment Complete</h2>
          {orderNumber && <p className="text-[var(--text-muted)] mt-1">Order #{orderNumber}</p>}
        </div>
        {method === 'cash' && changeCents > 0 && (
          <div className="bg-emerald-50 border border-emerald-200 rounded-xl px-6 py-4">
            <p className="text-sm text-emerald-700 font-medium">Change due</p>
            <p className="text-3xl font-bold text-emerald-600 mt-1">{fmt(changeCents, currency)}</p>
          </div>
        )}
        <div className="flex gap-3">
          <button
            onClick={() => navigate(`/workspaces/${wsId}/pos`)}
            className="ui-btn-secondary flex items-center gap-2"
          >
            <Plus size={16} />
            New Order
          </button>
          <button
            onClick={() => navigate(`/workspaces/${wsId}/pos/orders`)}
            className="ui-btn-secondary flex items-center gap-2"
          >
            View Orders
          </button>
        </div>
        {loyaltyPointsEarned > 0 && (
          <div className="flex items-center gap-2 bg-amber-50 border border-amber-200 rounded-xl px-5 py-3 text-amber-700">
            <Star size={18} className="fill-amber-400 text-amber-400" />
            <span className="font-semibold">+{loyaltyPointsEarned} loyalty points earned!</span>
          </div>
        )}
      </div>
    );
  }

  // ─── Main render ─────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col gap-6 p-4 sm:p-6 max-w-2xl mx-auto">
      <div className="flex items-center gap-3">
        <button
          onClick={() => navigate(-1)}
          className="p-2 rounded-lg hover:bg-[var(--surface-raised)] text-[var(--text-muted)]"
        >
          <ArrowLeft size={18} />
        </button>
        <PageHeader
          title="Payment"
          subtitle={order ? `Order #${order.orderNumber}` : 'Loading…'}
          className="mb-0 flex-1"
        />
      </div>

      {/* Order summary */}
      <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] overflow-hidden">
        <div className="px-4 py-3 border-b border-[var(--border)] font-semibold text-[var(--text)] text-sm">
          Order Summary
        </div>
        {orderLoading ? (
          <div className="p-4 flex flex-col gap-2">
            {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-6 rounded" />)}
          </div>
        ) : order ? (
          <div className="divide-y divide-[var(--border)]">
            {order.items.map((li) => (
              <div key={li.id} className="flex items-center justify-between px-4 py-2.5 text-sm">
                <div className="flex items-center gap-2">
                  <Badge tone="neutral">{li.quantity}×</Badge>
                  <span className="text-[var(--text)]">{li.itemName}</span>
                  {li.notes && <span className="text-xs text-[var(--text-muted)] italic">({li.notes})</span>}
                </div>
                <span className="text-[var(--text)] font-medium shrink-0 ml-3">
                  {fmt(li.lineTotalCents, currency)}
                </span>
              </div>
            ))}
          </div>
        ) : (
          <div className="px-4 py-3 text-sm text-[var(--text-muted)]">Order not found.</div>
        )}

        {/* Totals */}
        <div className="border-t border-[var(--border)] divide-y divide-[var(--border)]">
          <div className="flex justify-between px-4 py-2 text-sm text-[var(--text-muted)]">
            <span>Subtotal</span><span>{fmt(subtotal, currency)}</span>
          </div>
          {taxCents > 0 && (
            <div className="flex justify-between px-4 py-2 text-sm text-[var(--text-muted)]">
              <span>Tax ({(taxBps / 100).toFixed(1)}%)</span>
              <span>{fmt(taxCents, currency)}</span>
            </div>
          )}
          {tipCents > 0 && (
            <div className="flex justify-between px-4 py-2 text-sm text-emerald-600">
              <span>Tip</span><span>{fmt(tipCents, currency)}</span>
            </div>
          )}
          <div className="flex justify-between px-4 py-3 text-base font-bold text-[var(--text)]">
            <span>Total</span><span>{fmt(grandTotal, currency)}</span>
          </div>
        </div>
      </div>

      {/* Loyalty customer */}
      <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] overflow-hidden">
        <div className="px-4 py-3 border-b border-[var(--border)] flex items-center gap-2">
          <Star size={15} className="text-amber-400" />
          <span className="font-semibold text-[var(--text)] text-sm">Loyalty Customer</span>
          <span className="text-xs text-[var(--text-muted)] ml-1">(optional)</span>
        </div>
        <div className="p-4">
          {loyaltyCustomer ? (
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-semibold text-[var(--text)]">{loyaltyCustomer.name}</p>
                <p className="text-xs text-[var(--text-muted)]">
                  {loyaltyCustomer.phone ?? loyaltyCustomer.email ?? ''}
                  {' · '}
                  <span className="capitalize">{loyaltyCustomer.tier}</span>
                  {' · '}
                  <span className="text-amber-500 font-medium">{loyaltyCustomer.points} pts</span>
                </p>
              </div>
              <button
                onClick={() => { setLoyaltyCustomer(null); setLoyaltySearch(''); }}
                className="p-1 rounded-lg text-[var(--text-muted)] hover:text-[var(--text)] hover:bg-[var(--surface-raised)] transition-colors"
              >
                <X size={16} />
              </button>
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              <div className="relative">
                <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
                <input
                  type="text"
                  placeholder="Search by name, phone or email…"
                  value={loyaltySearch}
                  onChange={(e) => setLoyaltySearch(e.target.value)}
                  className="w-full pl-8 pr-3 py-2 text-sm rounded-lg border border-[var(--border)] bg-[var(--surface-raised)] text-[var(--text)] focus:outline-none focus:ring-1 focus:ring-[var(--accent)]"
                />
              </div>
              {loyaltySearch.trim().length >= 2 && (
                loyaltyFetching ? (
                  <p className="text-xs text-[var(--text-muted)] px-1">Searching…</p>
                ) : loyaltyResults.length === 0 ? (
                  <p className="text-xs text-[var(--text-muted)] px-1">No customers found.</p>
                ) : (
                  <ul className="divide-y divide-[var(--border)] rounded-lg border border-[var(--border)] overflow-hidden">
                    {loyaltyResults.slice(0, 5).map((c) => (
                      <li key={c.id}>
                        <button
                          onClick={() => { setLoyaltyCustomer(c); setLoyaltySearch(''); }}
                          className="w-full flex items-center justify-between px-3 py-2.5 text-sm hover:bg-[var(--surface-raised)] transition-colors text-left"
                        >
                          <span className="font-medium text-[var(--text)]">{c.name}</span>
                          <span className="text-xs text-amber-500 font-medium">{c.points} pts</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )
              )}
            </div>
          )}
        </div>
      </div>

      {/* Tip selector */}
      <div className="flex flex-col gap-2">
        <p className="text-sm font-medium text-[var(--text)]">Tip</p>
        <div className="flex gap-2 flex-wrap">
          {TIP_PRESETS.map((p) => (
            <button
              key={p}
              onClick={() => { setTipPreset(p); setCustomTip(''); }}
              className={`px-4 py-2 rounded-lg border text-sm font-medium transition-colors ${
                tipPreset === p
                  ? 'bg-[var(--accent)] border-[var(--accent)] text-white'
                  : 'border-[var(--border)] text-[var(--text)] hover:border-[var(--accent)]'
              }`}
            >
              {p === 0 ? 'No Tip' : `${p}%`}
            </button>
          ))}
          <button
            onClick={() => setTipPreset(-1)}
            className={`px-4 py-2 rounded-lg border text-sm font-medium transition-colors ${
              tipPreset === -1
                ? 'bg-[var(--accent)] border-[var(--accent)] text-white'
                : 'border-[var(--border)] text-[var(--text)] hover:border-[var(--accent)]'
            }`}
          >
            Custom
          </button>
        </div>
        {tipPreset === -1 && (
          <input
            type="number"
            min="0"
            step="0.01"
            placeholder="e.g. 3.50"
            value={customTip}
            onChange={(e) => setCustomTip(e.target.value)}
            className="text-sm px-3 py-2 rounded-lg border border-[var(--border)] bg-[var(--surface)] text-[var(--text)] focus:outline-none focus:ring-1 focus:ring-[var(--accent)] w-40"
          />
        )}
      </div>

      {/* Payment method */}
      <div className="flex flex-col gap-3">
        <p className="text-sm font-medium text-[var(--text)]">Payment Method</p>
        <div className="grid grid-cols-2 gap-3">
          {(['cash', 'card'] as const).map((m) => (
            <button
              key={m}
              onClick={() => setMethod(m)}
              className={`flex flex-col items-center gap-2 rounded-xl border-2 py-5 text-sm font-semibold capitalize transition-colors ${
                method === m
                  ? 'border-[var(--accent)] bg-[var(--accent)]/5 text-[var(--accent)]'
                  : 'border-[var(--border)] text-[var(--text-muted)] hover:border-[var(--accent)]/60'
              }`}
            >
              {m === 'cash' ? <Banknote size={28} /> : <CreditCard size={28} />}
              {m}
            </button>
          ))}
        </div>

        {method === 'cash' && (
          <div className="flex flex-col gap-1.5">
            <label className="text-sm text-[var(--text-muted)]">Amount tendered</label>
            <input
              type="number"
              min="0"
              step="0.01"
              placeholder={fmt(grandTotal, currency)}
              value={tenderedInput}
              onChange={(e) => setTendered(e.target.value)}
              className="text-base px-3 py-2.5 rounded-lg border border-[var(--border)] bg-[var(--surface)] text-[var(--text)] focus:outline-none focus:ring-1 focus:ring-[var(--accent)] w-full"
            />
            {tenderedCents > 0 && (
              <p className={`text-sm font-medium ${calculatedChange >= 0 ? 'text-emerald-600' : 'text-red-500'}`}>
                Change: {fmt(calculatedChange, currency)}
              </p>
            )}
          </div>
        )}

        {method === 'card' && (
          <div className="flex flex-col gap-1.5">
            <label className="text-sm text-[var(--text-muted)]">Auth / Reference (optional)</label>
            <input
              type="text"
              placeholder="e.g. VISA ****1234"
              value={cardRef}
              onChange={(e) => setCardRef(e.target.value)}
              maxLength={100}
              className="text-sm px-3 py-2.5 rounded-lg border border-[var(--border)] bg-[var(--surface)] text-[var(--text)] focus:outline-none focus:ring-1 focus:ring-[var(--accent)] w-full"
            />
          </div>
        )}
      </div>

      {order?.status === 'completed' && (
        <Callout tone="accent">This order has already been paid.</Callout>
      )}

      {order?.status === 'cancelled' && (
        <Callout tone="danger">This order was cancelled and can no longer be paid.</Callout>
      )}

      <button
        onClick={handlePay}
        disabled={payMut.isPending || !orderId || order?.status === 'completed' || order?.status === 'cancelled'}
        className="w-full flex items-center justify-center gap-2 rounded-xl bg-[var(--accent)] px-4 py-3.5 text-base font-bold text-white transition-opacity hover:opacity-90 disabled:opacity-50"
      >
        {payMut.isPending ? 'Processing…' : `Charge ${fmt(grandTotal, currency)}`}
      </button>
    </div>
  );
}

// small helper imported by done screen
function Plus({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
    </svg>
  );
}
