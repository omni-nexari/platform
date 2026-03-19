import { z } from 'zod';
import { ORG_ROLES } from '../types/roles.js';

export const UserSchema = z.object({
  id: z.string().uuid(),
  orgId: z.string().uuid(),
  email: z.string().email(),
  name: z.string(),
  avatarUrl: z.string().nullable(),
  orgRole: z.enum(ORG_ROLES),
  status: z.enum(['active', 'suspended']),
  totpEnabled: z.boolean(),
  lastLogin: z.string().datetime().nullable(),
});
export type User = z.infer<typeof UserSchema>;

export const UpdateUserSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  avatarUrl: z.string().url().nullable().optional(),
});
export type UpdateUserInput = z.infer<typeof UpdateUserSchema>;
