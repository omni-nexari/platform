import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useParams } from 'react-router';
import { toast } from 'sonner';
import { Package, Plus, Pencil, Trash2, AlertTriangle } from 'lucide-react';
import { api } from '../../lib/api.js';
import {
  Badge, EmptyState, Modal, ModalBody, ModalFooter, ModalHeader,
  PageHeader, Skeleton,
} from '../../components/UiPrimitives.js';

interface InventoryItem {
  id: string;
  name: string;
  sku: string | null;
  unit: string;
  quantity: number;
  reorderPoint: number;
  costCents: number;
  supplier: string | null;
  notes: string | null;
}

function fmt(cents: number) { return `$${(cents / 100).toFixed(2)}`; }

const BLANK: Omit<InventoryItem, 'id'> = { name: '', sku: null, unit: 'unit', quantity: 0, reorderPoint: 0, costCents: 0, supplier: null, notes: null };

export default function PosInventoryPage() {
  const { wsId } = useParams<{ wsId: string }>();
  const qc = useQueryClient();
  const [editing, setEditing] = useState<InventoryItem | null>(null);
  const [adding,  setAdding]  = useState(false);
  const [form, setForm] = useState({ ...BLANK });

  const { data: items = [], isLoading } = useQuery<InventoryItem[]>({
    queryKey: ['pos-inventory', wsId],
    queryFn:  () => api.get(`/pos/mgmt/inventory?workspaceId=${wsId}`),
  });

  const createMut = useMutation({
    mutationFn: (body: object) => api.post('/pos/mgmt/inventory', body),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['pos-inventory', wsId] }); setAdding(false); toast.success('Item added'); },
    onError: () => toast.error('Failed to add item'),
  });

  const updateMut = useMutation({
    mutationFn: ({ id, ...body }: { id: string } & object) => api.patch(`/pos/mgmt/inventory/${id}`, body),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['pos-inventory', wsId] }); setEditing(null); toast.success('Item updated'); },
    onError: () => toast.error('Failed to update item'),
  });

  const deleteMut = useMutation({
    mutationFn: (id: string) => api.delete(`/pos/mgmt/inventory/${id}`),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['pos-inventory', wsId] }); toast.success('Item removed'); },
    onError: () => toast.error('Failed to remove item'),
  });

  function openAdd() { setForm({ ...BLANK }); setAdding(true); }
  function openEdit(item: InventoryItem) { setForm({ ...item }); setEditing(item); }

  function handleSave() {
    if (!form.name.trim()) { toast.error('Name is required'); return; }
    const payload = {
      ...form,
      workspaceId: wsId,
      costCents: Number(form.costCents),
      quantity: Number(form.quantity),
      reorderPoint: Number(form.reorderPoint),
    };
    if (editing) { updateMut.mutate({ id: editing.id, ...payload }); }
    else         { createMut.mutate(payload); }
  }

  const lowStock = items.filter((i) => i.quantity <= i.reorderPoint);

  return (
    <div className="flex flex-col gap-6 p-4 sm:p-6 max-w-screen-xl mx-auto">
      <PageHeader
        icon={<Package size={22} />}
        title="Inventory"
        subtitle="Track ingredient and product stock levels"
        action={
          <button onClick={openAdd} className="ui-btn-primary flex items-center gap-1.5">
            <Plus size={16} /> Add Item
          </button>
        }
      />

      {lowStock.length > 0 && (
        <div className="flex items-center gap-2 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          <AlertTriangle size={16} className="shrink-0" />
          <span><strong>{lowStock.length}</strong> item{lowStock.length !== 1 ? 's' : ''} at or below reorder point: {lowStock.map((i) => i.name).join(', ')}</span>
        </div>
      )}

      {isLoading ? (
        <div className="flex flex-col gap-2">{Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-12 rounded-lg" />)}</div>
      ) : items.length === 0 ? (
        <EmptyState icon={<Package size={32} />} title="No inventory items" subtitle="Add ingredients or products to track stock levels." />
      ) : (
        <div className="rounded-xl border border-[var(--border)] overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-[var(--surface-raised)]">
              <tr className="text-left text-[var(--text-muted)]">
                <th className="px-4 py-2 font-medium">Name</th>
                <th className="px-4 py-2 font-medium">SKU</th>
                <th className="px-4 py-2 font-medium">Unit</th>
                <th className="px-4 py-2 font-medium text-right">In Stock</th>
                <th className="px-4 py-2 font-medium text-right">Reorder</th>
                <th className="px-4 py-2 font-medium text-right">Cost</th>
                <th className="px-4 py-2 font-medium">Supplier</th>
                <th className="px-4 py-2" />
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--border)]">
              {items.map((item) => (
                <tr key={item.id} className="hover:bg-[var(--surface-raised)] transition-colors">
                  <td className="px-4 py-2.5 font-medium text-[var(--text)]">
                    {item.name}
                    {item.quantity <= item.reorderPoint && (
                      <Badge tone="warning" className="ml-2">Low</Badge>
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-[var(--text-muted)]">{item.sku ?? '—'}</td>
                  <td className="px-4 py-2.5 text-[var(--text-muted)]">{item.unit}</td>
                  <td className="px-4 py-2.5 text-right font-mono text-[var(--text)]">{item.quantity}</td>
                  <td className="px-4 py-2.5 text-right font-mono text-[var(--text-muted)]">{item.reorderPoint}</td>
                  <td className="px-4 py-2.5 text-right text-[var(--text)]">{fmt(item.costCents)}</td>
                  <td className="px-4 py-2.5 text-[var(--text-muted)]">{item.supplier ?? '—'}</td>
                  <td className="px-4 py-2.5">
                    <div className="flex items-center justify-end gap-1">
                      <button onClick={() => openEdit(item)} className="p-1 rounded hover:bg-[var(--surface)] text-[var(--text-muted)] hover:text-[var(--text)]"><Pencil size={14} /></button>
                      <button onClick={() => deleteMut.mutate(item.id)} className="p-1 rounded hover:bg-red-50 text-[var(--text-muted)] hover:text-red-500"><Trash2 size={14} /></button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {(adding || editing) && (
        <Modal onClose={() => { setAdding(false); setEditing(null); }}>
          <ModalHeader title={editing ? 'Edit Item' : 'Add Inventory Item'} onClose={() => { setAdding(false); setEditing(null); }} />
          <ModalBody className="flex flex-col gap-3">
            {([
              { label: 'Name *',       key: 'name',         type: 'text' },
              { label: 'SKU',          key: 'sku',          type: 'text' },
              { label: 'Unit',         key: 'unit',         type: 'text',   placeholder: 'kg / g / L / unit' },
              { label: 'In Stock',     key: 'quantity',     type: 'number' },
              { label: 'Reorder at',   key: 'reorderPoint', type: 'number' },
              { label: 'Cost ($)',     key: 'costCents',    type: 'number', divBy100: true },
              { label: 'Supplier',     key: 'supplier',     type: 'text' },
            ] as { label: string; key: keyof typeof form; type: string; placeholder?: string; divBy100?: boolean }[]).map(({ label, key, type, placeholder, divBy100 }) => (
              <label key={key} className="flex flex-col gap-1">
                <span className="text-xs font-medium text-[var(--text-muted)]">{label}</span>
                <input
                  type={type}
                  value={divBy100 ? (Number(form[key]) / 100).toFixed(2) : (form[key] ?? '')}
                  onChange={(e) => setForm((f) => ({ ...f, [key]: divBy100 ? Math.round(parseFloat(e.target.value) * 100) || 0 : e.target.value }))}
                  placeholder={placeholder}
                  className="input"
                />
              </label>
            ))}
          </ModalBody>
          <ModalFooter>
            <button onClick={() => { setAdding(false); setEditing(null); }} className="ui-btn-secondary">Cancel</button>
            <button onClick={handleSave} disabled={createMut.isPending || updateMut.isPending} className="ui-btn-primary">
              {editing ? 'Save' : 'Add'}
            </button>
          </ModalFooter>
        </Modal>
      )}
    </div>
  );
}
