import { pgTable, uuid, text, bigint, timestamp } from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { contentItems } from './content.js';
import { users } from './users.js';

export const contentVersions = pgTable('content_versions', {
  id: uuid('id').primaryKey().defaultRandom(),
  contentItemId: uuid('content_item_id').notNull().references(() => contentItems.id, { onDelete: 'cascade' }),
  filePath: text('file_path').notNull(),
  thumbnailPath: text('thumbnail_path'),
  originalName: text('original_name'),
  mimeType: text('mime_type'),
  fileSize: bigint('file_size', { mode: 'number' }),
  fileHash: text('file_hash'),
  uploadedBy: uuid('uploaded_by').references(() => users.id, { onDelete: 'set null' }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const contentVersionsRelations = relations(contentVersions, ({ one }) => ({
  contentItem: one(contentItems, {
    fields: [contentVersions.contentItemId],
    references: [contentItems.id],
  }),
  uploader: one(users, {
    fields: [contentVersions.uploadedBy],
    references: [users.id],
  }),
}));
