import { db, tagAssignments, workspaceTags, tagCategories } from '@signage/db';
import { and, eq, inArray, asc } from 'drizzle-orm';

export type TaggedEntityType = 'device' | 'content' | 'playlist' | 'schedule';

export interface StructuredTag {
  id: string;
  name: string;
  color: string | null;
  categoryId: string;
  categoryName: string;
  categoryColor: string;
}

export async function getAssignedTagsForEntities(
  workspaceId: string,
  entityType: TaggedEntityType,
  entityIds: string[],
): Promise<Record<string, StructuredTag[]>> {
  if (entityIds.length === 0) return {};

  const rows = await db
    .select({
      entityId: tagAssignments.entityId,
      id: workspaceTags.id,
      name: workspaceTags.name,
      color: workspaceTags.color,
      categoryId: tagCategories.id,
      categoryName: tagCategories.name,
      categoryColor: tagCategories.color,
    })
    .from(tagAssignments)
    .innerJoin(workspaceTags, eq(workspaceTags.id, tagAssignments.tagId))
    .innerJoin(tagCategories, eq(tagCategories.id, workspaceTags.categoryId))
    .where(and(
      eq(tagAssignments.workspaceId, workspaceId),
      eq(tagAssignments.entityType, entityType),
      inArray(tagAssignments.entityId, entityIds),
    ))
    .orderBy(
      asc(tagCategories.position),
      asc(workspaceTags.position),
      asc(workspaceTags.createdAt),
    );

  const result: Record<string, StructuredTag[]> = {};
  for (const entityId of entityIds) result[entityId] = [];
  for (const row of rows) {
    if (!result[row.entityId]) result[row.entityId] = [];
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    result[row.entityId]!.push({
      id: row.id,
      name: row.name,
      color: row.color,
      categoryId: row.categoryId,
      categoryName: row.categoryName,
      categoryColor: row.categoryColor,
    });
  }

  return result;
}

export async function getEntityIdsForTags(
  workspaceId: string,
  entityType: TaggedEntityType,
  tagIds: string[],
): Promise<string[]> {
  if (tagIds.length === 0) return [];

  const rows = await db
    .selectDistinct({ entityId: tagAssignments.entityId })
    .from(tagAssignments)
    .where(and(
      eq(tagAssignments.workspaceId, workspaceId),
      eq(tagAssignments.entityType, entityType),
      inArray(tagAssignments.tagId, tagIds),
    ))
    .orderBy(asc(tagAssignments.entityId));

  return rows.map((row) => row.entityId);
}

export async function cloneEntityTags(
  workspaceId: string,
  entityType: TaggedEntityType,
  sourceEntityId: string,
  targetEntityId: string,
): Promise<void> {
  const sourceRows = await db
    .select({ tagId: tagAssignments.tagId })
    .from(tagAssignments)
    .where(and(
      eq(tagAssignments.workspaceId, workspaceId),
      eq(tagAssignments.entityType, entityType),
      eq(tagAssignments.entityId, sourceEntityId),
    ));

  if (sourceRows.length === 0) return;

  await db.insert(tagAssignments).values(
    sourceRows.map((row) => ({
      tagId: row.tagId,
      entityId: targetEntityId,
      entityType,
      workspaceId,
    })),
  ).onConflictDoNothing();
}