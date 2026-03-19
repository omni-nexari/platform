import { z } from 'zod';

export const OrgSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  slug: z.string(),
  plan: z.enum(['starter', 'pro', 'enterprise']),
  suspendedAt: z.string().datetime().nullable(),
});
export type Org = z.infer<typeof OrgSchema>;

export const CreateOrgSchema = z.object({
  ownerEmail: z.string().email(),
  ownerName: z.string().min(1).max(120),
});
export type CreateOrgInput = z.infer<typeof CreateOrgSchema>;

export const InviteUserSchema = z.object({
  email: z.string().email(),
  orgRole: z.enum(['admin', 'member']),
});
export type InviteUserInput = z.infer<typeof InviteUserSchema>;
