import { z } from 'zod';

// ── Enums ────────────────────────────────────────────────────────────────────
export const SUPPORT_CATEGORIES = ['bug', 'feature_request', 'billing', 'general'] as const;
export const SUPPORT_STATUSES   = ['open', 'in_progress', 'resolved', 'closed']    as const;
export const SUPPORT_PRIORITIES = ['low', 'medium', 'high', 'urgent']               as const;
export const SUPPORT_PARTY_TYPES = ['management_company', 'client_org']              as const;
export const SUPPORT_SENDER_TYPES = ['superadmin', 'reseller', 'client']             as const;

export type SupportCategory   = typeof SUPPORT_CATEGORIES[number];
export type SupportStatus     = typeof SUPPORT_STATUSES[number];
export type SupportPriority   = typeof SUPPORT_PRIORITIES[number];
export type SupportPartyType  = typeof SUPPORT_PARTY_TYPES[number];
export type SupportSenderType = typeof SUPPORT_SENDER_TYPES[number];

// ── Create ticket ─────────────────────────────────────────────────────────────
export const CreateSupportTicketSchema = z.object({
  partyType: z.enum(SUPPORT_PARTY_TYPES),
  /** Must be provided when partyType='management_company' */
  companyId: z.string().uuid().optional(),
  /** Must be provided when partyType='client_org' */
  orgId: z.string().uuid().optional(),
  /**
   * When a reseller opens a ticket *on behalf of* one of their client orgs
   * the companyId holds the reseller and orgId holds the client org.
   */
  category: z.enum(SUPPORT_CATEGORIES).default('general'),
  subject: z.string().min(5).max(200),
  priority: z.enum(SUPPORT_PRIORITIES).default('medium'),
  /** Optional first message body */
  message: z.string().min(1).max(10000).optional(),
});
export type CreateSupportTicketInput = z.infer<typeof CreateSupportTicketSchema>;

// ── Reply to ticket ──────────────────────────────────────────────────────────
export const ReplyToTicketSchema = z.object({
  body: z.string().min(1).max(10000),
  /** Optional array of already-uploaded attachment URLs */
  attachmentUrls: z.array(z.string().url()).max(5).optional(),
});
export type ReplyToTicketInput = z.infer<typeof ReplyToTicketSchema>;

// ── Update ticket (superadmin only) ─────────────────────────────────────────
export const UpdateTicketSchema = z.object({
  status: z.enum(SUPPORT_STATUSES).optional(),
  priority: z.enum(SUPPORT_PRIORITIES).optional(),
  assignedToOwnerId: z.string().uuid().nullable().optional(),
});
export type UpdateTicketInput = z.infer<typeof UpdateTicketSchema>;

// ── Response shapes ──────────────────────────────────────────────────────────
export interface SupportTicketSummary {
  id: string;
  partyType: SupportPartyType;
  partyName: string;        // company name or org name
  companyId: string | null;
  orgId: string | null;
  submittedByName: string;
  submittedByEmail: string;
  category: SupportCategory;
  subject: string;
  status: SupportStatus;
  priority: SupportPriority;
  assignedToOwnerId: string | null;
  closedAt: string | null;
  messageCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface SupportTicketMessage {
  id: string;
  ticketId: string;
  senderType: SupportSenderType;
  senderId: string;
  senderName: string;
  body: string;
  attachmentUrls: string[];
  createdAt: string;
}

export interface SupportTicketDetail extends SupportTicketSummary {
  messages: SupportTicketMessage[];
}

// ── Unread count (per-portal) ────────────────────────────────────────────────
export interface SupportUnreadCount {
  unread: number;
}
