import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { toast } from 'sonner';
import { z } from 'zod';
import { Plus, Pencil, Trash2, DollarSign, ChevronDown, ChevronUp, Building2 } from 'lucide-react';
import { saApi } from '../../lib/superadmin-auth.js';
import {
  Badge,
  InlineActionButton,
  Modal,
  ModalBody,
  ModalFooter,
  ModalHeader,
  ModalPrimaryButton,
  ModalSecondaryButton,
  PageHeader,
  Skeleton,
  SectionCard,
  SectionCardHeader,
  SectionCardBody,
  EmptyState,
} from '../../components/UiPrimitives.js';

// ─── Types ────────────────────────────────────────────────────────────────────

interface PricingPlan {
  id: string;
  planKey: string;
  name: string;
  module: string;
  screensIncluded: number;
  billingPeriod: 'monthly' | 'annual';
  description: string | null;
  isActive: boolean;
  isPublic: boolean;
  sortOrder: number;
  createdAt: string;
}

interface PlanPrice {
  id: string;
  planId: string;
  currency: string;
  amountCents: number;
  extraScreenCents: number;
  stripePriceId: string | null;
  isActive: boolean;
}

interface OrgSub {
  orgId: string;
  orgName: string;
  orgSlug: string;
  planId: string | null;
  planKey: string | null;
  planName: string | null;
  currency: string | null;
  status: string;
  billingModel: string;
  trialEndsAt: string | null;
  trialScreenLimit: number | null;
  cancelAtPeriodEnd: boolean;
  currentPeriodEnd: string | null;
}

// ─── Schemas ──────────────────────────────────────────────────────────────────

const PlanSchema = z.object({
  planKey: z.string().min(2).max(60).regex(/^[a-z0-9_-]+$/, 'Lowercase letters, numbers, _ or -'),
  name: z.string().min(2).max(100),
  module: z.enum(['signage', 'pos', 'both']),
  screensIncluded: z.coerce.number().int().min(0),
  billingPeriod: z.enum(['monthly', 'annual']),
  description: z.string().max(500).optional(),
  isActive: z.boolean().optional().default(true),
  isPublic: z.boolean().optional().default(true),
  sortOrder: z.coerce.number().int().min(0).optional().default(0),
});
type PlanFormData = z.infer<typeof PlanSchema>;

const PriceSchema = z.object({
  currency: z.enum(['CAD', 'USD', 'GBP', 'EUR', 'AUD']),
  amountCents: z.coerce.number().int().min(0),
  extraScreenCents: z.coerce.number().int().min(0).optional().default(0),
  stripePriceId: z.string().optional(),
  isActive: z.boolean().optional().default(true),
});
type PriceFormData = z.infer<typeof PriceSchema>;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatCents(cents: number, currency: string) {
  return new Intl.NumberFormat('en-CA', { style: 'currency', currency }).format(cents / 100);
}

function formatDate(iso: string | null) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-CA', { year: 'numeric', month: 'short', day: 'numeric' });
}

const STATUS_TONES: Record<string, 'success' | 'warning' | 'danger' | 'neutral' | 'accent'> = {
  active: 'success',
  trialing: 'accent',
  past_due: 'warning',
  canceled: 'danger',
  unpaid: 'danger',
  paused: 'neutral',
};

const PERIOD_LABELS: Record<string, string> = {
  monthly: 'Monthly',
  annual: 'Annual',
};

const MODULE_LABELS: Record<string, string> = {
  signage: 'CMS',
  pos: 'POS',
  both: 'CMS + POS',
};

// ─── Tab components ───────────────────────────────────────────────────────────

// ── Plans tab ─────────────────────────────────────────────────────────────────

function PlansTab() {
  const qc = useQueryClient();
  const [expandedPlanId, setExpandedPlanId] = useState<string | null>(null);
  const [showCreatePlan, setShowCreatePlan] = useState(false);
  const [editingPlan, setEditingPlan] = useState<PricingPlan | null>(null);
  const [showCreatePrice, setShowCreatePrice] = useState<string | null>(null); // planId
  const [editingPrice, setEditingPrice] = useState<{ planId: string; price: PlanPrice } | null>(null);

  const { data: plans = [], isLoading } = useQuery<PricingPlan[]>({
    queryKey: ['pricing-plans'],
    queryFn: () => saApi.get('/pricing/plans'),
  });

  const pricesQueries = useQuery<Record<string, PlanPrice[]>>({
    queryKey: ['pricing-plan-prices', expandedPlanId],
    queryFn: async () => {
      if (!expandedPlanId) return {};
      const prices = await saApi.get<PlanPrice[]>(`/pricing/plans/${expandedPlanId}/prices`);
      return { [expandedPlanId]: prices };
    },
    enabled: !!expandedPlanId,
  });

  const createPlan = useMutation({
    mutationFn: (data: PlanFormData) => saApi.post<PricingPlan>('/pricing/plans', data),
    onSuccess: () => {
      toast.success('Plan created');
      setShowCreatePlan(false);
      void qc.invalidateQueries({ queryKey: ['pricing-plans'] });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const updatePlan = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<PlanFormData> }) =>
      saApi.patch<PricingPlan>(`/pricing/plans/${id}`, data),
    onSuccess: () => {
      toast.success('Plan updated');
      setEditingPlan(null);
      void qc.invalidateQueries({ queryKey: ['pricing-plans'] });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const deletePlan = useMutation({
    mutationFn: (id: string) => saApi.delete(`/pricing/plans/${id}`),
    onSuccess: () => {
      toast.success('Plan deleted');
      void qc.invalidateQueries({ queryKey: ['pricing-plans'] });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const createPrice = useMutation({
    mutationFn: ({ planId, data }: { planId: string; data: PriceFormData }) =>
      saApi.post<PlanPrice>(`/pricing/plans/${planId}/prices`, data),
    onSuccess: (_r, vars) => {
      toast.success('Price added');
      setShowCreatePrice(null);
      void qc.invalidateQueries({ queryKey: ['pricing-plan-prices', vars.planId] });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const updatePrice = useMutation({
    mutationFn: ({ planId, priceId, data }: { planId: string; priceId: string; data: Partial<PriceFormData> }) =>
      saApi.patch<PlanPrice>(`/pricing/plans/${planId}/prices/${priceId}`, data),
    onSuccess: (_r, vars) => {
      toast.success('Price updated');
      setEditingPrice(null);
      void qc.invalidateQueries({ queryKey: ['pricing-plan-prices', vars.planId] });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const deletePrice = useMutation({
    mutationFn: ({ planId, priceId }: { planId: string; priceId: string }) =>
      saApi.delete(`/pricing/plans/${planId}/prices/${priceId}`),
    onSuccess: (_r, vars) => {
      toast.success('Price removed');
      void qc.invalidateQueries({ queryKey: ['pricing-plan-prices', vars.planId] });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const toggleExpand = (id: string) => {
    setExpandedPlanId((prev) => (prev === id ? null : id));
  };

  if (isLoading) {
    return (
      <div className="space-y-3">
        {[1, 2, 3].map((i) => <Skeleton key={i} className="h-16" />)}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <button
          onClick={() => setShowCreatePlan(true)}
          className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium bg-[var(--blue)] text-white hover:opacity-90 transition-opacity"
        >
          <Plus size={14} /> Add Plan
        </button>
      </div>

      {plans.length === 0 ? (
        <EmptyState
          icon={<DollarSign size={28} />}
          title="No pricing plans"
          description="Create your first plan to get started."
        />
      ) : (
        <div className="space-y-3">
          {plans.map((plan) => {
            const expanded = expandedPlanId === plan.id;
            const prices: PlanPrice[] = pricesQueries.data?.[plan.id] ?? [];
            return (
              <SectionCard key={plan.id}>
                <SectionCardHeader>
                  <div className="flex items-center gap-3 min-w-0 flex-1">
                    <button
                      onClick={() => toggleExpand(plan.id)}
                      className="flex items-center gap-2 min-w-0 text-left"
                    >
                      {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                      <span className="font-semibold text-sm">{plan.name}</span>
                      <code className="text-xs text-[var(--text-muted)] font-mono">{plan.planKey}</code>
                    </button>
                    <Badge tone="neutral">{MODULE_LABELS[plan.module] ?? plan.module}</Badge>
                    <Badge tone="neutral">{PERIOD_LABELS[plan.billingPeriod]}</Badge>
                    {plan.isActive ? (
                      <Badge tone="success">Active</Badge>
                    ) : (
                      <Badge tone="neutral">Inactive</Badge>
                    )}
                    {plan.isPublic && <Badge tone="accent">Public</Badge>}
                    <span className="text-xs text-[var(--text-muted)]">{plan.screensIncluded} screens included</span>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <InlineActionButton onClick={() => setEditingPlan(plan)}>
                      <Pencil size={13} />
                    </InlineActionButton>
                    <InlineActionButton
                      tone="danger"
                      onClick={() => {
                        if (confirm(`Delete plan "${plan.name}"?`)) {
                          deletePlan.mutate(plan.id);
                        }
                      }}
                    >
                      <Trash2 size={13} />
                    </InlineActionButton>
                  </div>
                </SectionCardHeader>

                {expanded && (
                  <SectionCardBody>
                    <div className="flex items-center justify-between mb-3">
                      <h4 className="text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wider">Prices</h4>
                      <button
                        onClick={() => setShowCreatePrice(plan.id)}
                        className="flex items-center gap-1 text-xs text-[var(--blue)] hover:underline"
                      >
                        <Plus size={12} /> Add Price
                      </button>
                    </div>
                    {prices.length === 0 ? (
                      <p className="text-xs text-[var(--text-muted)]">No prices yet.</p>
                    ) : (
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="text-xs text-[var(--text-muted)] border-b border-[var(--border)]">
                            <th className="text-left pb-2">Currency</th>
                            <th className="text-left pb-2">Monthly</th>
                            <th className="text-left pb-2">Extra screen</th>
                            <th className="text-left pb-2">Stripe Price ID</th>
                            <th className="text-left pb-2">Status</th>
                            <th />
                          </tr>
                        </thead>
                        <tbody>
                          {prices.map((p) => (
                            <tr key={p.id} className="border-b border-[var(--border)] last:border-0">
                              <td className="py-2 font-mono font-semibold">{p.currency}</td>
                              <td className="py-2">{formatCents(p.amountCents, p.currency)}</td>
                              <td className="py-2">{formatCents(p.extraScreenCents, p.currency)}</td>
                              <td className="py-2 font-mono text-xs text-[var(--text-muted)]">{p.stripePriceId ?? '—'}</td>
                              <td className="py-2">
                                <Badge tone={p.isActive ? 'success' : 'neutral'}>{p.isActive ? 'Active' : 'Inactive'}</Badge>
                              </td>
                              <td className="py-2">
                                <div className="flex items-center gap-2">
                                  <InlineActionButton onClick={() => setEditingPrice({ planId: plan.id, price: p })}>
                                    <Pencil size={12} />
                                  </InlineActionButton>
                                  <InlineActionButton
                                    tone="danger"
                                    onClick={() => {
                                      if (confirm(`Remove ${p.currency} price?`)) {
                                        deletePrice.mutate({ planId: plan.id, priceId: p.id });
                                      }
                                    }}
                                  >
                                    <Trash2 size={12} />
                                  </InlineActionButton>
                                </div>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                  </SectionCardBody>
                )}
              </SectionCard>
            );
          })}
        </div>
      )}

      {/* Create plan modal */}
      {showCreatePlan && (
        <PlanFormModal
          title="Create Plan"
          onClose={() => setShowCreatePlan(false)}
          onSubmit={(data) => createPlan.mutate(data)}
          loading={createPlan.isPending}
        />
      )}

      {/* Edit plan modal */}
      {editingPlan && (
        <PlanFormModal
          title="Edit Plan"
          defaultValues={editingPlan}
          onClose={() => setEditingPlan(null)}
          onSubmit={(data) => updatePlan.mutate({ id: editingPlan.id, data })}
          loading={updatePlan.isPending}
        />
      )}

      {/* Create price modal */}
      {showCreatePrice && (
        <PriceFormModal
          title="Add Price"
          onClose={() => setShowCreatePrice(null)}
          onSubmit={(data) => createPrice.mutate({ planId: showCreatePrice, data })}
          loading={createPrice.isPending}
        />
      )}

      {/* Edit price modal */}
      {editingPrice && (
        <PriceFormModal
          title="Edit Price"
          defaultValues={editingPrice.price}
          onClose={() => setEditingPrice(null)}
          onSubmit={(data) => updatePrice.mutate({ planId: editingPrice.planId, priceId: editingPrice.price.id, data })}
          loading={updatePrice.isPending}
        />
      )}
    </div>
  );
}

// ── Plan form modal ───────────────────────────────────────────────────────────

function PlanFormModal({
  title,
  defaultValues,
  onClose,
  onSubmit,
  loading,
}: {
  title: string;
  defaultValues?: Partial<PricingPlan>;
  onClose: () => void;
  onSubmit: (data: PlanFormData) => void;
  loading: boolean;
}) {
  const { register, handleSubmit, formState: { errors } } = useForm<PlanFormData>({
    resolver: zodResolver(PlanSchema),
    defaultValues: {
      planKey: defaultValues?.planKey ?? '',
      name: defaultValues?.name ?? '',
      module: (defaultValues?.module as PlanFormData['module']) ?? 'signage',
      screensIncluded: defaultValues?.screensIncluded ?? 1,
      billingPeriod: (defaultValues?.billingPeriod as PlanFormData['billingPeriod']) ?? 'monthly',
      description: defaultValues?.description ?? '',
      isActive: defaultValues?.isActive ?? true,
      isPublic: defaultValues?.isPublic ?? true,
      sortOrder: defaultValues?.sortOrder ?? 0,
    },
  });

  return (
    <Modal open onClose={onClose} size="md">
      <ModalHeader title={title} onClose={onClose} />
      <ModalBody>
        <form id="plan-form" onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium mb-1">Plan Key <span className="text-[var(--danger)]">*</span></label>
              <input {...register('planKey')} placeholder="starter" className="input w-full text-sm" />
              {errors.planKey && <p className="text-xs text-[var(--danger)] mt-1">{errors.planKey.message}</p>}
            </div>
            <div>
              <label className="block text-xs font-medium mb-1">Display Name <span className="text-[var(--danger)]">*</span></label>
              <input {...register('name')} placeholder="Starter" className="input w-full text-sm" />
              {errors.name && <p className="text-xs text-[var(--danger)] mt-1">{errors.name.message}</p>}
            </div>
          </div>
          <div className="grid grid-cols-3 gap-4">
            <div>
              <label className="block text-xs font-medium mb-1">Module</label>
              <select {...register('module')} className="input w-full text-sm">
                <option value="signage">CMS</option>
                <option value="pos">POS</option>
                <option value="both">CMS + POS</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium mb-1">Billing Period</label>
              <select {...register('billingPeriod')} className="input w-full text-sm">
                <option value="monthly">Monthly</option>
                <option value="annual">Annual</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium mb-1">Screens Included</label>
              <input {...register('screensIncluded')} type="number" min={0} className="input w-full text-sm" />
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium mb-1">Description</label>
            <textarea {...register('description')} rows={2} className="input w-full text-sm resize-none" placeholder="Optional description for pricing page" />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium mb-1">Sort Order</label>
              <input {...register('sortOrder')} type="number" min={0} className="input w-full text-sm" />
            </div>
          </div>
          <div className="flex gap-6">
            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <input type="checkbox" {...register('isActive')} className="rounded" />
              Active
            </label>
            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <input type="checkbox" {...register('isPublic')} className="rounded" />
              Public (visible on pricing page)
            </label>
          </div>
        </form>
      </ModalBody>
      <ModalFooter>
        <ModalSecondaryButton onClick={onClose}>Cancel</ModalSecondaryButton>
        <ModalPrimaryButton form="plan-form" type="submit" disabled={loading}>
          {loading ? 'Saving…' : 'Save'}
        </ModalPrimaryButton>
      </ModalFooter>
    </Modal>
  );
}

// ── Price form modal ──────────────────────────────────────────────────────────

function PriceFormModal({
  title,
  defaultValues,
  onClose,
  onSubmit,
  loading,
}: {
  title: string;
  defaultValues?: Partial<PlanPrice>;
  onClose: () => void;
  onSubmit: (data: PriceFormData) => void;
  loading: boolean;
}) {
  const { register, handleSubmit, formState: { errors } } = useForm<PriceFormData>({
    resolver: zodResolver(PriceSchema),
    defaultValues: {
      currency: (defaultValues?.currency as PriceFormData['currency']) ?? 'CAD',
      amountCents: defaultValues?.amountCents ?? 0,
      extraScreenCents: defaultValues?.extraScreenCents ?? 0,
      stripePriceId: defaultValues?.stripePriceId ?? '',
      isActive: defaultValues?.isActive ?? true,
    },
  });

  return (
    <Modal open onClose={onClose} size="sm">
      <ModalHeader title={title} onClose={onClose} />
      <ModalBody>
        <form id="price-form" onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <div>
            <label className="block text-xs font-medium mb-1">Currency</label>
            <select {...register('currency')} className="input w-full text-sm">
              {['CAD', 'USD', 'GBP', 'EUR', 'AUD'].map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium mb-1">Amount (cents)</label>
              <input {...register('amountCents')} type="number" min={0} className="input w-full text-sm" />
              {errors.amountCents && <p className="text-xs text-[var(--danger)] mt-1">{errors.amountCents.message}</p>}
            </div>
            <div>
              <label className="block text-xs font-medium mb-1">Extra screen (cents)</label>
              <input {...register('extraScreenCents')} type="number" min={0} className="input w-full text-sm" />
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium mb-1">Stripe Price ID</label>
            <input {...register('stripePriceId')} className="input w-full text-sm font-mono" placeholder="price_xxxx" />
          </div>
          <label className="flex items-center gap-2 text-sm cursor-pointer">
            <input type="checkbox" {...register('isActive')} className="rounded" />
            Active
          </label>
        </form>
      </ModalBody>
      <ModalFooter>
        <ModalSecondaryButton onClick={onClose}>Cancel</ModalSecondaryButton>
        <ModalPrimaryButton form="price-form" type="submit" disabled={loading}>
          {loading ? 'Saving…' : 'Save'}
        </ModalPrimaryButton>
      </ModalFooter>
    </Modal>
  );
}

// ── MC Wholesale tab ──────────────────────────────────────────────────────────

interface ManagementCompany {
  id: string;
  name: string;
  slug: string;
}

interface McPricingOverride {
  id: string;
  managementCompanyId: string;
  planId: string;
  currency: string;
  wholesaleAmountCents: number;
  plan?: { name: string; planKey: string };
}

function McWholesaleTab() {
  const qc = useQueryClient();
  const [selectedMcId, setSelectedMcId] = useState<string | null>(null);
  const [editingOverride, setEditingOverride] = useState<McPricingOverride | null>(null);
  const [showAddOverride, setShowAddOverride] = useState(false);

  const { data: companies = [], isLoading: loadingMcs } = useQuery<ManagementCompany[]>({
    queryKey: ['management-companies-list'],
    queryFn: () => saApi.get('/superadmin/management-companies'),
    select: (data) => data.map((c: ManagementCompany & { adminCount?: number; orgCount?: number }) => ({
      id: c.id,
      name: c.name,
      slug: c.slug,
    })),
  });

  const { data: plans = [] } = useQuery<PricingPlan[]>({
    queryKey: ['pricing-plans'],
    queryFn: () => saApi.get('/pricing/plans'),
  });

  type McPricingRaw = { mc: ManagementCompany; pricing: Array<{
    id: string;
    managementCompanyId: string;
    planId: string;
    currency: string;
    wholesaleCents: number | null;
    plan?: McPricingOverride['plan'];
  }> };

  const { data: overrides = [], isLoading: loadingOverrides } = useQuery<McPricingRaw, Error, McPricingOverride[]>({
    queryKey: ['mc-pricing', selectedMcId],
    queryFn: () => saApi.get<McPricingRaw>(`/pricing/mc/${selectedMcId}/pricing`),
    select: (data) => (data.pricing ?? []).map((p) => ({
      id: p.id,
      managementCompanyId: p.managementCompanyId,
      planId: p.planId,
      currency: p.currency,
      wholesaleAmountCents: p.wholesaleCents ?? 0,
      ...(p.plan ? { plan: p.plan } : {}),
    })),
    enabled: !!selectedMcId,
  });

  const upsertOverride = useMutation({
    mutationFn: (data: { planId: string; currency: string; wholesaleAmountCents: number }) =>
      saApi.put(`/pricing/mc/${selectedMcId}/pricing`, data),
    onSuccess: () => {
      toast.success('Wholesale price saved');
      setShowAddOverride(false);
      setEditingOverride(null);
      void qc.invalidateQueries({ queryKey: ['mc-pricing', selectedMcId] });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const deleteOverride = useMutation({
    mutationFn: (overrideId: string) =>
      saApi.delete(`/pricing/mc/${selectedMcId}/pricing/${overrideId}`),
    onSuccess: () => {
      toast.success('Override removed');
      void qc.invalidateQueries({ queryKey: ['mc-pricing', selectedMcId] });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  if (loadingMcs) return <Skeleton className="h-32" />;

  return (
    <div className="space-y-4">
      <div>
        <label className="block text-xs font-medium mb-1.5 text-[var(--text-muted)]">Select Reseller</label>
        <select
          value={selectedMcId ?? ''}
          onChange={(e) => setSelectedMcId(e.target.value || null)}
          className="input text-sm"
          style={{ maxWidth: 320 }}
        >
          <option value="">— Choose a reseller —</option>
          {companies.map((c) => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </select>
      </div>

      {selectedMcId && (
        <SectionCard>
          <SectionCardHeader>
            <span className="text-sm font-semibold">Wholesale Pricing</span>
            <button
              onClick={() => setShowAddOverride(true)}
              className="flex items-center gap-1 text-xs text-[var(--blue)] hover:underline"
            >
              <Plus size={12} /> Add Override
            </button>
          </SectionCardHeader>
          <SectionCardBody>
            {loadingOverrides ? (
              <Skeleton className="h-12" />
            ) : overrides.length === 0 ? (
              <p className="text-sm text-[var(--text-muted)]">No wholesale overrides — using standard pricing.</p>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-xs text-[var(--text-muted)] border-b border-[var(--border)]">
                    <th className="text-left pb-2">Plan</th>
                    <th className="text-left pb-2">Currency</th>
                    <th className="text-left pb-2">Wholesale Amount</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {overrides.map((o) => {
                    const plan = plans.find((p) => p.id === o.planId);
                    return (
                      <tr key={o.id} className="border-b border-[var(--border)] last:border-0">
                        <td className="py-2">{plan?.name ?? o.planId}</td>
                        <td className="py-2 font-mono">{o.currency}</td>
                        <td className="py-2">{formatCents(o.wholesaleAmountCents, o.currency)}</td>
                        <td className="py-2">
                          <div className="flex items-center gap-2">
                            <InlineActionButton onClick={() => setEditingOverride(o)}>
                              <Pencil size={12} />
                            </InlineActionButton>
                            <InlineActionButton
                              tone="danger"
                              onClick={() => {
                                if (confirm('Remove this wholesale override?')) {
                                  deleteOverride.mutate(o.id);
                                }
                              }}
                            >
                              <Trash2 size={12} />
                            </InlineActionButton>
                          </div>
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

      {(showAddOverride || editingOverride) && selectedMcId && (
        <McOverrideFormModal
          plans={plans}
          {...(editingOverride ? { defaultValues: editingOverride } : {})}
          onClose={() => { setShowAddOverride(false); setEditingOverride(null); }}
          onSubmit={(data) => upsertOverride.mutate(data)}
          loading={upsertOverride.isPending}
        />
      )}
    </div>
  );
}

const McOverrideSchema = z.object({
  planId: z.string().uuid(),
  currency: z.enum(['CAD', 'USD', 'GBP', 'EUR', 'AUD']),
  wholesaleAmountCents: z.coerce.number().int().min(0),
});
type McOverrideFormData = z.infer<typeof McOverrideSchema>;

function McOverrideFormModal({
  plans,
  defaultValues,
  onClose,
  onSubmit,
  loading,
}: {
  plans: PricingPlan[];
  defaultValues?: McPricingOverride;
  onClose: () => void;
  onSubmit: (data: McOverrideFormData) => void;
  loading: boolean;
}) {
  const { register, handleSubmit, formState: { errors } } = useForm<McOverrideFormData>({
    resolver: zodResolver(McOverrideSchema),
    defaultValues: {
      planId: defaultValues?.planId ?? '',
      currency: (defaultValues?.currency as McOverrideFormData['currency']) ?? 'CAD',
      wholesaleAmountCents: defaultValues?.wholesaleAmountCents ?? 0,
    },
  });

  return (
    <Modal open onClose={onClose} size="sm">
      <ModalHeader title={defaultValues?.id ? 'Edit Override' : 'Add Override'} onClose={onClose} />
      <ModalBody>
        <form id="mc-override-form" onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <div>
            <label className="block text-xs font-medium mb-1">Plan</label>
            <select {...register('planId')} className="input w-full text-sm">
              <option value="">— Select plan —</option>
              {plans.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
            {errors.planId && <p className="text-xs text-[var(--danger)] mt-1">Plan is required</p>}
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium mb-1">Currency</label>
              <select {...register('currency')} className="input w-full text-sm">
                {['CAD', 'USD', 'GBP', 'EUR', 'AUD'].map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium mb-1">Wholesale Amount (cents)</label>
              <input {...register('wholesaleAmountCents')} type="number" min={0} className="input w-full text-sm" />
            </div>
          </div>
        </form>
      </ModalBody>
      <ModalFooter>
        <ModalSecondaryButton onClick={onClose}>Cancel</ModalSecondaryButton>
        <ModalPrimaryButton form="mc-override-form" type="submit" disabled={loading}>
          {loading ? 'Saving…' : 'Save'}
        </ModalPrimaryButton>
      </ModalFooter>
    </Modal>
  );
}

// ── Org Subscriptions tab ─────────────────────────────────────────────────────

function OrgSubscriptionsTab() {
  const qc = useQueryClient();
  const [selectedOrgId, setSelectedOrgId] = useState<string | null>(null);
  const [editTrialModal, setEditTrialModal] = useState(false);

  const { data: orgs = [], isLoading: loadingOrgs } = useQuery<{ id: string; name: string; slug: string }[]>({
    queryKey: ['all-orgs-simple'],
    queryFn: async () => {
      const rows = await saApi.get<Array<{ id: string; name: string; slug: string }>>('/superadmin/orgs');
      return rows;
    },
  });

  const { data: sub, isLoading: loadingSub } = useQuery<OrgSub>({
    queryKey: ['org-subscription-admin', selectedOrgId],
    queryFn: () => saApi.get(`/pricing/orgs/${selectedOrgId}/subscription`),
    enabled: !!selectedOrgId,
  });

  const { data: plans = [] } = useQuery<PricingPlan[]>({
    queryKey: ['pricing-plans'],
    queryFn: () => saApi.get('/pricing/plans'),
  });

  const patchTrial = useMutation({
    mutationFn: (data: { trialEndsAt: string; trialScreenLimit: number }) =>
      saApi.patch(`/pricing/orgs/${selectedOrgId}/subscription/trial`, data),
    onSuccess: () => {
      toast.success('Trial updated');
      setEditTrialModal(false);
      void qc.invalidateQueries({ queryKey: ['org-subscription-admin', selectedOrgId] });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const patchStatus = useMutation({
    mutationFn: (data: { status: string; planId?: string; currency?: string }) =>
      saApi.patch(`/pricing/orgs/${selectedOrgId}/subscription/status`, data),
    onSuccess: () => {
      toast.success('Subscription updated');
      void qc.invalidateQueries({ queryKey: ['org-subscription-admin', selectedOrgId] });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  if (loadingOrgs) return <Skeleton className="h-32" />;

  return (
    <div className="space-y-4">
      <div>
        <label className="block text-xs font-medium mb-1.5 text-[var(--text-muted)]">Select Organisation</label>
        <select
          value={selectedOrgId ?? ''}
          onChange={(e) => setSelectedOrgId(e.target.value || null)}
          className="input text-sm"
          style={{ maxWidth: 360 }}
        >
          <option value="">— Choose an org —</option>
          {orgs.map((o) => (
            <option key={o.id} value={o.id}>{o.name}</option>
          ))}
        </select>
      </div>

      {selectedOrgId && (
        loadingSub ? (
          <Skeleton className="h-48" />
        ) : sub ? (
          <SectionCard>
            <SectionCardHeader>
              <div>
                <span className="text-sm font-semibold">Subscription</span>
                <span className="ml-3">
                  <Badge tone={STATUS_TONES[sub.status] ?? 'neutral'}>{sub.status}</Badge>
                </span>
              </div>
              <div className="flex gap-2">
                {(sub.status === 'trialing' || !sub.status) && (
                  <InlineActionButton onClick={() => setEditTrialModal(true)}>Edit Trial</InlineActionButton>
                )}
                <InlineActionButton
                  onClick={() => {
                    const newStatus = sub.status === 'active' ? 'canceled' : 'active';
                    if (confirm(`Set subscription to "${newStatus}"?`)) {
                      patchStatus.mutate({ status: newStatus });
                    }
                  }}
                >
                  {sub.status === 'active' ? 'Cancel' : 'Reactivate'}
                </InlineActionButton>
              </div>
            </SectionCardHeader>
            <SectionCardBody>
              <dl className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm">
                <div>
                  <dt className="text-xs text-[var(--text-muted)]">Plan</dt>
                  <dd className="font-medium">{sub.planName ?? '—'}</dd>
                </div>
                <div>
                  <dt className="text-xs text-[var(--text-muted)]">Billing Model</dt>
                  <dd className="font-medium capitalize">{sub.billingModel}</dd>
                </div>
                <div>
                  <dt className="text-xs text-[var(--text-muted)]">Currency</dt>
                  <dd className="font-mono font-medium">{sub.currency ?? '—'}</dd>
                </div>
                <div>
                  <dt className="text-xs text-[var(--text-muted)]">Current Period End</dt>
                  <dd className="font-medium">{formatDate(sub.currentPeriodEnd)}</dd>
                </div>
                {sub.status === 'trialing' && (
                  <>
                    <div>
                      <dt className="text-xs text-[var(--text-muted)]">Trial Ends</dt>
                      <dd className="font-medium">{formatDate(sub.trialEndsAt)}</dd>
                    </div>
                    <div>
                      <dt className="text-xs text-[var(--text-muted)]">Trial Screen Limit</dt>
                      <dd className="font-medium">{sub.trialScreenLimit ?? '—'}</dd>
                    </div>
                  </>
                )}
                {sub.cancelAtPeriodEnd && (
                  <div className="col-span-2">
                    <Badge tone="warning">Cancels at period end</Badge>
                  </div>
                )}
              </dl>
            </SectionCardBody>
          </SectionCard>
        ) : (
          <EmptyState
            icon={<Building2 size={28} />}
            title="No subscription"
            description="This organisation has no billing record yet."
          />
        )
      )}

      {editTrialModal && selectedOrgId && sub && (
        <TrialEditModal
          defaultValues={{ trialEndsAt: sub.trialEndsAt ?? '', trialScreenLimit: sub.trialScreenLimit ?? 3 }}
          onClose={() => setEditTrialModal(false)}
          onSubmit={(data) => patchTrial.mutate(data)}
          loading={patchTrial.isPending}
        />
      )}
    </div>
  );
}

const TrialSchema = z.object({
  trialEndsAt: z.string().min(1),
  trialScreenLimit: z.coerce.number().int().min(1),
});
type TrialFormData = z.infer<typeof TrialSchema>;

function TrialEditModal({
  defaultValues,
  onClose,
  onSubmit,
  loading,
}: {
  defaultValues: { trialEndsAt: string; trialScreenLimit: number };
  onClose: () => void;
  onSubmit: (data: TrialFormData) => void;
  loading: boolean;
}) {
  const { register, handleSubmit, formState: { errors } } = useForm<TrialFormData>({
    resolver: zodResolver(TrialSchema),
    defaultValues: {
      trialEndsAt: defaultValues.trialEndsAt?.slice(0, 10) ?? '',
      trialScreenLimit: defaultValues.trialScreenLimit,
    },
  });

  return (
    <Modal open onClose={onClose} size="sm">
      <ModalHeader title="Edit Trial" onClose={onClose} />
      <ModalBody>
        <form id="trial-form" onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <div>
            <label className="block text-xs font-medium mb-1">Trial End Date</label>
            <input {...register('trialEndsAt')} type="date" className="input w-full text-sm" />
            {errors.trialEndsAt && <p className="text-xs text-[var(--danger)] mt-1">Required</p>}
          </div>
          <div>
            <label className="block text-xs font-medium mb-1">Screen Limit</label>
            <input {...register('trialScreenLimit')} type="number" min={1} className="input w-full text-sm" />
          </div>
        </form>
      </ModalBody>
      <ModalFooter>
        <ModalSecondaryButton onClick={onClose}>Cancel</ModalSecondaryButton>
        <ModalPrimaryButton form="trial-form" type="submit" disabled={loading}>
          {loading ? 'Saving…' : 'Save'}
        </ModalPrimaryButton>
      </ModalFooter>
    </Modal>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

type Tab = 'plans' | 'wholesale' | 'subscriptions';

const TABS: { id: Tab; label: string }[] = [
  { id: 'plans', label: 'Plans & Prices' },
  { id: 'wholesale', label: 'MC Wholesale' },
  { id: 'subscriptions', label: 'Org Subscriptions' },
];

export default function PricingManagementPage() {
  const [tab, setTab] = useState<Tab>('plans');

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <PageHeader
        icon={<DollarSign size={20} />}
        title="Pricing Management"
        description="Manage plans, prices, reseller wholesale overrides, and org subscriptions."
      />

      {/* Tabs */}
      <div className="flex border-b border-[var(--border)] mb-6 gap-1">
        {TABS.map(({ id, label }) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
              tab === id
                ? 'border-[var(--blue)] text-[var(--blue)]'
                : 'border-transparent text-[var(--text-muted)] hover:text-[var(--text)]'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === 'plans' && <PlansTab />}
      {tab === 'wholesale' && <McWholesaleTab />}
      {tab === 'subscriptions' && <OrgSubscriptionsTab />}
    </div>
  );
}
