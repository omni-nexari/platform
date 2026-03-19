// Temporary diagnostic file — safe to delete
import { db, contentItems, playlists, schedules, workspaceMembers } from '@signage/db';
import { eq, and, isNull, desc, getTableColumns, sql } from 'drizzle-orm';
import { getAssignedTagsForEntities } from '../src/services/entityTags.js';

const wsId = '89c9f3c9-a4d5-4483-ba04-582f7ab2715e';

console.log('Testing content list query...');
try {
  const rows = await db.select({
    ...getTableColumns(contentItems),
  }).from(contentItems)
    .where(and(eq(contentItems.workspaceId, wsId), isNull(contentItems.deletedAt)))
    .orderBy(desc(contentItems.createdAt))
    .limit(5);
  console.log('  content rows:', rows.length, '- OK');

  const tagMap = await getAssignedTagsForEntities(wsId, 'content', rows.map(r => r.id));
  console.log('  getAssignedTagsForEntities:', Object.keys(tagMap).length, 'keys - OK');
} catch (err: unknown) {
  console.error('  FAILED:', (err as Error).message);
  console.error((err as Error).stack);
}

console.log('Testing playlist list query...');
try {
  const rows = await db.select({
    ...getTableColumns(playlists),
  }).from(playlists)
    .where(and(eq(playlists.workspaceId, wsId), isNull(playlists.deletedAt)))
    .orderBy(desc(playlists.updatedAt));
  console.log('  playlist rows:', rows.length, '- OK');

  const tagMap = await getAssignedTagsForEntities(wsId, 'playlist', rows.map(r => r.id));
  console.log('  getAssignedTagsForEntities:', Object.keys(tagMap).length, 'keys - OK');
} catch (err: unknown) {
  console.error('  FAILED:', (err as Error).message);
  console.error((err as Error).stack);
}

console.log('Testing schedule list query...');
try {
  const rows = await db.select({
    ...getTableColumns(schedules),
  }).from(schedules)
    .where(and(eq(schedules.workspaceId, wsId), isNull(schedules.deletedAt)))
    .orderBy(desc(schedules.updatedAt));
  console.log('  schedule rows:', rows.length, '- OK');

  const tagMap = await getAssignedTagsForEntities(wsId, 'schedule', rows.map(r => r.id));
  console.log('  getAssignedTagsForEntities:', Object.keys(tagMap).length, 'keys - OK');
} catch (err: unknown) {
  console.error('  FAILED:', (err as Error).message);
  console.error((err as Error).stack);
}

process.exit(0);
