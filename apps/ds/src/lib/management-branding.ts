import type { CSSProperties } from 'react';
import type { BrandingFontPreset } from '@signage/shared';
import { api } from './api.js';
import { saFetch } from './superadmin-auth.js';

export const BRANDING_FONT_OPTIONS: Array<{
  value: BrandingFontPreset;
  label: string;
  body: string;
  heading: string;
}> = [
  {
    value: 'modern',
    label: 'Modern Sans',
    body: 'Inter, system-ui, sans-serif',
    heading: 'Inter, system-ui, sans-serif',
  },
  {
    value: 'editorial',
    label: 'Editorial',
    body: 'Georgia, Cambria, "Times New Roman", serif',
    heading: 'Georgia, Cambria, "Times New Roman", serif',
  },
  {
    value: 'geometric',
    label: 'Geometric',
    body: 'Avenir Next, Montserrat, Poppins, system-ui, sans-serif',
    heading: 'Avenir Next, Montserrat, Poppins, system-ui, sans-serif',
  },
  {
    value: 'mono',
    label: 'Monospace',
    body: '"IBM Plex Mono", "SFMono-Regular", Consolas, monospace',
    heading: '"Space Mono", "IBM Plex Mono", Consolas, monospace',
  },
];

function getFontStack(preset: BrandingFontPreset | null | undefined, kind: 'body' | 'heading') {
  const match = BRANDING_FONT_OPTIONS.find((option) => option.value === preset);
  if (!match) return null;
  return kind === 'body' ? match.body : match.heading;
}

export interface ManagementBranding {
  companyName?: string | null;
  companyLogoUrl?: string | null;
  companyPortalTitle?: string | null;
  companyFaviconUrl?: string | null;
  companyPrimaryColor?: string | null;
  companyAccentColor?: string | null;
  companySidebarBg?: string | null;
  companyHeadingFontPreset?: BrandingFontPreset | null;
  companyBodyFontPreset?: BrandingFontPreset | null;
  companyLoginBackgroundUrl?: string | null;
}

type BrandingStyle = CSSProperties & Record<string, string>;

export function getManagementBrandingStyle(
  branding?: ManagementBranding | null,
): BrandingStyle {
  const style: Record<string, string> = {};

  if (branding?.companyPrimaryColor) style['--blue'] = branding.companyPrimaryColor;
  if (branding?.companyAccentColor) style['--aqua'] = branding.companyAccentColor;
  if (branding?.companySidebarBg) style['--management-sidebar-bg'] = branding.companySidebarBg;

  const bodyFont = getFontStack(branding?.companyBodyFontPreset, 'body');
  const headingFont = getFontStack(branding?.companyHeadingFontPreset, 'heading');
  if (bodyFont) style['--management-font-body'] = bodyFont;
  if (headingFont) style['--management-font-heading'] = headingFont;

  return style as BrandingStyle;
}

export function getManagementLoginShellStyle(
  branding?: ManagementBranding | null,
): BrandingStyle {
  const style = getManagementBrandingStyle(branding);
  if (branding?.companyLoginBackgroundUrl) {
    style.backgroundImage = `linear-gradient(rgba(11, 13, 17, 0.72), rgba(11, 13, 17, 0.72)), url(${branding.companyLoginBackgroundUrl})`;
    style.backgroundSize = 'cover';
    style.backgroundPosition = 'center';
  }
  return style;
}

export async function uploadManagementBrandAsset(
  managementCompanyId: string,
  assetType: 'logo' | 'favicon' | 'login-background',
  file: File,
): Promise<{ url: string; assetType: string }> {
  const formData = new FormData();
  formData.append('file', file);

  return saFetch(`/superadmin/management-companies/${managementCompanyId}/branding-assets/${assetType}`, {
    method: 'POST',
    body: formData,
  });
}

export async function uploadInvitedManagementBrandAsset(
  token: string,
  assetType: 'logo' | 'favicon' | 'login-background',
  file: File,
): Promise<{ url: string; assetType: string }> {
  const formData = new FormData();
  formData.append('file', file);

  return api.postForm(`/auth/accept-management-company-invite/${token}/branding-assets/${assetType}`, formData);
}

function ensureFaviconLink(): HTMLLinkElement | null {
  if (typeof document === 'undefined') return null;

  let link = document.querySelector("link[rel='icon']") as HTMLLinkElement | null;
  if (!link) {
    link = document.createElement('link');
    link.rel = 'icon';
    document.head.appendChild(link);
  }
  return link;
}

export function applyManagementBrandingDocument(
  branding?: ManagementBranding | null,
): () => void {
  if (typeof document === 'undefined') return () => {};

  const previousTitle = document.title;
  const favicon = ensureFaviconLink();
  const previousHref = favicon?.getAttribute('href') ?? null;

  document.title =
    branding?.companyPortalTitle?.trim() ||
    branding?.companyName?.trim() ||
    'Management Portal';

  const nextHref =
    branding?.companyFaviconUrl || branding?.companyLogoUrl || previousHref || '/logo/nexari.png';
  if (favicon && nextHref) favicon.setAttribute('href', nextHref);

  return () => {
    document.title = previousTitle;
    if (!favicon) return;
    if (previousHref) favicon.setAttribute('href', previousHref);
    else favicon.removeAttribute('href');
  };
}