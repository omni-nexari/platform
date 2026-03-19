import type { FastifyInstance } from 'fastify';
import {
  db, schedules, scheduleSlots, workspaceMembers, playlists, contentItems,
} from '@signage/db';
import { eq, and, isNull, desc, ilike, inArray, sql, getTableColumns } from 'drizzle-orm';
import { cloneEntityTags, getAssignedTagsForEntities, getEntityIdsForTags } from '../services/entityTags.js';

type AuthUser = { sub: string; orgId: string; role: string };

async function checkWorkspaceAccess(workspaceId: string, userId: string) {
  return db.query.workspaceMembers.findFirst({
    where: and(
      eq(workspaceMembers.workspaceId, workspaceId),
      eq(workspaceMembers.userId, userId),
    ),
  });
}

interface SlotPayload {
  playlistId?: string | undefined;
  contentId?: string | undefined;
  startTime: string;
  endTime: string;
  recurrenceType: 'once' | 'daily' | 'weekly';
  date?: string | undefined;
  daysOfWeek?: number[] | undefined;
  label?: string | undefined;
  color: string;
  priority?: number | undefined;
}

export async function scheduleRoutes(app: FastifyInstance) {

  // ── GET /schedules?workspaceId=&search= ──────────────────────────────────
  app.get('/', { onRequest: [app.authenticate] }, async (req, reply) => {
    const user = req.user as AuthUser;
    const { workspaceId, search, tagIds: rawTagIds } = req.query as { workspaceId?: string; search?: string; tagIds?: string };
    if (!workspaceId) return reply.status(400).send({ error: 'workspaceId required' });

    const member = await checkWorkspaceAccess(workspaceId, user.sub);
    if (!member) return reply.status(403).send({ error: 'Forbidden' });

    const tagIds = (rawTagIds ?? '').split(',').map((value) => value.trim()).filter(Boolean);
    const matchingIds = tagIds.length > 0 ? await getEntityIdsForTags(workspaceId, 'schedule', tagIds) : null;
    if (matchingIds && matchingIds.length === 0) return reply.send([]);

    const rows = await db.select({
      ...getTableColumns(schedules),
      slotCount: sql<number>`(
        select count(*)::int from schedule_slots
        where schedule_slots.schedule_id = ${schedules.id}
      )`.as('slot_count'),
    }).from(schedules)
      .where(and(
        eq(schedules.workspaceId, workspaceId),
        isNull(schedules.deletedAt),
        matchingIds ? inArray(schedules.id, matchingIds) : undefined,
        search ? ilike(schedules.name, `%${search}%`) : undefined,
      ))
      .orderBy(desc(schedules.updatedAt));

    const assignedTagMap = await getAssignedTagsForEntities(workspaceId, 'schedule', rows.map((row) => row.id));
    return reply.send(rows.map((row) => ({ ...row, assignedTags: assignedTagMap[row.id] ?? [] })));
  });

  // ── GET /schedules/:id ───────────────────────────────────────────────────
  app.get('/:id', { onRequest: [app.authenticate] }, async (req, reply) => {
    const user = req.user as AuthUser;
    const { id } = req.params as { id: string };

    const schedule = await db.query.schedules.findFirst({
      where: and(eq(schedules.id, id), isNull(schedules.deletedAt)),
    });
    if (!schedule) return reply.status(404).send({ error: 'Not found' });

    const member = await checkWorkspaceAccess(schedule.workspaceId, user.sub);
    if (!member) return reply.status(403).send({ error: 'Forbidden' });

    const slots = await db.query.scheduleSlots.findMany({
      where: eq(scheduleSlots.scheduleId, id),
      orderBy: [scheduleSlots.startTime],
    });

    const playlistIds = slots.map(s => s.playlistId).filter((v): v is string => v != null);
    const contentIds = slots.map(s => s.contentId).filter((v): v is string => v != null);

    const [plRows, cRows] = await Promise.all([
      playlistIds.length > 0
        ? db.query.playlists.findMany({ where: and(inArray(playlists.id, playlistIds), isNull(playlists.deletedAt)) })
        : Promise.resolve([]),
      contentIds.length > 0
        ? db.query.contentItems.findMany({ where: and(inArray(contentItems.id, contentIds), isNull(contentItems.deletedAt)) })
        : Promise.resolve([]),
    ]);

    const plMap = Object.fromEntries(plRows.map(p => [p.id, p]));
    const cMap = Object.fromEntries(cRows.map(c => [c.id, c]));

    const enrichedSlots = slots.map(slot => ({
      ...slot,
      playlist: slot.playlistId ? (plMap[slot.playlistId] ?? null) : null,
      content: slot.contentId ? (cMap[slot.contentId] ?? null) : null,
    }));

    const assignedTagMap = await getAssignedTagsForEntities(schedule.workspaceId, 'schedule', [schedule.id]);
    return reply.send({ ...schedule, assignedTags: assignedTagMap[schedule.id] ?? [], slots: enrichedSlots });
  });

  // ── POST /schedules ──────────────────────────────────────────────────────
  app.post('/', { onRequest: [app.authenticate] }, async (req, reply) => {
    const user = req.user as AuthUser;
    const body = req.body as {
      workspaceId: string;
      name: string;
      description?: string | undefined;
      type?: string | undefined;
    };
    const { workspaceId, name, description, type } = body;
    if (!workspaceId || !name?.trim()) {
      return reply.status(400).send({ error: 'workspaceId and name required' });
    }

    const member = await checkWorkspaceAccess(workspaceId, user.sub);
    if (!member) return reply.status(403).send({ error: 'Forbidden' });

    const [schedule] = await db.insert(schedules).values({
      workspaceId,
      createdBy: user.sub,
      name: name.trim(),
      description: description ?? null,
      type: type ?? 'general',
    }).returning();

    return reply.status(201).send(schedule);
  });

  // ── PATCH /schedules/:id ─────────────────────────────────────────────────
  app.patch('/:id', { onRequest: [app.authenticate] }, async (req, reply) => {
    const user = req.user as AuthUser;
    const { id } = req.params as { id: string };
    const body = req.body as {
      name?: string | undefined;
      description?: string | null | undefined;
      type?: string | undefined;
      isActive?: boolean | undefined;
    };

    const schedule = await db.query.schedules.findFirst({
      where: and(eq(schedules.id, id), isNull(schedules.deletedAt)),
    });
    if (!schedule) return reply.status(404).send({ error: 'Not found' });

    const member = await checkWorkspaceAccess(schedule.workspaceId, user.sub);
    if (!member) return reply.status(403).send({ error: 'Forbidden' });

    const patch: Record<string, unknown> = { updatedAt: new Date() };
    if (body.name !== undefined) patch['name'] = body.name.trim();
    if (body.description !== undefined) patch['description'] = body.description;
    if (body.type !== undefined) patch['type'] = body.type;
    if (body.isActive !== undefined) patch['isActive'] = body.isActive;

    const [updated] = await db.update(schedules)
      .set(patch)
      .where(and(eq(schedules.id, id), isNull(schedules.deletedAt)))
      .returning();

    return reply.send(updated);
  });

  // ── DELETE /schedules/:id (soft) ─────────────────────────────────────────
  app.delete('/:id', { onRequest: [app.authenticate] }, async (req, reply) => {
    const user = req.user as AuthUser;
    const { id } = req.params as { id: string };

    const schedule = await db.query.schedules.findFirst({
      where: and(eq(schedules.id, id), isNull(schedules.deletedAt)),
    });
    if (!schedule) return reply.status(404).send({ error: 'Not found' });

    const member = await checkWorkspaceAccess(schedule.workspaceId, user.sub);
    if (!member) return reply.status(403).send({ error: 'Forbidden' });

    await db.update(schedules)
      .set({ deletedAt: new Date() })
      .where(eq(schedules.id, id));

    return reply.send({ ok: true });
  });

  // ── PUT /schedules/:id/slots (atomic replace) ────────────────────────────
  app.put('/:id/slots', { onRequest: [app.authenticate] }, async (req, reply) => {
    const user = req.user as AuthUser;
    const { id } = req.params as { id: string };
    const slots = req.body as SlotPayload[];

    if (!Array.isArray(slots)) return reply.status(400).send({ error: 'Body must be an array of slots' });

    const schedule = await db.query.schedules.findFirst({
      where: and(eq(schedules.id, id), isNull(schedules.deletedAt)),
    });
    if (!schedule) return reply.status(404).send({ error: 'Not found' });

    const member = await checkWorkspaceAccess(schedule.workspaceId, user.sub);
    if (!member) return reply.status(403).send({ error: 'Forbidden' });

    await db.transaction(async (tx) => {
      await tx.delete(scheduleSlots).where(eq(scheduleSlots.scheduleId, id));
      if (slots.length > 0) {
        await tx.insert(scheduleSlots).values(
          slots.map(s => ({
            scheduleId: id,
            playlistId: s.playlistId ?? null,
            contentId: s.contentId ?? null,
            startTime: s.startTime,
            endTime: s.endTime,
            recurrenceType: s.recurrenceType,
            date: s.date ?? null,
            daysOfWeek: s.daysOfWeek ?? null,
            label: s.label ?? null,
            color: s.color,
            priority: s.priority ?? 0,
          })),
        );
      }
    });

    // Update the schedule's updatedAt
    await db.update(schedules)
      .set({ updatedAt: new Date() })
      .where(eq(schedules.id, id));

    return reply.send({ ok: true });
  });

  // ── POST /schedules/:id/clone ────────────────────────────────────────────
  app.post('/:id/clone', { onRequest: [app.authenticate] }, async (req, reply) => {
    const user = req.user as AuthUser;
    const { id } = req.params as { id: string };

    const orig = await db.query.schedules.findFirst({
      where: and(eq(schedules.id, id), isNull(schedules.deletedAt)),
    });
    if (!orig) return reply.status(404).send({ error: 'Not found' });

    const member = await checkWorkspaceAccess(orig.workspaceId, user.sub);
    if (!member) return reply.status(403).send({ error: 'Forbidden' });

    const [cloned] = await db.insert(schedules).values({
      workspaceId: orig.workspaceId,
      createdBy: user.sub,
      name: `${orig.name} (copy)`,
      description: orig.description,
      type: orig.type,
      isActive: false,
    }).returning();

    if (cloned) {
      await cloneEntityTags(orig.workspaceId, 'schedule', orig.id, cloned.id);
    }

    const origSlots = await db.query.scheduleSlots.findMany({
      where: eq(scheduleSlots.scheduleId, id),
    });

    if (origSlots.length > 0 && cloned) {
      await db.insert(scheduleSlots).values(
        origSlots.map(s => ({
          scheduleId: cloned.id,
          playlistId: s.playlistId,
          contentId: s.contentId,
          startTime: s.startTime,
          endTime: s.endTime,
          recurrenceType: s.recurrenceType,
          date: s.date,
          daysOfWeek: s.daysOfWeek,
          label: s.label,
          color: s.color,
          priority: s.priority,
        })),
      );
    }

    return reply.status(201).send(cloned);
  });
}
