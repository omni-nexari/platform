import { z } from 'zod';

export const LoginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
});
export type LoginInput = z.infer<typeof LoginSchema>;

export const LoginTotpSchema = z.object({
  token: z.string().length(6).regex(/^\d+$/),
  tempToken: z.string(),
});
export type LoginTotpInput = z.infer<typeof LoginTotpSchema>;

export const ForgotPasswordSchema = z.object({
  email: z.string().email(),
});

export const ResetPasswordSchema = z.object({
  token: z.string().min(1),
  password: z.string().min(8),
});
export type ResetPasswordInput = z.infer<typeof ResetPasswordSchema>;

export const AcceptInviteSchema = z.object({
  name: z.string().min(1).max(120),
  password: z.string().min(8),
});
export type AcceptInviteInput = z.infer<typeof AcceptInviteSchema>;

export const AcceptOwnerInviteSchema = AcceptInviteSchema.extend({
  orgName: z.string().min(2).max(100),
  orgSlug: z.string().min(2).max(50).regex(/^[a-z0-9-]+$/),
  workspaceName: z.string().min(2).max(100),
  workspaceTimezone: z.string().min(1).default('UTC'),
});
export type AcceptOwnerInviteInput = z.infer<typeof AcceptOwnerInviteSchema>;
