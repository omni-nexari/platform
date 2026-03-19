import { z } from 'zod';
import { WORKSPACE_ROLES } from '../types/roles.js';

export const WorkspaceSchema = z.object({
  id: z.string().uuid(),
  orgId: z.string().uuid(),
  name: z.string(),
  slug: z.string(),
  timezone: z.string(),
});
export type Workspace = z.infer<typeof WorkspaceSchema>;

export const SmartViewEntityTypeSchema = z.enum(['content', 'playlist', 'schedule', 'device']);
export type SmartViewEntityType = z.infer<typeof SmartViewEntityTypeSchema>;

export const SmartViewFiltersSchema = z.record(z.unknown());

export const SmartViewSchema = z.object({
  id: z.string().uuid(),
  workspaceId: z.string().uuid(),
  entityType: SmartViewEntityTypeSchema,
  name: z.string().min(1).max(80),
  filters: SmartViewFiltersSchema,
  createdBy: z.string().uuid().nullable().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type SmartView = z.infer<typeof SmartViewSchema>;

export const CreateSmartViewSchema = z.object({
  workspaceId: z.string().uuid(),
  entityType: SmartViewEntityTypeSchema,
  name: z.string().trim().min(1).max(80),
  filters: SmartViewFiltersSchema.default({}),
});
export type CreateSmartViewInput = z.infer<typeof CreateSmartViewSchema>;

export const CreateWorkspaceSchema = z.object({
  name: z.string().min(2).max(100),
  slug: z.string().min(2).max(50).regex(/^[a-z0-9-]+$/),
  timezone: z.string().min(1).default('UTC'),
});
export type CreateWorkspaceInput = z.infer<typeof CreateWorkspaceSchema>;

export const AddWorkspaceMemberSchema = z.object({
  userId: z.string().uuid(),
  role: z.enum(WORKSPACE_ROLES),
});
export type AddWorkspaceMemberInput = z.infer<typeof AddWorkspaceMemberSchema>;
