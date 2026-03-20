import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { toast } from 'sonner';
import { ChevronDown, ChevronUp, CircleHelp, ExternalLink, Plus, Mail } from 'lucide-react';
import { InviteManagementCompanyAdminSchema } from '@signage/shared';
import type { InviteManagementCompanyAdminInput } from '@signage/shared';
import { saApi } from '../../lib/superadmin-auth.js';
import {
  BRANDING_FONT_OPTIONS,
  getManagementLoginShellStyle,
  uploadManagementBrandAsset,
} from '../../lib/management-branding.js';
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
  SectionCard,
  SectionCardBody,
  SectionCardHeader,
  Skeleton,
} from '../../components/UiPrimitives.js';

type BrandingFontPreset = 'modern' | 'editorial' | 'geometric' | 'mono';

const assetUrl = z.string().refine((value) => {
  if (value.startsWith('/')) return true;
  try {
    new URL(value);
    return true;
  } catch {
    return false;
  }
}, 'Enter a valid URL');

interface CompanyAdmin {
  id: string;
  email: string;
  name: string | null;
  role: 'owner' | 'admin' | 'billing';
  lastLogin: string | null;
  suspendedAt: string | null;
  createdAt: string;
}

interface PendingInvite {
  id: string;
  email: string;
  role: string;
  expiresAt: string;
  createdAt: string;
}

interface AdminsResponse {
  admins: CompanyAdmin[];
  pendingInvites: PendingInvite[];
}

interface CompanyDetail {
  id: string;
  name: string;
  slug: string;
  billingEmail: string | null;
  logoUrl: string | null;
  portalTitle: string | null;
  faviconUrl: string | null;
  primaryColor: string | null;
  accentColor: string | null;
  sidebarBg: string | null;
  headingFontPreset: BrandingFontPreset | null;
  bodyFontPreset: BrandingFontPreset | null;
  loginBackgroundUrl: string | null;
  suspendedAt: string | null;
  adminCount: number;
  orgCount: number;
}

const BrandingFormSchema = InviteManagementCompanyAdminSchema.pick({}).extend({
  portalTitle: z.string().max(120),
  logoUrl: z.union([z.literal(''), assetUrl]),
  faviconUrl: z.union([z.literal(''), assetUrl]),
  primaryColor: z.union([z.literal(''), z.string().regex(/^#[0-9a-fA-F]{6}$/)]),
  accentColor: z.union([z.literal(''), z.string().regex(/^#[0-9a-fA-F]{6}$/)]),
  sidebarBg: z.union([z.literal(''), z.string().regex(/^#[0-9a-fA-F]{6}$/)]),
  headingFontPreset: z.union([z.literal(''), z.enum(['modern', 'editorial', 'geometric', 'mono'])]),
  bodyFontPreset: z.union([z.literal(''), z.enum(['modern', 'editorial', 'geometric', 'mono'])]),
  loginBackgroundUrl: z.union([z.literal(''), assetUrl]),
});
type BrandingFormData = z.infer<typeof BrandingFormSchema>;

function normalizeNullable(value: string): string | null {
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function getResellerPortalPath(slug: string): string | null {
  if (!slug || slug.startsWith('pending-')) return null;
  return `/m/${slug}/login`;
}

const ROLE_TONES = {
  owner: 'accent',
  admin: 'neutral',
  billing: 'neutral',
} as const;

export default function ManagementCompanyDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [showInvite, setShowInvite] = useState(false);
  const [showDelete, setShowDelete] = useState(false);
  const [showBrandingOptions, setShowBrandingOptions] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ['sa-company-admins', id],
    queryFn: () => saApi.get<AdminsResponse>(`/superadmin/management-companies/${id}/admins`),
    enabled: !!id,
  });

  const { data: company } = useQuery({
    queryKey: ['sa-company-detail', id],
    queryFn: () => saApi.get<CompanyDetail>(`/superadmin/management-companies/${id}`),
    enabled: !!id,
  });

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<InviteManagementCompanyAdminInput>({
    resolver: zodResolver(InviteManagementCompanyAdminSchema),
    defaultValues: { role: 'admin' },
  });

  const brandingForm = useForm<BrandingFormData>({
    resolver: zodResolver(BrandingFormSchema),
    values: {
      portalTitle: company?.portalTitle ?? '',
      logoUrl: company?.logoUrl ?? '',
      faviconUrl: company?.faviconUrl ?? '',
      primaryColor: company?.primaryColor ?? '',
      accentColor: company?.accentColor ?? '',
      sidebarBg: company?.sidebarBg ?? '',
      headingFontPreset: company?.headingFontPreset ?? '',
      bodyFontPreset: company?.bodyFontPreset ?? '',
      loginBackgroundUrl: company?.loginBackgroundUrl ?? '',
    },
  });

  const inviteAdmin = useMutation({
    mutationFn: (data: InviteManagementCompanyAdminInput) =>
      saApi.post(`/superadmin/management-companies/${id}/admins`, data),
    onSuccess: () => {
      toast.success('Invite sent');
      void qc.invalidateQueries({ queryKey: ['sa-company-admins', id] });
      reset();
      setShowInvite(false);
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : 'Failed to send invite'),
  });

  const patchAdmin = useMutation({
    mutationFn: ({ adminId, ...body }: { adminId: string; suspended?: boolean; role?: string }) =>
      saApi.patch(`/superadmin/management-companies/${id}/admins/${adminId}`, body),
    onSuccess: () => {
      toast.success('Updated');
      void qc.invalidateQueries({ queryKey: ['sa-company-admins', id] });
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : 'Action failed'),
  });

  const revokeInvite = useMutation({
    mutationFn: (inviteId: string) => saApi.delete(`/superadmin/management-companies/${id}/invites/${inviteId}`),
    onSuccess: () => {
      toast.success('Invitation deleted');
      void qc.invalidateQueries({ queryKey: ['sa-company-admins', id] });
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : 'Failed to delete invite'),
  });

  const patchBranding = useMutation({
    mutationFn: (values: BrandingFormData) =>
      saApi.patch(`/superadmin/management-companies/${id}/branding`, {
        portalTitle: normalizeNullable(values.portalTitle),
        logoUrl: normalizeNullable(values.logoUrl),
        faviconUrl: normalizeNullable(values.faviconUrl),
        primaryColor: normalizeNullable(values.primaryColor),
        accentColor: normalizeNullable(values.accentColor),
        sidebarBg: normalizeNullable(values.sidebarBg),
        headingFontPreset: normalizeNullable(values.headingFontPreset),
        bodyFontPreset: normalizeNullable(values.bodyFontPreset),
        loginBackgroundUrl: normalizeNullable(values.loginBackgroundUrl),
      }),
    onSuccess: () => {
      toast.success('Branding updated');
      void qc.invalidateQueries({ queryKey: ['sa-company-detail', id] });
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : 'Failed to save branding'),
  });

  const uploadBrandAsset = useMutation({
    mutationFn: ({
      assetType,
      file,
    }: {
      assetType: 'logo' | 'favicon' | 'login-background';
      file: File;
    }) => uploadManagementBrandAsset(id ?? '', assetType, file),
    onSuccess: (result, vars) => {
      const fieldName =
        vars.assetType === 'logo'
          ? 'logoUrl'
          : vars.assetType === 'favicon'
            ? 'faviconUrl'
            : 'loginBackgroundUrl';
      brandingForm.setValue(fieldName, result.url, { shouldDirty: true, shouldValidate: true });
      toast.success('Asset uploaded');
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : 'Failed to upload branding asset'),
  });

  const deleteCompany = useMutation({
    mutationFn: () => saApi.delete(`/superadmin/management-companies/${id}`),
    onSuccess: async () => {
      toast.success('Reseller deleted');
      await qc.invalidateQueries({ queryKey: ['sa-companies'] });
      navigate('/superadmin/companies');
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : 'Failed to delete reseller'),
  });

  const deleteBlockedReason = 'Remove client orgs before delete';
  const resellerPortalPath = company ? getResellerPortalPath(company.slug) : null;
  const dashboardLoginPath = '/login';

  useEffect(() => {
    if (Object.keys(brandingForm.formState.errors).length > 0) {
      setShowBrandingOptions(true);
    }
  }, [brandingForm.formState.errors]);

  useEffect(() => {
    setShowBrandingOptions(false);
  }, [company?.id]);

  if (isLoading) {
    return (
      <div className="p-8 max-w-5xl mx-auto space-y-6">
        <Skeleton className="h-10 w-72" />
        <div className="space-y-3">
          {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-12 rounded-xl" />)}
        </div>
        <div className="space-y-3">
          {Array.from({ length: 2 }).map((_, i) => <Skeleton key={i} className="h-12 rounded-xl" />)}
        </div>
      </div>
    );
  }

  const { admins = [], pendingInvites = [] } = data ?? {};

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-5xl mx-auto space-y-6">
      <PageHeader
        className="workspace-page-header"
        title="Reseller Admins"
        subtitle={`${admins.length} active · ${pendingInvites.length} pending`}
        action={(
          <div className="flex flex-col items-stretch gap-2 sm:items-end">
            <div className="flex flex-wrap items-center gap-2">
            <button onClick={() => setShowInvite(true)} className="workspace-page-action">
              <Plus size={16} />
              Invite Admin
            </button>
            <InlineActionButton
              tone="danger"
              onClick={() => setShowDelete(true)}
              disabled={(company?.orgCount ?? 0) > 0}
              title={(company?.orgCount ?? 0) > 0 ? deleteBlockedReason : 'Delete reseller'}
            >
              Delete Reseller
            </InlineActionButton>
            {(company?.orgCount ?? 0) > 0 ? (
              <span className="inline-flex items-center justify-center rounded-full border border-[var(--card-border)] p-1 text-[var(--text-muted)]" title={deleteBlockedReason} aria-label={deleteBlockedReason}>
                <CircleHelp size={13} />
              </span>
            ) : null}
            </div>
            {(company?.orgCount ?? 0) > 0 ? (
              <div className="flex items-center gap-1 text-xs text-[var(--text-muted)] sm:justify-end">
                <span title={deleteBlockedReason} aria-label={deleteBlockedReason}>
                  <CircleHelp size={13} />
                </span>
                <p>{deleteBlockedReason}.</p>
              </div>
            ) : null}
          </div>
        )}
      />

      {company ? (
        <SectionCard>
          <SectionCardHeader>Portal Access</SectionCardHeader>
          <SectionCardBody className="grid gap-4 md:grid-cols-2">
            <div className="rounded-2xl border p-4" style={{ borderColor: 'var(--card-border)', background: 'var(--bg2)' }}>
              <p className="text-xs font-semibold uppercase tracking-wide text-[var(--text-muted)]">Reseller Portal</p>
              {resellerPortalPath ? (
                <a href={resellerPortalPath} target="_blank" rel="noreferrer" className="mt-2 inline-flex items-center gap-2 text-sm font-medium text-[var(--blue)] hover:underline">
                  <span>{resellerPortalPath}</span>
                  <ExternalLink size={14} />
                </a>
              ) : (
                <p className="mt-2 text-sm text-[var(--text-muted)]">Portal link appears after the reseller completes first-time setup.</p>
              )}
            </div>
            <div className="rounded-2xl border p-4" style={{ borderColor: 'var(--card-border)', background: 'var(--bg2)' }}>
              <p className="text-xs font-semibold uppercase tracking-wide text-[var(--text-muted)]">Client Dashboard Login</p>
              <a href={dashboardLoginPath} target="_blank" rel="noreferrer" className="mt-2 inline-flex items-center gap-2 text-sm font-medium text-[var(--blue)] hover:underline">
                <span>{dashboardLoginPath}</span>
                <ExternalLink size={14} />
              </a>
            </div>
          </SectionCardBody>
        </SectionCard>
      ) : null}

      {company && (
        <SectionCard>
          <SectionCardHeader>Portal Branding</SectionCardHeader>
          <SectionCardBody className="space-y-6">
            <button
              type="button"
              onClick={() => setShowBrandingOptions((value) => !value)}
              className="flex w-full items-start justify-between gap-4 rounded-2xl border p-4 text-left"
              style={{ borderColor: 'var(--card-border)', background: 'var(--bg2)' }}
            >
              <div>
                <p className="text-base font-semibold text-[var(--text)]">Optional portal branding</p>
                <p className="mt-1 text-sm text-[var(--text-muted)]">Keep this collapsed unless the reseller needs custom title, artwork, colors, or fonts.</p>
              </div>
              <span className="mt-1 inline-flex h-9 w-9 items-center justify-center rounded-full border border-[var(--card-border)] text-[var(--text-muted)]">
                {showBrandingOptions ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
              </span>
            </button>

            {showBrandingOptions ? (
              <form onSubmit={brandingForm.handleSubmit((values) => patchBranding.mutate(values))} className="grid gap-6 lg:grid-cols-[1.1fr_0.9fr]">
                <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium mb-1">Portal title</label>
                  <input {...brandingForm.register('portalTitle')} className="input w-full" placeholder="Acme Media Portal" />
                </div>
                <div className="grid gap-4 md:grid-cols-2">
                  <div>
                    <label className="block text-sm font-medium mb-1">Logo URL</label>
                    <div className="space-y-2">
                      <input {...brandingForm.register('logoUrl')} className="input w-full" placeholder="https://cdn.example.com/logo.svg" />
                      <div className="flex justify-end">
                        <label className="workspace-page-action inline-flex cursor-pointer items-center justify-center whitespace-nowrap">
                          Upload
                          <input
                            type="file"
                            accept="image/*"
                            className="hidden"
                            onChange={(event) => {
                              const file = event.target.files?.[0];
                              if (file) uploadBrandAsset.mutate({ assetType: 'logo', file });
                              event.currentTarget.value = '';
                            }}
                          />
                        </label>
                      </div>
                    </div>
                  </div>
                  <div>
                    <label className="block text-sm font-medium mb-1">Favicon URL</label>
                    <div className="space-y-2">
                      <input {...brandingForm.register('faviconUrl')} className="input w-full" placeholder="https://cdn.example.com/favicon.png" />
                      <div className="flex justify-end">
                        <label className="workspace-page-action inline-flex cursor-pointer items-center justify-center whitespace-nowrap">
                          Upload
                          <input
                            type="file"
                            accept="image/*"
                            className="hidden"
                            onChange={(event) => {
                              const file = event.target.files?.[0];
                              if (file) uploadBrandAsset.mutate({ assetType: 'favicon', file });
                              event.currentTarget.value = '';
                            }}
                          />
                        </label>
                      </div>
                    </div>
                  </div>
                </div>
                <div className="grid gap-4 md:grid-cols-3">
                  <div>
                    <label className="block text-sm font-medium mb-1">Primary</label>
                    <input {...brandingForm.register('primaryColor')} className="input w-full" placeholder="#3a7bff" />
                  </div>
                  <div>
                    <label className="block text-sm font-medium mb-1">Accent</label>
                    <input {...brandingForm.register('accentColor')} className="input w-full" placeholder="#4ff2d1" />
                  </div>
                  <div>
                    <label className="block text-sm font-medium mb-1">Sidebar</label>
                    <input {...brandingForm.register('sidebarBg')} className="input w-full" placeholder="#0b0d11" />
                  </div>
                </div>
                <div className="grid gap-4 md:grid-cols-2">
                  <div>
                    <label className="block text-sm font-medium mb-1">Heading font</label>
                    <select {...brandingForm.register('headingFontPreset')} className="input w-full">
                      <option value="">Default</option>
                      {BRANDING_FONT_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>{option.label}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-medium mb-1">Body font</label>
                    <select {...brandingForm.register('bodyFontPreset')} className="input w-full">
                      <option value="">Default</option>
                      {BRANDING_FONT_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>{option.label}</option>
                      ))}
                    </select>
                  </div>
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">Login background art URL</label>
                  <div className="space-y-2">
                    <input {...brandingForm.register('loginBackgroundUrl')} className="input w-full" placeholder="https://cdn.example.com/login-bg.jpg" />
                    <div className="flex justify-end">
                      <label className="workspace-page-action inline-flex cursor-pointer items-center justify-center whitespace-nowrap">
                        Upload
                        <input
                          type="file"
                          accept="image/*"
                          className="hidden"
                          onChange={(event) => {
                            const file = event.target.files?.[0];
                            if (file) uploadBrandAsset.mutate({ assetType: 'login-background', file });
                            event.currentTarget.value = '';
                          }}
                        />
                      </label>
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <button type="submit" disabled={patchBranding.isPending} className="workspace-page-action">
                    {patchBranding.isPending ? 'Saving…' : 'Save Branding'}
                  </button>
                  <span className="text-xs text-[var(--text-muted)]">Support override for branded login and management portal UI.</span>
                </div>
                </div>

                <div
                  className="management-portal rounded-2xl border overflow-hidden"
                  style={{
                    background: 'var(--card)',
                    borderColor: 'var(--card-border)',
                    ...getManagementLoginShellStyle({
                      companyPrimaryColor: normalizeNullable(brandingForm.watch('primaryColor')),
                      companyAccentColor: normalizeNullable(brandingForm.watch('accentColor')),
                      companySidebarBg: normalizeNullable(brandingForm.watch('sidebarBg')),
                      companyHeadingFontPreset: normalizeNullable(brandingForm.watch('headingFontPreset')) as BrandingFontPreset | null,
                      companyBodyFontPreset: normalizeNullable(brandingForm.watch('bodyFontPreset')) as BrandingFontPreset | null,
                      companyLoginBackgroundUrl: normalizeNullable(brandingForm.watch('loginBackgroundUrl')),
                    }),
                  }}
                >
                <div className="p-5 border-b" style={{ borderColor: 'var(--card-border)' }}>
                  <p className="text-sm font-semibold">Preview</p>
                  <p className="text-xs text-[var(--text-muted)] mt-1">What the management login and portal theme will look like.</p>
                </div>
                <div className="grid grid-cols-[220px_1fr] min-h-[280px]">
                  <div className="p-5 border-r" style={{ borderColor: 'var(--card-border)', background: 'var(--management-sidebar-bg, var(--bg2))' }}>
                    <div className="flex items-center gap-3 pb-4 border-b" style={{ borderColor: 'var(--card-border)' }}>
                      {normalizeNullable(brandingForm.watch('logoUrl')) ? (
                        <img src={normalizeNullable(brandingForm.watch('logoUrl')) ?? ''} alt={company.name} className="h-8 w-8 rounded object-contain bg-white/5" />
                      ) : null}
                      <div className="min-w-0">
                        <p className="management-heading text-sm font-semibold truncate">{normalizeNullable(brandingForm.watch('portalTitle')) || company.name}</p>
                        <p className="text-xs text-[var(--text-muted)] truncate">/m/{company.slug}</p>
                      </div>
                    </div>
                    <div className="mt-4 space-y-2">
                      <div className="px-3 py-2 rounded-lg text-white text-sm font-medium" style={{ background: 'var(--blue)' }}>Dashboard</div>
                      <div className="px-3 py-2 rounded-lg text-sm text-[var(--text-muted)]">Client Organizations</div>
                      <div className="px-3 py-2 rounded-lg text-sm text-[var(--text-muted)]">Branding</div>
                    </div>
                  </div>
                  <div className="p-6">
                    <p className="management-heading text-xl font-bold">{normalizeNullable(brandingForm.watch('portalTitle')) || company.name}</p>
                    <p className="text-sm text-[var(--text-muted)] mt-2">Platform Owner support preview for login artwork, typography, and theme accents.</p>
                  </div>
                </div>
                </div>
              </form>
            ) : null}
          </SectionCardBody>
        </SectionCard>
      )}

      {/* Active admins */}
      <SectionCard>
        <SectionCardHeader>Admins</SectionCardHeader>
        <SectionCardBody>
          {admins.length === 0 ? (
            <p className="text-sm text-[var(--text-muted)] p-4">No active admins yet.</p>
          ) : (
            <>
              <div className="space-y-3 md:hidden">
                {admins.map((admin) => (
                  <div
                    key={admin.id}
                    className="rounded-2xl border p-4"
                    style={{ background: 'var(--bg2)', borderColor: 'var(--card-border)' }}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="font-medium break-words">{admin.name ?? admin.email}</p>
                        <p className="text-xs text-[var(--text-muted)] break-all">{admin.email}</p>
                      </div>
                      <Badge tone={admin.suspendedAt ? 'warning' : 'success'}>
                        {admin.suspendedAt ? 'Suspended' : 'Active'}
                      </Badge>
                    </div>
                    <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
                      <div>
                        <p className="text-xs uppercase tracking-wide text-[var(--text-muted)]">Role</p>
                        <div className="mt-1">
                          <Badge tone={ROLE_TONES[admin.role] ?? 'neutral'} className="capitalize">
                            {admin.role}
                          </Badge>
                        </div>
                      </div>
                      <div>
                        <p className="text-xs uppercase tracking-wide text-[var(--text-muted)]">Last login</p>
                        <p className="mt-1 text-[var(--text-muted)]">
                          {admin.lastLogin ? new Date(admin.lastLogin).toLocaleDateString() : 'Never'}
                        </p>
                      </div>
                    </div>
                    <div className="mt-4">
                      <InlineActionButton
                        onClick={() => patchAdmin.mutate({ adminId: admin.id, suspended: !admin.suspendedAt })}
                        className="justify-center w-full"
                      >
                        {admin.suspendedAt ? 'Unsuspend' : 'Suspend'}
                      </InlineActionButton>
                    </div>
                  </div>
                ))}
              </div>

              <div className="hidden md:block">
                <table className="ui-data-table">
                  <thead>
                    <tr>
                      <th>Admin</th>
                      <th>Role</th>
                      <th>Last login</th>
                      <th>Status</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {admins.map((admin) => (
                      <tr key={admin.id}>
                        <td>
                          <p className="font-medium">{admin.name ?? admin.email}</p>
                          <p className="text-xs text-[var(--text-muted)]">{admin.email}</p>
                        </td>
                        <td>
                          <Badge tone={ROLE_TONES[admin.role] ?? 'neutral'} className="capitalize">
                            {admin.role}
                          </Badge>
                        </td>
                        <td className="text-[var(--text-muted)] text-sm">
                          {admin.lastLogin ? new Date(admin.lastLogin).toLocaleDateString() : 'Never'}
                        </td>
                        <td>
                          <Badge tone={admin.suspendedAt ? 'warning' : 'success'}>
                            {admin.suspendedAt ? 'Suspended' : 'Active'}
                          </Badge>
                        </td>
                        <td>
                          <InlineActionButton
                            onClick={() => patchAdmin.mutate({ adminId: admin.id, suspended: !admin.suspendedAt })}
                          >
                            {admin.suspendedAt ? 'Unsuspend' : 'Suspend'}
                          </InlineActionButton>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </SectionCardBody>
      </SectionCard>

      {/* Pending invites */}
      {pendingInvites.length > 0 && (
        <SectionCard>
          <SectionCardHeader>Pending Invites</SectionCardHeader>
          <SectionCardBody>
            <>
              <div className="space-y-3 md:hidden">
                {pendingInvites.map((invite) => (
                  <div
                    key={invite.id}
                    className="rounded-2xl border p-4"
                    style={{ background: 'var(--bg2)', borderColor: 'var(--card-border)' }}
                  >
                    <div className="flex items-start gap-2">
                      <Mail size={14} className="mt-0.5 shrink-0 text-[var(--text-muted)]" />
                      <div className="min-w-0">
                        <p className="break-all font-medium">{invite.email}</p>
                        <div className="mt-2">
                          <Badge tone="neutral" className="capitalize">{invite.role}</Badge>
                        </div>
                      </div>
                    </div>
                    <div className="mt-4 text-sm">
                      <p className="text-xs uppercase tracking-wide text-[var(--text-muted)]">Expires</p>
                      <p className="mt-1 text-[var(--text-muted)]">{new Date(invite.expiresAt).toLocaleDateString()}</p>
                    </div>
                    <div className="mt-4">
                      <button
                        onClick={() => revokeInvite.mutate(invite.id)}
                        disabled={revokeInvite.isPending}
                        className="ui-inline-action-btn ui-inline-action-btn-danger w-full justify-center"
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                ))}
              </div>

              <div className="hidden md:block">
                <table className="ui-data-table">
                  <thead>
                    <tr>
                      <th>Email</th>
                      <th>Role</th>
                      <th>Expires</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {pendingInvites.map((invite) => (
                      <tr key={invite.id}>
                        <td className="flex items-center gap-2">
                          <Mail size={14} className="text-[var(--text-muted)]" />
                          {invite.email}
                        </td>
                        <td>
                          <Badge tone="neutral" className="capitalize">{invite.role}</Badge>
                        </td>
                        <td className="text-[var(--text-muted)] text-sm">
                          {new Date(invite.expiresAt).toLocaleDateString()}
                        </td>
                        <td className="text-right">
                          <button
                            onClick={() => revokeInvite.mutate(invite.id)}
                            disabled={revokeInvite.isPending}
                            className="ui-inline-action-btn ui-inline-action-btn-danger"
                          >
                            Delete
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          </SectionCardBody>
        </SectionCard>
      )}

      {/* Invite modal */}
      {showInvite && (
        <Modal onClose={() => setShowInvite(false)} size="sm">
          <ModalHeader
            title="Invite Admin"
            subtitle="They'll receive an email to set up their account."
            onClose={() => setShowInvite(false)}
          />
          <ModalBody>
            <form
              id="invite-admin-form"
              onSubmit={handleSubmit((d) => inviteAdmin.mutate(d))}
              className="space-y-4"
            >
              <div>
                <label className="block text-sm font-medium mb-1">Full name <span className="text-[var(--text-muted)]">(optional)</span></label>
                <input {...register('name')} placeholder="Alice Johnson" className="input w-full" />
                {errors.name && <p className="text-xs text-[var(--danger)] mt-1">{errors.name.message}</p>}
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Email address</label>
                <input {...register('email')} type="email" placeholder="alice@acme.com" className="input w-full" />
                {errors.email && <p className="text-xs text-[var(--danger)] mt-1">{errors.email.message}</p>}
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Role</label>
                <select {...register('role')} className="input w-full">
                  <option value="admin">Admin</option>
                  <option value="owner">Owner</option>
                  <option value="billing">Billing</option>
                </select>
                {errors.role && <p className="text-xs text-[var(--danger)] mt-1">{errors.role.message}</p>}
              </div>
            </form>
          </ModalBody>
          <ModalFooter>
            <ModalSecondaryButton type="button" onClick={() => setShowInvite(false)} className="flex-1">
              Cancel
            </ModalSecondaryButton>
            <ModalPrimaryButton
              form="invite-admin-form"
              type="submit"
              disabled={isSubmitting}
              className="flex-1"
            >
              {isSubmitting ? 'Sending…' : 'Send Invite'}
            </ModalPrimaryButton>
          </ModalFooter>
        </Modal>
      )}

      {showDelete && company && (
        <Modal onClose={() => setShowDelete(false)} size="sm">
          <ModalHeader
            title="Delete Reseller"
            subtitle="This reseller can only be deleted when no client organizations remain."
            onClose={() => setShowDelete(false)}
          />
          <ModalBody>
            <div className="space-y-3 text-sm text-[var(--text-muted)]">
              <p>
                Delete <span className="font-semibold text-[var(--text)]">{company.name}</span>?
              </p>
              <p>
                Client organizations: <span className="font-semibold text-[var(--text)]">{company.orgCount}</span>
              </p>
              <p>
                Pending reseller invites will be revoked and existing reseller admins will be suspended.
              </p>
            </div>
          </ModalBody>
          <ModalFooter>
            <ModalSecondaryButton type="button" onClick={() => setShowDelete(false)} className="flex-1">
              Cancel
            </ModalSecondaryButton>
            <ModalPrimaryButton
              type="button"
              onClick={() => deleteCompany.mutate()}
              disabled={deleteCompany.isPending || company.orgCount > 0}
              className="flex-1"
            >
              {deleteCompany.isPending ? 'Deleting…' : 'Delete Reseller'}
            </ModalPrimaryButton>
          </ModalFooter>
        </Modal>
      )}
    </div>
  );
}
