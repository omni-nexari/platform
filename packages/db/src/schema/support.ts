import {
  pgTable,
  uuid,
  text,
  timestamp,
} from 'drizzle-orm/pg-core';
import { managementCompanies } from './management.js';
import { organizations } from './auth.js';

// ---------------------------------------------------------------------------
// Support tickets — communication channel between superadmin ↔ resellers
// and superadmin ↔ client orgs.  Resellers may also open tickets on behalf
// of their client orgs (partyType='client_org', companyId set to the
// originating reseller so attribution is retained).
// ---------------------------------------------------------------------------
export const supportTickets = pgTable('support_tickets', {
  id: uuid('id').primaryKey().defaultRandom(),
  /** 'management_company' | 'client_org' */
  partyType: text('party_type').notNull(),
  /** Set when the ticket comes from (or on behalf of) a reseller */
  companyId: uuid('company_id').references(() => managementCompanies.id, { onDelete: 'set null' }),
  /** Set when the ticket comes from a client org */
  orgId: uuid('org_id').references(() => organizations.id, { onDelete: 'set null' }),
  /** management_company_admins.id — bare FK (avoids cross-schema import) */
  submittedByAdminId: uuid('submitted_by_admin_id'),
  /** users.id — bare FK */
  submittedByUserId: uuid('submitted_by_user_id'),
  /** Name of the person who submitted (denormalized for display) */
  submittedByName: text('submitted_by_name').notNull().default(''),
  /** Email of the submitter — for sending reply notifications */
  submittedByEmail: text('submitted_by_email').notNull().default(''),
  /** 'bug' | 'feature_request' | 'billing' | 'general' */
  category: text('category').notNull().default('general'),
  subject: text('subject').notNull(),
  /** 'open' | 'in_progress' | 'resolved' | 'closed' */
  status: text('status').notNull().default('open'),
  /** 'low' | 'medium' | 'high' | 'urgent' */
  priority: text('priority').notNull().default('medium'),
  /** platformOwners.id — bare FK */
  assignedToOwnerId: uuid('assigned_to_owner_id'),
  closedAt: timestamp('closed_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

// ---------------------------------------------------------------------------
// Support ticket messages — the threaded conversation within a ticket.
// Attachments are stored as URLs in `attachmentUrls` (newline-delimited).
// ---------------------------------------------------------------------------
export const supportTicketMessages = pgTable('support_ticket_messages', {
  id: uuid('id').primaryKey().defaultRandom(),
  ticketId: uuid('ticket_id')
    .notNull()
    .references(() => supportTickets.id, { onDelete: 'cascade' }),
  /** 'superadmin' | 'reseller' | 'client' */
  senderType: text('sender_type').notNull(),
  /** The actual sender's id (platform_owner.id / management_company_admin.id / user.id) */
  senderId: uuid('sender_id').notNull(),
  senderName: text('sender_name').notNull(),
  body: text('body').notNull(),
  /** Newline-delimited list of local asset URLs — e.g. /api/v1/support/attachments/abc.png */
  attachmentUrls: text('attachment_urls'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});
