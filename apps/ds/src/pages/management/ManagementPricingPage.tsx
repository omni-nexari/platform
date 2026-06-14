import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { toast } from 'sonner';
import { DollarSign, Info, Plus, Trash2 } from 'lucide-react';
import { saApi } from '../../lib/superadmin-auth.js';
import {
  Badge,
  EmptyState,
  Modal,
  ModalBody,
  ModalFooter,
  ModalHeader,
  ModalPrimaryButton,
  ModalSecondaryButton,
  PageHeader,
  SectionCard,
  SectionCardBody,
  SectionCardHeader,
  Skeleton,
} from '../../components/UiPrimitives.js';

// ─── Types ────────────────────────────────────────────────────────────────────

interface McPricing {
  planId: string;
  planKey: string;
  planName: string;
  currency: string;
  wholesaleAmountCents: number;
  retailAmountCents: number;
  screensIncluded: number;
  billingPeriod: 'monthly' | 'annual';
  module: string;
}

interface ManagedOrg {
  id: string;
  name: string;
  slug: string;
}

interface OrgOverride {
  id: string;
  orgId: string;
  planId: string;
  currency: string;
  overrideCents: number;
  reason: string | null;
  expiresAt: string | null;
  createdAt: string;
}

// ─── Schemas ──────────────────────────────────────────────────────────────────

const CURRENCIES = ['CAD', 'USD', 'GBP', 'EUR', 'AUD'] as const;

const OrgOverrideSchema = z.object({
  planId: z.string().uuid('Select a plan'),
  currency: z.enum(CURRENCIES),
  overrideCents: z.coerce.number().int().min(0, 'Must be 0 or more'),
  reason: z.string().optional(),
});
type OrgOverrideFormData = z.infer<typeof OrgOverrideSchema>;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatCents(cents: number, currency: string) {
  return new Intl.NumberFormat('en-CA', { style: 'currency', currency }).format(cents / 100);
}

const PERIOD_LABELS: Record<string, string> = {
  monthly: 'Monthly',
  annual: 'Annual',
};

const MODULE_LABELS: Record<string, string> = {
  signage: 'CMS',
  pos: 'POS',
  both: 'CMS + POS',
};

// ─── Client Pricing Tab ───────────────────────────────────────────────────────

function ClientPricingTab({ wholesalePlans }: { wholesalePlans: McPricing[] }) {
  const qc = useQueryClient();
  const [selectedOrgId, setSelectedOrgId] = useState<string | null>(null);
  const [showAddForm, setShowAddForm] = useState(false);

  const { data: orgs = [], isLoading: loadingOrgs } = useQuery<ManagedOrg[]>({
    queryKey: ['managed-orgs'],
    queryFn: () => saApi.get<Array<ManagedOrg & Record<string, unknown>>>('/superadmin/orgs'),
    select: (data) => data.map((o) => ({ id: o.id, name: o.name, slug: o.slug })),
  });

  const { data: overrides = [], isLoading: loadingOverrides } = useQuery<OrgOverride[]>({
    queryKey: ['org-overrides', selectedOrgId],
    queryFn: () => saApi.get<OrgOverride[]>(`/pricing/orgs/${selectedOrgId}/overrides`),
    enabled: !!selectedOrgId,
  });

  const addOverride = useMutation({
    mutationFn: (data: OrgOverrideFormData) =>
      saApi.post(`/pricing/orgs/${selectedOrgId}/overrides`, data),
    onSuccess: () => {
      toast.success('Client price saved');
      setShowAddForm(false);
      void qc.invalidateQueries({ queryKey: ['org-overrides', selectedOrgId] });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const removeOverride = useMutation({
    mutationFn: (id: string) =>
      saApi.delete(`/pricing/orgs/${selectedOrgId}/overrides/${id}`),
    onSuccess: () => {
      toast.success('Override removed');
      void qc.invalidateQueries({ queryKey: ['org-overrides', selectedOrgId] });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const { register, handleSubmit, reset, formState: { errors } } = useForm<OrgOverrideFormData>({
    resolver: zodResolver(OrgOverrideSchema),
    defaultValues: { currency: 'CAD', overrideCents: 0, planId: '' },
  });

  if (loadingOrgs) return <Skeleton className="h-32" />;

  if (orgs.length === 0) {
    return (
      <EmptyState
        icon={<DollarSign size={28} />}
        title="No client organizations"
        description="You don't have any client organizations to configure pricing for."
      />
    );
  }

  const selectedOrg = orgs.find((o) => o.id === selectedOrgId);

  return (
    <div className="space-y-4">
      <div
        className="flex items-start gap-2 rounded-lg p-3 text-sm"
        style={{ background: 'var(--bg2)', border: '1px solid var(--border)' }}
      >
        <Info size={15} className="shrink-0 mt-0.5 text-[var(--text-muted)]" />
        <p className="text-[var(--text-muted)]">
          Set custom prices for each client organization. These override the standard retail rates they'd otherwise see.
          Your profit is the difference between what you charge them and your wholesale cost.
        </p>
      </div>

      <div>
        <label className="block text-xs font-medium mb-1.5 text-[var(--text-muted)]">Select Client Organization</label>
        <select
          value={selectedOrgId ?? ''}
          onChange={(e) => { setSelectedOrgId(e.target.value || null); setShowAddForm(false); reset(); }}
          className="input text-sm"
          style={{ maxWidth: 360 }}
        >
          <option value="">— Choose a client —</option>
          {orgs.map((o) => (
            <option key={o.id} value={o.id}>{o.name}</option>
          ))}
        </select>
      </div>

      {selectedOrgId && selectedOrg && (
        <SectionCard>
          <SectionCardHeader>
            <span className="text-sm font-semibold">Custom Prices for {selectedOrg.name}</span>
            <button
              onClick={() => setShowAddForm(true)}
              className="flex items-center gap-1 text-xs text-[var(--blue)] hover:underline"
            >
              <Plus size={12} /> Add Price
            </button>
          </SectionCardHeader>
          <SectionCardBody>
            {loadingOverrides ? (
              <Skeleton className="h-12" />
            ) : overrides.length === 0 ? (
              <p className="text-sm text-[var(--text-muted)]">
                No custom prices set — this client sees standard retail pricing.
              </p>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-xs text-[var(--text-muted)] border-b border-[var(--border)]">
                    <th className="text-left pb-2">Plan</th>
                    <th className="text-left pb-2">Currency</th>
                    <th className="text-right pb-2">Your Wholesale</th>
                    <th className="text-right pb-2">Client Price</th>
                    <th className="text-right pb-2">Your Margin</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {overrides.map((o) => {
                    const wsPlan = wholesalePlans.find(
                      (p) => p.planId === o.planId && p.currency === o.currency
                    );
                    const wholesaleCents = wsPlan?.wholesaleAmountCents ?? 0;
                    const margin = o.overrideCents - wholesaleCents;
                    return (
                      <tr key={o.id} className="border-b border-[var(--border)] last:border-0">
                        <td className="py-2.5">
                          {wsPlan?.planName ?? o.planId}
                          {wsPlan && (
                            <span className="ml-1.5 text-xs text-[var(--text-muted)]">
                              ({MODULE_LABELS[wsPlan.module] ?? wsPlan.module} · {PERIOD_LABELS[wsPlan.billingPeriod] ?? wsPlan.billingPeriod})
                            </span>
                          )}
                        </td>
                        <td className="py-2.5 font-mono">{o.currency}</td>
                        <td className="py-2.5 text-right text-[var(--text-muted)]">
                          {wholesaleCents > 0 ? formatCents(wholesaleCents, o.currency) : '—'}
                        </td>
                        <td className="py-2.5 text-right font-semibold">{formatCents(o.overrideCents, o.currency)}</td>
                        <td className="py-2.5 text-right">
                          {margin > 0 ? (
                            <Badge tone="success">+{formatCents(margin, o.currency)}</Badge>
                          ) : margin < 0 ? (
                            <Badge tone="danger">−{formatCents(Math.abs(margin), o.currency)}</Badge>
                          ) : (
                            <Badge tone="neutral">0</Badge>
                          )}
                        </td>
                        <td className="py-2.5">
                          <button
                            onClick={() => {
                              if (confirm('Remove this price override?')) removeOverride.mutate(o.id);
                            }}
                            className="text-[var(--text-muted)] hover:text-red-400 transition-colors"
                          >
                            <Trash2 size={13} />
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </SectionCardBody>
        </SectionCard>
      )}

      {showAddForm && selectedOrgId && (
        <Modal onClose={() => { setShowAddForm(false); reset(); }} size="sm">
          <ModalHeader title="Add Client Price" onClose={() => { setShowAddForm(false); reset(); }} />
          <form onSubmit={handleSubmit((data) => addOverride.mutate(data))}>
            <ModalBody>
              <div className="space-y-4">
                <div>
                  <label className="ui-label">Plan</label>
                  <select {...register('planId')} className="input text-sm w-full">
                    <option value="">— Select plan —</option>
                    {wholesalePlans.map((p) => (
                      <option key={`${p.planId}-${p.currency}`} value={p.planId}>
                        {p.planName} — {p.currency} (your cost: {formatCents(p.wholesaleAmountCents, p.currency)})
                      </option>
                    ))}
                  </select>
                  {errors.planId && <p className="text-xs text-red-400 mt-1">{errors.planId.message}</p>}
                </div>
                <div>
                  <label className="ui-label">Currency</label>
                  <select {...register('currency')} className="input text-sm w-full">
                    {CURRENCIES.map((c) => <option key={c} value={c}>{c}</option>)}
                  </select>
                </div>
                <div>
                  <label className="ui-label">Client Price (cents)</label>
                  <input {...register('overrideCents')} type="number" min={0} className="input text-sm w-full" />
                  <p className="text-xs text-[var(--text-muted)] mt-1">e.g. 2500 = $25.00</p>
                  {errors.overrideCents && <p className="text-xs text-red-400 mt-1">{errors.overrideCents.message}</p>}
                </div>
                <div>
                  <label className="ui-label">Reason (optional)</label>
                  <input {...register('reason')} type="text" className="input text-sm w-full" placeholder="e.g. Custom agreement" />
                </div>
              </div>
            </ModalBody>
            <ModalFooter>
              <ModalSecondaryButton onClick={() => { setShowAddForm(false); reset(); }}>Cancel</ModalSecondaryButton>
              <ModalPrimaryButton type="submit" disabled={addOverride.isPending}>
                {addOverride.isPending ? 'Saving…' : 'Save Price'}
              </ModalPrimaryButton>
            </ModalFooter>
          </form>
        </Modal>
      )}
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function ManagementPricingPage() {
  const [tab, setTab] = useState<'wholesale' | 'client'>('wholesale');

  const { data: pricing = [], isLoading, isError } = useQuery<McPricing[]>({
    queryKey: ['my-mc-pricing'],
    queryFn: () => saApi.get('/pricing/my-mc/pricing'),
  });

  const byCurrency = pricing.reduce<Record<string, McPricing[]>>((acc, row) => {
    (acc[row.currency] ??= []).push(row);
    return acc;
  }, {});

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <PageHeader
        icon={<DollarSign size={20} />}
        title="Pricing"
        description="Manage wholesale rates and set custom prices for your clients."
      />

      {/* Tabs */}
      <div className="flex gap-1 mb-6 border-b border-[var(--border)]">
        {(['wholesale', 'client'] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className="px-4 py-2 text-sm font-medium transition-colors border-b-2 -mb-px"
            style={{
              borderColor: tab === t ? 'var(--accent)' : 'transparent',
              color: tab === t ? 'var(--accent)' : 'var(--text-muted)',
            }}
          >
            {t === 'wholesale' ? 'Wholesale Rates' : 'Client Pricing'}
          </button>
        ))}
      </div>

      {tab === 'wholesale' && (
        <>
          <div
            className="flex items-start gap-2 rounded-lg p-3 mb-6 text-sm"
            style={{ background: 'var(--bg2)', border: '1px solid var(--border)' }}
          >
            <Info size={15} className="shrink-0 mt-0.5 text-[var(--text-muted)]" />
            <p className="text-[var(--text-muted)]">
              These are the wholesale rates negotiated for your account. Retail prices shown are the standard rates
              your client organizations see. The difference is your margin.
            </p>
          </div>

          {isLoading && (
            <div className="space-y-3">
              {[1, 2, 3].map((i) => <Skeleton key={i} className="h-16" />)}
            </div>
          )}

          {isError && (
            <EmptyState
              icon={<DollarSign size={28} />}
              title="Unable to load pricing"
              description="Please try again or contact platform support."
            />
          )}

          {!isLoading && !isError && pricing.length === 0 && (
            <EmptyState
              icon={<DollarSign size={28} />}
              title="No pricing configured"
              description="No wholesale pricing has been configured for your account yet. Contact platform support."
            />
          )}

          {!isLoading && !isError && Object.entries(byCurrency).map(([currency, rows]) => (
            <SectionCard key={currency} className="mb-4">
              <SectionCardHeader>
                <div className="flex items-center gap-2">
                  <span className="text-sm font-semibold font-mono">{currency}</span>
                  <Badge tone="neutral">{rows.length} plan{rows.length !== 1 ? 's' : ''}</Badge>
                </div>
              </SectionCardHeader>
              <SectionCardBody>
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-xs text-[var(--text-muted)] border-b border-[var(--border)]">
                      <th className="text-left pb-2">Plan</th>
                      <th className="text-left pb-2">Module</th>
                      <th className="text-left pb-2">Period</th>
                      <th className="text-left pb-2">Screens</th>
                      <th className="text-right pb-2">Retail</th>
                      <th className="text-right pb-2">Your Wholesale</th>
                      <th className="text-right pb-2">Margin</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row) => {
                      const margin = row.retailAmountCents - row.wholesaleAmountCents;
                      const marginPct =
                        row.retailAmountCents > 0
                          ? Math.round((margin / row.retailAmountCents) * 100)
                          : 0;
                      return (
                        <tr key={`${row.planId}-${row.currency}`} className="border-b border-[var(--border)] last:border-0">
                          <td className="py-2.5 font-medium">
                            {row.planName}
                            <span className="ml-1.5 font-mono text-xs text-[var(--text-muted)]">{row.planKey}</span>
                          </td>
                          <td className="py-2.5">
                            <Badge tone="neutral">{MODULE_LABELS[row.module] ?? row.module}</Badge>
                          </td>
                          <td className="py-2.5">{PERIOD_LABELS[row.billingPeriod] ?? row.billingPeriod}</td>
                          <td className="py-2.5">{row.screensIncluded}</td>
                          <td className="py-2.5 text-right text-[var(--text-muted)]">
                            {formatCents(row.retailAmountCents, currency)}
                          </td>
                          <td className="py-2.5 text-right font-semibold">
                            {formatCents(row.wholesaleAmountCents, currency)}
                          </td>
                          <td className="py-2.5 text-right">
                            {margin > 0 ? (
                              <Badge tone="success">{formatCents(margin, currency)} ({marginPct}%)</Badge>
                            ) : margin < 0 ? (
                              <Badge tone="danger">−{formatCents(Math.abs(margin), currency)}</Badge>
                            ) : (
                              <Badge tone="neutral">0%</Badge>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </SectionCardBody>
            </SectionCard>
          ))}
        </>
      )}

      {tab === 'client' && (
        <ClientPricingTab wholesalePlans={pricing} />
      )}
    </div>
  );
}
