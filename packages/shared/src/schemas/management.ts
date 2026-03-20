import { z } from 'zod';

export const BrandingFontPresetSchema = z.enum(['modern', 'editorial', 'geometric', 'mono']);
export type BrandingFontPreset = z.infer<typeof BrandingFontPresetSchema>;

const assetUrl = z.string().refine((value) => {
  if (value.startsWith('/')) return true;
  return /^https?:\/\/\S+$/i.test(value);
}, 'Enter a valid URL');

// ---------------------------------------------------------------------------
// Management company
// ---------------------------------------------------------------------------
export const ManagementCompanySchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  slug: z.string(),
  billingEmail: z.string().email().nullable(),
  logoUrl: z.string().nullable().optional(),
  portalTitle: z.string().nullable().optional(),
  faviconUrl: z.string().nullable().optional(),
  primaryColor: z.string().nullable().optional(),
  accentColor: z.string().nullable().optional(),
  sidebarBg: z.string().nullable().optional(),
  headingFontPreset: BrandingFontPresetSchema.nullable().optional(),
  bodyFontPreset: BrandingFontPresetSchema.nullable().optional(),
  loginBackgroundUrl: z.string().nullable().optional(),
  suspendedAt: z.string().datetime().nullable(),
  deletedAt: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
});
export type ManagementCompany = z.infer<typeof ManagementCompanySchema>;

const hexColor = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Use a 6-digit hex color like #1f6feb');

export const ManagementCompanyBrandingSchema = z.object({
  portalTitle: z.string().min(2).max(120).nullable().optional(),
  logoUrl: assetUrl.nullable().optional(),
  faviconUrl: assetUrl.nullable().optional(),
  primaryColor: hexColor.nullable().optional(),
  accentColor: hexColor.nullable().optional(),
  sidebarBg: hexColor.nullable().optional(),
  headingFontPreset: BrandingFontPresetSchema.nullable().optional(),
  bodyFontPreset: BrandingFontPresetSchema.nullable().optional(),
  loginBackgroundUrl: assetUrl.nullable().optional(),
});
export type ManagementCompanyBrandingInput = z.infer<typeof ManagementCompanyBrandingSchema>;

export const CreateManagementCompanySchema = z.object({
  /** email of the first admin to invite immediately after creation */
  initialAdminEmail: z.string().email(),
  initialAdminName: z.string().min(1).max(120),
});
export type CreateManagementCompanyInput = z.infer<typeof CreateManagementCompanySchema>;

// ---------------------------------------------------------------------------
// Management company admin
// ---------------------------------------------------------------------------
export const ManagementCompanyAdminSchema = z.object({
  id: z.string().uuid(),
  managementCompanyId: z.string().uuid(),
  email: z.string().email(),
  name: z.string().nullable(),
  role: z.enum(['owner', 'admin', 'billing']),
  lastLogin: z.string().datetime().nullable(),
  suspendedAt: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
});
export type ManagementCompanyAdmin = z.infer<typeof ManagementCompanyAdminSchema>;

export const InviteManagementCompanyAdminSchema = z.object({
  email: z.string().email(),
  name: z.string().min(1).max(120).optional(),
  role: z.enum(['owner', 'admin', 'billing']).default('admin'),
});
export type InviteManagementCompanyAdminInput = z.infer<
  typeof InviteManagementCompanyAdminSchema
>;

export const AcceptManagementCompanyInviteSchema = z.object({
  name: z.string().min(1, 'Your full name is required').max(120),
  password: z.string().min(8, 'Password must be at least 8 characters'),
  /** Filled in by the first (owner) admin when the company is still pending setup */
  companyName: z.string().min(2).max(120).optional(),
  companyPortalUrl: z
    .string()
    .min(2)
    .max(60)
    .regex(/^[a-z0-9-]+$/, 'Use lowercase letters, numbers and hyphens only')
    .optional(),
  billingEmail: z.string().email().optional().or(z.literal('')),
  logoUrl: assetUrl.optional().or(z.literal('')),
  portalTitle: z.string().min(2).max(120).optional(),
  faviconUrl: assetUrl.optional().or(z.literal('')),
  primaryColor: hexColor.optional(),
  accentColor: hexColor.optional(),
  sidebarBg: hexColor.optional(),
  headingFontPreset: BrandingFontPresetSchema.optional(),
  bodyFontPreset: BrandingFontPresetSchema.optional(),
  loginBackgroundUrl: assetUrl.optional().or(z.literal('')),
  createOwnerDashboardAccount: z.boolean().optional(),
  ownerOrgName: z.string().min(2).max(120).optional().or(z.literal('')),
  ownerOrgSlug: z
    .string()
    .min(2)
    .max(60)
    .regex(/^[a-z0-9-]+$/, 'Use lowercase letters, numbers and hyphens only')
    .optional()
    .or(z.literal('')),
  ownerWorkspaceName: z.string().min(2).max(120).optional().or(z.literal('')),
  ownerWorkspaceTimezone: z.string().min(1).optional().or(z.literal('')),
}).superRefine((value, ctx) => {
  if (!value.createOwnerDashboardAccount) return;

  if (!value.ownerOrgName) {
    ctx.addIssue({ code: 'custom', path: ['ownerOrgName'], message: 'Organization name is required' });
  }
  if (!value.ownerOrgSlug) {
    ctx.addIssue({ code: 'custom', path: ['ownerOrgSlug'], message: 'Organization slug is required' });
  }
  if (!value.ownerWorkspaceName) {
    ctx.addIssue({ code: 'custom', path: ['ownerWorkspaceName'], message: 'Workspace name is required' });
  }
  if (!value.ownerWorkspaceTimezone) {
    ctx.addIssue({ code: 'custom', path: ['ownerWorkspaceTimezone'], message: 'Workspace timezone is required' });
  }
});
export type AcceptManagementCompanyInviteInput = z.infer<
  typeof AcceptManagementCompanyInviteSchema
>;

// ---------------------------------------------------------------------------
// Client org owner invite (sent by management company admin)
// ---------------------------------------------------------------------------
export const InviteClientOrgOwnerSchema = z.object({
  ownerEmail: z.string().email(),
  ownerName: z.string().min(1).max(120),
});
export type InviteClientOrgOwnerInput = z.infer<typeof InviteClientOrgOwnerSchema>;

export const AcceptClientOrgInviteSchema = z.object({
  name: z.string().min(1).max(120),
  password: z.string().min(8),
  orgName: z.string().min(2).max(100),
  orgSlug: z
    .string()
    .min(2)
    .max(50)
    .regex(/^[a-z0-9-]+$/, 'Slug must be lowercase letters, numbers, and hyphens'),
  workspaceName: z.string().min(2).max(100),
  workspaceTimezone: z.string().min(1).default('UTC'),
});
export type AcceptClientOrgInviteInput = z.infer<typeof AcceptClientOrgInviteSchema>;
