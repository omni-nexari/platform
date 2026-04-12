import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useParams } from 'react-router';
import { toast } from 'sonner';
import { Heart, Plus, Search, Gift, Minus } from 'lucide-react';
import { api } from '../../lib/api.js';
import {
  Badge, EmptyState, Modal, ModalBody, ModalFooter, ModalHeader,
  PageHeader, Skeleton,
} from '../../components/UiPrimitives.js';

interface LoyaltyCustomer {
  id: string;
  name: string | null;
  phone: string | null;
  email: string | null;
  points: number;
  tier: 'bronze' | 'silver' | 'gold';
  enrolledAt: string;
}

const TIER_TONE = { bronze: 'neutral', silver: 'accent', gold: 'warning' } as const;

const BLANK_CUSTOMER = { name: '', phone: '', email: '' };
const BLANK_POINTS = { customerId: '', type: 'earn' as 'earn' | 'redeem', amount: 0, notes: '' };

export default function PosLoyaltyPage() {
  const { wsId } = useParams<{ wsId: string }>();
  const qc = useQueryClient();
  const [q, setQ] = useState('');
  const [enrolling, setEnrolling] = useState(false);
  const [customerForm, setCustomerForm] = useState({ ...BLANK_CUSTOMER });
  const [pointsTarget, setPointsTarget] = useState<LoyaltyCustomer | null>(null);
  const [pointsForm, setPointsForm] = useState({ ...BLANK_POINTS });

  const { data: customers = [], isLoading } = useQuery<LoyaltyCustomer[]>({
    queryKey: ['pos-loyalty', wsId, q],
    queryFn: () => api.get(`/pos/mgmt/loyalty/customers?workspaceId=${wsId}${q ? `&q=${encodeURIComponent(q)}` : ''}`),
  });

  const enrollMut = useMutation({
    mutationFn: (body: object) => api.post('/pos/mgmt/loyalty/customers', body),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['pos-loyalty', wsId] }); setEnrolling(false); toast.success('Customer enrolled'); },
    onError: () => toast.error('Enrollment failed'),
  });

  const pointsMut = useMutation({
    mutationFn: (body: object) => api.post('/pos/mgmt/loyalty/points', body),
    onSuccess: (data: { points: number; tier: string }) => {
      void qc.invalidateQueries({ queryKey: ['pos-loyalty', wsId] });
      setPointsTarget(null);
      toast.success(`Points updated — now ${data.points} pts (${data.tier})`);
    },
    onError: () => toast.error('Failed to update points'),
  });

  function handleEnroll() {
    if (!customerForm.name.trim()) { toast.error('Name is required'); return; }
    enrollMut.mutate({ ...customerForm, workspaceId: wsId });
  }

  function openPoints(c: LoyaltyCustomer, type: 'earn' | 'redeem') {
    setPointsForm({ customerId: c.id, type, amount: 0, notes: '' });
    setPointsTarget(c);
  }

  function handlePoints() {
    if (pointsForm.amount <= 0) { toast.error('Amount must be > 0'); return; }
    pointsMut.mutate({
      customerId: pointsForm.customerId,
      type: pointsForm.type,
      amount: pointsForm.amount,
      notes: pointsForm.notes,
      workspaceId: wsId,
    });
  }

  return (
    <div className="flex flex-col gap-6 p-4 sm:p-6 max-w-screen-xl mx-auto">
      <PageHeader
        icon={<Heart size={22} />}
        title="Loyalty"
        subtitle="Customer points and tier management"
        action={
          <button onClick={() => { setCustomerForm({ ...BLANK_CUSTOMER }); setEnrolling(true); }} className="ui-btn-primary flex items-center gap-1.5">
            <Plus size={16} /> Enroll Customer
          </button>
        }
      />

      {/* Search */}
      <div className="relative max-w-sm">
        <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
        <input
          type="text"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search name, phone, email…"
          className="input pl-8"
        />
      </div>

      {isLoading ? (
        <div className="flex flex-col gap-2">{Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-14 rounded-lg" />)}</div>
      ) : customers.length === 0 ? (
        <EmptyState icon={<Heart size={32} />} title={q ? 'No matching customers' : 'No loyalty customers'} subtitle="Enroll customers to start tracking points and tiers." />
      ) : (
        <div className="rounded-xl border border-[var(--border)] overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-[var(--surface-raised)]">
              <tr className="text-left text-[var(--text-muted)]">
                <th className="px-4 py-2 font-medium">Customer</th>
                <th className="px-4 py-2 font-medium">Contact</th>
                <th className="px-4 py-2 font-medium">Tier</th>
                <th className="px-4 py-2 font-medium text-right">Points</th>
                <th className="px-4 py-2 font-medium">Enrolled</th>
                <th className="px-4 py-2" />
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--border)]">
              {customers.map((c) => (
                <tr key={c.id} className="hover:bg-[var(--surface-raised)] transition-colors">
                  <td className="px-4 py-2.5 font-medium text-[var(--text)]">{c.name ?? '—'}</td>
                  <td className="px-4 py-2.5 text-[var(--text-muted)]">{c.phone ?? c.email ?? '—'}</td>
                  <td className="px-4 py-2.5">
                    <Badge tone={TIER_TONE[c.tier]} className="capitalize">{c.tier}</Badge>
                  </td>
                  <td className="px-4 py-2.5 text-right font-mono font-medium text-[var(--text)]">{c.points.toLocaleString()}</td>
                  <td className="px-4 py-2.5 text-[var(--text-muted)] text-xs">{new Date(c.enrolledAt).toLocaleDateString()}</td>
                  <td className="px-4 py-2.5">
                    <div className="flex items-center justify-end gap-1">
                      <button onClick={() => openPoints(c, 'earn')} title="Earn points" className="p-1 rounded hover:bg-[var(--surface)] text-[var(--text-muted)] hover:text-[var(--text)]">
                        <Gift size={14} />
                      </button>
                      <button onClick={() => openPoints(c, 'redeem')} title="Redeem points" className="p-1 rounded hover:bg-[var(--surface)] text-[var(--text-muted)] hover:text-[var(--text)]">
                        <Minus size={14} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Enroll modal */}
      {enrolling && (
        <Modal onClose={() => setEnrolling(false)}>
          <ModalHeader title="Enroll Customer" onClose={() => setEnrolling(false)} />
          <ModalBody className="flex flex-col gap-3">
            {([{ label: 'Name *', key: 'name' }, { label: 'Phone', key: 'phone' }, { label: 'Email', key: 'email' }] as { label: string; key: keyof typeof customerForm }[]).map(({ label, key }) => (
              <label key={key} className="flex flex-col gap-1">
                <span className="text-xs font-medium text-[var(--text-muted)]">{label}</span>
                <input type="text" value={customerForm[key]} onChange={(e) => setCustomerForm((f) => ({ ...f, [key]: e.target.value }))} className="input" />
              </label>
            ))}
          </ModalBody>
          <ModalFooter>
            <button onClick={() => setEnrolling(false)} className="ui-btn-secondary">Cancel</button>
            <button onClick={handleEnroll} disabled={enrollMut.isPending} className="ui-btn-primary">Enroll</button>
          </ModalFooter>
        </Modal>
      )}

      {/* Points modal */}
      {pointsTarget && (
        <Modal onClose={() => setPointsTarget(null)}>
          <ModalHeader
            title={pointsForm.type === 'earn' ? `Earn points — ${pointsTarget.name}` : `Redeem points — ${pointsTarget.name}`}
            onClose={() => setPointsTarget(null)}
          />
          <ModalBody className="flex flex-col gap-3">
            <div className="flex items-center gap-2 text-sm text-[var(--text-muted)] mb-1">
              Current: <strong className="text-[var(--text)]">{pointsTarget.points.toLocaleString()} pts</strong>
              <Badge tone={TIER_TONE[pointsTarget.tier]} className="capitalize">{pointsTarget.tier}</Badge>
            </div>
            <label className="flex flex-col gap-1">
              <span className="text-xs font-medium text-[var(--text-muted)]">Points to {pointsForm.type}</span>
              <input
                type="number"
                min={1}
                value={pointsForm.amount || ''}
                onChange={(e) => setPointsForm((f) => ({ ...f, amount: Math.max(0, parseInt(e.target.value) || 0) }))}
                className="input"
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-xs font-medium text-[var(--text-muted)]">Notes (optional)</span>
              <input type="text" value={pointsForm.notes} onChange={(e) => setPointsForm((f) => ({ ...f, notes: e.target.value }))} className="input" />
            </label>
          </ModalBody>
          <ModalFooter>
            <button onClick={() => setPointsTarget(null)} className="ui-btn-secondary">Cancel</button>
            <button onClick={handlePoints} disabled={pointsMut.isPending} className="ui-btn-primary">
              {pointsForm.type === 'earn' ? 'Add Points' : 'Redeem'}
            </button>
          </ModalFooter>
        </Modal>
      )}
    </div>
  );
}
