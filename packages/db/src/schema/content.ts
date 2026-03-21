import {
  relations,
  pgTable,
  uuid,
  text,
  bigint,
  integer,
  timestamp,
} from 'drizzle-orm/pg-core';
import { type AnyPgColumn } from 'drizzle-orm/pg-core';
import { workspaces } from './workspaces.js';
import { users } from './users.js';

export const contentFolders = pgTable('content_folders', {
  id: uuid('id').primaryKey().defaultRandom(),
  workspaceId: uuid('workspace_id').notNull().references((): AnyPgColumn => workspaces.id),
  name: text('name').notNull(),
  parentId: uuid('parent_id'),
  position: integer('position').notNull().default(0),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const contentItems = pgTable('content_items', {
  id: uuid('id').primaryKey().defaultRandom(),
  workspaceId: uuid('workspace_id').notNull().references((): AnyPgColumn => workspaces.id),
  uploadedBy: uuid('uploaded_by').notNull().references(() => users.id),

  // Content type
  type: text('type').notNull(), // image | video | html5 | pdf | presentation | web_url

  // Core fields
  name: text('name').notNull(),
  description: text('description'),
  folderId: uuid('folder_id').references((): AnyPgColumn => contentFolders.id, { onDelete: 'set null' }),

  // File storage
  filePath: text('file_path'),           // relative to STORAGE_ROOT; NULL for web_url
  thumbnailPath: text('thumbnail_path'), // relative to STORAGE_ROOT
  originalName: text('original_name'),
  mimeType: text('mime_type'),
  fileSize: bigint('file_size', { mode: 'number' }),

  // Media properties
  duration: integer('duration'),         // seconds; 0 = manual advance
  width: integer('width'),
  height: integer('height'),
  orientation: text('orientation').notNull().default('any'), // landscape | portrait | any

  // Validity window
  validFrom: timestamp('valid_from', { withTimezone: true }),
  validUntil: timestamp('valid_until', { withTimezone: true }),

  // Approval workflow (optional, enabled per workspace)
  approvalState: text('approval_state').notNull().default('approved'), // draft | pending_review | approved | rejected
  reviewNote: text('review_note'),
  reviewedBy: uuid('reviewed_by').references(() => users.id),
  reviewedAt: timestamp('reviewed_at', { withTimezone: true }),

  // Processing state
  status: text('status').notNull().default('ready'), // processing | ready | error

  // Extra metadata: JSON string (page count for PDF, slide count for PPTX, etc.)
  metadata: text('metadata').notNull().default('{}'),

  // Web URL type fields
  webUrl: text('web_url'),
  refreshInterval: integer('refresh_interval'), // seconds; default 3600

  // Soft delete
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const contentFoldersRelations = relations(contentFolders, ({ one, many }) => ({
  workspace: one(workspaces, {
    fields: [contentFolders.workspaceId],
    references: [workspaces.id],
  }),
  parent: one(contentFolders, {
    fields: [contentFolders.parentId],
    references: [contentFolders.id],
    relationName: 'contentFolderParent',
  }),
  children: many(contentFolders, {
    relationName: 'contentFolderParent',
  }),
  items: many(contentItems),
}));

export const contentItemsRelations = relations(contentItems, ({ one }) => ({
  workspace: one(workspaces, {
    fields: [contentItems.workspaceId],
    references: [workspaces.id],
  }),
  uploader: one(users, {
    fields: [contentItems.uploadedBy],
    references: [users.id],
  }),
  folder: one(contentFolders, {
    fields: [contentItems.folderId],
    references: [contentFolders.id],
  }),
  reviewer: one(users, {
    fields: [contentItems.reviewedBy],
    references: [users.id],
    relationName: 'contentReviewer',
  }),
}));
