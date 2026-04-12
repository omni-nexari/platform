import { useState, useMemo } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { CreditCard, Banknote, CheckCircle2, ArrowLeft } from 'lucide-react';
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
  taxRatePct: number;
  currency: string;
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
  const [changeCents, setChangeCents]   = useState(0);
  const [orderNumber, setOrderNumber]   = useState<number | null>(null);

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
    mutationFn: (body: object) => api.post(`/pos/mgmt/orders/${orderId}/mark-paid`, body),
    onSuccess: async (data: { paymentId: string; changeCents: number; orderId: string }) => {
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
      setDone(true);
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
      reference: cardRef.trim() || undefined,
    });
  }

  // ─── Done screen ─────────────────────────────────────────────────────────

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

      {/* Tip selector */}
      <div className="flex flex-col gap-2">
        <p className="text-sm font-medium text-[var(--text)]">Tip</p>
        <div className="flex gap-2 flex-wrap">
          {TIP_PRESETS.map((p) => (
            <button
              key={p}
              onClick={() => { setTipPreset(p); setCustomTip(''); }}
              className={`px-4 py-2 rounded-lg border text-sm font-medium transition-colors ${
                tipPreset === p && tipPreset !== -1
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
