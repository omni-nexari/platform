import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useParams, useNavigate } from 'react-router';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { saFetch, useSAStore } from '../../lib/superadmin-auth.js';
import { buildApiUrl } from '../../lib/api.js';
import {
  applyManagementBrandingDocument,
  getManagementBrandingStyle,
  getManagementLoginShellStyle,
} from '../../lib/management-branding.js';

const schema = z.object({
  email: z.string().email('Enter a valid email'),
  password: z.string().min(1, 'Password is required'),
});
type FormData = z.infer<typeof schema>;

interface CompanyBrand {
  name: string;
  slug: string;
  logoUrl: string | null;
  portalTitle: string | null;
  faviconUrl: string | null;
  primaryColor: string | null;
  accentColor: string | null;
  sidebarBg: string | null;
  headingFontPreset: 'modern' | 'editorial' | 'geometric' | 'mono' | null;
  bodyFontPreset: 'modern' | 'editorial' | 'geometric' | 'mono' | null;
  loginBackgroundUrl: string | null;
  suspendedAt: string | null;
}

export default function ManagementLoginPage() {
  const { slug } = useParams<{ slug?: string }>();
  const navigate = useNavigate();
  const beginBootstrap = useSAStore((s) => s.beginBootstrap);
  const [brand, setBrand] = useState<CompanyBrand | null>(null);

  // Fetch company branding when a slug is in the URL
  useEffect(() => {
    if (!slug) return;
    saFetch<CompanyBrand>(`/superadmin/auth/company/${slug}`)
      .then(setBrand)
      .catch(() => setBrand(null)); // silently fall back to generic if not found
  }, [slug]);

  useEffect(() => {
    return applyManagementBrandingDocument(
      brand
        ? {
            companyName: brand.name,
            companyLogoUrl: brand.logoUrl,
            companyPortalTitle: brand.portalTitle,
            companyFaviconUrl: brand.faviconUrl,
            companyPrimaryColor: brand.primaryColor,
            companyAccentColor: brand.accentColor,
            companySidebarBg: brand.sidebarBg,
            companyHeadingFontPreset: brand.headingFontPreset,
            companyBodyFontPreset: brand.bodyFontPreset,
            companyLoginBackgroundUrl: brand.loginBackgroundUrl,
          }
        : undefined,
    );
  }, [brand]);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<FormData>({ resolver: zodResolver(schema) });

  const onSubmit = async (data: FormData) => {
    try {
      // Use direct fetch (not saFetch) so a wrong-password 401 shows an error
      // instead of triggering the session-expired redirect loop.
      const res = await fetch(buildApiUrl('/superadmin/auth/company-login'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
        credentials: 'include',
      });
      if (res.status === 401) {
        toast.error('Invalid email or password');
        return;
      }
      if (res.status === 403) {
        toast.error('This account has been suspended. Please contact support.');
        return;
      }
      if (!res.ok) {
        const text = await res.text();
        toast.error(text || 'Login failed');
        return;
      }
      beginBootstrap();
      navigate('/management');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Login failed');
    }
  };

  const displayName = brand?.portalTitle ?? brand?.name ?? 'Management Portal';
  const logoSrc = brand?.logoUrl ?? '/logo/nexari.png';

  return (
    <div className="management-portal min-h-dvh flex items-center justify-center p-4" style={getManagementLoginShellStyle(
      brand
        ? {
            companyPrimaryColor: brand.primaryColor,
            companyAccentColor: brand.accentColor,
            companySidebarBg: brand.sidebarBg,
            companyHeadingFontPreset: brand.headingFontPreset,
            companyBodyFontPreset: brand.bodyFontPreset,
            companyLoginBackgroundUrl: brand.loginBackgroundUrl,
          }
        : undefined,
    )}>
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <img src={logoSrc} alt={displayName} className="h-10 mx-auto mb-4 object-contain" />
          <h1 className="management-heading text-2xl font-bold">{displayName}</h1>
          <p className="text-sm text-[var(--text-muted)] mt-1">
            {brand
              ? `Sign in to your ${brand.name} admin portal`
              : 'Sign in with your management company credentials'}
          </p>
          {brand && (
            <p className="text-xs text-[var(--text-muted)] mt-3 opacity-60">Powered by OmniHub</p>
          )}
        </div>

        {brand?.suspendedAt ? (
          <div
            className="rounded-2xl border p-6 text-center text-sm text-[var(--danger)]"
            style={{ background: 'var(--card)', borderColor: 'var(--card-border)' }}
          >
            This portal has been suspended. Please contact support.
          </div>
        ) : (
          <form
            onSubmit={handleSubmit(onSubmit)}
            className="rounded-2xl border p-6 space-y-4"
            style={{ background: 'var(--card)', borderColor: 'var(--card-border)' }}
          >
            <div>
              <label className="block text-sm font-medium mb-1">Email</label>
              <input
                {...register('email')}
                type="email"
                autoComplete="username"
                placeholder="admin@company.com"
                className="input w-full"
              />
              {errors.email && (
                <p className="text-xs text-[var(--danger)] mt-1">{errors.email.message}</p>
              )}
            </div>

            <div>
              <label className="block text-sm font-medium mb-1">Password</label>
              <input
                {...register('password')}
                type="password"
                autoComplete="current-password"
                placeholder="••••••••"
                className="input w-full"
              />
              {errors.password && (
                <p className="text-xs text-[var(--danger)] mt-1">{errors.password.message}</p>
              )}
            </div>

            <button type="submit" disabled={isSubmitting} className="btn-primary w-full">
              {isSubmitting ? 'Signing in…' : 'Sign in'}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}

