import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useParams } from 'react-router';
import { toast } from 'sonner';
import { Users, Plus, LogIn, LogOut, Clock, Pencil, Trash2 } from 'lucide-react';
import { api } from '../../lib/api.js';
import {
  Badge, EmptyState, Modal, ModalBody, ModalFooter, ModalHeader,
  PageHeader, Skeleton,
} from '../../components/UiPrimitives.js';
import { formatDistanceToNow } from '../utils/time.js';

interface Employee {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  role: string;
  isActive: boolean;
  hiredAt: string | null;
  createdAt: string;
}

interface TimeEntry {
  id: string;
  clockedInAt: string;
  clockedOutAt: string | null;
  breakMinutes: number;
}

const ROLE_TONE = {
  manager:  'accent',
  cashier:  'success',
  kitchen:  'warning',
  staff:    'neutral',
} as const;

const BLANK = { name: '', email: '', phone: '', role: 'staff' };

export default function PosEmployeesPage() {
  const { wsId } = useParams<{ wsId: string }>();
  const qc = useQueryClient();
  const [adding,   setAdding]   = useState(false);
  const [editing,  setEditing]  = useState<Employee | null>(null);
  const [viewTime, setViewTime] = useState<Employee | null>(null);
  const [form, setForm] = useState({ ...BLANK });

  const { data: employees = [], isLoading } = useQuery<Employee[]>({
    queryKey: ['pos-employees', wsId],
    queryFn:  () => api.get(`/pos/mgmt/employees?workspaceId=${wsId}`),
    refetchInterval: 30_000,
  });

  const { data: timeEntries = [] } = useQuery<TimeEntry[]>({
    queryKey: ['pos-time-entries', viewTime?.id],
    queryFn:  () => api.get(`/pos/mgmt/employees/${viewTime!.id}/time-entries`),
    enabled: !!viewTime,
  });

  const createMut = useMutation({
    mutationFn: (body: object) => api.post('/pos/mgmt/employees', body),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['pos-employees', wsId] }); setAdding(false); toast.success('Employee added'); },
    onError: () => toast.error('Failed to add employee'),
  });

  const updateMut = useMutation({
    mutationFn: ({ id, ...body }: { id: string } & object) => api.patch(`/pos/mgmt/employees/${id}`, body),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['pos-employees', wsId] }); setEditing(null); toast.success('Employee updated'); },
    onError: () => toast.error('Failed to update employee'),
  });

  const deleteMut = useMutation({
    mutationFn: (id: string) => api.delete(`/pos/mgmt/employees/${id}`),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['pos-employees', wsId] }); toast.success('Employee removed'); },
    onError: () => toast.error('Failed to remove employee'),
  });

  const clockMut = useMutation({
    mutationFn: (id: string) => api.post(`/pos/mgmt/employees/${id}/clock`, { workspaceId: wsId }),
    onSuccess: (data: { action: string }) => {
      void qc.invalidateQueries({ queryKey: ['pos-employees', wsId] });
      toast.success(data.action === 'clock-in' ? 'Clocked in' : 'Clocked out');
    },
    onError: () => toast.error('Clock action failed'),
  });

  function handleSave() {
    if (!form.name.trim()) { toast.error('Name is required'); return; }
    const payload = { ...form, workspaceId: wsId };
    if (editing) { updateMut.mutate({ id: editing.id, ...payload }); }
    else         { createMut.mutate(payload); }
  }

  function calcHours(entries: TimeEntry[]) {
    return entries.reduce((sum, e) => {
      if (!e.clockedOutAt) return sum;
      const mins = (new Date(e.clockedOutAt).getTime() - new Date(e.clockedInAt).getTime()) / 60000 - e.breakMinutes;
      return sum + Math.max(0, mins);
    }, 0);
  }

  return (
    <div className="flex flex-col gap-6 p-4 sm:p-6 max-w-screen-xl mx-auto">
      <PageHeader
        icon={<Users size={22} />}
        title="Employees"
        subtitle="Staff management and time tracking"
        action={
          <button onClick={() => { setForm({ ...BLANK }); setAdding(true); }} className="ui-btn-primary flex items-center gap-1.5">
            <Plus size={16} /> Add Employee
          </button>
        }
      />

      {isLoading ? (
        <div className="flex flex-col gap-2">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-14 rounded-lg" />)}</div>
      ) : employees.length === 0 ? (
        <EmptyState icon={<Users size={32} />} title="No employees" subtitle="Add staff members to manage shifts and access." />
      ) : (
        <div className="rounded-xl border border-[var(--border)] overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-[var(--surface-raised)]">
              <tr className="text-left text-[var(--text-muted)]">
                <th className="px-4 py-2 font-medium">Name</th>
                <th className="px-4 py-2 font-medium">Role</th>
                <th className="px-4 py-2 font-medium">Contact</th>
                <th className="px-4 py-2 font-medium">Hired</th>
                <th className="px-4 py-2" />
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--border)]">
              {employees.map((emp) => (
                <tr key={emp.id} className="hover:bg-[var(--surface-raised)] transition-colors">
                  <td className="px-4 py-2.5 font-medium text-[var(--text)]">{emp.name}</td>
                  <td className="px-4 py-2.5">
                    <Badge tone={ROLE_TONE[emp.role as keyof typeof ROLE_TONE] ?? 'neutral'} className="capitalize">{emp.role}</Badge>
                  </td>
                  <td className="px-4 py-2.5 text-[var(--text-muted)]">{emp.email ?? emp.phone ?? '—'}</td>
                  <td className="px-4 py-2.5 text-[var(--text-muted)] text-xs">
                    {emp.hiredAt ? new Date(emp.hiredAt).toLocaleDateString() : '—'}
                  </td>
                  <td className="px-4 py-2.5">
                    <div className="flex items-center justify-end gap-1">
                      <button onClick={() => clockMut.mutate(emp.id)} title="Clock in/out" className="p-1 rounded hover:bg-[var(--surface)] text-[var(--text-muted)] hover:text-[var(--text)]">
                        <Clock size={14} />
                      </button>
                      <button onClick={() => { setViewTime(emp); }} title="View time entries" className="p-1 rounded hover:bg-[var(--surface)] text-[var(--text-muted)] hover:text-[var(--text)]">
                        {true ? <LogOut size={14} /> : <LogIn size={14} />}
                      </button>
                      <button onClick={() => { setForm({ name: emp.name, email: emp.email ?? '', phone: emp.phone ?? '', role: emp.role }); setEditing(emp); }} className="p-1 rounded hover:bg-[var(--surface)] text-[var(--text-muted)] hover:text-[var(--text)]"><Pencil size={14} /></button>
                      <button onClick={() => deleteMut.mutate(emp.id)} className="p-1 rounded hover:bg-red-50 text-[var(--text-muted)] hover:text-red-500"><Trash2 size={14} /></button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Add/Edit modal */}
      {(adding || editing) && (
        <Modal onClose={() => { setAdding(false); setEditing(null); }}>
          <ModalHeader title={editing ? 'Edit Employee' : 'Add Employee'} onClose={() => { setAdding(false); setEditing(null); }} />
          <ModalBody className="flex flex-col gap-3">
            {([{ label: 'Name *', key: 'name' }, { label: 'Email', key: 'email' }, { label: 'Phone', key: 'phone' }] as { label: string; key: keyof typeof form }[]).map(({ label, key }) => (
              <label key={key} className="flex flex-col gap-1">
                <span className="text-xs font-medium text-[var(--text-muted)]">{label}</span>
                <input type="text" value={form[key] as string} onChange={(e) => setForm((f) => ({ ...f, [key]: e.target.value }))} className="input" />
              </label>
            ))}
            <label className="flex flex-col gap-1">
              <span className="text-xs font-medium text-[var(--text-muted)]">Role</span>
              <select value={form.role} onChange={(e) => setForm((f) => ({ ...f, role: e.target.value }))} className="input">
                {['manager', 'cashier', 'kitchen', 'staff'].map((r) => <option key={r} value={r} className="capitalize">{r}</option>)}
              </select>
            </label>
          </ModalBody>
          <ModalFooter>
            <button onClick={() => { setAdding(false); setEditing(null); }} className="ui-btn-secondary">Cancel</button>
            <button onClick={handleSave} disabled={createMut.isPending || updateMut.isPending} className="ui-btn-primary">{editing ? 'Save' : 'Add'}</button>
          </ModalFooter>
        </Modal>
      )}

      {/* Time entries modal */}
      {viewTime && (
        <Modal size="md" onClose={() => setViewTime(null)}>
          <ModalHeader title={`${viewTime.name} — Time Entries`} onClose={() => setViewTime(null)} />
          <ModalBody>
            {timeEntries.length === 0 ? (
              <p className="text-sm text-[var(--text-muted)] py-4 text-center">No time entries yet.</p>
            ) : (
              <div className="flex flex-col gap-1 text-sm">
                <p className="text-[var(--text-muted)] mb-2">Total: <strong>{(calcHours(timeEntries) / 60).toFixed(1)} hrs</strong> ({timeEntries.filter((e) => e.clockedOutAt).length} shifts)</p>
                <div className="divide-y divide-[var(--border)]">
                  {timeEntries.slice(0, 20).map((e) => (
                    <div key={e.id} className="flex items-center justify-between py-2">
                      <span className="text-[var(--text-muted)]">{new Date(e.clockedInAt).toLocaleString()}</span>
                      {e.clockedOutAt ? (
                        <span className="text-[var(--text)]">
                          {((new Date(e.clockedOutAt).getTime() - new Date(e.clockedInAt).getTime()) / 3_600_000).toFixed(1)} hrs
                        </span>
                      ) : (
                        <Badge tone="success">On shift {formatDistanceToNow(e.clockedInAt)}</Badge>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </ModalBody>
        </Modal>
      )}
    </div>
  );
}
