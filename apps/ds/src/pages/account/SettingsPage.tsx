import { useState, useEffect, useRef } from 'react';
import { useSearchParams } from 'react-router';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  User,
  Shield,
  Building2,
  LayoutGrid,
  Bell,
  Tag,
  AlertTriangle,
  ClipboardList,
  Key,
  ShieldCheck,
  ShieldOff,
  Download,
  Copy,
  Plus,
  Trash2,
  Eye,
  EyeOff,
  X,
  Check,
  RefreshCw,
  Zap,
  Sun,
  Moon,
  Clock,
  Pencil,
  Monitor,
  Image as ImageIcon,
  Layers,
  CalendarDays,
  ChevronDown,
  MapPin,
  Mail,
  UserMinus,
  Info,
  Filter,
  CheckCheck,
  BellOff,
  Ban,
} from 'lucide-react';
import { api } from '../../lib/api.js';
import ConfirmDialog from '../../components/ConfirmDialog.js';
import { useAuthStore } from '../../lib/auth.js';
import {
  Badge,
  Callout,
  ActionButton,
  SectionCard,
  SectionCardHeader,
  SectionCardBody,
  Skeleton,
  ToggleSwitch,
} from '../../components/UiPrimitives.js';
import { useTheme } from '../../contexts/ThemeContext.js';

// ─── Types ────────────────────────────────────────────────────────────────────

interface Workspace {
  id: string;
  name: string;
  slug: string;
  timezone: string;
  defaultPlaylistId: string | null;
  logoUrl: string | null;
}

interface EmergencyOverride {
  id: string;
  contentText: string | null;
  scope: string;
  createdAt: string;
}

interface TwoFASetupResponse {
  secret: string;
  qrDataUrl: string;
}

interface BackupCodesResponse {
  backupCodes: string[];
}

interface AuditEntry {
  id: string;
  actor_id: string | null;
  actor_type: string;
  actor_name: string | null;
  action: string;
  entity_type: string | null;
  entity_id: string | null;
  meta: string;
  ip_address: string | null;
  created_at: string;
}

interface ApiKey {
  id: string;
  name: string;
  keyPrefix: string;
  scopes: string;
  workspaceId: string | null;
  lastUsedAt: string | null;
  expiresAt: string | null;
  revokedAt: string | null;
  createdAt: string;
}

interface NotifItem {
  id: string;
  type: string;
  title: string;
  body: string;
  entityType: string | null;
  entityId: string | null;
  readAt: string | null;
  dismissed: boolean;
  createdAt: string;
}

interface NotifPref {
  event_key: string;
  in_app: boolean;
  email_notify: boolean;
}

// ─── Section registry ─────────────────────────────────────────────────────────

type SectionId =
  | 'general'
  | 'security'
  | 'organization'
  | 'workspace'
  | 'tags'
  | 'emergency'
  | 'audit'
  | 'api-keys'
  | 'notifications';

const SECTIONS: {
  id: SectionId;
  label: string;
  icon: React.ComponentType<{ className?: string; size?: number }>;
  group: string;
}[] = [
  { id: 'general',      label: 'General',         icon: User,          group: 'Account' },
  { id: 'security',     label: 'Security',         icon: Shield,        group: 'Account' },
  { id: 'organization', label: 'Organization',     icon: Building2,     group: 'Organization' },
  { id: 'workspace',    label: 'Workspace',        icon: LayoutGrid,    group: 'Workspace' },
  { id: 'tags',         label: 'Tags',             icon: Tag,           group: 'Workspace' },
  { id: 'emergency',    label: 'Emergency Alert',  icon: AlertTriangle, group: 'Workspace' },
  { id: 'audit',        label: 'Audit Log',        icon: ClipboardList, group: 'Workspace' },
  { id: 'api-keys',     label: 'API Keys',         icon: Key,           group: 'Workspace' },
  { id: 'notifications',label: 'Notifications',    icon: Bell,          group: 'Preferences' },
];

const SECTION_LABELS: Record<SectionId, string> = {
  general:       'General',
  security:      'Security',
  organization:  'Organization',
  workspace:     'Workspace',
  tags:          'Tags',
  emergency:     'Emergency Alert',
  audit:         'Audit Log',
  'api-keys':    'API Keys',
  notifications: 'Notifications',
};

// ─── Shared helpers ────────────────────────────────────────────────────────────

function SettingRow({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-6 py-4 border-b border-[var(--border)] last:border-0">
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-[var(--text)]">{label}</p>
        {hint && <p className="text-xs text-[var(--text-muted)] mt-0.5">{hint}</p>}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

function ComingSoon({ title, description }: { title: string; description: string }) {
  return (
    <SectionCard>
      <SectionCardHeader>
        <h3 className="text-sm font-semibold">{title}</h3>
        <Badge tone="accent">Coming Soon</Badge>
      </SectionCardHeader>
      <SectionCardBody>
        <p className="text-sm text-[var(--text-muted)]">{description}</p>
      </SectionCardBody>
    </SectionCard>
  );
}

function WorkspacePicker({
  workspaces,
  value,
  onChange,
}: {
  workspaces: Workspace[];
  value: string | null;
  onChange: (id: string) => void;
}) {
  if (!workspaces.length) return null;
  return (
    <div className="mb-5">
      <label className="block text-xs font-medium text-[var(--text-muted)] mb-1.5">
        Workspace
      </label>
      <select
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value)}
        className="input text-sm"
        style={{ maxWidth: 260 }}
      >
        {workspaces.map((ws) => (
          <option key={ws.id} value={ws.id}>
            {ws.name}
          </option>
        ))}
      </select>
    </div>
  );
}

// ─── General section ──────────────────────────────────────────────────────────

function GeneralSection() {
  const user = useAuthStore((s) => s.user);
  const { theme, setTheme } = useTheme();

  const THEMES = [
    { id: 'brand',       label: 'Dark',      icon: Moon },
    { id: 'brand-light', label: 'Light',     icon: Sun },
    { id: 'cyberpunk',   label: 'Cyberpunk', icon: Zap },
  ] as const;

  return (
    <div className="space-y-6">
      {/* Profile card */}
      <SectionCard>
        <SectionCardHeader>
          <h3 className="text-sm font-semibold">Profile</h3>
        </SectionCardHeader>
        <SectionCardBody>
          <div className="flex items-center gap-4 mb-6">
            <div
              className="w-14 h-14 rounded-full flex items-center justify-center text-white text-2xl font-bold shrink-0"
              style={{ background: 'var(--blue)' }}
            >
              {user?.name?.[0]?.toUpperCase() ?? 'U'}
            </div>
            <div>
              <p className="font-semibold text-[var(--text)]">{user?.name}</p>
              <p className="text-sm text-[var(--text-muted)]">{user?.email}</p>
              <Badge tone="neutral" className="mt-1.5 capitalize">
                {user?.orgRole}
              </Badge>
            </div>
          </div>
          <SettingRow label="Display Name" hint="Your name visible to teammates">
            <span className="text-sm text-[var(--text-muted)]">{user?.name}</span>
          </SettingRow>
          <SettingRow label="Email" hint="Used for login and notifications">
            <span className="text-sm text-[var(--text-muted)]">{user?.email}</span>
          </SettingRow>
          <SettingRow label="Role" hint="Your role in this organisation">
            <span className="text-sm capitalize text-[var(--text-muted)]">{user?.orgRole}</span>
          </SettingRow>
        </SectionCardBody>
      </SectionCard>

      {/* Appearance */}
      <SectionCard>
        <SectionCardHeader>
          <h3 className="text-sm font-semibold">Appearance</h3>
        </SectionCardHeader>
        <SectionCardBody>
          <p className="text-xs text-[var(--text-muted)] mb-4">Choose a theme for the dashboard.</p>
          <div className="flex gap-2 flex-wrap">
            {THEMES.map(({ id, label, icon: Icon }) => (
              <button
                key={id}
                onClick={() => setTheme(id)}
                className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm border transition-colors ${
                  theme === id
                    ? 'border-[var(--blue)] bg-[var(--blue)]/10 text-[var(--blue)] font-medium'
                    : 'border-[var(--border)] text-[var(--text-muted)] hover:text-[var(--text)] hover:border-[var(--text-muted)]'
                }`}
              >
                <Icon size={14} />
                {label}
                {theme === id && <Check size={12} />}
              </button>
            ))}
          </div>
        </SectionCardBody>
      </SectionCard>
    </div>
  );
}

// ─── Security section (2FA) ────────────────────────────────────────────────────

function CodeGrid({ codes }: { codes: string[] }) {
  return (
    <div className="grid grid-cols-2 gap-2 my-3">
      {codes.map((c) => (
        <code
          key={c}
          className="px-3 py-2 rounded-lg text-sm font-mono text-center"
          style={{ background: 'rgba(255,255,255,0.06)', color: 'var(--aqua)' }}
        >
          {c}
        </code>
      ))}
    </div>
  );
}

function SecuritySection() {
  const [step, setStep] = useState<'idle' | 'scan' | 'confirm' | 'codes'>('idle');
  const [setupData, setSetupData] = useState<TwoFASetupResponse | null>(null);
  const [totpInput, setTotpInput] = useState('');
  const [newCodes, setNewCodes] = useState<string[]>([]);
  const [disablePassword, setDisablePassword] = useState('');
  const [disableTotp, setDisableTotp] = useState('');
  const [is2FAEnabled, setIs2FAEnabled] = useState<boolean | null>(null);

  const setupMut = useMutation({
    mutationFn: () => api.post<TwoFASetupResponse>('/auth/2fa/setup'),
    onSuccess: (data) => { setSetupData(data); setStep('scan'); },
    onError: (err) => toast.error(err instanceof Error ? err.message : 'Setup failed'),
  });

  const verifyMut = useMutation({
    mutationFn: () => api.post<BackupCodesResponse>('/auth/2fa/verify', { token: totpInput }),
    onSuccess: (data) => {
      setNewCodes(data.backupCodes);
      setIs2FAEnabled(true);
      setStep('codes');
      toast.success('Two-factor authentication enabled!');
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : 'Invalid code'),
  });

  const disableMut = useMutation({
    mutationFn: () =>
      api.post('/auth/2fa/disable', { password: disablePassword, token: disableTotp }),
    onSuccess: () => {
      setIs2FAEnabled(false);
      setDisablePassword('');
      setDisableTotp('');
      toast.success('Two-factor authentication disabled');
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : 'Disable failed'),
  });

  const regenMut = useMutation({
    mutationFn: () => api.get<BackupCodesResponse>('/auth/2fa/backup-codes'),
    onSuccess: (data) => {
      setNewCodes(data.backupCodes);
      toast.success('New backup codes generated');
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : 'Failed'),
  });

  function downloadCodes(codes: string[]) {
    const a = document.createElement('a');
    a.href = `data:text/plain;charset=utf-8,${encodeURIComponent(codes.join('\n'))}`;
    a.download = 'omnihub-backup-codes.txt';
    a.click();
  }

  return (
    <div className="space-y-6">
      <SectionCard>
        <SectionCardHeader>
          <div className="flex items-center gap-2">
            {is2FAEnabled ? (
              <ShieldCheck size={18} className="text-green-400" />
            ) : (
              <ShieldOff size={18} className="text-[var(--text-muted)]" />
            )}
            <h3 className="text-sm font-semibold">Two-Factor Authentication</h3>
          </div>
          {is2FAEnabled === true && <Badge tone="success">Enabled</Badge>}
          {is2FAEnabled === false && <Badge tone="neutral">Disabled</Badge>}
        </SectionCardHeader>
        <SectionCardBody>
          <p className="text-xs text-[var(--text-muted)] mb-5">
            {is2FAEnabled === true
              ? 'Your account is protected with a TOTP authenticator app.'
              : 'Add an extra layer of security by requiring a code in addition to your password.'}
          </p>

          {/* Setup flow */}
          {step === 'idle' && is2FAEnabled !== true && (
            <ActionButton
              tone="primary"
              onClick={() => setupMut.mutate()}
              disabled={setupMut.isPending}
            >
              {setupMut.isPending ? 'Setting up…' : 'Enable 2FA'}
            </ActionButton>
          )}

          {step === 'scan' && setupData && (
            <div className="space-y-4">
              <p className="text-sm text-[var(--text-muted)]">
                Scan this QR code with your authenticator app (e.g. Google Authenticator, Authy).
              </p>
              <img
                src={setupData.qrDataUrl}
                alt="TOTP QR code"
                className="w-44 h-44 rounded-xl"
                style={{ imageRendering: 'pixelated' }}
              />
              <p className="text-xs text-[var(--text-muted)]">
                Or enter the secret manually:&nbsp;
                <code
                  className="px-2 py-0.5 rounded font-mono"
                  style={{ background: 'rgba(255,255,255,0.06)', color: 'var(--aqua)' }}
                >
                  {setupData.secret}
                </code>
              </p>
              <div className="flex gap-3 items-center">
                <input
                  value={totpInput}
                  onChange={(e) => setTotpInput(e.target.value.replace(/\D/g, '').slice(0, 6))}
                  placeholder="6-digit code"
                  className="input w-36 text-center font-mono tracking-widest text-lg"
                  maxLength={6}
                />
                <ActionButton
                  tone="primary"
                  onClick={() => verifyMut.mutate()}
                  disabled={totpInput.length !== 6 || verifyMut.isPending}
                >
                  {verifyMut.isPending ? 'Verifying…' : 'Confirm'}
                </ActionButton>
                <button
                  onClick={() => { setStep('idle'); setSetupData(null); setTotpInput(''); }}
                  className="text-sm text-[var(--text-muted)] hover:text-[var(--text)]"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}

          {step === 'codes' && newCodes.length > 0 && (
            <div className="space-y-4">
              <Callout tone="warning">
                <p className="font-semibold text-sm mb-1">Save your backup codes</p>
                <p className="text-xs text-[var(--text-muted)]">
                  Store these somewhere safe. Each code can only be used once.
                </p>
              </Callout>
              <CodeGrid codes={newCodes} />
              <div className="flex gap-3">
                <button
                  onClick={() => downloadCodes(newCodes)}
                  className="flex items-center gap-2 px-4 py-2 rounded-lg border text-sm font-medium hover:bg-white/5 transition-colors"
                  style={{ borderColor: 'var(--card-border)' }}
                >
                  <Download size={14} /> Download
                </button>
                <button
                  onClick={() => { void navigator.clipboard.writeText(newCodes.join('\n')); toast.success('Copied'); }}
                  className="flex items-center gap-2 px-4 py-2 rounded-lg border text-sm font-medium hover:bg-white/5 transition-colors"
                  style={{ borderColor: 'var(--card-border)' }}
                >
                  <Copy size={14} /> Copy
                </button>
                <ActionButton tone="primary" className="ml-auto" onClick={() => setStep('idle')}>
                  Done
                </ActionButton>
              </div>
            </div>
          )}

          {/* Enabled state */}
          {step === 'idle' && is2FAEnabled === true && (
            <div className="space-y-6">
              <div>
                <h4 className="text-sm font-semibold mb-1">Backup Codes</h4>
                <p className="text-xs text-[var(--text-muted)] mb-3">
                  Regenerate all 8 backup codes. Old codes will be invalidated immediately.
                </p>
                {newCodes.length > 0 ? (
                  <>
                    <CodeGrid codes={newCodes} />
                    <div className="flex gap-3">
                      <button
                        onClick={() => downloadCodes(newCodes)}
                        className="flex items-center gap-2 px-4 py-2 rounded-lg border text-sm font-medium hover:bg-white/5 transition-colors"
                        style={{ borderColor: 'var(--card-border)' }}
                      >
                        <Download size={14} /> Download
                      </button>
                      <button
                        onClick={() => { void navigator.clipboard.writeText(newCodes.join('\n')); toast.success('Copied'); }}
                        className="flex items-center gap-2 px-4 py-2 rounded-lg border text-sm font-medium hover:bg-white/5 transition-colors"
                        style={{ borderColor: 'var(--card-border)' }}
                      >
                        <Copy size={14} /> Copy
                      </button>
                    </div>
                  </>
                ) : (
                  <ActionButton
                    onClick={() => regenMut.mutate()}
                    disabled={regenMut.isPending}
                  >
                    {regenMut.isPending ? 'Regenerating…' : 'Regenerate Backup Codes'}
                  </ActionButton>
                )}
              </div>

              <div className="border-t pt-6" style={{ borderColor: 'var(--card-border)' }}>
                <h4 className="text-sm font-semibold mb-1 text-[var(--danger)]">Disable 2FA</h4>
                <p className="text-xs text-[var(--text-muted)] mb-3">
                  Enter your current password and an authenticator code to disable 2FA.
                </p>
                <div className="space-y-3">
                  <input
                    value={disablePassword}
                    onChange={(e) => setDisablePassword(e.target.value)}
                    type="password"
                    placeholder="Current password"
                    className="input w-full"
                  />
                  <input
                    value={disableTotp}
                    onChange={(e) => setDisableTotp(e.target.value.replace(/\D/g, '').slice(0, 6))}
                    placeholder="6-digit code"
                    className="input w-36 text-center font-mono tracking-widest text-lg"
                    maxLength={6}
                  />
                  <ActionButton
                    tone="danger"
                    onClick={() => disableMut.mutate()}
                    disabled={!disablePassword || disableTotp.length !== 6 || disableMut.isPending}
                  >
                    {disableMut.isPending ? 'Disabling…' : 'Disable 2FA'}
                  </ActionButton>
                </div>
              </div>
            </div>
          )}
        </SectionCardBody>
      </SectionCard>
    </div>
  );
}

// ─── Organization section ─────────────────────────────────────────────────────

// ─── Role definitions ─────────────────────────────────────────────────────────

const ORG_ROLES: {
  id: string;
  label: string;
  color: string;
  border?: boolean;
  description: string;
  managerOnly?: boolean;
}[] = [
  { id: 'prime_owner', label: 'Prime Owner', color: '#a78bfa', description: 'Prime Owner possesses all owner privileges plus additional rights to invite up to 3 owners and delete the organization.' },
  { id: 'owner',       label: 'Owner',       color: '#a78bfa', border: true, description: 'Owner has full control over all the workspaces. They can perform most administrative functions but cannot invite other owners or delete the organization.' },
  { id: 'admin',       label: 'Admin',       color: '#f59e0b', border: true, description: 'Admin can manage their own workspaces, including plan management.' },
  { id: 'a-manager',  label: 'A-Manager',   color: '#2dd4bf', border: true, description: 'All-Manager manages screens and content for their workspaces.' },
  { id: 's-manager',  label: 'S-Manager',   color: '#22d3ee', border: true, description: 'Screen-Manager can add or manage screens, but content management is limited.' },
  { id: 'c-manager',  label: 'C-Manager',   color: '#22d3ee', border: true, description: 'Content-Manager can create or manage content, but content publishing and screen management are limited.' },
  { id: 'viewer',      label: 'Viewer',      color: '#f472b6', border: true, description: 'Viewer can view content, screens and users in the workspaces they have access to.' },
  { id: 'installer',   label: 'Installer',   color: '#94a3b8', border: true, description: 'Installer can add the screens and edit basic screen information.' },
  { id: 'tag-bound',   label: 'Tag-Bound Role', color: '#fb7185', border: true, description: 'Tag-Bound Role limits access to screens and content resources based on assigned tags while preserving base role permissions. Only Admin, Owner, and Prime Owner can manage this role.' },
];

function RoleBadge({ roleId, size = 'sm' }: { roleId: string; size?: 'xs' | 'sm' }) {
  const def = ORG_ROLES.find((r) => r.id === roleId);
  if (!def) return <span className="text-xs text-[var(--text-muted)]">{roleId}</span>;
  const px = size === 'xs' ? 'px-2 py-0' : 'px-2.5 py-0.5';
  const txt = size === 'xs' ? 'text-[10px]' : 'text-xs';
  return (
    <span
      className={`inline-flex items-center rounded-full font-medium ${px} ${txt}`}
      style={
        def.border
          ? { border: `1px solid ${def.color}`, color: def.color, background: `${def.color}15` }
          : { background: def.color, color: '#fff' }
      }
    >
      {def.label}
    </span>
  );
}

// ─── Organization section ──────────────────────────────────────────────────────

interface OrgMember {
  id: string;
  name: string;
  email: string;
  orgRole: string;
  status: string;
  lastLogin: string | null;
  createdAt: string;
}

interface PendingInvite {
  id: string;
  email: string;
  orgRole: string;
  expiresAt: string;
  createdAt: string;
}

const ASSIGNABLE_ROLES = ORG_ROLES.filter((r) => r.id !== 'prime_owner');

function OrganizationSection() {
  const user = useAuthStore((s) => s.user);
  const qc = useQueryClient();
  const canManage = ['prime_owner', 'owner', 'admin'].includes(user?.orgRole ?? '');

  const [showInvite, setShowInvite] = useState(false);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<string>('viewer');
  const [showRoleRef, setShowRoleRef] = useState(false);

  const { data, isLoading } = useQuery<{ members: OrgMember[]; pendingInvites: PendingInvite[] }>({
    queryKey: ['org-members'],
    queryFn: () => api.get('/org/members'),
    enabled: canManage,
  });

  function invalidate() { void qc.invalidateQueries({ queryKey: ['org-members'] }); }

  const sendInvite = useMutation({
    mutationFn: (body: { email: string; orgRole: string }) => api.post('/org/members/invite', body),
    onSuccess: () => { toast.success('Invitation sent'); invalidate(); setShowInvite(false); setInviteEmail(''); setInviteRole('viewer'); },
    onError: (e: any) => toast.error(e?.message ?? 'Failed to send invite'),
  });

  const changeRole = useMutation({
    mutationFn: ({ userId, orgRole }: { userId: string; orgRole: string }) =>
      api.patch(`/org/members/${userId}/role`, { orgRole }),
    onSuccess: () => { toast.success('Role updated'); invalidate(); },
    onError: () => toast.error('Failed to update role'),
  });

  const removeMember = useMutation({
    mutationFn: (userId: string) => api.delete(`/org/members/${userId}`),
    onSuccess: () => { toast.success('Member removed'); invalidate(); },
    onError: () => toast.error('Failed to remove member'),
  });

  const cancelInvite = useMutation({
    mutationFn: (inviteId: string) => api.delete(`/org/invites/${inviteId}`),
    onSuccess: () => { toast.success('Invite cancelled'); invalidate(); },
    onError: () => toast.error('Failed to cancel invite'),
  });

  return (
    <div className="space-y-6">
      {/* Org info */}
      <SectionCard>
        <SectionCardHeader>
          <h3 className="text-sm font-semibold">Organization Info</h3>
        </SectionCardHeader>
        <SectionCardBody>
          <SettingRow label="Your Role" hint="Your role in this organisation">
            <RoleBadge roleId={user?.orgRole ?? 'member'} />
          </SettingRow>
        </SectionCardBody>
      </SectionCard>

      {!canManage && (
        <Callout tone="accent">
          Contact an organisation owner or admin to manage members and settings.
        </Callout>
      )}

      {canManage && (
        <>
          {/* Role reference */}
          <SectionCard>
            <SectionCardHeader>
              <h3 className="text-sm font-semibold">Role Reference</h3>
              <button
                type="button"
                onClick={() => setShowRoleRef((v) => !v)}
                className="text-xs text-[var(--text-muted)] hover:text-[var(--text)] transition-colors flex items-center gap-1"
              >
                <Info size={12} /> {showRoleRef ? 'Hide' : 'Show all roles'}
              </button>
            </SectionCardHeader>
            {showRoleRef && (
              <SectionCardBody className="p-0">
                <div className="divide-y" style={{ borderColor: 'var(--border)' }}>
                  {ORG_ROLES.map((role) => (
                    <div key={role.id} className="flex items-start gap-4 px-5 py-3">
                      <div className="w-28 shrink-0 pt-0.5">
                        <RoleBadge roleId={role.id} size="xs" />
                      </div>
                      <p className="text-xs text-[var(--text-muted)] leading-relaxed">{role.description}</p>
                    </div>
                  ))}
                </div>
              </SectionCardBody>
            )}
          </SectionCard>

          {/* Members */}
          <SectionCard>
            <SectionCardHeader>
              <h3 className="text-sm font-semibold">Members</h3>
              <ActionButton tone="primary" onClick={() => setShowInvite((v) => !v)}>
                <Mail size={12} className="mr-1" /> Invite
              </ActionButton>
            </SectionCardHeader>
            <SectionCardBody className="p-0">
              {/* Invite form */}
              {showInvite && (
                <div className="px-5 py-4 border-b flex flex-col sm:flex-row gap-3 items-start sm:items-end" style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}>
                  <div className="flex-1 min-w-0">
                    <label className="text-[10px] text-[var(--text-muted)] uppercase tracking-wide mb-1 block">Email</label>
                    <input
                      type="email"
                      className="input w-full text-sm"
                      placeholder="colleague@example.com"
                      value={inviteEmail}
                      onChange={(e) => setInviteEmail(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && sendInvite.mutate({ email: inviteEmail, orgRole: inviteRole })}
                    />
                  </div>
                  <div className="w-44 shrink-0">
                    <label className="text-[10px] text-[var(--text-muted)] uppercase tracking-wide mb-1 block">Role</label>
                    <select
                      className="input w-full text-sm"
                      value={inviteRole}
                      onChange={(e) => setInviteRole(e.target.value)}
                    >
                      {ASSIGNABLE_ROLES.map((r) => (
                        <option key={r.id} value={r.id}>{r.label}</option>
                      ))}
                    </select>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <ActionButton
                      tone="primary"
                      onClick={() => sendInvite.mutate({ email: inviteEmail, orgRole: inviteRole })}
                      disabled={!inviteEmail.trim() || sendInvite.isPending}
                    >
                      <Check size={13} className="mr-1" /> Send
                    </ActionButton>
                    <button type="button" onClick={() => { setShowInvite(false); setInviteEmail(''); }}
                      className="text-[var(--text-muted)] hover:text-[var(--text)] transition-colors">
                      <X size={15} />
                    </button>
                  </div>
                </div>
              )}

              {/* Member list */}
              {isLoading && (
                <div className="space-y-2 p-5">
                  {[...Array(3)].map((_, i) => (
                    <Skeleton key={i} className="h-12 rounded-lg" />
                  ))}
                </div>
              )}

              {!isLoading && data && data.members.length === 0 && (
                <p className="text-sm text-[var(--text-muted)] p-5">No members found.</p>
              )}

              {!isLoading && data && data.members.length > 0 && (
                <div className="divide-y" style={{ borderColor: 'var(--border)' }}>
                  {data.members.map((m) => (
                    <div key={m.id} className="flex items-center gap-3 px-5 py-3">
                      {/* Avatar initial */}
                      <div
                        className="w-8 h-8 rounded-full flex items-center justify-center text-sm font-semibold shrink-0 select-none"
                        style={{ background: 'var(--blue)', color: '#fff' }}
                      >
                        {m.name ? m.name[0]!.toUpperCase() : m.email[0]!.toUpperCase()}
                      </div>
                      {/* Name + email */}
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-[var(--text)] truncate">
                          {m.name || m.email}
                          {m.id === user?.id && (
                            <span className="ml-1.5 text-[10px] text-[var(--text-muted)]">(you)</span>
                          )}
                        </p>
                        <p className="text-xs text-[var(--text-muted)] truncate">{m.email}</p>
                      </div>
                      {/* Role selector */}
                      {m.id !== user?.id ? (
                        <select
                          className="input text-xs py-1 px-2 w-36 shrink-0"
                          value={m.orgRole}
                          onChange={(e) => changeRole.mutate({ userId: m.id, orgRole: e.target.value })}
                          disabled={m.orgRole === 'prime_owner'}
                        >
                          {ASSIGNABLE_ROLES.map((r) => (
                            <option key={r.id} value={r.id}>{r.label}</option>
                          ))}
                        </select>
                      ) : (
                        <RoleBadge roleId={m.orgRole} size="xs" />
                      )}
                      {/* Remove */}
                      {m.id !== user?.id && m.orgRole !== 'prime_owner' && (
                        <button
                          type="button"
                          title="Remove member"
                          onClick={() => removeMember.mutate(m.id)}
                          className="w-7 h-7 rounded flex items-center justify-center text-[var(--text-muted)] hover:text-[var(--danger)] hover:bg-[var(--surface)] transition-colors shrink-0"
                        >
                          <UserMinus size={14} />
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </SectionCardBody>
          </SectionCard>

          {/* Pending invites */}
          {!isLoading && data && data.pendingInvites.length > 0 && (
            <SectionCard>
              <SectionCardHeader>
                <h3 className="text-sm font-semibold">Pending Invites</h3>
                <span className="text-xs text-[var(--text-muted)]">{data.pendingInvites.length} pending</span>
              </SectionCardHeader>
              <SectionCardBody className="p-0">
                <div className="divide-y" style={{ borderColor: 'var(--border)' }}>
                  {data.pendingInvites.map((inv) => (
                    <div key={inv.id} className="flex items-center gap-3 px-5 py-3">
                      <Mail size={14} className="shrink-0 text-[var(--text-muted)]" />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm text-[var(--text)] truncate">{inv.email}</p>
                        <p className="text-xs text-[var(--text-muted)]">
                          Expires {new Date(inv.expiresAt).toLocaleDateString()}
                        </p>
                      </div>
                      <RoleBadge roleId={inv.orgRole} size="xs" />
                      <button
                        type="button"
                        title="Cancel invite"
                        onClick={() => cancelInvite.mutate(inv.id)}
                        className="w-7 h-7 rounded flex items-center justify-center text-[var(--text-muted)] hover:text-[var(--danger)] hover:bg-[var(--surface)] transition-colors shrink-0"
                      >
                        <X size={14} />
                      </button>
                    </div>
                  ))}
                </div>
              </SectionCardBody>
            </SectionCard>
          )}

          {/* Plan & Billing */}
          <ComingSoon
            title="Plan & Billing"
            description="View and manage your subscription plan, storage quota, and billing details. Available in an upcoming update."
          />
        </>
      )}
    </div>
  );
}

// ─── Workspace section ────────────────────────────────────────────────────────

// Common IANA timezones
const TIMEZONES = [
  { value: 'UTC',                    label: 'UTC — Coordinated Universal Time' },
  { value: 'America/New_York',       label: 'Eastern Time — New York (ET)' },
  { value: 'America/Chicago',        label: 'Central Time — Chicago (CT)' },
  { value: 'America/Denver',         label: 'Mountain Time — Denver (MT)' },
  { value: 'America/Los_Angeles',    label: 'Pacific Time — Los Angeles (PT)' },
  { value: 'America/Anchorage',      label: 'Alaska Time — Anchorage (AKT)' },
  { value: 'Pacific/Honolulu',       label: 'Hawaii Time — Honolulu (HT)' },
  { value: 'America/Toronto',        label: 'Eastern Time — Toronto (ET)' },
  { value: 'America/Vancouver',      label: 'Pacific Time — Vancouver (PT)' },
  { value: 'America/Sao_Paulo',      label: 'Brasília Time — São Paulo (BRT)' },
  { value: 'America/Argentina/Buenos_Aires', label: 'Argentina Time — Buenos Aires (ART)' },
  { value: 'America/Mexico_City',    label: 'Central Time — Mexico City (CST)' },
  { value: 'Europe/London',          label: 'Greenwich Mean Time — London (GMT/BST)' },
  { value: 'Europe/Paris',           label: 'Central European Time — Paris (CET)' },
  { value: 'Europe/Berlin',          label: 'Central European Time — Berlin (CET)' },
  { value: 'Europe/Madrid',          label: 'Central European Time — Madrid (CET)' },
  { value: 'Europe/Rome',            label: 'Central European Time — Rome (CET)' },
  { value: 'Europe/Amsterdam',       label: 'Central European Time — Amsterdam (CET)' },
  { value: 'Europe/Stockholm',       label: 'Central European Time — Stockholm (CET)' },
  { value: 'Europe/Warsaw',          label: 'Central European Time — Warsaw (CET)' },
  { value: 'Europe/Helsinki',        label: 'Eastern European Time — Helsinki (EET)' },
  { value: 'Europe/Athens',          label: 'Eastern European Time — Athens (EET)' },
  { value: 'Europe/Kiev',            label: 'Eastern European Time — Kyiv (EET)' },
  { value: 'Europe/Moscow',          label: 'Moscow Time — Moscow (MSK)' },
  { value: 'Asia/Dubai',             label: 'Gulf Standard Time — Dubai (GST)' },
  { value: 'Asia/Karachi',           label: 'Pakistan Standard Time — Karachi (PKT)' },
  { value: 'Asia/Kolkata',           label: 'India Standard Time — Kolkata (IST)' },
  { value: 'Asia/Dhaka',             label: 'Bangladesh Standard Time — Dhaka (BST)' },
  { value: 'Asia/Bangkok',           label: 'Indochina Time — Bangkok (ICT)' },
  { value: 'Asia/Singapore',         label: 'Singapore Time — Singapore (SGT)' },
  { value: 'Asia/Hong_Kong',         label: 'Hong Kong Time — Hong Kong (HKT)' },
  { value: 'Asia/Shanghai',          label: 'China Standard Time — Shanghai (CST)' },
  { value: 'Asia/Tokyo',             label: 'Japan Standard Time — Tokyo (JST)' },
  { value: 'Asia/Seoul',             label: 'Korea Standard Time — Seoul (KST)' },
  { value: 'Asia/Jakarta',           label: 'Western Indonesia Time — Jakarta (WIB)' },
  { value: 'Asia/Manila',            label: 'Philippine Time — Manila (PHT)' },
  { value: 'Australia/Perth',        label: 'Australian Western Time — Perth (AWST)' },
  { value: 'Australia/Adelaide',     label: 'Australian Central Time — Adelaide (ACST)' },
  { value: 'Australia/Sydney',       label: 'Australian Eastern Time — Sydney (AEST)' },
  { value: 'Australia/Brisbane',     label: 'Australian Eastern Time — Brisbane (AEST)' },
  { value: 'Pacific/Auckland',       label: 'New Zealand Time — Auckland (NZST)' },
  { value: 'Pacific/Fiji',           label: 'Fiji Time — Suva (FJT)' },
  { value: 'Africa/Cairo',           label: 'Eastern European Time — Cairo (EET)' },
  { value: 'Africa/Johannesburg',    label: 'South Africa Standard Time (SAST)' },
  { value: 'Africa/Lagos',           label: 'West Africa Time — Lagos (WAT)' },
  { value: 'Africa/Nairobi',         label: 'East Africa Time — Nairobi (EAT)' },
];

function WorkspaceSection({ selectedWsId }: { selectedWsId: string | null }) {
  const qc = useQueryClient();
  const [wsName, setWsName] = useState('');
  const [tzValue, setTzValue] = useState('UTC');
  const [approvalEnabled, setApprovalEnabled] = useState(false);
  const [approvalReviewers, setApprovalReviewers] = useState<string[]>([]);
  // Player defaults
  const [defaultPlaylistId, setDefaultPlaylistId] = useState<string>('');
  const [logoUrl, setLogoUrl] = useState<string>('');

  const APPROVER_ROLES = new Set(['prime_owner', 'owner', 'admin', 'a-manager']);

  const { data: ws, isLoading } = useQuery<Workspace & { settings: string }>({
    queryKey: ['workspace', selectedWsId],
    queryFn: () => api.get<Workspace & { settings: string }>(`/workspaces/${selectedWsId}`),
    enabled: !!selectedWsId,
  });

  // Fetch org members to populate reviewer picker
  const { data: membersData } = useQuery<{ members: { id: string; name: string; email: string; orgRole: string }[] }>({
    queryKey: ['org-members'],
    queryFn: () => api.get('/org/members'),
    enabled: approvalEnabled,
  });

  const { data: wsPls = [] } = useQuery<{ id: string; name: string }[]>({
    queryKey: ['ws-playlists-brief', selectedWsId],
    queryFn: () => api.get(`/playlists?workspaceId=${selectedWsId}`),
    enabled: !!selectedWsId,
    staleTime: 60_000,
  });

  const eligibleReviewers = (membersData?.members ?? []).filter((m) => APPROVER_ROLES.has(m.orgRole));

  useEffect(() => {
    if (ws) {
      setWsName(ws.name);
      setTzValue(ws.timezone ?? 'UTC');
      setDefaultPlaylistId(ws.defaultPlaylistId ?? '');
      setLogoUrl(ws.logoUrl ?? '');
      try {
        const parsed = JSON.parse(ws.settings ?? '{}') as { approvalRequired?: boolean; approvalReviewers?: string[] };
        setApprovalEnabled(parsed.approvalRequired ?? false);
        setApprovalReviewers(parsed.approvalReviewers ?? []);
      } catch { setApprovalEnabled(false); setApprovalReviewers([]); }
    }
  }, [ws]);

  const saveMut = useMutation({
    mutationFn: () =>
      api.patch(`/workspaces/${selectedWsId}`, { name: wsName.trim(), timezone: tzValue }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['workspaces'] });
      void qc.invalidateQueries({ queryKey: ['workspace', selectedWsId] });
      toast.success('Workspace updated');
    },
    onError: () => toast.error('Failed to save changes'),
  });

  const approvalMut = useMutation({
    mutationFn: (payload: { approvalRequired?: boolean; approvalReviewers?: string[] }) =>
      api.patch(`/workspaces/${selectedWsId}`, payload),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['workspace', selectedWsId] });
      toast.success('Approval settings saved');
    },
    onError: () => toast.error('Failed to save'),
  });

  const playerDefaultsMut = useMutation({
    mutationFn: () =>
      api.patch(`/workspaces/${selectedWsId}`, {
        defaultPlaylistId: defaultPlaylistId || null,
        logoUrl: logoUrl || null,
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['workspace', selectedWsId] });
      toast.success('Player defaults saved');
    },
    onError: () => toast.error('Failed to save player defaults'),
  });

  const toggleReviewer = (userId: string) => {
    const next = approvalReviewers.includes(userId)
      ? approvalReviewers.filter((id) => id !== userId)
      : [...approvalReviewers, userId];
    setApprovalReviewers(next);
    approvalMut.mutate({ approvalReviewers: next });
  };

  if (!selectedWsId) {
    return (
      <Callout tone="accent">Select a workspace above to view and edit its settings.</Callout>
    );
  }

  if (isLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-24 rounded-2xl" />
        <Skeleton className="h-64 rounded-2xl" />
      </div>
    );
  }

  const roleColor: Record<string, string> = {
    prime_owner: '#a78bfa', owner: '#f59e0b', admin: '#34d399',
    'a-manager': '#2dd4bf',
  };

  return (
    <div className="space-y-6">
      <SectionCard>
        <SectionCardHeader>
          <h3 className="text-sm font-semibold">General</h3>
        </SectionCardHeader>
        <SectionCardBody>
          <div className="space-y-4">
            <div>
              <label className="block text-xs font-medium text-[var(--text-muted)] mb-1.5">
                Workspace Name
              </label>
              <input
                value={wsName}
                onChange={(e) => setWsName(e.target.value)}
                className="input w-full"
                placeholder="Workspace name…"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-[var(--text-muted)] mb-1.5">
                Timezone
              </label>
              <select
                value={tzValue}
                onChange={(e) => setTzValue(e.target.value)}
                className="input w-full"
              >
                {TIMEZONES.map((tz) => (
                  <option key={tz.value} value={tz.value}>
                    {tz.label}
                  </option>
                ))}
              </select>
              <p className="text-xs text-[var(--text-muted)] mt-1">
                All scheduled content in this workspace will use this timezone.
              </p>
            </div>
            {ws?.slug && (
              <div>
                <label className="block text-xs font-medium text-[var(--text-muted)] mb-1">
                  Slug
                </label>
                <code
                  className="text-sm px-2 py-1 rounded"
                  style={{ background: 'rgba(255,255,255,0.05)', color: 'var(--text-muted)' }}
                >
                  {ws.slug}
                </code>
              </div>
            )}
            <div className="pt-2">
              <ActionButton
                tone="primary"
                onClick={() => saveMut.mutate()}
                disabled={!wsName.trim() || (wsName === ws?.name && tzValue === (ws?.timezone ?? 'UTC')) || saveMut.isPending}
              >
                {saveMut.isPending ? 'Saving…' : 'Save Changes'}
              </ActionButton>
            </div>
          </div>
        </SectionCardBody>
      </SectionCard>

      <SectionCard>
        <SectionCardHeader>
          <h3 className="text-sm font-semibold">Content Approval Workflow</h3>
          <Badge tone={approvalEnabled ? 'success' : 'neutral'}>
            {approvalEnabled ? 'Enabled' : 'Disabled'}
          </Badge>
        </SectionCardHeader>
        <SectionCardBody>
          <SettingRow
            label="Require approval for new content"
            hint="When enabled, uploaded content must be reviewed and approved before it can be added to a playlist."
          >
            <ToggleSwitch
              label=""
              checked={approvalEnabled}
              onChange={() => {
                const next = !approvalEnabled;
                setApprovalEnabled(next);
                approvalMut.mutate({ approvalRequired: next });
              }}
            />
          </SettingRow>

          {approvalEnabled && (
            <div className="mt-5 pt-4 border-t border-[var(--border)]">
              <p className="text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)] mb-1">
                Designated Approvers
              </p>
              <p className="text-xs text-[var(--text-muted)] mb-3">
                Select who can approve or reject content. If none are selected, all eligible roles (Admin / A-Manager / Owner) can approve.
              </p>

              {eligibleReviewers.length === 0 ? (
                <p className="text-xs text-[var(--text-muted)] italic">No eligible members found.</p>
              ) : (
                <div className="space-y-1.5">
                  {eligibleReviewers.map((m) => {
                    const checked = approvalReviewers.includes(m.id);
                    return (
                      <label
                        key={m.id}
                        className={`flex items-center gap-3 px-3 py-2.5 rounded-lg cursor-pointer transition-colors border ${
                          checked
                            ? 'border-[var(--accent)]/50 bg-[var(--accent)]/8'
                            : 'border-[var(--border)] hover:bg-[var(--surface-raised)]'
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => toggleReviewer(m.id)}
                          className="accent-[var(--accent)] w-3.5 h-3.5 shrink-0"
                        />
                        {/* Avatar initial */}
                        <div
                          className="w-7 h-7 rounded-full flex items-center justify-center text-[10px] font-bold text-white shrink-0"
                          style={{ background: roleColor[m.orgRole] ?? '#64748b' }}
                        >
                          {m.name.charAt(0).toUpperCase()}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-[var(--text)] truncate">{m.name}</p>
                          <p className="text-[10px] text-[var(--text-muted)] truncate">{m.email}</p>
                        </div>
                        <span
                          className="text-[9px] font-bold uppercase px-1.5 py-0.5 rounded shrink-0"
                          style={{ background: `${roleColor[m.orgRole] ?? '#64748b'}22`, color: roleColor[m.orgRole] ?? '#94a3b8' }}
                        >
                          {m.orgRole.replace('-', ' ')}
                        </span>
                      </label>
                    );
                  })}
                </div>
              )}

              {approvalReviewers.length > 0 && (
                <p className="text-[10px] text-[var(--text-muted)] mt-2">
                  {approvalReviewers.length} approver{approvalReviewers.length !== 1 ? 's' : ''} selected.
                  Prime Owner and Owner can always approve regardless.
                </p>
              )}
            </div>
          )}

          <p className="text-xs text-[var(--text-muted)] mt-4">
            Workflow: <strong className="text-[var(--text)]">draft → pending review → approved / rejected</strong>
            <br />
            <span className="text-[10px]">C-Manager uploads start as <em>draft</em> when enabled. Owners &amp; Admins upload as auto-approved.</span>
          </p>
        </SectionCardBody>
      </SectionCard>

      {/* Player Defaults */}
      <SectionCard>
        <SectionCardHeader>
          <h3 className="text-sm font-semibold">Player Defaults</h3>
        </SectionCardHeader>
        <SectionCardBody>
          <div className="space-y-4">
            <div>
              <label className="block text-xs font-medium text-[var(--text-muted)] mb-1.5">
                Default Playlist
                <span className="font-normal ml-1">— shown on all devices when no schedule slot is active and the device has no device-level override</span>
              </label>
              <select
                value={defaultPlaylistId}
                onChange={(e) => setDefaultPlaylistId(e.target.value)}
                className="input w-full"
              >
                <option value="">— None (show idle screen) —</option>
                {wsPls.map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-[var(--text-muted)] mb-1.5">
                Idle Screen Logo URL
                <span className="font-normal ml-1">— shown on the built-in idle screen on all Samsung displays</span>
              </label>
              <input
                type="url"
                value={logoUrl}
                onChange={(e) => setLogoUrl(e.target.value)}
                placeholder="https://example.com/logo.png"
                className="input w-full font-mono text-sm"
              />
            </div>
            <div className="pt-1">
              <ActionButton
                tone="primary"
                onClick={() => playerDefaultsMut.mutate()}
                disabled={playerDefaultsMut.isPending}
              >
                {playerDefaultsMut.isPending ? 'Saving…' : 'Save Player Defaults'}
              </ActionButton>
            </div>
          </div>
        </SectionCardBody>
      </SectionCard>
    </div>
  );
}

// ─── Tags section ─────────────────────────────────────────────────────────────

// ─── Tag system primitives ────────────────────────────────────────────────────

type TagEntityType = 'device' | 'content' | 'playlist' | 'schedule';

interface WorkspaceTag {
  id: string;
  categoryId: string;
  workspaceId: string;
  name: string;
  color: string | null;
  position: number;
  createdAt: string;
  usage: { device: number; content: number; playlist: number; schedule: number };
}

interface TagCategory {
  id: string;
  workspaceId: string;
  name: string;
  color: string;
  availableFor: TagEntityType[];
  position: number;
  createdAt: string;
  updatedAt: string;
  tags: WorkspaceTag[];
}

const TAG_ENTITY_OPTIONS: { id: TagEntityType; label: string; icon: React.ReactNode }[] = [
  { id: 'device',   label: 'Devices',   icon: <Monitor size={13} /> },
  { id: 'content',  label: 'Content',   icon: <ImageIcon size={13} /> },
  { id: 'playlist', label: 'Playlists', icon: <Layers size={13} /> },
  { id: 'schedule', label: 'Schedules', icon: <CalendarDays size={13} /> },
];

const TAG_PRESET_COLORS = [
  '#6366f1', '#3b82f6', '#06b6d4', '#10b981',
  '#f59e0b', '#ef4444', '#ec4899', '#8b5cf6',
  '#f97316', '#84cc16', '#14b8a6', '#64748b',
];

function TagColorPicker({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-5 h-5 rounded-full border-2 border-[var(--border)] shrink-0 focus:outline-none"
        style={{ background: value }}
      />
      {open && (
        <div
          className="absolute left-0 top-7 z-30 p-2 rounded-xl border grid grid-cols-6 gap-1.5"
          style={{ background: 'var(--card)', borderColor: 'var(--card-border)', minWidth: 156 }}
        >
          {TAG_PRESET_COLORS.map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => { onChange(c); setOpen(false); }}
              className="w-5 h-5 rounded-full border-2 transition-transform hover:scale-110"
              style={{ background: c, borderColor: c === value ? 'white' : 'transparent' }}
            />
          ))}
          <div className="col-span-6 mt-1 border-t pt-1.5" style={{ borderColor: 'var(--border)' }}>
            <input type="color" value={value} onChange={(e) => onChange(e.target.value)} className="w-full h-6 cursor-pointer rounded" />
          </div>
        </div>
      )}
    </div>
  );
}

function TagPillInline({
  tag, categoryColor, onDelete, onRename,
}: {
  tag: WorkspaceTag; categoryColor: string;
  onDelete: () => void; onRename: (name: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(tag.name);
  const [usageModal, setUsageModal] = useState<TagEntityType | null>(null);
  const color = tag.color ?? categoryColor;

  function commit() {
    const t = value.trim();
    if (t && t !== tag.name) onRename(t); else setValue(tag.name);
    setEditing(false);
  }

  return (
    <>
      <div
        className="group flex items-center justify-between px-3 py-1.5 rounded-lg border hover:border-[var(--text-muted)] transition-colors"
        style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}
      >
        <div className="flex items-center gap-2 flex-1 min-w-0">
          <div className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: color }} />
          {editing ? (
            <input
              autoFocus value={value}
              onChange={(e) => setValue(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') { setValue(tag.name); setEditing(false); } }}
              onBlur={commit}
              className="bg-transparent border-none outline-none text-xs w-28 text-[var(--text)]"
            />
          ) : (
            <span
              className="text-xs text-[var(--text)] cursor-pointer hover:text-[var(--blue)] transition-colors truncate"
              onClick={() => { setEditing(true); setValue(tag.name); }}
            >
              {tag.name}
            </span>
          )}
        </div>
        <div className="flex items-center gap-0.5 shrink-0 ml-2">
          {TAG_ENTITY_OPTIONS.map(({ id, label, icon }) => {
            const count = tag.usage[id];
            return (
              <button
                key={id} type="button"
                title={count > 0 ? `Used in ${count} ${label.toLowerCase()}` : `Not used in ${label.toLowerCase()}`}
                disabled={count === 0}
                onClick={() => count > 0 && setUsageModal(id)}
                className={`w-5 h-5 rounded flex items-center justify-center transition-colors ${
                  count > 0
                    ? 'text-[var(--blue)] cursor-pointer hover:bg-[var(--blue)]/10'
                    : 'text-[var(--text-muted)] opacity-25 cursor-default'
                }`}
              >
                {icon}
              </button>
            );
          })}
          <button type="button" onClick={onDelete}
            className="w-5 h-5 rounded flex items-center justify-center text-[var(--text-muted)] opacity-0 group-hover:opacity-100 hover:text-[var(--danger)] transition-all ml-0.5">
            <X size={11} />
          </button>
        </div>
      </div>

      {usageModal && (
        <TagUsageModalInline
          tag={tag} categoryColor={categoryColor}
          activeType={usageModal}
          onClose={() => setUsageModal(null)}
        />
      )}
    </>
  );
}

function TagUsageModalInline({
  tag, categoryColor, activeType, onClose,
}: {
  tag: WorkspaceTag; categoryColor: string;
  activeType: TagEntityType; onClose: () => void;
}) {
  const color = tag.color ?? categoryColor;
  const [tab, setTab] = useState<TagEntityType>(activeType);
  const totalUsage = tag.usage.device + tag.usage.content + tag.usage.playlist + tag.usage.schedule;

  const { data, isLoading } = useQuery<Record<TagEntityType, { id: string; name: string }[]>>({
    queryKey: ['tag-usage', tag.id],
    queryFn: () => api.get(`/tags/${tag.id}/usage`),
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.5)' }} onClick={onClose}>
      <div
        className="w-full max-w-md rounded-2xl border shadow-2xl overflow-hidden"
        style={{ background: 'var(--card)', borderColor: 'var(--card-border)' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b" style={{ borderColor: 'var(--border)' }}>
          <div className="flex items-center gap-3">
            <MapPin size={16} className="text-[var(--text-muted)]" />
            <div>
              <div className="flex items-center gap-2">
                <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold"
                  style={{ background: `${color}22`, color, border: `1px solid ${color}55` }}>
                  {tag.name}
                </span>
                <span className="text-xs text-[var(--text-muted)]">{totalUsage} {totalUsage === 1 ? 'use' : 'uses'}</span>
              </div>
              <p className="text-[10px] text-[var(--text-muted)] mt-0.5">Tag usage map</p>
            </div>
          </div>
          <button type="button" onClick={onClose} className="text-[var(--text-muted)] hover:text-[var(--text)] transition-colors"><X size={16} /></button>
        </div>

        <div className="flex border-b" style={{ borderColor: 'var(--border)' }}>
          {TAG_ENTITY_OPTIONS.map(({ id, label, icon }) => {
            const count = tag.usage[id];
            return (
              <button key={id} type="button" onClick={() => setTab(id)}
                className={`flex-1 flex flex-col items-center gap-1 py-2.5 text-[10px] font-medium border-b-2 transition-colors ${
                  tab === id ? 'border-[var(--blue)] text-[var(--blue)]'
                    : count > 0 ? 'border-transparent text-[var(--text)]'
                    : 'border-transparent text-[var(--text-muted)]'
                }`}
              >
                <span className={count > 0 ? 'opacity-100' : 'opacity-30'}>{icon}</span>
                <span>{label}</span>
                {count > 0 && (
                  <span className="px-1.5 py-0 rounded-full text-[9px] font-bold"
                    style={{ background: tab === id ? 'var(--blue)' : `${color}33`, color: tab === id ? 'white' : color }}>
                    {count}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        <div className="p-4 min-h-[100px] max-h-60 overflow-y-auto">
          {isLoading && (
            <div className="space-y-2">{[...Array(2)].map((_, i) => (
              <Skeleton key={i} className="h-8 rounded-lg" />
            ))}</div>
          )}
          {!isLoading && data && data[tab].length === 0 && (
            <div className="flex flex-col items-center justify-center gap-2 py-5 text-[var(--text-muted)]">
              <span className="opacity-30">{TAG_ENTITY_OPTIONS.find((e) => e.id === tab)?.icon}</span>
              <p className="text-xs">No {TAG_ENTITY_OPTIONS.find((e) => e.id === tab)?.label.toLowerCase()} use this tag</p>
            </div>
          )}
          {!isLoading && data && data[tab].length > 0 && (
            <div className="space-y-1.5">
              {data[tab].map((item) => (
                <div key={item.id} className="flex items-center gap-3 px-3 py-2 rounded-lg border"
                  style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}>
                  <span className="text-[var(--text-muted)] shrink-0">{TAG_ENTITY_OPTIONS.find((e) => e.id === tab)?.icon}</span>
                  <span className="text-xs text-[var(--text)] truncate">{item.name}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function TagCategoryCard({
  cat, onUpdateCategory, onDeleteCategory, onAddTag, onRenameTag, onDeleteTag,
}: {
  cat: TagCategory;
  onUpdateCategory: (id: string, data: Partial<Pick<TagCategory, 'name' | 'color' | 'availableFor'>>) => void;
  onDeleteCategory: (id: string) => void;
  onAddTag: (categoryId: string, name: string) => void;
  onRenameTag: (categoryId: string, tagId: string, name: string) => void;
  onDeleteTag: (categoryId: string, tagId: string) => void;
}) {
  const [editingName, setEditingName] = useState(false);
  const [nameValue, setNameValue] = useState(cat.name);
  const [addingTag, setAddingTag] = useState(false);
  const [newTagName, setNewTagName] = useState('');
  const [menuOpen, setMenuOpen] = useState(false);
  const tagInputRef = useRef<HTMLInputElement>(null);

  function commitName() {
    const t = nameValue.trim();
    if (t && t !== cat.name) onUpdateCategory(cat.id, { name: t }); else setNameValue(cat.name);
    setEditingName(false);
  }

  function toggleEntity(entity: TagEntityType) {
    const next = cat.availableFor.includes(entity)
      ? cat.availableFor.filter((e) => e !== entity)
      : [...cat.availableFor, entity];
    onUpdateCategory(cat.id, { availableFor: next });
  }

  function commitNewTag() {
    const t = newTagName.trim();
    if (t) onAddTag(cat.id, t);
    setNewTagName(''); setAddingTag(false);
  }

  return (
    <div className="rounded-xl border overflow-hidden" style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}>
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b" style={{ borderColor: 'var(--border)' }}>
        <div className="flex items-center gap-2.5 flex-1 min-w-0">
          <TagColorPicker value={cat.color} onChange={(c) => onUpdateCategory(cat.id, { color: c })} />
          {editingName ? (
            <input
              autoFocus value={nameValue}
              onChange={(e) => setNameValue(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') commitName(); if (e.key === 'Escape') { setNameValue(cat.name); setEditingName(false); } }}
              onBlur={commitName}
              className="input text-xs font-semibold py-0.5 px-2 h-6 w-36"
            />
          ) : (
            <h4
              className="text-xs font-semibold text-[var(--text)] cursor-pointer hover:text-[var(--blue)] transition-colors"
              onClick={() => setEditingName(true)}
            >
              {cat.name}
            </h4>
          )}
          <span className="text-[10px] text-[var(--text-muted)]">{cat.tags.length}</span>
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          {/* Entity toggles */}
          {TAG_ENTITY_OPTIONS.map(({ id, label, icon }) => {
            const active = cat.availableFor.includes(id);
            return (
              <button
                key={id} type="button" title={label}
                onClick={() => toggleEntity(id)}
                className={`w-6 h-6 rounded flex items-center justify-center border transition-colors ${
                  active ? 'border-[var(--blue)] bg-[var(--blue)]/15 text-[var(--blue)]' : 'border-[var(--border)] text-[var(--text-muted)] hover:text-[var(--text)]'
                }`}
              >
                {icon}
              </button>
            );
          })}
          {/* Menu */}
          <div className="relative">
            <button
              type="button" onClick={() => setMenuOpen((v) => !v)}
              className="w-6 h-6 rounded flex items-center justify-center text-[var(--text-muted)] hover:text-[var(--text)] hover:bg-[var(--surface)] transition-colors"
            >
              <ChevronDown size={12} />
            </button>
            {menuOpen && (
              <div className="absolute right-0 top-8 z-20 rounded-xl border py-1 min-w-[130px]" style={{ background: 'var(--modal-bg)', borderColor: 'var(--card-border)' }}>
                <button type="button" onClick={() => { setEditingName(true); setMenuOpen(false); }}
                  className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-[var(--text-muted)] hover:text-[var(--text)] hover:bg-[var(--surface)] transition-colors">
                  <Pencil size={11} /> Rename
                </button>
                <button type="button" onClick={() => { onDeleteCategory(cat.id); setMenuOpen(false); }}
                  className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-[var(--danger)] hover:bg-[var(--surface)] transition-colors">
                  <Trash2 size={11} /> Delete
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Tags area — row list */}
      <div className="px-4 py-3 space-y-1.5">
        <button
          type="button"
          onClick={() => { setAddingTag(true); setTimeout(() => tagInputRef.current?.focus(), 50); }}
          className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] border border-dashed text-[var(--text-muted)] hover:text-[var(--text)] hover:border-[var(--text-muted)] transition-colors mb-0.5"
          style={{ borderColor: 'var(--border)' }}
        >
          <Plus size={9} /> Add tag
        </button>
        {addingTag && (
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg border"
            style={{ borderColor: cat.color, background: `${cat.color}11` }}>
            <div className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: cat.color }} />
            <input
              ref={tagInputRef} value={newTagName}
              onChange={(e) => setNewTagName(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') commitNewTag(); if (e.key === 'Escape') { setNewTagName(''); setAddingTag(false); } }}
              onBlur={commitNewTag}
              placeholder="Tag name…"
              className="bg-transparent border-none outline-none text-xs text-[var(--text)] w-full"
            />
          </div>
        )}
        {cat.tags.map((tag) => (
          <TagPillInline
            key={tag.id} tag={tag} categoryColor={cat.color}
            onDelete={() => onDeleteTag(cat.id, tag.id)}
            onRename={(name) => onRenameTag(cat.id, tag.id, name)}
          />
        ))}
        {cat.tags.length === 0 && !addingTag && (
          <span className="text-[10px] text-[var(--text-muted)]">No tags yet</span>
        )}
      </div>
    </div>
  );
}

function TagsSection({ selectedWsId }: { selectedWsId: string | null }) {
  const qc = useQueryClient();
  const [showAddCategory, setShowAddCategory] = useState(false);
  const [newCatName, setNewCatName] = useState('');
  const [newCatColor, setNewCatColor] = useState('#6366f1');

  const { data: categories = [], isLoading } = useQuery<TagCategory[]>({
    queryKey: ['tags', selectedWsId],
    queryFn: () => api.get(`/tags?workspaceId=${selectedWsId}`),
    enabled: !!selectedWsId,
  });

  const totalTags = categories.reduce((s, c) => s + c.tags.length, 0);

  function invalidate() {
    void qc.invalidateQueries({ queryKey: ['tags', selectedWsId] });
  }

  const createCategory = useMutation({
    mutationFn: (data: { name: string; color: string; availableFor: TagEntityType[] }) =>
      api.post('/tags/categories', { workspaceId: selectedWsId, ...data }),
    onSuccess: () => { toast.success('Category created'); invalidate(); },
    onError: () => toast.error('Failed to create category'),
  });

  const updateCategory = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<Pick<TagCategory, 'name' | 'color' | 'availableFor'>> }) =>
      api.patch(`/tags/categories/${id}`, data),
    onSuccess: () => invalidate(),
    onError: () => toast.error('Failed to update category'),
  });

  const deleteCategory = useMutation({
    mutationFn: (id: string) => api.delete(`/tags/categories/${id}`),
    onSuccess: () => { toast.success('Category deleted'); invalidate(); },
    onError: () => toast.error('Failed to delete category'),
  });

  const addTag = useMutation({
    mutationFn: ({ categoryId, name }: { categoryId: string; name: string }) =>
      api.post(`/tags/categories/${categoryId}/tags`, { name }),
    onSuccess: () => invalidate(),
    onError: () => toast.error('Failed to add tag'),
  });

  const renameTag = useMutation({
    mutationFn: ({ categoryId, tagId, name }: { categoryId: string; tagId: string; name: string }) =>
      api.patch(`/tags/categories/${categoryId}/tags/${tagId}`, { name }),
    onSuccess: () => invalidate(),
    onError: () => toast.error('Failed to rename tag'),
  });

  const deleteTag = useMutation({
    mutationFn: ({ categoryId, tagId }: { categoryId: string; tagId: string }) =>
      api.delete(`/tags/categories/${categoryId}/tags/${tagId}`),
    onSuccess: () => invalidate(),
    onError: () => toast.error('Failed to delete tag'),
  });

  function handleCreate() {
    const trimmed = newCatName.trim();
    if (!trimmed) return;
    createCategory.mutate({ name: trimmed, color: newCatColor, availableFor: [] });
    setNewCatName(''); setNewCatColor('#6366f1'); setShowAddCategory(false);
  }

  if (!selectedWsId) {
    return <Callout tone="accent">Select a workspace above to manage its tags.</Callout>;
  }

  return (
    <div className="space-y-4">
      {/* Header row */}
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-semibold text-[var(--text)]">Tag Registry</p>
          {categories.length > 0 && (
            <p className="text-xs text-[var(--text-muted)] mt-0.5">
              {categories.length} {categories.length === 1 ? 'category' : 'categories'} · {totalTags} tags
            </p>
          )}
        </div>
        <ActionButton tone="primary" onClick={() => setShowAddCategory(true)}>
          <Plus size={13} className="mr-1" /> Add Category
        </ActionButton>
      </div>

      {/* Add category inline */}
      {showAddCategory && (
        <div className="rounded-xl border p-4" style={{ borderColor: 'var(--card-border)', background: 'var(--card)' }}>
          <p className="text-xs font-semibold mb-3 text-[var(--text)]">New Category</p>
          <div className="flex items-center gap-2">
            <TagColorPicker value={newCatColor} onChange={setNewCatColor} />
            <input
              autoFocus value={newCatName}
              onChange={(e) => setNewCatName(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') handleCreate(); if (e.key === 'Escape') { setShowAddCategory(false); setNewCatName(''); } }}
              placeholder="Category name…"
              className="input flex-1 text-sm"
            />
            <ActionButton tone="primary" onClick={handleCreate} disabled={!newCatName.trim() || createCategory.isPending}>
              <Check size={13} className="mr-1" /> Create
            </ActionButton>
            <button type="button" onClick={() => { setShowAddCategory(false); setNewCatName(''); }}
              className="text-[var(--text-muted)] hover:text-[var(--text)] transition-colors">
              <X size={15} />
            </button>
          </div>
        </div>
      )}

      {/* Loading skeletons */}
      {isLoading && (
        <div className="space-y-3">
          {[...Array(2)].map((_, i) => (
            <Skeleton key={i} className="h-20 rounded-xl" />
          ))}
        </div>
      )}

      {/* Empty */}
      {!isLoading && categories.length === 0 && (
        <p className="text-sm text-[var(--text-muted)] py-4 text-center">
          No tag categories yet. Click "Add Category" to create the first one.
        </p>
      )}

      {/* Category list */}
      {!isLoading && categories.length > 0 && (
        <div className="space-y-3">
          {categories.map((cat) => (
            <TagCategoryCard
              key={cat.id} cat={cat}
              onUpdateCategory={(id, data) => updateCategory.mutate({ id, data })}
              onDeleteCategory={(id) => deleteCategory.mutate(id)}
              onAddTag={(categoryId, name) => addTag.mutate({ categoryId, name })}
              onRenameTag={(categoryId, tagId, name) => renameTag.mutate({ categoryId, tagId, name })}
              onDeleteTag={(categoryId, tagId) => deleteTag.mutate({ categoryId, tagId })}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Emergency Alert section ──────────────────────────────────────────────────

function EmergencySection({ workspaces, selectedWsId }: { workspaces: Workspace[]; selectedWsId: string | null }) {
  const qc = useQueryClient();
  const user = useAuthStore((s) => s.user);
  const [newMsg, setNewMsg] = useState('');
  const [scope, setScope] = useState('org');

  const { data: overrides = [] } = useQuery<EmergencyOverride[]>({
    queryKey: ['emergency'],
    queryFn: () => api.get('/emergency'),
    refetchInterval: 15_000,
  });

  const createMut = useMutation({
    mutationFn: () =>
      api.post('/emergency', { contentType: 'text', contentText: newMsg.trim(), scope }),
    onSuccess: () => {
      setNewMsg('');
      toast.error('Emergency override activated');
      void qc.invalidateQueries({ queryKey: ['emergency'] });
    },
    onError: () => toast.error('Failed to activate'),
  });

  const clearMut = useMutation({
    mutationFn: (id: string) => api.delete(`/emergency/${id}`),
    onSuccess: () => {
      toast.success('Emergency override cleared');
      void qc.invalidateQueries({ queryKey: ['emergency'] });
    },
    onError: () => toast.error('Failed to clear'),
  });

  const canManage = user?.orgRole === 'owner' || user?.orgRole === 'admin';

  return (
    <div className="space-y-6">
      {/* Active overrides */}
      {overrides.length > 0 && (
        <SectionCard>
          <SectionCardHeader>
            <h3 className="text-sm font-semibold text-red-400">Active Overrides</h3>
            <Badge tone="danger">{overrides.length} active</Badge>
          </SectionCardHeader>
          <SectionCardBody>
            <div className="space-y-2">
              {overrides.map((ov) => (
                <div
                  key={ov.id}
                  className="flex items-center justify-between gap-3 px-3 py-2.5 rounded-lg"
                  style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)' }}
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <AlertTriangle size={14} className="text-red-400 shrink-0" />
                    <p className="text-sm truncate">{ov.contentText ?? 'Emergency override'}</p>
                  </div>
                  {canManage && (
                    <ActionButton
                      tone="danger"
                      className="shrink-0 text-xs py-1 px-2"
                      onClick={() => clearMut.mutate(ov.id)}
                      disabled={clearMut.isPending}
                    >
                      <X size={12} /> Clear
                    </ActionButton>
                  )}
                </div>
              ))}
            </div>
          </SectionCardBody>
        </SectionCard>
      )}

      {/* Create new override */}
      {canManage && (
        <SectionCard>
          <SectionCardHeader>
            <h3 className="text-sm font-semibold">Broadcast Emergency Override</h3>
          </SectionCardHeader>
          <SectionCardBody>
            <p className="text-xs text-[var(--text-muted)] mb-4">
              Instantly interrupt all device playback and display an urgent full-screen message.
            </p>
            <div className="space-y-3">
              <div>
                <label className="block text-xs font-medium text-[var(--text-muted)] mb-1.5">
                  Scope
                </label>
                <select
                  value={scope}
                  onChange={(e) => setScope(e.target.value)}
                  className="input w-full"
                >
                  <option value="org">Entire Organisation</option>
                  {workspaces.map((ws) => (
                    <option key={ws.id} value={`workspace:${ws.id}`}>
                      Workspace: {ws.name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-[var(--text-muted)] mb-1.5">
                  Emergency Message
                </label>
                <textarea
                  value={newMsg}
                  onChange={(e) => setNewMsg(e.target.value)}
                  rows={3}
                  placeholder="Message shown full-screen on all displays…"
                  className="input w-full resize-none"
                />
              </div>
              <ActionButton
                tone="danger"
                disabled={!newMsg.trim() || createMut.isPending}
                onClick={() => {
                  if (!newMsg.trim()) return toast.error('Message is required');
                  createMut.mutate();
                }}
              >
                <AlertTriangle size={14} />
                {createMut.isPending ? 'Activating…' : 'Activate Override'}
              </ActionButton>
            </div>
          </SectionCardBody>
        </SectionCard>
      )}

      {!canManage && (
        <Callout tone="accent">
          Only organisation admins and owners can activate emergency overrides.
        </Callout>
      )}
    </div>
  );
}

// ─── Audit Log section ────────────────────────────────────────────────────────

function AuditSection() {
  const [actorId, setActorId] = useState('');
  const [page, setPage] = useState(1);
  const LIMIT = 20;

  const { data: actorsData } = useQuery({
    queryKey: ['audit-actors'],
    queryFn: () => api.get<{ actors: { id: string; name: string | null }[] }>('/audit/actors'),
  });

  const { data, isFetching } = useQuery({
    queryKey: ['audit', page, actorId],
    queryFn: () =>
      api.get<{ entries: AuditEntry[]; total: number; page: number; limit: number }>(
        `/audit?page=${page}&limit=${LIMIT}${actorId ? `&actorId=${actorId}` : ''}`,
      ),
  });

  const actors = actorsData?.actors ?? [];
  const entries: AuditEntry[] = data?.entries ?? [];
  const total = data?.total ?? 0;

  function timeAgo(dateStr: string) {
    const ms = Date.now() - new Date(dateStr).getTime();
    const mins = Math.floor(ms / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    const days = Math.floor(hrs / 24);
    if (days < 7) return `${days}d ago`;
    return new Date(dateStr).toLocaleDateString();
  }

  return (
    <div className="space-y-6">
      <SectionCard>
        <SectionCardHeader>
          <h3 className="text-sm font-semibold">Activity Log</h3>
          {total > 0 && (
            <span className="text-xs text-[var(--text-muted)]">{total} entries</span>
          )}
        </SectionCardHeader>
        <SectionCardBody>
          {/* Actor filter */}
          <div className="flex items-center gap-2 mb-4">
            <Filter size={13} className="text-[var(--text-muted)]" />
            <select
              value={actorId}
              onChange={(e) => { setActorId(e.target.value); setPage(1); }}
              className="text-xs py-1 px-2 rounded"
              style={{ background: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--text)' }}
            >
              <option value="">All actors</option>
              {actors.map((a) => (
                <option key={a.id} value={a.id}>{a.name ?? a.id.substring(0, 8)}</option>
              ))}
            </select>
          </div>

          {/* Entry list */}
          <div className="space-y-0">
            {isFetching && entries.length === 0 && (
              <div className="space-y-3 py-3">
                {Array.from({ length: 3 }).map((_, index) => (
                  <Skeleton key={index} className="h-14 rounded-xl" />
                ))}
              </div>
            )}
            {!isFetching && entries.length === 0 && (
              <div className="py-8 text-center text-sm text-[var(--text-muted)]">No audit entries found.</div>
            )}
            {entries.map((entry) => (
              <div
                key={entry.id}
                className="flex items-start justify-between gap-4 py-3 border-b last:border-0"
                style={{ borderColor: 'var(--border)' }}
              >
                <div className="min-w-0">
                  <p className="text-sm text-[var(--text)] truncate">{entry.action}</p>
                  <p className="text-xs text-[var(--text-muted)]">
                    {entry.actor_name ?? (entry.actor_type === 'system' ? 'System' : 'Unknown')}
                    {entry.entity_type && (
                      <span className="ml-2 opacity-60">· {entry.entity_type}</span>
                    )}
                  </p>
                </div>
                <div className="flex items-center gap-1.5 shrink-0 text-xs text-[var(--text-muted)] whitespace-nowrap">
                  <Clock size={11} />
                  {timeAgo(entry.created_at)}
                </div>
              </div>
            ))}
          </div>

          {/* Pagination */}
          {total > LIMIT && (
            <div className="flex items-center justify-between pt-4 border-t" style={{ borderColor: 'var(--border)' }}>
              <button
                disabled={page === 1}
                onClick={() => setPage((p) => p - 1)}
                className="text-xs px-3 py-1.5 rounded border disabled:opacity-40 hover:bg-[var(--surface)]"
                style={{ borderColor: 'var(--border)', color: 'var(--text)' }}
              >
                Previous
              </button>
              <span className="text-xs text-[var(--text-muted)]">
                {(page - 1) * LIMIT + 1}–{Math.min(page * LIMIT, total)} of {total}
              </span>
              <button
                disabled={page * LIMIT >= total}
                onClick={() => setPage((p) => p + 1)}
                className="text-xs px-3 py-1.5 rounded border disabled:opacity-40 hover:bg-[var(--surface)]"
                style={{ borderColor: 'var(--border)', color: 'var(--text)' }}
              >
                Next
              </button>
            </div>
          )}
        </SectionCardBody>
      </SectionCard>
    </div>
  );
}

// ─── API Keys section ─────────────────────────────────────────────────────────

const API_KEY_SCOPES = [
  { id: 'content:read',    label: 'Content Read' },
  { id: 'content:write',   label: 'Content Write' },
  { id: 'schedules:read',  label: 'Schedules Read' },
  { id: 'schedules:write', label: 'Schedules Write' },
  { id: 'devices:read',    label: 'Devices Read' },
  { id: 'sensor:write',    label: 'Sensor Write' },
  { id: 'analytics:read',  label: 'Analytics Read' },
];

function ApiKeysSection({ selectedWsId }: { selectedWsId: string | null }) {
  const qc = useQueryClient();
  const [showCreate, setShowCreate] = useState(false);
  const [newRawKey, setNewRawKey] = useState<string | null>(null);
  const [newName, setNewName] = useState('');
  const [newScopes, setNewScopes] = useState<string[]>(['content:read']);
  const [expiresInDays, setExpiresInDays] = useState('');
  const [confirmAction, setConfirmAction] = useState<{ type: 'revoke' | 'delete'; id: string; name: string } | null>(null);

  const { data } = useQuery({
    queryKey: ['api-keys', selectedWsId],
    queryFn: () =>
      api.get<{ keys: ApiKey[] }>(
        `/api-keys${selectedWsId ? `?workspaceId=${selectedWsId}` : ''}`,
      ),
  });

  const keys: ApiKey[] = data?.keys ?? [];

  const createMut = useMutation({
    mutationFn: (body: { name: string; scopes: string[]; workspaceId?: string; expiresInDays?: number }) =>
      api.post<{ key: ApiKey & { rawKey: string } }>('/api-keys', body),
    onSuccess: (res) => {
      setNewRawKey(res.key.rawKey);
      setShowCreate(false);
      setNewName('');
      setNewScopes(['content:read']);
      setExpiresInDays('');
      qc.invalidateQueries({ queryKey: ['api-keys'] });
    },
    onError: () => toast.error('Failed to create API key'),
  });

  const revokeMut = useMutation({
    mutationFn: (id: string) => api.patch(`/api-keys/${id}/revoke`, {}),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['api-keys'] }); toast.success('Key revoked'); },
    onError: () => toast.error('Failed to revoke key'),
  });

  const deleteMut = useMutation({
    mutationFn: (id: string) => api.delete(`/api-keys/${id}`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['api-keys'] }); toast.success('Key deleted'); },
    onError: () => toast.error('Failed to delete key'),
  });

  function toggleScope(scope: string) {
    setNewScopes((prev) =>
      prev.includes(scope) ? prev.filter((s) => s !== scope) : [...prev, scope],
    );
  }

  function handleCreate() {
    if (!newName.trim() || newScopes.length === 0) return;
    const body: { name: string; scopes: string[]; workspaceId?: string; expiresInDays?: number } = {
      name: newName.trim(),
      scopes: newScopes,
    };
    if (selectedWsId) body.workspaceId = selectedWsId;
    if (expiresInDays) body.expiresInDays = parseInt(expiresInDays);
    createMut.mutate(body);
  }

  function formatDate(d: string | null) {
    if (!d) return '—';
    return new Date(d).toLocaleDateString();
  }

  function timeAgo(d: string | null) {
    if (!d) return 'Never';
    const ms = Date.now() - new Date(d).getTime();
    const days = Math.floor(ms / 86400000);
    if (days === 0) return 'Today';
    if (days === 1) return 'Yesterday';
    return `${days} days ago`;
  }

  return (
    <div className="space-y-6">
      {/* New key one-time banner */}
      {newRawKey && (
        <div
          className="rounded-xl border p-4"
          style={{ borderColor: 'var(--green)', background: 'rgba(34,197,94,0.07)' }}
        >
          <p className="text-sm font-semibold text-green-400 mb-1">Copy your API key — shown only once</p>
          <div className="flex items-center gap-2 mt-2">
            <code
              className="flex-1 text-xs font-mono px-3 py-2 rounded truncate"
              style={{ background: 'var(--surface)', color: 'var(--text)' }}
            >
              {newRawKey}
            </code>
            <button
              onClick={() => { navigator.clipboard.writeText(newRawKey); toast.success('Copied!'); }}
              className="p-2 rounded hover:bg-white/10"
              title="Copy"
            >
              <Copy size={13} />
            </button>
            <button
              onClick={() => setNewRawKey(null)}
              className="p-2 rounded hover:bg-white/10 text-[var(--text-muted)]"
              title="Dismiss"
            >
              <X size={13} />
            </button>
          </div>
        </div>
      )}

      <SectionCard>
        <SectionCardHeader>
          <h3 className="text-sm font-semibold">API Keys</h3>
          <ActionButton onClick={() => setShowCreate((v) => !v)}>
            <Plus size={13} className="inline mr-1" />
            {showCreate ? 'Cancel' : 'Create Key'}
          </ActionButton>
        </SectionCardHeader>
        <SectionCardBody>
          <p className="text-xs text-[var(--text-muted)] mb-4">
            Workspace-scoped API keys for external integrations (sensor webhooks, BMS, POS, third-party tools). The raw key is shown only once on creation.
          </p>

          {/* Create form */}
          {showCreate && (
            <div
              className="mb-4 p-4 rounded-xl border space-y-3"
              style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}
            >
              <div>
                <label className="text-xs font-medium block mb-1">Key name</label>
                <input
                  type="text"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder="e.g. Sensor Gateway"
                  className="w-full text-sm px-3 py-2 rounded-lg border"
                  style={{ background: 'var(--card)', border: '1px solid var(--border)', color: 'var(--text)' }}
                />
              </div>
              <div>
                <label className="text-xs font-medium block mb-1.5">Scopes</label>
                <div className="flex flex-wrap gap-1.5">
                  {API_KEY_SCOPES.map((s) => (
                    <button
                      key={s.id}
                      type="button"
                      onClick={() => toggleScope(s.id)}
                      className="text-xs px-2.5 py-1 rounded-full border transition-colors"
                      style={
                        newScopes.includes(s.id)
                          ? { background: 'var(--blue)', borderColor: 'var(--blue)', color: '#fff' }
                          : { background: 'transparent', borderColor: 'var(--border)', color: 'var(--text-muted)' }
                      }
                    >
                      {s.label}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <label className="text-xs font-medium block mb-1">Expires in (days, optional)</label>
                <input
                  type="number"
                  value={expiresInDays}
                  onChange={(e) => setExpiresInDays(e.target.value)}
                  placeholder="e.g. 90"
                  min={1}
                  max={365}
                  className="w-32 text-sm px-3 py-2 rounded-lg border"
                  style={{ background: 'var(--card)', border: '1px solid var(--border)', color: 'var(--text)' }}
                />
              </div>
              <ActionButton
                onClick={handleCreate}
                disabled={!newName.trim() || newScopes.length === 0 || createMut.isPending}
              >
                {createMut.isPending ? 'Creating…' : 'Generate Key'}
              </ActionButton>
            </div>
          )}

          {/* Key list */}
          {keys.length === 0 && (
            <p className="text-sm text-[var(--text-muted)] py-4 text-center">No API keys yet.</p>
          )}
          <div className="space-y-2">
            {keys.map((key) => (
              <div
                key={key.id}
                className="flex items-start justify-between gap-3 px-3 py-3 rounded-lg border"
                style={{
                  borderColor: 'var(--border)',
                  background: key.revokedAt ? 'rgba(255,255,255,0.02)' : 'var(--surface)',
                  opacity: key.revokedAt ? 0.6 : 1,
                }}
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-medium text-[var(--text)] truncate">{key.name}</p>
                    {key.revokedAt && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-red-500/15 text-red-400 font-medium">
                        Revoked
                      </span>
                    )}
                    {key.expiresAt && !key.revokedAt && new Date(key.expiresAt) < new Date() && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-yellow-500/15 text-yellow-400 font-medium">
                        Expired
                      </span>
                    )}
                  </div>
                  <p className="text-xs font-mono text-[var(--aqua)] mt-0.5">{key.keyPrefix}…</p>
                  <div className="flex gap-1 flex-wrap mt-1">
                    {key.scopes.split(' ').map((s) => (
                      <code
                        key={s}
                        className="text-[10px] px-1.5 py-0.5 rounded font-mono"
                        style={{ background: 'rgba(255,255,255,0.06)', color: 'var(--aqua)' }}
                      >
                        {s}
                      </code>
                    ))}
                  </div>
                  <div className="flex gap-3 mt-1 text-[11px] text-[var(--text-muted)]">
                    <span>Last used: {timeAgo(key.lastUsedAt)}</span>
                    {key.expiresAt && <span>Expires: {formatDate(key.expiresAt)}</span>}
                  </div>
                </div>
                <div className="flex gap-0.5 shrink-0">
                  {!key.revokedAt && (
                    <button
                      onClick={() => setConfirmAction({ type: 'revoke', id: key.id, name: key.name })}
                      className="p-1.5 rounded hover:bg-white/5 text-yellow-400"
                      title="Revoke key"
                    >
                      <Ban size={13} />
                    </button>
                  )}
                  <button
                    onClick={() => setConfirmAction({ type: 'delete', id: key.id, name: key.name })}
                    className="p-1.5 rounded hover:bg-white/5 text-red-400"
                    title="Delete key"
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </SectionCardBody>
      </SectionCard>

      <ConfirmDialog
        open={confirmAction !== null}
        title={confirmAction?.type === 'revoke' ? `Revoke "${confirmAction?.name}"?` : `Delete "${confirmAction?.name}"?`}
        message={
          confirmAction?.type === 'revoke'
            ? 'The key will stop working immediately. This cannot be undone.'
            : 'The key will be permanently deleted and cannot be recovered.'
        }
        confirmLabel={confirmAction?.type === 'revoke' ? 'Revoke' : 'Delete'}
        variant={confirmAction?.type === 'revoke' ? 'warning' : 'danger'}
        isConfirming={revokeMut.isPending || deleteMut.isPending}
        onConfirm={() => {
          if (!confirmAction) return;
          if (confirmAction.type === 'revoke') revokeMut.mutate(confirmAction.id);
          else deleteMut.mutate(confirmAction.id);
          setConfirmAction(null);
        }}
        onClose={() => setConfirmAction(null)}
      />
    </div>
  );
}

// ─── Notifications section ────────────────────────────────────────────────────

const NOTIF_EVENT_META: Record<string, { label: string; hint: string }> = {
  device_offline:      { label: 'Device went offline',            hint: 'After configurable threshold (default 5 min)' },
  device_online:       { label: 'Device came back online',         hint: 'When a disconnected device reconnects' },
  content_failed:      { label: 'Content processing failed',       hint: 'When your uploaded content fails to process' },
  storage_warning:     { label: 'Storage quota at 80% / 100%',    hint: 'Sent to org admins and the uploader' },
  content_expiring:    { label: 'Content expiring within 7 days',  hint: 'Sent to workspace admins' },
  emergency_activated: { label: 'Emergency override activated',     hint: 'Sent to all workspace members' },
  sensor_rule_fired:   { label: 'Sensor rule fired',               hint: 'Sent to workspace admins' },
  invitation_accepted: { label: 'Invitation accepted',             hint: 'Sent to the person who sent the invite' },
};

function NotificationsSection() {
  const qc = useQueryClient();
  const [tab, setTab] = useState<'inbox' | 'prefs'>('inbox');
  const [page, setPage] = useState(1);
  const LIMIT = 20;

  // ── Inbox queries ──
  const { data: notifData, isFetching } = useQuery({
    queryKey: ['notifications', page],
    queryFn: () =>
      api.get<{ notifications: NotifItem[]; total: number; unreadCount: number }>(
        `/notifications?page=${page}&limit=${LIMIT}`,
      ),
    enabled: tab === 'inbox',
  });

  const notifs: NotifItem[] = notifData?.notifications ?? [];
  const total = notifData?.total ?? 0;
  const unreadCount = notifData?.unreadCount ?? 0;

  const markReadMut = useMutation({
    mutationFn: (id: string) => api.patch(`/notifications/${id}/read`, {}),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['notifications'] }),
  });

  const markAllMut = useMutation({
    mutationFn: () => api.post('/notifications/mark-all-read'),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['notifications'] }); toast.success('All marked as read'); },
  });

  const dismissMut = useMutation({
    mutationFn: (id: string) => api.delete(`/notifications/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['notifications'] }),
  });

  // ── Prefs queries ──
  const { data: prefsData } = useQuery({
    queryKey: ['notif-prefs'],
    queryFn: () => api.get<{ prefs: NotifPref[] }>('/notifications/prefs'),
    enabled: tab === 'prefs',
  });

  const prefs: NotifPref[] = prefsData?.prefs ?? [];

  const prefsMut = useMutation({
    mutationFn: (updated: { eventKey: string; inApp: boolean; email: boolean }[]) =>
      api.put('/notifications/prefs', { prefs: updated }),
    onError: () => toast.error('Failed to save preferences'),
  });

  function togglePref(eventKey: string, field: 'in_app' | 'email_notify') {
    const updated = prefs.map((p) =>
      p.event_key === eventKey ? { ...p, [field]: !p[field] } : p,
    );
    qc.setQueryData(['notif-prefs'], { prefs: updated });
    prefsMut.mutate(
      updated.map((p) => ({ eventKey: p.event_key, inApp: p.in_app, email: p.email_notify })),
    );
  }

  function timeAgo(d: string) {
    const ms = Date.now() - new Date(d).getTime();
    const mins = Math.floor(ms / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    return `${Math.floor(hrs / 24)}d ago`;
  }

  const notifIcon: Record<string, React.ReactNode> = {
    device_offline:      <Monitor size={13} className="text-red-400" />,
    device_online:       <Monitor size={13} className="text-green-400" />,
    content_failed:      <ImageIcon size={13} className="text-yellow-400" />,
    storage_warning:     <AlertTriangle size={13} className="text-orange-400" />,
    content_expiring:    <Clock size={13} className="text-yellow-400" />,
    emergency_activated: <AlertTriangle size={13} className="text-red-400" />,
    sensor_rule_fired:   <Zap size={13} className="text-purple-400" />,
    invitation_accepted: <Mail size={13} className="text-blue-400" />,
  };

  return (
    <div className="space-y-6">
      <SectionCard>
        <SectionCardHeader>
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-semibold">Notifications</h3>
            {unreadCount > 0 && tab === 'inbox' && (
              <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-[var(--blue)] text-white font-medium">
                {unreadCount}
              </span>
            )}
          </div>
          {tab === 'inbox' && unreadCount > 0 && (
            <button
              onClick={() => markAllMut.mutate()}
              disabled={markAllMut.isPending}
              className="flex items-center gap-1.5 text-xs text-[var(--text-muted)] hover:text-[var(--text)]"
            >
              <CheckCheck size={13} /> Mark all read
            </button>
          )}
        </SectionCardHeader>

        {/* Tabs */}
        <div className="flex border-b px-4" style={{ borderColor: 'var(--border)' }}>
          {(['inbox', 'prefs'] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`px-3 py-2 text-xs font-medium border-b-2 -mb-px transition-colors ${
                tab === t
                  ? 'border-[var(--blue)] text-[var(--blue)]'
                  : 'border-transparent text-[var(--text-muted)] hover:text-[var(--text)]'
              }`}
            >
              {t === 'inbox' ? 'Inbox' : 'Preferences'}
            </button>
          ))}
        </div>

        <SectionCardBody>
          {/* ── Inbox tab ── */}
          {tab === 'inbox' && (
            <div>
              {isFetching && notifs.length === 0 && (
                <div className="space-y-3 py-3">
                  {Array.from({ length: 3 }).map((_, index) => (
                    <Skeleton key={index} className="h-16 rounded-xl" />
                  ))}
                </div>
              )}
              {!isFetching && notifs.length === 0 && (
                <div className="py-10 flex flex-col items-center gap-2 text-[var(--text-muted)]">
                  <BellOff size={24} className="opacity-30" />
                  <p className="text-sm">No notifications</p>
                </div>
              )}
              <div className="space-y-0">
                {notifs.map((n) => (
                  <div
                    key={n.id}
                    className={`flex items-start gap-3 py-3 border-b last:border-0 cursor-pointer hover:bg-[var(--surface)] rounded transition-colors ${
                      n.readAt ? 'opacity-60' : ''
                    }`}
                    style={{ borderColor: 'var(--border)' }}
                    onClick={() => { if (!n.readAt) markReadMut.mutate(n.id); }}
                  >
                    <div
                      className="mt-0.5 shrink-0 w-6 h-6 rounded-full flex items-center justify-center"
                      style={{ background: 'var(--surface)' }}
                    >
                      {notifIcon[n.type] ?? <Bell size={13} className="text-[var(--text-muted)]" />}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-start justify-between gap-2">
                        <p className={`text-sm ${!n.readAt ? 'font-medium text-[var(--text)]' : 'text-[var(--text-muted)]'}`}>
                          {n.title}
                        </p>
                        <span className="text-[11px] text-[var(--text-muted)] shrink-0 whitespace-nowrap">
                          {timeAgo(n.createdAt)}
                        </span>
                      </div>
                      <p className="text-xs text-[var(--text-muted)] mt-0.5 line-clamp-2">{n.body}</p>
                    </div>
                    <button
                      onClick={(e) => { e.stopPropagation(); dismissMut.mutate(n.id); }}
                      className="p-1 rounded hover:bg-white/10 text-[var(--text-muted)] shrink-0"
                      title="Dismiss"
                    >
                      <X size={12} />
                    </button>
                  </div>
                ))}
              </div>
              {total > LIMIT && (
                <div className="flex items-center justify-between pt-4 border-t" style={{ borderColor: 'var(--border)' }}>
                  <button
                    disabled={page === 1}
                    onClick={() => setPage((p) => p - 1)}
                    className="text-xs px-3 py-1.5 rounded border disabled:opacity-40 hover:bg-[var(--surface)]"
                    style={{ borderColor: 'var(--border)', color: 'var(--text)' }}
                  >
                    Previous
                  </button>
                  <span className="text-xs text-[var(--text-muted)]">
                    {(page - 1) * LIMIT + 1}–{Math.min(page * LIMIT, total)} of {total}
                  </span>
                  <button
                    disabled={page * LIMIT >= total}
                    onClick={() => setPage((p) => p + 1)}
                    className="text-xs px-3 py-1.5 rounded border disabled:opacity-40 hover:bg-[var(--surface)]"
                    style={{ borderColor: 'var(--border)', color: 'var(--text)' }}
                  >
                    Next
                  </button>
                </div>
              )}
            </div>
          )}

          {/* ── Preferences tab ── */}
          {tab === 'prefs' && (
            <div>
              <p className="text-xs text-[var(--text-muted)] mb-4">
                Choose which events send you in-app notifications or emails.
              </p>
              <div className="flex justify-end gap-8 mb-2 pr-1">
                <span className="text-[11px] font-medium text-[var(--text-muted)]">In-App</span>
                <span className="text-[11px] font-medium text-[var(--text-muted)]">Email</span>
              </div>
              {Object.entries(NOTIF_EVENT_META).map(([key, meta]) => {
                const pref = prefs.find((p) => p.event_key === key);
                return (
                  <div
                    key={key}
                    className="flex items-start justify-between gap-4 py-3 border-b last:border-0"
                    style={{ borderColor: 'var(--border)' }}
                  >
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-[var(--text)]">{meta.label}</p>
                      <p className="text-xs text-[var(--text-muted)] mt-0.5">{meta.hint}</p>
                    </div>
                    <div className="flex items-center gap-8 shrink-0">
                      <ToggleSwitch
                        label=""
                        checked={pref?.in_app ?? true}
                        onChange={() => togglePref(key, 'in_app')}
                      />
                      <ToggleSwitch
                        label=""
                        checked={pref?.email_notify ?? false}
                        onChange={() => togglePref(key, 'email_notify')}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </SectionCardBody>
      </SectionCard>
    </div>
  );
}

// ─── Main SettingsPage ────────────────────────────────────────────────────────

export default function SettingsPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const activeSection = (searchParams.get('section') ?? 'general') as SectionId;

  const { data: workspaces = [] } = useQuery<Workspace[]>({
    queryKey: ['workspaces'],
    queryFn: () => api.get('/workspaces'),
  });

  const [selectedWsId, setSelectedWsId] = useState<string | null>(null);

  // Default to first workspace once loaded
  const resolvedWsId = selectedWsId ?? workspaces[0]?.id ?? null;

  function setSection(id: SectionId) {
    setSearchParams({ section: id }, { replace: true });
  }

  // Group sections for sidebar rendering
  const groups = Array.from(new Set(SECTIONS.map((s) => s.group)));

  const WORKSPACE_SECTIONS: SectionId[] = ['workspace', 'tags', 'emergency', 'api-keys'];
  const needsWorkspacePicker = WORKSPACE_SECTIONS.includes(activeSection);

  return (
    <div className="flex h-full">
      {/* ── Left nav ── */}
      <aside
        className="w-52 shrink-0 flex flex-col border-r overflow-y-auto"
        style={{ borderColor: 'var(--border)', background: 'var(--card)' }}
      >
        <div className="px-4 py-4 border-b" style={{ borderColor: 'var(--border)' }}>
          <h2 className="text-sm font-semibold text-[var(--text)]">Settings</h2>
        </div>

        <nav className="flex-1 px-2 py-3">
          {groups.map((group) => (
            <div key={group} className="mb-4">
              <p className="px-3 mb-1 text-[10px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">
                {group}
              </p>
              {SECTIONS.filter((s) => s.group === group).map(({ id, label, icon: Icon }) => (
                <button
                  key={id}
                  onClick={() => setSection(id)}
                  className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition-colors text-left ${
                    activeSection === id
                      ? 'bg-[var(--blue)] text-white font-medium'
                      : 'text-[var(--text-muted)] hover:text-[var(--text)] hover:bg-[var(--surface)]'
                  }`}
                >
                  <Icon size={14} className="shrink-0" />
                  {label}
                </button>
              ))}
            </div>
          ))}
        </nav>
      </aside>

      {/* ── Right content ── */}
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-2xl px-8 py-8">
          {/* Section title */}
          <h1 className="text-xl font-bold text-[var(--text)] mb-6">
            {SECTION_LABELS[activeSection]}
          </h1>

          {/* Workspace picker for workspace-specific sections */}
          {needsWorkspacePicker && workspaces.length > 0 && (
            <WorkspacePicker
              workspaces={workspaces}
              value={resolvedWsId}
              onChange={(id) => setSelectedWsId(id)}
            />
          )}

          {activeSection === 'general'       && <GeneralSection />}
          {activeSection === 'security'      && <SecuritySection />}
          {activeSection === 'organization'  && <OrganizationSection />}
          {activeSection === 'workspace'     && <WorkspaceSection selectedWsId={resolvedWsId} />}
          {activeSection === 'tags'          && <TagsSection selectedWsId={resolvedWsId} />}
          {activeSection === 'emergency'     && <EmergencySection workspaces={workspaces} selectedWsId={resolvedWsId} />}
          {activeSection === 'audit'         && <AuditSection />}
          {activeSection === 'api-keys'      && <ApiKeysSection selectedWsId={resolvedWsId} />}
          {activeSection === 'notifications' && <NotificationsSection />}
        </div>
      </div>
    </div>
  );
}
