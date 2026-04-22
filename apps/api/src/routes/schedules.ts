import type { FastifyInstance } from 'fastify';
import {
  db, schedules, scheduleSlots, scheduleBlackouts, workspaceMembers, playlists, contentItems,
} from '@signage/db';
import { eq, and, isNull, desc, asc, ilike, inArray, sql, getTableColumns } from 'drizzle-orm';
import { cloneEntityTags, getAssignedTagsForEntities, getEntityIdsForTags } from '../services/entityTags.js';
import { dispatchWebhookEvent } from '../services/webhooks.js';

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
  syncGroupId?: string | undefined;
  syncPlaylistId?: string | undefined;
  startTime: string;
  endTime: string;
  recurrenceType: 'once' | 'daily' | 'weekly' | 'monthly' | 'bi-weekly';
  date?: string | undefined;
  daysOfWeek?: number[] | undefined;
  monthDay?: number | undefined;
  intervalWeeks?: number | undefined;
  recurrenceStartDate?: string | undefined;
  recurrenceEndDate?: string | undefined;
  label?: string | undefined;
  color: string;
  priority?: number | undefined;
}

/** Convert HH:MM to minutes-since-midnight for comparison */
function timeToMinutes(t: string): number {
  const [h = '0', m = '0'] = t.split(':');
  return parseInt(h, 10) * 60 + parseInt(m, 10);
}

/** True when two slots have overlapping days + time ranges (4-E). */
function slotsOverlap(a: SlotPayload, b: SlotPayload): boolean {
  if (a.recurrenceType === 'once' && b.recurrenceType === 'once') {
    if (a.date !== b.date) return false;
  } else if (a.recurrenceType === 'once' || b.recurrenceType === 'once') {
    return false; // once vs recurring: player resolves via priority
  }

  if (
    (a.recurrenceType === 'weekly' || a.recurrenceType === 'bi-weekly') &&
    (b.recurrenceType === 'weekly' || b.recurrenceType === 'bi-weekly')
  ) {
    const aDays = new Set(a.daysOfWeek ?? []);
    const bDays = new Set(b.daysOfWeek ?? []);
    if (![...aDays].some(d => bDays.has(d))) return false;
  }

  const aStart = timeToMinutes(a.startTime);
  const aEnd   = timeToMinutes(a.endTime);
  const bStart = timeToMinutes(b.startTime);
  const bEnd   = timeToMinutes(b.endTime);
  return aStart < bEnd && bStart < aEnd;
}

/** Maps a SlotPayload to the DB insert shape. */
function slotToInsert(scheduleId: string) {
  return (s: SlotPayload) => ({
    scheduleId,
    playlistId: s.playlistId ?? null,
    contentId: s.contentId ?? null,
    syncGroupId: s.syncGroupId ?? null,
    syncPlaylistId: s.syncPlaylistId ?? null,
    startTime: s.startTime,
    endTime: s.endTime,
    recurrenceType: s.recurrenceType,
    date: s.date ?? null,
    daysOfWeek: s.daysOfWeek ?? null,
    monthDay: s.monthDay ?? null,
    intervalWeeks: s.intervalWeeks ?? 1,
    recurrenceStartDate: s.recurrenceStartDate ?? null,
    recurrenceEndDate: s.recurrenceEndDate ?? null,
    label: s.label ?? null,
    color: s.color,
    priority: s.priority ?? 0,
  });
}

type SlotRow = typeof scheduleSlots.$inferSelect;

/** 4-F: Whether a slot is active on the given date. */
function slotMatchesDate(slot: SlotRow, at: Date): boolean {
  const dateStr = at.toISOString().slice(0, 10);
  if (slot.recurrenceStartDate && dateStr < slot.recurrenceStartDate) return false;
  if (slot.recurrenceEndDate   && dateStr > slot.recurrenceEndDate)   return false;

  if (slot.recurrenceType === 'daily') return true;
  if (slot.recurrenceType === 'once') return slot.date === dateStr;

  // JS: 0=Sun … 6=Sat → schema: 0=Mon … 6=Sun
  const jsDay = at.getDay();
  const schemaDay = jsDay === 0 ? 6 : jsDay - 1;

  if (slot.recurrenceType === 'monthly') return at.getDate() === (slot.monthDay ?? 1);

  const days = slot.daysOfWeek ?? [];
  if (slot.recurrenceType === 'weekly') return days.includes(schemaDay);

  if (slot.recurrenceType === 'bi-weekly') {
    if (!days.includes(schemaDay)) return false;
    if (slot.recurrenceStartDate) {
      const origin = new Date(slot.recurrenceStartDate);
      const diffWeeks = Math.floor((at.getTime() - origin.getTime()) / (7 * 24 * 60 * 60 * 1000));
      return diffWeeks % (slot.intervalWeeks ?? 2) === 0;
    }
    return true;
  }
  return false;
}

/** 4-F: Resolve the highest-priority active slot for a given instant. */
function resolveActiveSlot(slots: SlotRow[], at: Date): SlotRow | null {
  const atMinutes = at.getHours() * 60 + at.getMinutes();
  const candidates = slots.filter(slot => {
    if (!slotMatchesDate(slot, at)) return false;
    return atMinutes >= timeToMinutes(slot.startTime) && atMinutes < timeToMinutes(slot.endTime);
  });
  if (candidates.length === 0) return null;
  return candidates.reduce((best, s) => (s.priority > best.priority ? s : best), candidates[0]!);
}

export async function scheduleRoutes(app: FastifyInstance) {

  // ── GET /schedules?workspaceId=&search=&page=&limit= ─────────────────────
  app.get('/', { onRequest: [app.authenticate] }, async (req, reply) => {
    const user = req.user as AuthUser;
    const { workspaceId, search, tagIds: rawTagIds, page: rawPage, limit: rawLimit } = req.query as {
      workspaceId?: string; search?: string; tagIds?: string; page?: string; limit?: string;
    };
    if (!workspaceId) return reply.status(400).send({ error: 'workspaceId required' });

    const page = Math.max(Number(rawPage ?? 1), 1);
    const limit = Math.min(Number(rawLimit ?? 50), 200);
    const offset = (page - 1) * limit;

    const member = await checkWorkspaceAccess(workspaceId, user.sub);
    if (!member) return reply.status(403).send({ error: 'Forbidden' });

    const tagIds = (rawTagIds ?? '').split(',').map((value) => value.trim()).filter(Boolean);
    const matchingIds = tagIds.length > 0 ? await getEntityIdsForTags(workspaceId, 'schedule', tagIds) : null;
    if (matchingIds && matchingIds.length === 0) return reply.send({ items: [], total: 0, page, limit });

    const conditions = and(
      eq(schedules.workspaceId, workspaceId),
      isNull(schedules.deletedAt),
      matchingIds ? inArray(schedules.id, matchingIds) : undefined,
      search ? ilike(schedules.name, `%${search}%`) : undefined,
    );

    const [rows, totalResult] = await Promise.all([
      db.select({
        ...getTableColumns(schedules),
        slotCount: sql<number>`(
          select count(*)::int from schedule_slots
          where schedule_slots.schedule_id = ${schedules.id}
        )`.as('slot_count'),
      }).from(schedules)
        .where(conditions)
        .orderBy(desc(schedules.updatedAt))
        .limit(limit)
        .offset(offset),
      db.select({ count: sql<number>`count(*)::int` })
        .from(schedules)
        .where(conditions)
        .then((r) => r[0]?.count ?? 0),
    ]);

    const assignedTagMap = await getAssignedTagsForEntities(workspaceId, 'schedule', rows.map((row) => row.id));
    return reply.send({
      items: rows.map((row) => ({ ...row, assignedTags: assignedTagMap[row.id] ?? [] })),
      total: totalResult,
      page,
      limit,
    });
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

    const [plRows, cRows, blackoutRows] = await Promise.all([
      playlistIds.length > 0
        ? db.query.playlists.findMany({ where: and(inArray(playlists.id, playlistIds), isNull(playlists.deletedAt)) })
        : Promise.resolve([]),
      contentIds.length > 0
        ? db.query.contentItems.findMany({ where: and(inArray(contentItems.id, contentIds), isNull(contentItems.deletedAt)) })
        : Promise.resolve([]),
      db.query.scheduleBlackouts.findMany({
        where: eq(scheduleBlackouts.scheduleId, id),
        orderBy: [asc(scheduleBlackouts.date)],
      }),
    ]);

    const plMap = Object.fromEntries(plRows.map(p => [p.id, p]));
    const cMap = Object.fromEntries(cRows.map(c => [c.id, c]));

    const enrichedSlots = slots.map(slot => ({
      ...slot,
      playlist: slot.playlistId ? (plMap[slot.playlistId] ?? null) : null,
      content: slot.contentId ? (cMap[slot.contentId] ?? null) : null,
    }));

    const assignedTagMap = await getAssignedTagsForEntities(schedule.workspaceId, 'schedule', [schedule.id]);
    return reply.send({ ...schedule, assignedTags: assignedTagMap[schedule.id] ?? [], slots: enrichedSlots, blackouts: blackoutRows });
  });

  // ── POST /schedules ──────────────────────────────────────────────────────
  app.post('/', { onRequest: [app.authenticate] }, async (req, reply) => {
    const user = req.user as AuthUser;
    const body = req.body as {
      workspaceId: string;
      name: string;
      description?: string | undefined;
      type?: string | undefined;
      timezone?: string | undefined;
    };
    const { workspaceId, name, description, type, timezone } = body;
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
      timezone: timezone ?? 'UTC',
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
      timezone?: string | undefined;
      defaultPlaylistId?: string | null | undefined;
      defaultContentId?: string | null | undefined;
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
    if (body.timezone !== undefined) patch['timezone'] = body.timezone;
    if (body.defaultPlaylistId !== undefined) patch['defaultPlaylistId'] = body.defaultPlaylistId ?? null;
    if (body.defaultContentId !== undefined) patch['defaultContentId'] = body.defaultContentId ?? null;

    const [updated] = await db.update(schedules)
      .set(patch)
      .where(and(eq(schedules.id, id), isNull(schedules.deletedAt)))
      .returning();

    if (body.isActive !== undefined && updated) {
      void dispatchWebhookEvent(user.orgId,
        body.isActive ? 'schedule.activated' : 'schedule.deactivated',
        { scheduleId: id, scheduleName: updated.name, workspaceId: schedule.workspaceId },
      );
    }

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
    const { force } = req.query as { force?: string };
    const slots = req.body as SlotPayload[];

    if (!Array.isArray(slots)) return reply.status(400).send({ error: 'Body must be an array of slots' });

    const schedule = await db.query.schedules.findFirst({
      where: and(eq(schedules.id, id), isNull(schedules.deletedAt)),
    });
    if (!schedule) return reply.status(404).send({ error: 'Not found' });

    const member = await checkWorkspaceAccess(schedule.workspaceId, user.sub);
    if (!member) return reply.status(403).send({ error: 'Forbidden' });

    // 4-E: Conflict detection — skip when ?force=true
    if (force !== 'true') {
      const conflicts: Array<{ slotA: number; slotB: number }> = [];
      for (let i = 0; i < slots.length; i++) {
        for (let j = i + 1; j < slots.length; j++) {
          const a = slots[i]!;
          const b = slots[j]!;
          if (slotsOverlap(a, b)) conflicts.push({ slotA: i, slotB: j });
        }
      }
      if (conflicts.length > 0) {
        return reply.status(400).send({ error: 'Slot conflicts detected', conflicts });
      }
    }

    await db.transaction(async (tx) => {
      await tx.delete(scheduleSlots).where(eq(scheduleSlots.scheduleId, id));
      if (slots.length > 0) {
        await tx.insert(scheduleSlots).values(slots.map(slotToInsert(id)));
      }
    });

    await db.update(schedules).set({ updatedAt: new Date() }).where(eq(schedules.id, id));
    return reply.send({ ok: true });
  });

  // ── POST /schedules/:id/slots (add single slot) ─────────────────────────
  app.post('/:id/slots', { onRequest: [app.authenticate] }, async (req, reply) => {
    const user = req.user as AuthUser;
    const { id } = req.params as { id: string };
    const s = req.body as SlotPayload;

    if (!s.startTime || !s.endTime || !s.recurrenceType || !s.color) {
      return reply.status(400).send({ error: 'startTime, endTime, recurrenceType, and color required' });
    }

    const schedule = await db.query.schedules.findFirst({
      where: and(eq(schedules.id, id), isNull(schedules.deletedAt)),
    });
    if (!schedule) return reply.status(404).send({ error: 'Not found' });

    const member = await checkWorkspaceAccess(schedule.workspaceId, user.sub);
    if (!member) return reply.status(403).send({ error: 'Forbidden' });

    const [slot] = await db.insert(scheduleSlots).values(slotToInsert(id)(s)).returning();
    await db.update(schedules).set({ updatedAt: new Date() }).where(eq(schedules.id, id));
    return reply.status(201).send(slot);
  });

  // ── PATCH /schedules/:id/slots/:slotId (update single slot) ──────────────
  app.patch('/:id/slots/:slotId', { onRequest: [app.authenticate] }, async (req, reply) => {
    const user = req.user as AuthUser;
    const { id, slotId } = req.params as { id: string; slotId: string };
    const body = req.body as Partial<SlotPayload>;

    const schedule = await db.query.schedules.findFirst({
      where: and(eq(schedules.id, id), isNull(schedules.deletedAt)),
    });
    if (!schedule) return reply.status(404).send({ error: 'Not found' });

    const member = await checkWorkspaceAccess(schedule.workspaceId, user.sub);
    if (!member) return reply.status(403).send({ error: 'Forbidden' });

    const slot = await db.query.scheduleSlots.findFirst({
      where: eq(scheduleSlots.id, slotId),
    });
    if (!slot || slot.scheduleId !== id) return reply.status(404).send({ error: 'Slot not found' });

    const patch: Record<string, unknown> = { updatedAt: new Date() };
    if (body.playlistId !== undefined) patch['playlistId'] = body.playlistId ?? null;
    if (body.contentId !== undefined) patch['contentId'] = body.contentId ?? null;
    if (body.syncGroupId !== undefined) patch['syncGroupId'] = body.syncGroupId ?? null;
    if (body.syncPlaylistId !== undefined) patch['syncPlaylistId'] = body.syncPlaylistId ?? null;
    if (body.startTime !== undefined) patch['startTime'] = body.startTime;
    if (body.endTime !== undefined) patch['endTime'] = body.endTime;
    if (body.recurrenceType !== undefined) patch['recurrenceType'] = body.recurrenceType;
    if (body.date !== undefined) patch['date'] = body.date ?? null;
    if (body.daysOfWeek !== undefined) patch['daysOfWeek'] = body.daysOfWeek ?? null;
    if (body.monthDay !== undefined) patch['monthDay'] = body.monthDay ?? null;
    if (body.intervalWeeks !== undefined) patch['intervalWeeks'] = body.intervalWeeks ?? 1;
    if (body.recurrenceStartDate !== undefined) patch['recurrenceStartDate'] = body.recurrenceStartDate ?? null;
    if (body.recurrenceEndDate !== undefined) patch['recurrenceEndDate'] = body.recurrenceEndDate ?? null;
    if (body.label !== undefined) patch['label'] = body.label ?? null;
    if (body.color !== undefined) patch['color'] = body.color;
    if (body.priority !== undefined) patch['priority'] = body.priority;

    const [updated] = await db.update(scheduleSlots).set(patch).where(eq(scheduleSlots.id, slotId)).returning();
    await db.update(schedules).set({ updatedAt: new Date() }).where(eq(schedules.id, id));
    return reply.send(updated);
  });

  // ── DELETE /schedules/:id/slots/:slotId ──────────────────────────────────
  app.delete('/:id/slots/:slotId', { onRequest: [app.authenticate] }, async (req, reply) => {
    const user = req.user as AuthUser;
    const { id, slotId } = req.params as { id: string; slotId: string };

    const schedule = await db.query.schedules.findFirst({
      where: and(eq(schedules.id, id), isNull(schedules.deletedAt)),
    });
    if (!schedule) return reply.status(404).send({ error: 'Not found' });

    const member = await checkWorkspaceAccess(schedule.workspaceId, user.sub);
    if (!member) return reply.status(403).send({ error: 'Forbidden' });

    const slot = await db.query.scheduleSlots.findFirst({
      where: eq(scheduleSlots.id, slotId),
    });
    if (!slot || slot.scheduleId !== id) return reply.status(404).send({ error: 'Slot not found' });

    await db.delete(scheduleSlots).where(eq(scheduleSlots.id, slotId));
    await db.update(schedules).set({ updatedAt: new Date() }).where(eq(schedules.id, id));
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
          monthDay: s.monthDay,
          intervalWeeks: s.intervalWeeks,
          recurrenceStartDate: s.recurrenceStartDate,
          recurrenceEndDate: s.recurrenceEndDate,
          label: s.label,
          color: s.color,
          priority: s.priority,
        })),
      );
    }

    return reply.status(201).send(cloned);
  });

  // ── GET /schedules/:id/preview?at=ISO  (4-F) ─────────────────────────────
  app.get('/:id/preview', { onRequest: [app.authenticate] }, async (req, reply) => {
    const user = req.user as AuthUser;
    const { id } = req.params as { id: string };
    const { at: atStr } = req.query as { at?: string };

    const schedule = await db.query.schedules.findFirst({
      where: and(eq(schedules.id, id), isNull(schedules.deletedAt)),
    });
    if (!schedule) return reply.status(404).send({ error: 'Not found' });

    const member = await checkWorkspaceAccess(schedule.workspaceId, user.sub);
    if (!member) return reply.status(403).send({ error: 'Forbidden' });

    const at = atStr ? new Date(atStr) : new Date();
    if (isNaN(at.getTime())) return reply.status(400).send({ error: 'Invalid at date' });

    const dateStr = at.toISOString().slice(0, 10);

    // Check blackouts first
    const blackout = await db.query.scheduleBlackouts.findFirst({
      where: and(eq(scheduleBlackouts.scheduleId, id), eq(scheduleBlackouts.date, dateStr)),
    });
    if (blackout) {
      return reply.send({ activeSlot: null, blackout });
    }

    const slots = await db.query.scheduleSlots.findMany({
      where: eq(scheduleSlots.scheduleId, id),
    });

    const activeSlot = resolveActiveSlot(slots, at);

    // If no slot active, check fallback
    if (!activeSlot && (schedule.defaultPlaylistId || schedule.defaultContentId)) {
      return reply.send({
        activeSlot: null,
        fallback: {
          playlistId: schedule.defaultPlaylistId,
          contentId: schedule.defaultContentId,
        },
        at: at.toISOString(),
      });
    }

    return reply.send({ activeSlot, at: at.toISOString() });
  });

  // ── PUT /schedules/:id/blackouts  (4-H) ──────────────────────────────────
  app.put('/:id/blackouts', { onRequest: [app.authenticate] }, async (req, reply) => {
    const user = req.user as AuthUser;
    const { id } = req.params as { id: string };
    const body = req.body as Array<{ date: string; label?: string }>;

    if (!Array.isArray(body)) return reply.status(400).send({ error: 'Body must be an array' });

    const schedule = await db.query.schedules.findFirst({
      where: and(eq(schedules.id, id), isNull(schedules.deletedAt)),
    });
    if (!schedule) return reply.status(404).send({ error: 'Not found' });

    const member = await checkWorkspaceAccess(schedule.workspaceId, user.sub);
    if (!member || member.role === 'viewer') return reply.status(403).send({ error: 'Forbidden' });

    await db.delete(scheduleBlackouts).where(eq(scheduleBlackouts.scheduleId, id));
    if (body.length > 0) {
      await db.insert(scheduleBlackouts).values(
        body.map(b => ({
          scheduleId: id,
          date: b.date,
          label: b.label ?? null,
        })),
      );
    }

    const updated = await db.query.scheduleBlackouts.findMany({
      where: eq(scheduleBlackouts.scheduleId, id),
      orderBy: [asc(scheduleBlackouts.date)],
    });
    await db.update(schedules).set({ updatedAt: new Date() }).where(eq(schedules.id, id));
    return reply.send(updated);
  });

  // ── GET /schedules/:id/export  (4-I) ─────────────────────────────────────
  app.get('/:id/export', { onRequest: [app.authenticate] }, async (req, reply) => {
    const user = req.user as AuthUser;
    const { id } = req.params as { id: string };

    const schedule = await db.query.schedules.findFirst({
      where: and(eq(schedules.id, id), isNull(schedules.deletedAt)),
    });
    if (!schedule) return reply.status(404).send({ error: 'Not found' });

    const member = await checkWorkspaceAccess(schedule.workspaceId, user.sub);
    if (!member) return reply.status(403).send({ error: 'Forbidden' });

    const [slots, blackouts] = await Promise.all([
      db.query.scheduleSlots.findMany({ where: eq(scheduleSlots.scheduleId, id) }),
      db.query.scheduleBlackouts.findMany({ where: eq(scheduleBlackouts.scheduleId, id) }),
    ]);

    // Enrich slots with playlist/content names for portability
    const playlistIds = slots.map(s => s.playlistId).filter((v): v is string => v != null);
    const contentIds  = slots.map(s => s.contentId).filter((v): v is string => v != null);
    const [plRows, cRows] = await Promise.all([
      playlistIds.length > 0
        ? db.query.playlists.findMany({ where: inArray(playlists.id, playlistIds), columns: { id: true, name: true } })
        : Promise.resolve([]),
      contentIds.length > 0
        ? db.query.contentItems.findMany({ where: inArray(contentItems.id, contentIds), columns: { id: true, name: true } })
        : Promise.resolve([]),
    ]);
    const plNameMap = Object.fromEntries(plRows.map(p => [p.id, p.name]));
    const cNameMap  = Object.fromEntries(cRows.map(c => [c.id, c.name]));

    const exportPayload = {
      exportVersion: 1,
      name: schedule.name,
      description: schedule.description,
      type: schedule.type,
      timezone: schedule.timezone,
      slots: slots.map(s => ({
        startTime: s.startTime,
        endTime: s.endTime,
        recurrenceType: s.recurrenceType,
        date: s.date,
        daysOfWeek: s.daysOfWeek,
        monthDay: s.monthDay,
        intervalWeeks: s.intervalWeeks,
        recurrenceStartDate: s.recurrenceStartDate,
        recurrenceEndDate: s.recurrenceEndDate,
        label: s.label,
        color: s.color,
        priority: s.priority,
        playlistName: s.playlistId ? (plNameMap[s.playlistId] ?? null) : null,
        contentName: s.contentId  ? (cNameMap[s.contentId] ?? null) : null,
      })),
      blackouts: blackouts.map(b => ({ date: b.date, label: b.label })),
    };

    reply.header('Content-Type', 'application/json');
    reply.header('Content-Disposition', `attachment; filename="schedule-${id}.json"`);
    return reply.send(exportPayload);
  });

  // ── POST /schedules/import  (4-I) ─────────────────────────────────────────
  app.post('/import', { onRequest: [app.authenticate] }, async (req, reply) => {
    const user = req.user as AuthUser;
    const body = req.body as {
      workspaceId?: string;
      name?: string;
      exportPayload?: {
        name: string;
        description?: string;
        type?: string;
        timezone?: string;
        slots?: Array<{
          startTime: string;
          endTime: string;
          recurrenceType: string;
          date?: string;
          daysOfWeek?: number[];
          monthDay?: number;
          intervalWeeks?: number;
          recurrenceStartDate?: string;
          recurrenceEndDate?: string;
          label?: string;
          color?: string;
          priority?: number;
          playlistName?: string;
          contentName?: string;
        }>;
        blackouts?: Array<{ date: string; label?: string }>;
      };
    };

    if (!body.workspaceId) return reply.status(400).send({ error: 'workspaceId required' });
    if (!body.exportPayload) return reply.status(400).send({ error: 'exportPayload required' });

    const member = await checkWorkspaceAccess(body.workspaceId, user.sub);
    if (!member || member.role === 'viewer') return reply.status(403).send({ error: 'Forbidden' });

    const ep = body.exportPayload;

    const [newSchedule] = await db.insert(schedules).values({
      workspaceId: body.workspaceId,
      createdBy: user.sub,
      name: (body.name ?? ep.name ?? 'Imported Schedule').trim(),
      description: ep.description ?? null,
      type: ep.type ?? 'general',
      timezone: ep.timezone ?? 'UTC',
      isActive: false,
    }).returning();
    if (!newSchedule) return reply.status(500).send({ error: 'Failed to create schedule' });

    const importedSlots = ep.slots ?? [];
    const slotsToInsert: Array<ReturnType<ReturnType<typeof slotToInsert>>> = [];
    const unresolved: number[] = [];

    for (let idx = 0; idx < importedSlots.length; idx++) {
      const s = importedSlots[idx]!;
      let resolvedPlaylistId: string | null = null;
      let resolvedContentId: string | null = null;

      if (s.playlistName) {
        const found = await db.query.playlists.findFirst({
          where: and(
            eq(playlists.workspaceId, body.workspaceId),
            eq(playlists.name, s.playlistName),
            isNull(playlists.deletedAt),
          ),
          columns: { id: true },
        });
        resolvedPlaylistId = found?.id ?? null;
        if (!resolvedPlaylistId) unresolved.push(idx);
      }

      if (s.contentName && !resolvedPlaylistId) {
        const found = await db.query.contentItems.findFirst({
          where: and(
            eq(contentItems.workspaceId, body.workspaceId),
            eq(contentItems.name, s.contentName),
            isNull(contentItems.deletedAt),
          ),
          columns: { id: true },
        });
        resolvedContentId = found?.id ?? null;
        if (!resolvedContentId && !s.playlistName) unresolved.push(idx);
      }

      slotsToInsert.push(slotToInsert(newSchedule.id)({
        playlistId: resolvedPlaylistId ?? undefined,
        contentId: resolvedContentId ?? undefined,
        startTime: s.startTime,
        endTime: s.endTime,
        recurrenceType: (s.recurrenceType as SlotPayload['recurrenceType']) ?? 'weekly',
        date: s.date,
        daysOfWeek: s.daysOfWeek,
        monthDay: s.monthDay,
        intervalWeeks: s.intervalWeeks,
        recurrenceStartDate: s.recurrenceStartDate,
        recurrenceEndDate: s.recurrenceEndDate,
        label: s.label,
        color: s.color ?? '#3b82f6',
        priority: s.priority,
      }));
    }

    if (slotsToInsert.length > 0) {
      await db.insert(scheduleSlots).values(slotsToInsert);
    }

    if (ep.blackouts && ep.blackouts.length > 0) {
      await db.insert(scheduleBlackouts).values(
        ep.blackouts.map(b => ({ scheduleId: newSchedule.id, date: b.date, label: b.label ?? null })),
      );
    }

    return reply.status(201).send({
      schedule: newSchedule,
      importedSlots: slotsToInsert.length,
      unresolved,
    });
  });
}
