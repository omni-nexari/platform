import { useState } from 'react';
import { useParams } from 'react-router';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { toast } from 'sonner';
import { Plus, Mail } from 'lucide-react';
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

const ROLE_TONES = {
  owner: 'accent',
  admin: 'neutral',
  billing: 'neutral',
} as const;

export default function ManagementCompanyDetailPage() {
  const { id } = useParams<{ id: string }>();
  const qc = useQueryClient();
  const [showInvite, setShowInvite] = useState(false);

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
    <div className="p-8 max-w-5xl mx-auto space-y-6">
      <PageHeader
        className="workspace-page-header"
        title="Management Company Admins"
        subtitle={`${admins.length} active · ${pendingInvites.length} pending`}
        action={(
          <button onClick={() => setShowInvite(true)} className="workspace-page-action">
            <Plus size={16} />
            Invite Admin
          </button>
        )}
      />

      {company && (
        <SectionCard>
          <SectionCardHeader>Portal Branding</SectionCardHeader>
          <SectionCardBody className="space-y-6">
            <form onSubmit={brandingForm.handleSubmit((values) => patchBranding.mutate(values))} className="grid gap-6 lg:grid-cols-[1.1fr_0.9fr]">
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium mb-1">Portal title</label>
                  <input {...brandingForm.register('portalTitle')} className="input w-full" placeholder="Acme Media Portal" />
                </div>
                <div className="grid gap-4 md:grid-cols-2">
                  <div>
                    <label className="block text-sm font-medium mb-1">Logo URL</label>
                    <div className="flex gap-2">
                      <input {...brandingForm.register('logoUrl')} className="input flex-1" placeholder="https://cdn.example.com/logo.svg" />
                      <label className="workspace-page-action cursor-pointer">
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
                  <div>
                    <label className="block text-sm font-medium mb-1">Favicon URL</label>
                    <div className="flex gap-2">
                      <input {...brandingForm.register('faviconUrl')} className="input flex-1" placeholder="https://cdn.example.com/favicon.png" />
                      <label className="workspace-page-action cursor-pointer">
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
                  <div className="flex gap-2">
                    <input {...brandingForm.register('loginBackgroundUrl')} className="input flex-1" placeholder="https://cdn.example.com/login-bg.jpg" />
                    <label className="workspace-page-action cursor-pointer">
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
                      <div className="px-3 py-2 rounded-lg text-sm text-[var(--text-muted)]">Client Organisations</div>
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
                        onClick={() =>
                          patchAdmin.mutate({ adminId: admin.id, suspended: !admin.suspendedAt })
                        }
                      >
                        {admin.suspendedAt ? 'Unsuspend' : 'Suspend'}
                      </InlineActionButton>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </SectionCardBody>
      </SectionCard>

      {/* Pending invites */}
      {pendingInvites.length > 0 && (
        <SectionCard>
          <SectionCardHeader>Pending Invites</SectionCardHeader>
          <SectionCardBody>
            <table className="ui-data-table">
              <thead>
                <tr>
                  <th>Email</th>
                  <th>Role</th>
                  <th>Expires</th>
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
                  </tr>
                ))}
              </tbody>
            </table>
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
    </div>
  );
}
