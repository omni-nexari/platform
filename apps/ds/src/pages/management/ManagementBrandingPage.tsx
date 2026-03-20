import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { ChevronDown, ChevronUp, Palette, Sparkles } from 'lucide-react';
import { useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';
import type { BrandingFontPreset } from '@signage/shared';
import { PageHeader, Callout } from '../../components/UiPrimitives.js';
import { saApi, useSAStore } from '../../lib/superadmin-auth.js';
import {
  BRANDING_FONT_OPTIONS,
  getManagementBrandingStyle,
  getManagementLoginShellStyle,
  uploadManagementBrandAsset,
} from '../../lib/management-branding.js';

const hexColor = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Use a 6-digit hex color like #1f6feb');
const assetUrl = z.string().refine((value) => {
  if (value.startsWith('/')) return true;
  try {
    new URL(value);
    return true;
  } catch {
    return false;
  }
}, 'Enter a valid URL');

const schema = z.object({
  portalTitle: z.string().max(120, 'Keep the title under 120 characters'),
  logoUrl: z.union([z.literal(''), assetUrl]),
  faviconUrl: z.union([z.literal(''), assetUrl]),
  primaryColor: z.union([z.literal(''), hexColor]),
  accentColor: z.union([z.literal(''), hexColor]),
  sidebarBg: z.union([z.literal(''), hexColor]),
  headingFontPreset: z.union([
    z.literal(''),
    z.enum(['modern', 'editorial', 'geometric', 'mono']),
  ]),
  bodyFontPreset: z.union([
    z.literal(''),
    z.enum(['modern', 'editorial', 'geometric', 'mono']),
  ]),
  loginBackgroundUrl: z.union([z.literal(''), assetUrl]),
});

type FormData = z.infer<typeof schema>;

interface BrandingResponse {
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

function normalizeNullable(value: string): string | null {
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

export default function ManagementBrandingPage() {
  const user = useSAStore((s) => s.user);
  const updateUser = useSAStore((s) => s.updateUser);
  const [showBrandingOptions, setShowBrandingOptions] = useState(false);

  const form = useForm<FormData>({
    resolver: zodResolver(schema),
    defaultValues: {
      portalTitle: user?.companyPortalTitle ?? '',
      logoUrl: user?.companyLogoUrl ?? '',
      faviconUrl: user?.companyFaviconUrl ?? '',
      primaryColor: user?.companyPrimaryColor ?? '',
      accentColor: user?.companyAccentColor ?? '',
      sidebarBg: user?.companySidebarBg ?? '',
      headingFontPreset: user?.companyHeadingFontPreset ?? '',
      bodyFontPreset: user?.companyBodyFontPreset ?? '',
      loginBackgroundUrl: user?.companyLoginBackgroundUrl ?? '',
    },
  });

  useEffect(() => {
    form.reset({
      portalTitle: user?.companyPortalTitle ?? '',
      logoUrl: user?.companyLogoUrl ?? '',
      faviconUrl: user?.companyFaviconUrl ?? '',
      primaryColor: user?.companyPrimaryColor ?? '',
      accentColor: user?.companyAccentColor ?? '',
      sidebarBg: user?.companySidebarBg ?? '',
      headingFontPreset: user?.companyHeadingFontPreset ?? '',
      bodyFontPreset: user?.companyBodyFontPreset ?? '',
      loginBackgroundUrl: user?.companyLoginBackgroundUrl ?? '',
    });
    setShowBrandingOptions(false);
  }, [form, user]);

  useEffect(() => {
    if (Object.keys(form.formState.errors).length > 0) {
      setShowBrandingOptions(true);
    }
  }, [form.formState.errors]);

  const saveBranding = useMutation({
    mutationFn: async (values: FormData) => {
      if (!user?.managementCompanyId) throw new Error('Missing management company context');

      return saApi.patch<BrandingResponse>(
        `/superadmin/management-companies/${user.managementCompanyId}/branding`,
        {
          portalTitle: normalizeNullable(values.portalTitle),
          logoUrl: normalizeNullable(values.logoUrl),
          faviconUrl: normalizeNullable(values.faviconUrl),
          primaryColor: normalizeNullable(values.primaryColor),
          accentColor: normalizeNullable(values.accentColor),
          sidebarBg: normalizeNullable(values.sidebarBg),
          headingFontPreset: normalizeNullable(values.headingFontPreset) as BrandingFontPreset | null,
          bodyFontPreset: normalizeNullable(values.bodyFontPreset) as BrandingFontPreset | null,
          loginBackgroundUrl: normalizeNullable(values.loginBackgroundUrl),
        },
      );
    },
    onSuccess: (result) => {
      updateUser({
        companyLogoUrl: result.logoUrl,
        companyPortalTitle: result.portalTitle,
        companyFaviconUrl: result.faviconUrl,
        companyPrimaryColor: result.primaryColor,
        companyAccentColor: result.accentColor,
        companySidebarBg: result.sidebarBg,
        companyHeadingFontPreset: result.headingFontPreset,
        companyBodyFontPreset: result.bodyFontPreset,
        companyLoginBackgroundUrl: result.loginBackgroundUrl,
      });
      toast.success('Branding updated');
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : 'Failed to save branding');
    },
  });

  const uploadBrandAsset = useMutation({
    mutationFn: async ({
      assetType,
      file,
    }: {
      assetType: 'logo' | 'favicon' | 'login-background';
      file: File;
    }) => {
      if (!user?.managementCompanyId) throw new Error('Missing management company context');
      return uploadManagementBrandAsset(user.managementCompanyId, assetType, file);
    },
    onSuccess: (result, vars) => {
      const fieldName =
        vars.assetType === 'logo'
          ? 'logoUrl'
          : vars.assetType === 'favicon'
            ? 'faviconUrl'
            : 'loginBackgroundUrl';
      form.setValue(fieldName, result.url, { shouldDirty: true, shouldValidate: true });
      toast.success('Asset uploaded');
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : 'Failed to upload branding asset');
    },
  });

  const preview = form.watch();
  const previewTitle = preview.portalTitle.trim() || user?.companyName || 'Management Portal';
  const previewLogo = preview.logoUrl.trim() || user?.companyLogoUrl || '/logo/nexari.png';

  return (
    <div className="p-8 max-w-6xl mx-auto space-y-8">
      <PageHeader
        icon={<Palette size={20} />}
        title="Branding"
        subtitle="Customize the management portal to match your company's look and feel."
        action={
          <button
            onClick={form.handleSubmit((values) => saveBranding.mutate(values))}
            disabled={saveBranding.isPending}
            className="workspace-page-action"
          >
            {saveBranding.isPending ? 'Saving…' : 'Save Branding'}
          </button>
        }
      />

      <Callout tone="accent" icon={<Sparkles size={16} />}>
        This updates the branded login page, management sidebar, browser title, favicon, and all portal accents that use the company theme tokens.
      </Callout>

      <div className="rounded-2xl border p-4 sm:p-6" style={{ background: 'var(--card)', borderColor: 'var(--card-border)' }}>
        <button
          type="button"
          onClick={() => setShowBrandingOptions((value) => !value)}
          className="flex w-full items-start justify-between gap-4 text-left"
        >
          <div>
            <p className="text-base font-semibold text-[var(--text)]">Portal Branding</p>
            <p className="mt-1 text-sm text-[var(--text-muted)]">
              Logo, title, colors, fonts, and login artwork are optional. Open this section only when you want to customize the portal.
            </p>
          </div>
          <span className="mt-1 inline-flex h-9 w-9 items-center justify-center rounded-full border border-[var(--card-border)] text-[var(--text-muted)]">
            {showBrandingOptions ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
          </span>
        </button>

        {showBrandingOptions ? (
          <div className="mt-6 grid gap-6 lg:grid-cols-[1.2fr_0.8fr]">
            <form
              onSubmit={form.handleSubmit((values) => saveBranding.mutate(values))}
              className="space-y-5"
            >
          <div>
            <label className="ui-label">Portal title</label>
            <input
              {...form.register('portalTitle')}
              className="ui-input"
              placeholder="Acme Media Portal"
            />
            <p className="text-xs text-[var(--text-muted)] mt-1">
              Used for the login page heading and the browser tab title.
            </p>
            {form.formState.errors.portalTitle ? (
              <p className="ui-field-error">{form.formState.errors.portalTitle.message}</p>
            ) : null}
          </div>

          <div>
            <label className="ui-label">Logo URL</label>
            <div className="space-y-2">
              <input
                {...form.register('logoUrl')}
                className="ui-input w-full"
                placeholder="https://cdn.example.com/brand/logo.svg"
              />
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
            {form.formState.errors.logoUrl ? (
              <p className="ui-field-error">{form.formState.errors.logoUrl.message}</p>
            ) : null}
          </div>

          <div>
            <label className="ui-label">Favicon URL</label>
            <div className="space-y-2">
              <input
                {...form.register('faviconUrl')}
                className="ui-input w-full"
                placeholder="https://cdn.example.com/brand/favicon.png"
              />
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
            {form.formState.errors.faviconUrl ? (
              <p className="ui-field-error">{form.formState.errors.faviconUrl.message}</p>
            ) : null}
          </div>

          <div className="grid gap-4 sm:grid-cols-3">
            <div>
              <label className="ui-label">Primary color</label>
              <div className="flex items-center gap-3">
                <span
                  className="w-10 h-10 rounded-xl border shrink-0"
                  style={{
                    borderColor: 'var(--card-border)',
                    background: preview.primaryColor || 'var(--blue)',
                  }}
                />
                <input
                  {...form.register('primaryColor')}
                  className="ui-input"
                  placeholder="#3a7bff"
                />
              </div>
              {form.formState.errors.primaryColor ? (
                <p className="ui-field-error">{form.formState.errors.primaryColor.message}</p>
              ) : null}
            </div>
            <div>
              <label className="ui-label">Accent color</label>
              <div className="flex items-center gap-3">
                <span
                  className="w-10 h-10 rounded-xl border shrink-0"
                  style={{
                    borderColor: 'var(--card-border)',
                    background: preview.accentColor || 'var(--aqua)',
                  }}
                />
                <input
                  {...form.register('accentColor')}
                  className="ui-input"
                  placeholder="#4ff2d1"
                />
              </div>
              {form.formState.errors.accentColor ? (
                <p className="ui-field-error">{form.formState.errors.accentColor.message}</p>
              ) : null}
            </div>
            <div>
              <label className="ui-label">Sidebar background</label>
              <div className="flex items-center gap-3">
                <span
                  className="w-10 h-10 rounded-xl border shrink-0"
                  style={{
                    borderColor: 'var(--card-border)',
                    background: preview.sidebarBg || 'var(--bg2)',
                  }}
                />
                <input
                  {...form.register('sidebarBg')}
                  className="ui-input"
                  placeholder="#0b0d11"
                />
              </div>
              {form.formState.errors.sidebarBg ? (
                <p className="ui-field-error">{form.formState.errors.sidebarBg.message}</p>
              ) : null}
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="ui-label">Heading font</label>
              <select {...form.register('headingFontPreset')} className="ui-input">
                <option value="">Default</option>
                {BRANDING_FONT_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="ui-label">Body font</label>
              <select {...form.register('bodyFontPreset')} className="ui-input">
                <option value="">Default</option>
                {BRANDING_FONT_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <label className="ui-label">Login background art URL</label>
            <div className="space-y-2">
              <input
                {...form.register('loginBackgroundUrl')}
                className="ui-input w-full"
                placeholder="https://cdn.example.com/brand/login-background.jpg"
              />
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
            {form.formState.errors.loginBackgroundUrl ? (
              <p className="ui-field-error">{form.formState.errors.loginBackgroundUrl.message}</p>
            ) : null}
          </div>

          <div className="flex items-center gap-3 pt-2">
            <button
              type="submit"
              disabled={saveBranding.isPending}
              className="workspace-page-action"
            >
              {saveBranding.isPending ? 'Saving…' : 'Save Branding'}
            </button>
            <button
              type="button"
              onClick={() =>
                form.reset({
                  portalTitle: '',
                  logoUrl: '',
                  faviconUrl: '',
                  primaryColor: '',
                  accentColor: '',
                  sidebarBg: '',
                  headingFontPreset: '',
                  bodyFontPreset: '',
                  loginBackgroundUrl: '',
                })
              }
              className="px-4 py-2 rounded-xl border text-sm font-medium"
              style={{ borderColor: 'var(--card-border)', color: 'var(--text-muted)' }}
            >
              Clear Form
            </button>
          </div>
            </form>

            <div
              className="rounded-2xl border overflow-hidden"
              style={{
                background: 'var(--card)',
                borderColor: 'var(--card-border)',
                ...getManagementLoginShellStyle({
                  companyPrimaryColor: normalizeNullable(preview.primaryColor),
                  companyAccentColor: normalizeNullable(preview.accentColor),
                  companySidebarBg: normalizeNullable(preview.sidebarBg),
                  companyHeadingFontPreset: normalizeNullable(preview.headingFontPreset) as BrandingFontPreset | null,
                  companyBodyFontPreset: normalizeNullable(preview.bodyFontPreset) as BrandingFontPreset | null,
                  companyLoginBackgroundUrl: normalizeNullable(preview.loginBackgroundUrl),
                }),
              }}
            >
          <div className="px-5 py-4 border-b" style={{ borderColor: 'var(--card-border)' }}>
            <p className="text-sm font-semibold">Live Preview</p>
            <p className="text-xs text-[var(--text-muted)] mt-1">
              This approximates the branded login + sidebar experience.
            </p>
          </div>

          <div className="grid grid-cols-[220px_1fr] min-h-[360px]">
            <div
              className="border-r p-5"
              style={{
                borderColor: 'var(--card-border)',
                background: 'var(--management-sidebar-bg, var(--bg2))',
              }}
            >
              <div className="flex items-center gap-3 pb-5 border-b" style={{ borderColor: 'var(--card-border)' }}>
                <img src={previewLogo} alt={previewTitle} className="h-8 w-8 rounded object-contain bg-white/5" />
                <div className="min-w-0">
                  <p className="management-heading text-sm font-semibold truncate">{previewTitle}</p>
                  <p className="text-xs text-[var(--text-muted)] truncate">Management Portal</p>
                </div>
              </div>
              <div className="mt-5 space-y-2">
                <div className="px-3 py-2 rounded-lg text-white text-sm font-medium" style={{ background: 'var(--blue)' }}>
                  Dashboard
                </div>
                <div className="px-3 py-2 rounded-lg text-sm text-[var(--text-muted)]">Client Organisations</div>
                <div className="px-3 py-2 rounded-lg text-sm text-[var(--text-muted)]">Branding</div>
              </div>
            </div>

            <div className="p-6 space-y-4">
              <div>
                <p className="management-heading text-xl font-bold">{previewTitle}</p>
                <p className="text-sm text-[var(--text-muted)] mt-1">
                  Primary buttons, typography, and login artwork follow your company branding.
                </p>
              </div>
              <div className="flex gap-3">
                <button className="workspace-page-action">Primary Action</button>
                <span
                  className="px-3 py-2 rounded-xl text-sm font-medium"
                  style={{
                    background: 'color-mix(in srgb, var(--aqua) 18%, transparent)',
                    color: 'var(--aqua)',
                    border: '1px solid color-mix(in srgb, var(--aqua) 38%, transparent)',
                  }}
                >
                  Accent Tone
                </span>
              </div>
              <div className="rounded-xl border p-4" style={{ borderColor: 'var(--card-border)', background: 'var(--bg2)' }}>
                <p className="text-sm font-medium">Login tab title</p>
                <p className="text-xs text-[var(--text-muted)] mt-1">{previewTitle}</p>
              </div>
            </div>
          </div>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}