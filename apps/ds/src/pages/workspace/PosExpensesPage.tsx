import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useParams } from 'react-router';
import { toast } from 'sonner';
import { Receipt, Plus, Pencil, Trash2, DollarSign } from 'lucide-react';
import { api } from '../../lib/api.js';
import {
  Badge, EmptyState, FilterChip, Modal, ModalBody, ModalFooter,
  ModalHeader, PageHeader, Skeleton,
} from '../../components/UiPrimitives.js';

type Category = 'supplies' | 'utilities' | 'wages' | 'maintenance' | 'other';

interface Expense {
  id: string;
  category: Category;
  description: string;
  amountCents: number;
  expenseDate: string;
  receiptUrl: string | null;
}

const CATEGORIES: { value: Category | 'all'; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'supplies', label: 'Supplies' },
  { value: 'utilities', label: 'Utilities' },
  { value: 'wages', label: 'Wages' },
  { value: 'maintenance', label: 'Maintenance' },
  { value: 'other', label: 'Other' },
];

const CAT_TONE: Record<Category, 'neutral' | 'accent' | 'success' | 'warning' | 'danger'> = {
  supplies: 'accent', utilities: 'warning', wages: 'success', maintenance: 'danger', other: 'neutral',
};

function fmt(cents: number) { return `$${(cents / 100).toFixed(2)}`; }

const BLANK = { category: 'supplies' as Category, description: '', amountDollars: '', expenseDate: new Date().toISOString().slice(0, 10), receiptUrl: '' };

export default function PosExpensesPage() {
  const { wsId } = useParams<{ wsId: string }>();
  const qc = useQueryClient();
  const [catFilter, setCatFilter] = useState<Category | 'all'>('all');
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<Expense | null>(null);
  const [form, setForm] = useState({ ...BLANK });

  const from = new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 10);

  const { data: expenses = [], isLoading } = useQuery<Expense[]>({
    queryKey: ['pos-expenses', wsId],
    queryFn: () => api.get(`/pos/mgmt/expenses?workspaceId=${wsId}&from=${from}`),
  });

  const createMut = useMutation({
    mutationFn: (body: object) => api.post('/pos/mgmt/expenses', body),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['pos-expenses', wsId] }); setAdding(false); toast.success('Expense added'); },
    onError: () => toast.error('Failed to add expense'),
  });

  const updateMut = useMutation({
    mutationFn: ({ id, ...body }: { id: string } & object) => api.patch(`/pos/mgmt/expenses/${id}`, body),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['pos-expenses', wsId] }); setEditing(null); toast.success('Expense updated'); },
    onError: () => toast.error('Failed to update expense'),
  });

  const deleteMut = useMutation({
    mutationFn: (id: string) => api.delete(`/pos/mgmt/expenses/${id}`),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['pos-expenses', wsId] }); toast.success('Expense deleted'); },
    onError: () => toast.error('Failed to delete expense'),
  });

  const filtered = catFilter === 'all' ? expenses : expenses.filter((e) => e.category === catFilter);
  const total = filtered.reduce((s, e) => s + e.amountCents, 0);

  function openAdd() { setForm({ ...BLANK }); setAdding(true); }
  function openEdit(e: Expense) {
    setForm({ category: e.category, description: e.description, amountDollars: (e.amountCents / 100).toFixed(2), expenseDate: e.expenseDate.slice(0, 10), receiptUrl: e.receiptUrl ?? '' });
    setEditing(e);
  }

  function handleSave() {
    if (!form.description.trim()) { toast.error('Description is required'); return; }
    const payload = {
      workspaceId: wsId,
      category: form.category,
      description: form.description,
      amountCents: Math.round(parseFloat(form.amountDollars || '0') * 100),
      expenseDate: form.expenseDate,
      receiptUrl: form.receiptUrl || null,
    };
    if (editing) { updateMut.mutate({ id: editing.id, ...payload }); }
    else         { createMut.mutate(payload); }
  }

  return (
    <div className="flex flex-col gap-6 p-4 sm:p-6 max-w-screen-xl mx-auto">
      <PageHeader
        icon={<Receipt size={22} />}
        title="Expenses"
        subtitle="Record and track operational expenses"
        action={
          <button onClick={openAdd} className="ui-btn-primary flex items-center gap-1.5">
            <Plus size={16} /> Add Expense
          </button>
        }
      />

      {/* Filters + total */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-1.5">
          {CATEGORIES.map(({ value, label }) => (
            <FilterChip key={value} active={catFilter === value} onClick={() => setCatFilter(value)}>{label}</FilterChip>
          ))}
        </div>
        {!isLoading && (
          <div className="flex items-center gap-1.5 text-sm text-[var(--text-muted)]">
            <DollarSign size={14} />
            Period total: <strong className="text-[var(--text)]">{fmt(total)}</strong>
          </div>
        )}
      </div>

      {isLoading ? (
        <div className="flex flex-col gap-2">{Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-12 rounded-lg" />)}</div>
      ) : filtered.length === 0 ? (
        <EmptyState icon={<Receipt size={32} />} title="No expenses" subtitle="Log expenses to track operational costs." />
      ) : (
        <div className="rounded-xl border border-[var(--border)] overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-[var(--surface-raised)]">
              <tr className="text-left text-[var(--text-muted)]">
                <th className="px-4 py-2 font-medium">Date</th>
                <th className="px-4 py-2 font-medium">Category</th>
                <th className="px-4 py-2 font-medium">Description</th>
                <th className="px-4 py-2 font-medium text-right">Amount</th>
                <th className="px-4 py-2" />
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--border)]">
              {filtered.map((e) => (
                <tr key={e.id} className="hover:bg-[var(--surface-raised)] transition-colors">
                  <td className="px-4 py-2.5 text-[var(--text-muted)] text-xs whitespace-nowrap">{new Date(e.expenseDate).toLocaleDateString()}</td>
                  <td className="px-4 py-2.5">
                    <Badge tone={CAT_TONE[e.category]} className="capitalize">{e.category}</Badge>
                  </td>
                  <td className="px-4 py-2.5 text-[var(--text)]">{e.description}</td>
                  <td className="px-4 py-2.5 text-right font-mono font-medium text-[var(--text)]">{fmt(e.amountCents)}</td>
                  <td className="px-4 py-2.5">
                    <div className="flex items-center justify-end gap-1">
                      <button onClick={() => openEdit(e)} className="p-1 rounded hover:bg-[var(--surface)] text-[var(--text-muted)] hover:text-[var(--text)]"><Pencil size={14} /></button>
                      <button onClick={() => deleteMut.mutate(e.id)} className="p-1 rounded hover:bg-red-50 text-[var(--text-muted)] hover:text-red-500"><Trash2 size={14} /></button>
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
          <ModalHeader title={editing ? 'Edit Expense' : 'Add Expense'} onClose={() => { setAdding(false); setEditing(null); }} />
          <ModalBody className="flex flex-col gap-3">
            <label className="flex flex-col gap-1">
              <span className="text-xs font-medium text-[var(--text-muted)]">Category</span>
              <select value={form.category} onChange={(e) => setForm((f) => ({ ...f, category: e.target.value as Category }))} className="input">
                {CATEGORIES.filter((c) => c.value !== 'all').map(({ value, label }) => <option key={value} value={value}>{label}</option>)}
              </select>
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-xs font-medium text-[var(--text-muted)]">Description *</span>
              <input type="text" value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} className="input" />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-xs font-medium text-[var(--text-muted)]">Amount ($)</span>
              <input type="number" step="0.01" min="0" value={form.amountDollars} onChange={(e) => setForm((f) => ({ ...f, amountDollars: e.target.value }))} className="input" />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-xs font-medium text-[var(--text-muted)]">Date</span>
              <input type="date" value={form.expenseDate} onChange={(e) => setForm((f) => ({ ...f, expenseDate: e.target.value }))} className="input" />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-xs font-medium text-[var(--text-muted)]">Receipt URL</span>
              <input type="url" value={form.receiptUrl} onChange={(e) => setForm((f) => ({ ...f, receiptUrl: e.target.value }))} className="input" placeholder="https://…" />
            </label>
          </ModalBody>
          <ModalFooter>
            <button onClick={() => { setAdding(false); setEditing(null); }} className="ui-btn-secondary">Cancel</button>
            <button onClick={handleSave} disabled={createMut.isPending || updateMut.isPending} className="ui-btn-primary">{editing ? 'Save' : 'Add'}</button>
          </ModalFooter>
        </Modal>
      )}
    </div>
  );
}
