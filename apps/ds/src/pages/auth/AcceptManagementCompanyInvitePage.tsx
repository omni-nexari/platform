import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useParams, useNavigate } from 'react-router';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { api } from '../../lib/api.js';
import {
  BRANDING_FONT_OPTIONS,
  getManagementLoginShellStyle,
  uploadInvitedManagementBrandAsset,
} from '../../lib/management-branding.js';

type BrandingFontPreset = 'modern' | 'editorial' | 'geometric' | 'mono';

interface InviteInfo {
  email: string;
  role: string;
  companyName: string;
  isFirstSetup: boolean;
  logoUrl: string | null;
  portalTitle: string | null;
  faviconUrl: string | null;
  primaryColor: string | null;
  accentColor: string | null;
  sidebarBg: string | null;
  headingFontPreset: BrandingFontPreset | null;
  bodyFontPreset: BrandingFontPreset | null;
  loginBackgroundUrl: string | null;
}

const assetUrl = z.string().refine((value) => {
  if (value.startsWith('/')) return true;
  try {
    new URL(value);
    return true;
  } catch {
    return false;
  }
}, 'Enter a valid URL');

// Dynamic schema: require company fields only on first setup
function makeSchema(isFirstSetup: boolean) {
  const base = z.object({
    name: z.string().min(1, 'Full name is required').max(120),
    password: z.string().min(8, 'Password must be at least 8 characters'),
    companyName: z.string().min(2, 'Company name is required').max(120).optional(),
    companyPortalUrl: z
      .string()
      .min(2, 'Portal address is required')
      .max(60, 'Portal address too long')
      .regex(/^[a-z0-9-]+$/, 'Use lowercase letters, numbers and hyphens only')
      .optional(),
    billingEmail: z.string().email('Enter a valid email').or(z.literal('')).optional(),
    logoUrl: z.union([z.literal(''), assetUrl]).optional(),
    portalTitle: z.string().max(120).optional(),
    faviconUrl: z.union([z.literal(''), assetUrl]).optional(),
    primaryColor: z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Use a hex color like #1f6feb').optional(),
    accentColor: z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Use a hex color like #4ff2d1').optional(),
    sidebarBg: z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Use a hex color like #0b0d11').optional(),
    headingFontPreset: z.enum(['modern', 'editorial', 'geometric', 'mono']).optional(),
    bodyFontPreset: z.enum(['modern', 'editorial', 'geometric', 'mono']).optional(),
    loginBackgroundUrl: z.union([z.literal(''), assetUrl]).optional(),
  });
  if (!isFirstSetup) return base;
  return base.superRefine((val, ctx) => {
    if (!val.companyName) {
      ctx.addIssue({ code: 'custom', path: ['companyName'], message: 'Company name is required' });
    }
    if (!val.companyPortalUrl) {
      ctx.addIssue({ code: 'custom', path: ['companyPortalUrl'], message: 'Portal address is required' });
    }
  });
}

type FormData = z.infer<ReturnType<typeof makeSchema>>;

export default function AcceptManagementCompanyInvitePage() {
  const { token } = useParams<{ token: string }>();
  const navigate = useNavigate();
  const [inviteInfo, setInviteInfo] = useState<InviteInfo | null>(null);
  const [loadError, setLoadError] = useState('');

  useEffect(() => {
    api
      .get<InviteInfo>(`/auth/accept-management-company-invite/${token}`)
      .then(setInviteInfo)
      .catch(() => setLoadError('This invite link is invalid or has expired.'));
  }, [token]);

  const {
    register,
    handleSubmit,
    reset,
    setValue,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<FormData>({
    resolver: zodResolver(makeSchema(inviteInfo?.isFirstSetup ?? false)),
  });

  useEffect(() => {
    if (!inviteInfo) return;
    reset({
      name: '',
      password: '',
      companyName: inviteInfo.companyName ?? '',
      companyPortalUrl: '',
      billingEmail: '',
      logoUrl: inviteInfo.logoUrl ?? '',
      portalTitle: inviteInfo.portalTitle ?? '',
      faviconUrl: inviteInfo.faviconUrl ?? '',
      primaryColor: inviteInfo.primaryColor ?? '',
      accentColor: inviteInfo.accentColor ?? '',
      sidebarBg: inviteInfo.sidebarBg ?? '',
      headingFontPreset: inviteInfo.headingFontPreset ?? undefined,
      bodyFontPreset: inviteInfo.bodyFontPreset ?? undefined,
      loginBackgroundUrl: inviteInfo.loginBackgroundUrl ?? '',
    });
  }, [inviteInfo, reset]);

  const [uploadingAsset, setUploadingAsset] = useState<null | 'logo' | 'favicon' | 'login-background'>(null);

  const primaryColor = watch('primaryColor');
  const accentColor = watch('accentColor');
  const loginBackgroundUrl = watch('loginBackgroundUrl');

  const loginShellStyle = getManagementLoginShellStyle(
    inviteInfo
      ? {
          companyPrimaryColor: primaryColor?.trim() || inviteInfo.primaryColor,
          companyAccentColor: accentColor?.trim() || inviteInfo.accentColor,
          companyLoginBackgroundUrl: loginBackgroundUrl?.trim() || inviteInfo.loginBackgroundUrl,
        }
      : undefined,
  );

  const handleAssetUpload = async (
    assetType: 'logo' | 'favicon' | 'login-background',
    file: File,
  ) => {
    if (!token) return;

    try {
      setUploadingAsset(assetType);
      const result = await uploadInvitedManagementBrandAsset(token, assetType, file);
      const fieldName =
        assetType === 'logo'
          ? 'logoUrl'
          : assetType === 'favicon'
            ? 'faviconUrl'
            : 'loginBackgroundUrl';
      setValue(fieldName, result.url, { shouldDirty: true, shouldValidate: true });
      toast.success('Asset uploaded');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to upload branding asset');
    } finally {
      setUploadingAsset(null);
    }
  };

  const onSubmit = async (data: FormData) => {
    try {
      const res = await api.post<{ id: string; companySlug: string | null }>(
        `/auth/accept-management-company-invite/${token}`,
        data,
      );
      toast.success('Account created! Sign in to your portal.');
      if (res.companySlug && !res.companySlug.startsWith('pending-')) {
        navigate(`/m/${res.companySlug}`);
      } else {
        navigate('/management/login');
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to accept invite');
    }
  };

  if (loadError) {
    return (
      <div className="min-h-dvh flex items-center justify-center p-4">
        <p className="text-[var(--danger)]">{loadError}</p>
      </div>
    );
  }

  if (!inviteInfo) {
    return <div className="min-h-dvh flex items-center justify-center p-4">Loading…</div>;
  }

  return (
    <div className="management-portal min-h-dvh flex items-center justify-center p-4" style={loginShellStyle}>
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          {inviteInfo.logoUrl ? (
            <img src={inviteInfo.logoUrl} alt={inviteInfo.companyName || 'Company logo'} className="h-10 mx-auto mb-4 object-contain" />
          ) : null}
          <h1 className="management-heading text-2xl font-bold">
            {inviteInfo.isFirstSetup ? 'Set up your admin account' : 'Accept admin invitation'}
          </h1>
          <p className="text-sm text-[var(--text-muted)] mt-1">
            {inviteInfo.isFirstSetup
              ? 'Create your account and set up your company portal'
              : <>
                  Joining <strong>{inviteInfo.companyName}</strong> as{' '}
                  <span className="text-[var(--blue)] font-semibold capitalize">{inviteInfo.role}</span>
                </>
            }
          </p>
          <p className="text-xs text-[var(--text-muted)] mt-0.5">{inviteInfo.email}</p>
        </div>

        <form
          onSubmit={handleSubmit(onSubmit)}
          className="rounded-2xl border p-6 space-y-4"
          style={{ background: 'var(--card)', borderColor: 'var(--card-border)' }}
        >
          {/* ── Account section ── */}
          <div>
            <label className="block text-sm font-medium mb-1">Full name</label>
            <input {...register('name')} placeholder="Jane Smith" className="input w-full" />
            {errors.name && <p className="text-xs text-[var(--danger)] mt-1">{errors.name.message}</p>}
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">Password</label>
            <input
              {...register('password')}
              type="password"
              placeholder="••••••••"
              className="input w-full"
            />
            {errors.password && (
              <p className="text-xs text-[var(--danger)] mt-1">{errors.password.message}</p>
            )}
          </div>

          {/* ── Company setup section (first-setup only) ── */}
          {inviteInfo.isFirstSetup && (
            <>
              <hr style={{ borderColor: 'var(--card-border)' }} />
              <p className="text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wider">
                Your Company
              </p>

              <div>
                <label className="block text-sm font-medium mb-1">Company name</label>
                <input
                  {...register('companyName')}
                  placeholder="Acme Corp"
                  className="input w-full"
                />
                {errors.companyName && (
                  <p className="text-xs text-[var(--danger)] mt-1">{errors.companyName.message}</p>
                )}
              </div>

              <div>
                <label className="block text-sm font-medium mb-1">Portal address</label>
                <div className="flex items-stretch">
                  <span
                    className="px-3 flex items-center text-sm rounded-l-lg border border-r-0 text-[var(--text-muted)] select-none"
                    style={{ background: 'var(--bg2)', borderColor: 'var(--card-border)' }}
                  >
                    /m/
                  </span>
                  <input
                    {...register('companyPortalUrl')}
                    placeholder="acme-corp"
                    className="input rounded-l-none flex-1"
                  />
                </div>
                <p className="text-xs text-[var(--text-muted)] mt-1">
                  Lowercase letters, numbers and hyphens only
                </p>
                {errors.companyPortalUrl && (
                  <p className="text-xs text-[var(--danger)] mt-1">{errors.companyPortalUrl.message}</p>
                )}
              </div>

              <div>
                <label className="block text-sm font-medium mb-1">
                  Billing email <span className="text-[var(--text-muted)]">(optional)</span>
                </label>
                <input
                  {...register('billingEmail')}
                  type="email"
                  placeholder="billing@acme.com"
                  className="input w-full"
                />
                {errors.billingEmail && (
                  <p className="text-xs text-[var(--danger)] mt-1">{errors.billingEmail.message}</p>
                )}
              </div>

              <div>
                <label className="block text-sm font-medium mb-1">
                  Logo URL <span className="text-[var(--text-muted)]">(optional)</span>
                </label>
                <div className="flex gap-2">
                  <input
                    {...register('logoUrl')}
                    type="url"
                    placeholder="https://acme.com/logo.png"
                    className="input flex-1"
                  />
                  <label className="btn-secondary cursor-pointer whitespace-nowrap">
                    {uploadingAsset === 'logo' ? 'Uploading…' : 'Upload'}
                    <input
                      type="file"
                      accept="image/*"
                      className="hidden"
                      disabled={uploadingAsset !== null}
                      onChange={(event) => {
                        const file = event.target.files?.[0];
                        if (file) void handleAssetUpload('logo', file);
                        event.currentTarget.value = '';
                      }}
                    />
                  </label>
                </div>
                {errors.logoUrl && (
                  <p className="text-xs text-[var(--danger)] mt-1">{errors.logoUrl.message}</p>
                )}
              </div>

              <div>
                <label className="block text-sm font-medium mb-1">
                  Portal title <span className="text-[var(--text-muted)]">(optional)</span>
                </label>
                <input
                  {...register('portalTitle')}
                  placeholder="Acme Media Portal"
                  className="input w-full"
                />
              </div>

              <div>
                <label className="block text-sm font-medium mb-1">
                  Favicon URL <span className="text-[var(--text-muted)]">(optional)</span>
                </label>
                <div className="flex gap-2">
                  <input
                    {...register('faviconUrl')}
                    type="url"
                    placeholder="https://acme.com/favicon.png"
                    className="input flex-1"
                  />
                  <label className="btn-secondary cursor-pointer whitespace-nowrap">
                    {uploadingAsset === 'favicon' ? 'Uploading…' : 'Upload'}
                    <input
                      type="file"
                      accept="image/*"
                      className="hidden"
                      disabled={uploadingAsset !== null}
                      onChange={(event) => {
                        const file = event.target.files?.[0];
                        if (file) void handleAssetUpload('favicon', file);
                        event.currentTarget.value = '';
                      }}
                    />
                  </label>
                </div>
                {errors.faviconUrl && (
                  <p className="text-xs text-[var(--danger)] mt-1">{errors.faviconUrl.message}</p>
                )}
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="block text-sm font-medium mb-1">Primary</label>
                  <input {...register('primaryColor')} placeholder="#3a7bff" className="input w-full" />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">Accent</label>
                  <input {...register('accentColor')} placeholder="#4ff2d1" className="input w-full" />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">Sidebar</label>
                  <input {...register('sidebarBg')} placeholder="#0b0d11" className="input w-full" />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium mb-1">Heading font</label>
                  <select {...register('headingFontPreset')} className="input w-full">
                    <option value="">Default</option>
                    {BRANDING_FONT_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>{option.label}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">Body font</label>
                  <select {...register('bodyFontPreset')} className="input w-full">
                    <option value="">Default</option>
                    {BRANDING_FONT_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>{option.label}</option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium mb-1">
                  Login background art URL <span className="text-[var(--text-muted)]">(optional)</span>
                </label>
                <div className="flex gap-2">
                  <input
                    {...register('loginBackgroundUrl')}
                    type="url"
                    placeholder="https://acme.com/login-background.jpg"
                    className="input flex-1"
                  />
                  <label className="btn-secondary cursor-pointer whitespace-nowrap">
                    {uploadingAsset === 'login-background' ? 'Uploading…' : 'Upload'}
                    <input
                      type="file"
                      accept="image/*"
                      className="hidden"
                      disabled={uploadingAsset !== null}
                      onChange={(event) => {
                        const file = event.target.files?.[0];
                        if (file) void handleAssetUpload('login-background', file);
                        event.currentTarget.value = '';
                      }}
                    />
                  </label>
                </div>
                {errors.loginBackgroundUrl && (
                  <p className="text-xs text-[var(--danger)] mt-1">{errors.loginBackgroundUrl.message}</p>
                )}
              </div>
            </>
          )}

          <button type="submit" disabled={isSubmitting} className="btn-primary w-full">
            {isSubmitting ? 'Creating account…' : 'Create account'}
          </button>
        </form>
      </div>
    </div>
  );
}
