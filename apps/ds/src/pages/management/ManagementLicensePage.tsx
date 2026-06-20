import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import {
  KeyRound, Eye, EyeOff, RefreshCw, CheckCircle2, AlertCircle,
  Clock, XCircle, Monitor, ShoppingCart, Pencil, ChevronUp, ChevronDown,
} from 'lucide-react';
import { saApi } from '../../lib/superadmin-auth.js';
import {
  Badge,
  PageHeader,
  SectionCard,
  SectionCardBody,
  SectionCardHeader,
  Skeleton,
} from '../../components/UiPrimitives.js';

// â”€â”€â”€ Types â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

interface LicenseConfigData {
  configured: boolean;
  licenseKey?: string | null;
  hmacSecretSet?: boolean;
  licenseServerUrl?: string | null;
  isEnabled?: boolean;
  licenseMode?: string | null;
  certExpiresAt?: string | null;
  signedCertSet?: boolean;
  lastStatus?: string | null;
  lastCheckedAt?: string | null;
  lastError?: string | null;
}

interface OrgAllocation {
  orgId: string;
  orgName: string;
  orgSlug: string;
  maxSignageScreens: number | null;
  maxPosScreens: number | null;
  enabledModules: string[] | null;
  notes: string | null;
  currentSignageScreens: number;
  currentPosScreens: number;
}

interface AllocationsData {
  orgs: OrgAllocation[];
}

interface LicenseFormValues {
  licenseKey: string;
  hmacSecret: string;
}

interface AllocFormValues {
  maxSignageScreens: string;   // empty = unlimited
  maxPosScreens: string;
  enabledModules: string[];    // '' = all
  notes: string;
}

// â”€â”€â”€ Helpers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

function statusTone(s?: string | null): 'success' | 'warning' | 'danger' | 'neutral' {
  if (s === 'ok') return 'success';
  if (s === 'grace' || s === 'overlimit') return 'warning';
  if (s === 'suspended' || s === 'revoked') return 'danger';
  return 'neutral';
}

function StatusIcon({ status }: { status?: string | null | undefined }) {
  if (status === 'ok') return <CheckCircle2 className="h-4 w-4 text-green-500" />;
  if (status === 'grace' || status === 'overlimit') return <AlertCircle className="h-4 w-4 text-yellow-500" />;
  if (status === 'suspended' || status === 'revoked') return <XCircle className="h-4 w-4 text-red-500" />;
  return <Clock className="h-4 w-4 text-[var(--text-muted)]" />;
}

function relativeTime(iso?: string | null): string {
  if (!iso) return 'never';
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

function screenBar(used: number, max: number | null) {
  if (max === null) return null;
  const pct = Math.min(100, max === 0 ? 100 : (used / max) * 100);
  const tone = pct >= 100 ? 'var(--danger)' : pct >= 80 ? 'var(--warning, #f59e0b)' : 'var(--blue)';
  return (
    <div className="mt-1 h-1.5 w-full rounded-full overflow-hidden" style={{ background: 'var(--card-border)' }}>
      <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, background: tone }} />
    </div>
  );
}

// â”€â”€â”€ Allocation edit row â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

function OrgAllocationRow({ org }: { org: OrgAllocation }) {
  const qc = useQueryClient();
  const [editing, setEditing] = useState(false);

  const { register, handleSubmit, reset } = useForm<AllocFormValues>({
    defaultValues: {
      maxSignageScreens: org.maxSignageScreens?.toString() ?? '',
      maxPosScreens:     org.maxPosScreens?.toString()     ?? '',
      enabledModules:    org.enabledModules ?? [],
      notes:             org.notes ?? '',
    },
  });

  const save = useMutation({
    mutationFn: (vals: AllocFormValues) => {
      const mods = vals.enabledModules.length > 0 ? vals.enabledModules : null;
      return saApi.put(`/superadmin/license-allocations/${org.orgId}`, {
        maxSignageScreens: vals.maxSignageScreens ? parseInt(vals.maxSignageScreens, 10) : null,
        maxPosScreens:     vals.maxPosScreens     ? parseInt(vals.maxPosScreens, 10)     : null,
        enabledModules:    mods,
        notes:             vals.notes || null,
      });
    },
    onSuccess: () => {
      toast.success(`Allocation saved for ${org.orgName}`);
      void qc.invalidateQueries({ queryKey: ['license-allocations'] });
      setEditing(false);
    },
    onError: () => toast.error('Failed to save allocation'),
  });

  return (
    <>
      <tr>
        <td>
          <div className="font-medium">{org.orgName}</div>
          <div className="text-xs text-[var(--text-muted)] font-mono">{org.orgSlug}</div>
        </td>
        <td>
          <div className="flex items-center gap-1.5">
            <Monitor className="h-3.5 w-3.5 text-[var(--text-muted)]" />
            <span className="tabular-nums">
              {org.currentSignageScreens}
              {org.maxSignageScreens !== null && <span className="text-[var(--text-muted)]"> / {org.maxSignageScreens}</span>}
            </span>
          </div>
          {screenBar(org.currentSignageScreens, org.maxSignageScreens)}
        </td>
        <td>
          <div className="flex items-center gap-1.5">
            <ShoppingCart className="h-3.5 w-3.5 text-[var(--text-muted)]" />
            <span className="tabular-nums">
              {org.currentPosScreens}
              {org.maxPosScreens !== null && <span className="text-[var(--text-muted)]"> / {org.maxPosScreens}</span>}
            </span>
          </div>
          {screenBar(org.currentPosScreens, org.maxPosScreens)}
        </td>
        <td>
          {org.enabledModules
            ? org.enabledModules.map((m) => <Badge key={m} tone="neutral" className="capitalize mr-1">{m}</Badge>)
            : <span className="text-xs text-[var(--text-muted)]">All</span>}
        </td>
        <td className="text-right">
          <button
            type="button"
            onClick={() => { reset({ maxSignageScreens: org.maxSignageScreens?.toString() ?? '', maxPosScreens: org.maxPosScreens?.toString() ?? '', enabledModules: org.enabledModules ?? [], notes: org.notes ?? '' }); setEditing((v) => !v); }}
            className="ui-inline-action-btn"
          >
            {editing ? <ChevronUp className="h-3.5 w-3.5" /> : <Pencil className="h-3.5 w-3.5" />}
            {editing ? 'Close' : 'Edit'}
          </button>
        </td>
      </tr>
      {editing && (
        <tr>
          <td colSpan={5} className="bg-[var(--bg2)] p-4">
            <form onSubmit={handleSubmit((v) => save.mutate(v))} className="grid grid-cols-2 gap-4 sm:grid-cols-4 items-end">
              <div className="space-y-1">
                <label className="ui-label text-xs">Max Signage Screens</label>
                <input className="ui-input w-full" placeholder="Unlimited" {...register('maxSignageScreens')} />
              </div>
              <div className="space-y-1">
                <label className="ui-label text-xs">Max POS Screens</label>
                <input className="ui-input w-full" placeholder="Unlimited" {...register('maxPosScreens')} />
              </div>
              <div className="space-y-1">
                <label className="ui-label text-xs">Enabled Modules</label>
                <select className="ui-input w-full" multiple {...register('enabledModules')}>
                  <option value="signage">Signage (CMS)</option>
                  <option value="pos">POS</option>
                </select>
                <p className="text-xs text-[var(--text-muted)]">Ctrl+click for multi; none = all</p>
              </div>
              <div className="space-y-1">
                <label className="ui-label text-xs">Notes</label>
                <input className="ui-input w-full" placeholder="Optional notes" {...register('notes')} />
              </div>
              <div className="col-span-2 sm:col-span-4 flex gap-2 pt-1">
                <button type="submit" className="btn-primary text-sm" disabled={save.isPending}>
                  {save.isPending ? 'Saving...' : 'Save'}
                </button>
                <button type="button" className="workspace-page-action text-sm" onClick={() => setEditing(false)}>
                  Cancel
                </button>
              </div>
            </form>
          </td>
        </tr>
      )}
    </>
  );
}

// â”€â”€â”€ Page â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export default function ManagementLicensePage() {
  const qc = useQueryClient();
  const [tab, setTab] = useState<'platform' | 'clients'>('platform');
  const [showSecret, setShowSecret] = useState(false);
  const [testing, setTesting] = useState(false);
  const [certText, setCertText] = useState('');
  const [certMode, setCertMode] = useState<'offline' | 'both'>('offline');
  const [uploadingCert, setUploadingCert] = useState(false);

  const { data: config, isLoading: configLoading } = useQuery<LicenseConfigData>({
    queryKey: ['license-config'],
    queryFn: () => saApi.get<LicenseConfigData>('/superadmin/license-config'),
  });

  const { data: allocData, isLoading: allocLoading } = useQuery<AllocationsData>({
    queryKey: ['license-allocations'],
    queryFn: () => saApi.get<AllocationsData>('/superadmin/license-allocations'),
    enabled: tab === 'clients',
  });

  const { register, handleSubmit, formState: { isDirty, isSubmitting } } = useForm<LicenseFormValues>({
    values: {
      licenseKey: config?.licenseKey ?? '',
      hmacSecret: '',
    },
  });

  const saveLicense = useMutation({
    mutationFn: (vals: LicenseFormValues) => saApi.put('/superadmin/license-config', {
      ...(vals.licenseKey  ? { licenseKey:  vals.licenseKey }  : {}),
      ...(vals.hmacSecret  ? { hmacSecret:  vals.hmacSecret }  : {}),
      licenseServerUrl: 'https://admin.nexari.ca',
      isEnabled: true,
    }),
    onSuccess: () => {
      toast.success('License configuration saved');
      void qc.invalidateQueries({ queryKey: ['license-config'] });
    },
    onError: () => toast.error('Failed to save license configuration'),
  });

  const testConnection = async () => {
    setTesting(true);
    try {
      await saApi.post('/superadmin/license-config/test');
      toast.success('Heartbeat triggered - refreshing status...');
      setTimeout(() => void qc.invalidateQueries({ queryKey: ['license-config'] }), 3000);
    } catch {
      toast.error('Failed to trigger heartbeat');
    } finally {
      setTesting(false);
    }
  };

  const totalAlloc = allocData?.orgs ?? [];
  const totalSignage = totalAlloc.reduce((s, o) => s + o.currentSignageScreens, 0);
  const totalPos = totalAlloc.reduce((s, o) => s + o.currentPosScreens, 0);

  return (
    <div className="space-y-6 p-6">
      <PageHeader
        icon={<KeyRound className="h-5 w-5" />}
        title="License"
        description="Manage your Nexari platform license and allocate capacity to client organizations."
      />

      {/* Tab bar */}
      <div className="flex gap-1 border-b" style={{ borderColor: 'var(--card-border)' }}>
        {(['platform', 'clients'] as const).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
              tab === t
                ? 'border-[var(--blue)] text-[var(--blue)]'
                : 'border-transparent text-[var(--text-muted)] hover:text-[var(--text)]'
            }`}
          >
            {t === 'platform' ? 'Platform License' : 'Client Organizations'}
          </button>
        ))}
      </div>

      {/* â”€â”€ Tab: Platform License â”€â”€ */}
      {tab === 'platform' && (
        <>
          {/* Status */}
          <SectionCard>
            <SectionCardHeader>Current Status</SectionCardHeader>
            <SectionCardBody>
              {configLoading ? (
                <Skeleton className="h-16 w-full" />
              ) : !config?.configured ? (
                <p className="text-sm text-[var(--text-muted)]">No license configured yet. Enter your credentials below.</p>
              ) : (
                <div className="flex flex-wrap items-start gap-6">
                  <div className="flex items-center gap-2">
                    <StatusIcon status={config.lastStatus ?? undefined} />
                    <Badge tone={statusTone(config.lastStatus ?? undefined)}>
                      {config.lastStatus ?? 'unchecked'}
                    </Badge>
                  </div>
                  <div className="text-sm text-[var(--text-muted)]">
                    <span className="font-medium text-[var(--text-default)]">Last checked: </span>
                    {relativeTime(config.lastCheckedAt)}
                  </div>
                  {config.lastError && (
                    <div className="text-sm text-red-500 max-w-md">
                      <span className="font-medium">Error: </span>{config.lastError}
                    </div>
                  )}
                  <button type="button" onClick={() => void testConnection()} disabled={testing}
                    className="btn-ghost text-sm flex items-center gap-1.5">
                    <RefreshCw className={`h-3.5 w-3.5 ${testing ? 'animate-spin' : ''}`} />
                    Test connection
                  </button>
                </div>
              )}
            </SectionCardBody>
          </SectionCard>

          {/* Credentials form */}
          <SectionCard>
            <SectionCardHeader>Credentials</SectionCardHeader>
            <SectionCardBody>
              {configLoading ? (
                <div className="space-y-3">
                  <Skeleton className="h-10 w-full" /><Skeleton className="h-10 w-full" /><Skeleton className="h-10 w-full" />
                </div>
              ) : (
                <form onSubmit={handleSubmit((v) => saveLicense.mutate(v))} className="space-y-5 max-w-lg">
                  <div className="space-y-1.5">
                    <label className="ui-label" htmlFor="licenseKey">License Key</label>
                    <input id="licenseKey" className="ui-input w-full font-mono"
                      placeholder="NXR-XXXX-XXXX-XXXX-XXXX" {...register('licenseKey')} />
                  </div>
                  <div className="space-y-1.5">
                    <label className="ui-label" htmlFor="hmacSecret">
                      HMAC Secret
                      {config?.hmacSecretSet && (
                        <span className="ml-2 text-xs text-[var(--text-muted)] font-normal">
                          (set - enter new value to rotate)
                        </span>
                      )}
                    </label>
                    <div className="relative">
                      <input id="hmacSecret" type={showSecret ? 'text' : 'password'}
                        className="ui-input w-full pr-10 font-mono"
                        placeholder={config?.hmacSecretSet ? '****************' : 'Enter HMAC secret'}
                        {...register('hmacSecret')} />
                      <button type="button" onClick={() => setShowSecret((v) => !v)}
                        className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[var(--text-muted)] hover:text-[var(--text-default)]"
                        aria-label={showSecret ? 'Hide' : 'Show'}>
                        {showSecret ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                      </button>
                    </div>
                  </div>
                  <p className="text-xs text-[var(--text-muted)]">License server: <span className="font-mono">https://admin.nexari.ca</span></p>
                  <button type="submit" className="btn-primary" disabled={isSubmitting || !isDirty}>
                    {isSubmitting ? 'Saving...' : 'Save'}
                  </button>
                </form>
              )}
            </SectionCardBody>
          </SectionCard>

          {/* Offline Certificate */}
          <SectionCard>
            <SectionCardHeader>Offline License Certificate</SectionCardHeader>
            <SectionCardBody>
              {configLoading ? (
                <Skeleton className="h-16 w-full" />
              ) : (
                <div className="space-y-4 max-w-lg">
                  {config?.signedCertSet && (
                    <div className="rounded-lg border p-3 text-sm space-y-1" style={{ background: 'var(--card)', borderColor: 'var(--card-border)' }}>
                      <div className="flex items-center gap-2">
                        <CheckCircle2 className="h-4 w-4 text-green-500" />
                        <span className="font-medium">Offline cert installed</span>
                      </div>
                      {config.certExpiresAt && (
                        <p className="text-xs text-[var(--text-muted)]">
                          Expires: <strong>{new Date(config.certExpiresAt).toLocaleDateString()}</strong>
                          {' '}({relativeTime(config.certExpiresAt)})
                        </p>
                      )}
                      <p className="text-xs text-[var(--text-muted)]">
                        Mode: <strong className="capitalize">{config.licenseMode ?? 'online'}</strong>
                        {config.licenseMode === 'offline' && ' — heartbeat disabled, fully air-gapped'}
                        {config.licenseMode === 'both' && ' — cert for enforcement + heartbeat for billing analytics'}
                      </p>
                    </div>
                  )}

                  <div className="space-y-1.5">
                    <label className="ui-label">Paste .lic certificate content</label>
                    <textarea
                      className="ui-input w-full font-mono text-xs"
                      rows={5}
                      placeholder="Paste the contents of the .lic file here…"
                      value={certText}
                      onChange={(e) => setCertText(e.target.value)}
                    />
                    <p className="text-xs text-[var(--text-muted)]">
                      Or upload the .lic file directly:{' '}
                      <label className="cursor-pointer text-[var(--blue)] hover:underline">
                        browse
                        <input
                          type="file"
                          accept=".lic"
                          className="hidden"
                          onChange={(e) => {
                            const file = e.target.files?.[0];
                            if (!file) return;
                            file.text().then(setCertText).catch(() => undefined);
                          }}
                        />
                      </label>
                    </p>
                  </div>

                  <div className="space-y-1.5">
                    <label className="ui-label">License mode after upload</label>
                    <div className="flex gap-2">
                      {(['offline', 'both'] as const).map((m) => (
                        <button
                          key={m}
                          type="button"
                          onClick={() => setCertMode(m)}
                          className={`rounded-lg border px-3 py-1.5 text-xs transition-colors ${
                            certMode === m
                              ? 'border-[var(--blue)] bg-[var(--blue)]/10 text-[var(--blue)]'
                              : 'text-[var(--text-muted)] hover:text-[var(--text-default)]'
                          }`}
                          style={{ borderColor: certMode === m ? 'var(--blue)' : 'var(--card-border)' }}
                        >
                          {m === 'offline' ? 'Offline only (air-gapped)' : 'Offline cert + heartbeat'}
                        </button>
                      ))}
                    </div>
                  </div>

                  <button
                    type="button"
                    disabled={!certText.trim() || uploadingCert}
                    onClick={async () => {
                      setUploadingCert(true);
                      try {
                        await saApi.post('/superadmin/license-config/upload-cert', {
                          cert: certText.trim(),
                          mode: certMode,
                        });
                        toast.success('Offline certificate installed — license enforced locally');
                        setCertText('');
                        void qc.invalidateQueries({ queryKey: ['license-config'] });
                      } catch (err) {
                        toast.error(err instanceof Error ? err.message : 'Failed to upload certificate');
                      } finally {
                        setUploadingCert(false);
                      }
                    }}
                    className="btn-primary disabled:opacity-50"
                  >
                    {uploadingCert ? 'Verifying & installing…' : 'Install offline certificate'}
                  </button>

                  <p className="text-xs text-[var(--text-muted)]">
                    The certificate signature is verified locally against the Nexari public key
                    before being stored. A tampered or expired cert will be rejected.
                  </p>
                </div>
              )}
            </SectionCardBody>
          </SectionCard>
        </>
      )}

      {/* ── Tab: Client Allocations ── */}
      {tab === 'clients' && (
        <>
          {/* Summary row */}
          {!allocLoading && totalAlloc.length > 0 && (
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
              {[
                { label: 'Client Orgs', value: totalAlloc.length },
                { label: 'Signage Screens (total)', value: totalSignage },
                { label: 'POS Screens (total)', value: totalPos },
                { label: 'Total Active', value: totalSignage + totalPos },
              ].map(({ label, value }) => (
                <div key={label} className="rounded-xl border p-4" style={{ background: 'var(--card)', borderColor: 'var(--card-border)' }}>
                  <p className="text-xs text-[var(--text-muted)] mb-1">{label}</p>
                  <p className="text-2xl font-bold tabular-nums">{value}</p>
                </div>
              ))}
            </div>
          )}

          <SectionCard>
            <SectionCardHeader>Per-Client Screen Limits</SectionCardHeader>
            <SectionCardBody className="p-0">
              {allocLoading ? (
                <div className="p-4 space-y-2">
                  {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-12" />)}
                </div>
              ) : totalAlloc.length === 0 ? (
                <div className="p-8 text-center text-sm text-[var(--text-muted)]">
                  No client organizations found.
                  <br />
                  <span className="text-xs">Create an organization from the Organizations page to get started.</span>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="ui-data-table">
                    <thead>
                      <tr>
                        <th>Organization</th>
                        <th>
                          <span className="flex items-center gap-1"><Monitor className="h-3.5 w-3.5" /> Signage</span>
                        </th>
                        <th>
                          <span className="flex items-center gap-1"><ShoppingCart className="h-3.5 w-3.5" /> POS</span>
                        </th>
                        <th>Modules</th>
                        <th></th>
                      </tr>
                    </thead>
                    <tbody>
                      {totalAlloc.map((org) => (
                        <OrgAllocationRow key={org.orgId} org={org} />
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </SectionCardBody>
          </SectionCard>

          <p className="text-xs text-[var(--text-muted)]">
            Limits are advisory — set max screens to control capacity per client.
            Leave blank for unlimited. Module overrides restrict which Nexari features each org can access.
          </p>
        </>
      )}
    </div>
  );
}

