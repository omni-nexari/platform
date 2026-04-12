import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useParams } from 'react-router';
import { toast } from 'sonner';
import { ClipboardList, Plus, ChevronRight, Trash2 } from 'lucide-react';
import { api } from '../../lib/api.js';
import {
  Badge, EmptyState, FilterChip, Modal, ModalBody, ModalFooter,
  ModalHeader, PageHeader, Skeleton,
} from '../../components/UiPrimitives.js';

type POStatus = 'draft' | 'sent' | 'received' | 'cancelled';

interface POItem { name: string; quantity: number; unit: string; unitCostCents: number; totalCents: number }

interface PurchaseOrder {
  id: string;
  poNumber: number;
  supplier: string;
  status: POStatus;
  items: POItem[];
  totalCents: number;
  orderedAt: string | null;
  expectedAt: string | null;
  deliveredAt: string | null;
  notes: string | null;
  createdAt: string;
}

const STATUS_TONE: Record<POStatus, 'neutral' | 'accent' | 'success' | 'warning' | 'danger'> = {
  draft: 'neutral', sent: 'accent', received: 'success', cancelled: 'danger',
};

const NEXT_STATUS: Partial<Record<POStatus, POStatus>> = { draft: 'sent', sent: 'received' };

function fmt(cents: number) { return `$${(cents / 100).toFixed(2)}`; }

const BLANK_ITEM: POItem = { name: '', quantity: 1, unit: 'unit', unitCostCents: 0, totalCents: 0 };

export default function PosPurchaseOrdersPage() {
  const { wsId } = useParams<{ wsId: string }>();
  const qc = useQueryClient();
  const [statusFilter, setStatusFilter] = useState<POStatus | 'all'>('all');
  const [creating, setCreating] = useState(false);
  const [supplier, setSupplier] = useState('');
  const [expectedAt, setExpectedAt] = useState('');
  const [notes, setNotes] = useState('');
  const [poItems, setPoItems] = useState<POItem[]>([{ ...BLANK_ITEM }]);
  const [detail, setDetail] = useState<PurchaseOrder | null>(null);

  const { data: orders = [], isLoading } = useQuery<PurchaseOrder[]>({
    queryKey: ['pos-purchase-orders', wsId],
    queryFn: () => api.get(`/pos/mgmt/purchase-orders?workspaceId=${wsId}`),
  });

  const createMut = useMutation({
    mutationFn: (body: object) => api.post('/pos/mgmt/purchase-orders', body),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['pos-purchase-orders', wsId] }); setCreating(false); toast.success('Purchase order created'); },
    onError: () => toast.error('Failed to create PO'),
  });

  const advanceMut = useMutation({
    mutationFn: ({ id, status, deliveredAt }: { id: string; status: POStatus; deliveredAt?: string }) =>
      api.patch(`/pos/mgmt/purchase-orders/${id}`, { status, deliveredAt }),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['pos-purchase-orders', wsId] }); toast.success('Status updated'); },
    onError: () => toast.error('Failed to update status'),
  });

  const cancelMut = useMutation({
    mutationFn: (id: string) => api.patch(`/pos/mgmt/purchase-orders/${id}`, { status: 'cancelled' }),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['pos-purchase-orders', wsId] }); toast.success('PO cancelled'); },
    onError: () => toast.error('Failed to cancel PO'),
  });

  const filtered = statusFilter === 'all' ? orders : orders.filter((o) => o.status === statusFilter);

  function updateItem(i: number, field: keyof POItem, value: string | number) {
    setPoItems((items) => {
      const next = items.map((it, idx) => {
        if (idx !== i) return it;
        const updated = { ...it, [field]: value };
        updated.totalCents = Math.round(updated.quantity * updated.unitCostCents);
        return updated;
      });
      return next;
    });
  }

  function handleCreate() {
    if (!supplier.trim()) { toast.error('Supplier is required'); return; }
    if (poItems.some((it) => !it.name.trim())) { toast.error('All line items need a name'); return; }
    createMut.mutate({
      workspaceId: wsId,
      supplier,
      expectedAt: expectedAt || null,
      notes: notes || null,
      items: poItems.map((it) => ({ ...it, unitCostCents: Number(it.unitCostCents), quantity: Number(it.quantity), totalCents: Math.round(Number(it.quantity) * Number(it.unitCostCents)) })),
    });
  }

  function advance(po: PurchaseOrder) {
    const next = NEXT_STATUS[po.status];
    if (!next) return;
    advanceMut.mutate(
      next === 'received'
        ? { id: po.id, status: next, deliveredAt: new Date().toISOString() }
        : { id: po.id, status: next },
    );
  }

  return (
    <div className="flex flex-col gap-6 p-4 sm:p-6 max-w-screen-xl mx-auto">
      <PageHeader
        icon={<ClipboardList size={22} />}
        title="Purchase Orders"
        subtitle="Manage supplier orders and deliveries"
        action={
          <button onClick={() => { setSupplier(''); setExpectedAt(''); setNotes(''); setPoItems([{ ...BLANK_ITEM }]); setCreating(true); }} className="ui-btn-primary flex items-center gap-1.5">
            <Plus size={16} /> New PO
          </button>
        }
      />

      {/* Status filter */}
      <div className="flex flex-wrap gap-1.5">
        {(['all', 'draft', 'sent', 'received', 'cancelled'] as (POStatus | 'all')[]).map((s) => (
          <FilterChip key={s} active={statusFilter === s} onClick={() => setStatusFilter(s)} className="capitalize">{s}</FilterChip>
        ))}
      </div>

      {isLoading ? (
        <div className="flex flex-col gap-2">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-14 rounded-lg" />)}</div>
      ) : filtered.length === 0 ? (
        <EmptyState icon={<ClipboardList size={32} />} title="No purchase orders" subtitle="Create a PO to order from suppliers." />
      ) : (
        <div className="rounded-xl border border-[var(--border)] overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-[var(--surface-raised)]">
              <tr className="text-left text-[var(--text-muted)]">
                <th className="px-4 py-2 font-medium">PO #</th>
                <th className="px-4 py-2 font-medium">Supplier</th>
                <th className="px-4 py-2 font-medium">Status</th>
                <th className="px-4 py-2 font-medium text-right">Total</th>
                <th className="px-4 py-2 font-medium">Expected</th>
                <th className="px-4 py-2" />
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--border)]">
              {filtered.map((po) => (
                <tr key={po.id} className="hover:bg-[var(--surface-raised)] transition-colors cursor-pointer" onClick={() => setDetail(po)}>
                  <td className="px-4 py-2.5 font-mono font-medium text-[var(--text)]">PO-{String(po.poNumber).padStart(4, '0')}</td>
                  <td className="px-4 py-2.5 text-[var(--text)]">{po.supplier}</td>
                  <td className="px-4 py-2.5">
                    <Badge tone={STATUS_TONE[po.status]} className="capitalize">{po.status}</Badge>
                  </td>
                  <td className="px-4 py-2.5 text-right font-mono text-[var(--text)]">{fmt(po.totalCents)}</td>
                  <td className="px-4 py-2.5 text-[var(--text-muted)] text-xs">{po.expectedAt ? new Date(po.expectedAt).toLocaleDateString() : '—'}</td>
                  <td className="px-4 py-2.5" onClick={(e) => e.stopPropagation()}>
                    <div className="flex items-center justify-end gap-1">
                      {NEXT_STATUS[po.status] && (
                        <button onClick={() => advance(po)} title={`Mark as ${NEXT_STATUS[po.status]}`} className="flex items-center gap-0.5 text-xs px-2 py-1 rounded bg-[var(--accent)] text-white hover:opacity-90">
                          <ChevronRight size={12} />{NEXT_STATUS[po.status]}
                        </button>
                      )}
                      {po.status === 'draft' && (
                        <button onClick={() => cancelMut.mutate(po.id)} className="p-1 rounded hover:bg-red-50 text-[var(--text-muted)] hover:text-red-500"><Trash2 size={14} /></button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Create PO modal */}
      {creating && (
        <Modal size="lg" onClose={() => setCreating(false)}>
          <ModalHeader title="New Purchase Order" onClose={() => setCreating(false)} />
          <ModalBody className="flex flex-col gap-4">
            <div className="grid grid-cols-2 gap-3">
              <label className="flex flex-col gap-1 col-span-2">
                <span className="text-xs font-medium text-[var(--text-muted)]">Supplier *</span>
                <input type="text" value={supplier} onChange={(e) => setSupplier(e.target.value)} className="input" />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-xs font-medium text-[var(--text-muted)]">Expected date</span>
                <input type="date" value={expectedAt} onChange={(e) => setExpectedAt(e.target.value)} className="input" />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-xs font-medium text-[var(--text-muted)]">Notes</span>
                <input type="text" value={notes} onChange={(e) => setNotes(e.target.value)} className="input" />
              </label>
            </div>

            {/* Line items */}
            <div className="flex flex-col gap-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-[var(--text-muted)]">Line Items</span>
                <button onClick={() => setPoItems((it) => [...it, { ...BLANK_ITEM }])} className="text-xs text-[var(--accent)] hover:underline">+ Add row</button>
              </div>
              <div className="rounded-lg border border-[var(--border)] overflow-hidden">
                <table className="w-full text-xs">
                  <thead className="bg-[var(--surface-raised)]">
                    <tr className="text-left text-[var(--text-muted)]">
                      <th className="px-2 py-1.5 font-medium">Name</th>
                      <th className="px-2 py-1.5 font-medium">Qty</th>
                      <th className="px-2 py-1.5 font-medium">Unit</th>
                      <th className="px-2 py-1.5 font-medium">Unit Cost ($)</th>
                      <th className="px-2 py-1.5 font-medium text-right">Total</th>
                      <th className="px-2 py-1.5" />
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[var(--border)]">
                    {poItems.map((it, i) => (
                      <tr key={i}>
                        <td className="px-2 py-1"><input type="text" value={it.name} onChange={(e) => updateItem(i, 'name', e.target.value)} className="input text-xs py-1" /></td>
                        <td className="px-2 py-1 w-16"><input type="number" min={1} value={it.quantity} onChange={(e) => updateItem(i, 'quantity', parseInt(e.target.value) || 1)} className="input text-xs py-1" /></td>
                        <td className="px-2 py-1 w-20"><input type="text" value={it.unit} onChange={(e) => updateItem(i, 'unit', e.target.value)} className="input text-xs py-1" /></td>
                        <td className="px-2 py-1 w-24"><input type="number" step="0.01" min={0} value={(it.unitCostCents / 100).toFixed(2)} onChange={(e) => updateItem(i, 'unitCostCents', Math.round(parseFloat(e.target.value || '0') * 100))} className="input text-xs py-1" /></td>
                        <td className="px-2 py-1 text-right font-mono">{fmt(it.totalCents)}</td>
                        <td className="px-2 py-1">
                          {poItems.length > 1 && (
                            <button onClick={() => setPoItems((items) => items.filter((_, idx) => idx !== i))} className="text-[var(--text-muted)] hover:text-red-500"><Trash2 size={12} /></button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="text-xs text-right text-[var(--text-muted)]">
                Total: <strong className="text-[var(--text)]">{fmt(poItems.reduce((s, it) => s + it.totalCents, 0))}</strong>
              </p>
            </div>
          </ModalBody>
          <ModalFooter>
            <button onClick={() => setCreating(false)} className="ui-btn-secondary">Cancel</button>
            <button onClick={handleCreate} disabled={createMut.isPending} className="ui-btn-primary">Create PO</button>
          </ModalFooter>
        </Modal>
      )}

      {/* Detail modal */}
      {detail && (
        <Modal size="md" onClose={() => setDetail(null)}>
          <ModalHeader title={`PO-${String(detail.poNumber).padStart(4, '0')} — ${detail.supplier}`} onClose={() => setDetail(null)} />
          <ModalBody className="flex flex-col gap-3 text-sm">
            <div className="flex gap-2 items-center">
              <Badge tone={STATUS_TONE[detail.status]} className="capitalize">{detail.status}</Badge>
              {detail.expectedAt && <span className="text-[var(--text-muted)]">Expected: {new Date(detail.expectedAt).toLocaleDateString()}</span>}
              {detail.deliveredAt && <span className="text-[var(--text-muted)]">Received: {new Date(detail.deliveredAt).toLocaleDateString()}</span>}
            </div>
            {detail.notes && <p className="text-[var(--text-muted)] italic">{detail.notes}</p>}
            <div className="rounded-lg border border-[var(--border)] overflow-hidden">
              <table className="w-full text-xs">
                <thead className="bg-[var(--surface-raised)]">
                  <tr className="text-left text-[var(--text-muted)]">
                    <th className="px-3 py-1.5 font-medium">Item</th>
                    <th className="px-3 py-1.5 font-medium text-right">Qty</th>
                    <th className="px-3 py-1.5 font-medium text-right">Total</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--border)]">
                  {detail.items.map((it, i) => (
                    <tr key={i}>
                      <td className="px-3 py-1.5 text-[var(--text)]">{it.name}</td>
                      <td className="px-3 py-1.5 text-right text-[var(--text-muted)]">{it.quantity} {it.unit}</td>
                      <td className="px-3 py-1.5 text-right font-mono">{fmt(it.totalCents)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="text-right font-medium text-[var(--text)]">Total: {fmt(detail.totalCents)}</p>
          </ModalBody>
        </Modal>
      )}
    </div>
  );
}
