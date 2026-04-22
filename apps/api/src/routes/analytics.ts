import type { FastifyInstance } from 'fastify';
import {
  db,
  playEvents,
  devices,
  workspaces,
  workspaceMembers,
  contentItems,
  deviceHeartbeats,
  playlists,
  notifications,
  orgStorageQuotas,
  schedules,
  scheduleSlots,
} from '@signage/db';
import { eq, and, gte, lte, desc, asc, sql, count, sum, isNull, inArray, gt } from 'drizzle-orm';
import PDFDocument from 'pdfkit';
import { createHash, createPublicKey, createSign } from 'node:crypto';

type AuthUser = { sub: string; orgId: string; role: string };

function parseDate(s: string | undefined, fallback: Date): Date {
  if (!s) return fallback;
  const d = new Date(s);
  return isNaN(d.getTime()) ? fallback : d;
}

function buildWhereClause(
  orgId: string,
  wsId?: string,
  from?: Date,
  to?: Date,
  deviceId?: string,
  contentId?: string,
) {
  return and(
    eq(workspaces.orgId, orgId),
    isNull(workspaces.deletedAt),
    wsId ? eq(devices.workspaceId, wsId) : undefined,
    deviceId ? eq(playEvents.deviceId, deviceId) : undefined,
    contentId ? eq(playEvents.contentId, contentId) : undefined,
    from ? gte(playEvents.startedAt, from) : undefined,
    to ? lte(playEvents.startedAt, to) : undefined,
  );
}

function formatDuration(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  if (totalSeconds < 60) return `${totalSeconds}s`;
  if (totalSeconds < 3600) return `${Math.floor(totalSeconds / 60)}m ${totalSeconds % 60}s`;
  return `${Math.floor(totalSeconds / 3600)}h ${Math.floor((totalSeconds % 3600) / 60)}m`;
}

function signProofOfPlayPayload(payload: unknown) {
  const privateKeyPem = process.env['PROOF_OF_PLAY_SIGNING_PRIVATE_KEY'];
  if (!privateKeyPem) {
    throw new Error('Missing PROOF_OF_PLAY_SIGNING_PRIVATE_KEY');
  }

  const signer = createSign('RSA-SHA256');
  signer.update(JSON.stringify(payload));
  signer.end();

  const publicKeyPem = createPublicKey(privateKeyPem)
    .export({ type: 'spki', format: 'pem' })
    .toString();

  return {
    algorithm: 'RSA-SHA256',
    signatureBase64: signer.sign(privateKeyPem, 'base64'),
    publicKeyFingerprint: createHash('sha256').update(publicKeyPem).digest('hex'),
  };
}

async function renderPdfBuffer(draw: (doc: PDFKit.PDFDocument) => void): Promise<Buffer> {
  const doc = new PDFDocument({ margin: 40, size: 'A4' });
  const chunks: Buffer[] = [];

  return await new Promise<Buffer>((resolve, reject) => {
    doc.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    draw(doc);
    doc.end();
  });
}

export async function analyticsRoutes(app: FastifyInstance) {
  app.get('/summary', { onRequest: [app.authenticate] }, async (req, reply) => {
    const actor = req.user as AuthUser;
    const q = req.query as { workspaceId?: string; from?: string; to?: string };

    const to = parseDate(q.to, new Date());
    const from = parseDate(q.from, new Date(to.getTime() - 30 * 86_400_000));
    const where = buildWhereClause(actor.orgId, q.workspaceId, from, to);

    const [totals] = await db
      .select({
        totalPlays: count(),
        totalDurationMs: sum(playEvents.durationMs),
        uniqueDevices: sql<number>`COUNT(DISTINCT ${playEvents.deviceId})::int`,
        uniqueContents: sql<number>`COUNT(DISTINCT ${playEvents.contentId})::int`,
      })
      .from(playEvents)
      .innerJoin(devices, eq(playEvents.deviceId, devices.id))
      .innerJoin(workspaces, eq(devices.workspaceId, workspaces.id))
      .where(where);

    const byDay = await db
      .select({
        date: sql<string>`DATE_TRUNC('day', ${playEvents.startedAt})::DATE::TEXT`,
        plays: count(),
        durationMs: sum(playEvents.durationMs),
      })
      .from(playEvents)
      .innerJoin(devices, eq(playEvents.deviceId, devices.id))
      .innerJoin(workspaces, eq(devices.workspaceId, workspaces.id))
      .where(where)
      .groupBy(sql`DATE_TRUNC('day', ${playEvents.startedAt})`)
      .orderBy(asc(sql`DATE_TRUNC('day', ${playEvents.startedAt})`))
      .limit(90);

    const byContent = await db
      .select({
        contentId: playEvents.contentId,
        contentName: contentItems.name,
        contentType: contentItems.type,
        plays: count(),
        durationMs: sum(playEvents.durationMs),
      })
      .from(playEvents)
      .innerJoin(devices, eq(playEvents.deviceId, devices.id))
      .innerJoin(workspaces, eq(devices.workspaceId, workspaces.id))
      .leftJoin(contentItems, eq(playEvents.contentId, contentItems.id))
      .where(where)
      .groupBy(playEvents.contentId, contentItems.name, contentItems.type)
      .orderBy(desc(count()))
      .limit(20);

    const heartbeatRows = await db
      .select({
        deviceId: devices.id,
        deviceName: devices.name,
        workspaceName: workspaces.name,
        heartbeatCount: count(deviceHeartbeats.id),
        lastHeartbeatAt: sql<string | null>`MAX(${deviceHeartbeats.createdAt})::text`,
        avgCpuLoad: sql<number | null>`AVG(${deviceHeartbeats.cpuLoad})`,
      })
      .from(devices)
      .innerJoin(workspaces, eq(devices.workspaceId, workspaces.id))
      .leftJoin(
        deviceHeartbeats,
        and(
          eq(deviceHeartbeats.deviceId, devices.id),
          gte(deviceHeartbeats.createdAt, from),
          lte(deviceHeartbeats.createdAt, to),
        ),
      )
      .where(
        and(
          eq(workspaces.orgId, actor.orgId),
          isNull(workspaces.deletedAt),
          q.workspaceId ? eq(devices.workspaceId, q.workspaceId) : undefined,
          isNull(devices.deletedAt),
        ),
      )
      .groupBy(devices.id, devices.name, workspaces.name)
      .orderBy(asc(devices.name));

    const expectedHeartbeats = Math.max(1, Math.floor((to.getTime() - from.getTime()) / 30_000));
    const deviceUptime = heartbeatRows.map((row) => ({
      deviceId: row.deviceId,
      deviceName: row.deviceName,
      workspaceName: row.workspaceName,
      heartbeatCount: Number(row.heartbeatCount ?? 0),
      uptimePct: Math.min(
        100,
        Number((((Number(row.heartbeatCount ?? 0)) / expectedHeartbeats) * 100).toFixed(1)),
      ),
      lastHeartbeatAt: row.lastHeartbeatAt,
      avgCpuLoad: row.avgCpuLoad != null ? Number(Number(row.avgCpuLoad).toFixed(1)) : null,
    }));

    const connectivityEvents = await db
      .select({
        deviceId: notifications.entityId,
        deviceName: devices.name,
        workspaceName: workspaces.name,
        type: notifications.type,
        total: count(),
      })
      .from(notifications)
      .innerJoin(devices, eq(notifications.entityId, devices.id))
      .innerJoin(workspaces, eq(devices.workspaceId, workspaces.id))
      .where(
        and(
          eq(notifications.orgId, actor.orgId),
          inArray(notifications.type, ['device_offline', 'device_online']),
          gte(notifications.createdAt, from),
          lte(notifications.createdAt, to),
          q.workspaceId ? eq(devices.workspaceId, q.workspaceId) : undefined,
        ),
      )
      .groupBy(notifications.entityId, devices.name, workspaces.name, notifications.type)
      .orderBy(asc(devices.name));

    const playlistStats = await db
      .select({
        playlistId: playEvents.playlistId,
        playlistName: playlists.name,
        plays: count(),
        completedPlays: sql<number>`COUNT(*) FILTER (WHERE ${playEvents.completedFull})::int`,
      })
      .from(playEvents)
      .innerJoin(devices, eq(playEvents.deviceId, devices.id))
      .innerJoin(workspaces, eq(devices.workspaceId, workspaces.id))
      .innerJoin(playlists, eq(playEvents.playlistId, playlists.id))
      .where(and(where, sql`${playEvents.playlistId} IS NOT NULL`))
      .groupBy(playEvents.playlistId, playlists.name)
      .orderBy(desc(count()))
      .limit(15);

    const [storageUsageRow] = await db
      .select({ usedBytes: sum(contentItems.fileSize) })
      .from(contentItems)
      .innerJoin(workspaces, eq(contentItems.workspaceId, workspaces.id))
      .where(
        and(
          eq(workspaces.orgId, actor.orgId),
          isNull(workspaces.deletedAt),
          isNull(contentItems.deletedAt),
        ),
      );

    const [quotaRow] = await db
      .select({ limitBytes: orgStorageQuotas.limitBytes })
      .from(orgStorageQuotas)
      .where(eq(orgStorageQuotas.orgId, actor.orgId));

    const [deviceCountRow] = await db
      .select({ total: count() })
      .from(devices)
      .where(and(eq(devices.orgId, actor.orgId), isNull(devices.deletedAt)));

    const [scheduleCountRow] = await db
      .select({ total: count() })
      .from(schedules)
      .innerJoin(workspaces, eq(schedules.workspaceId, workspaces.id))
      .where(and(eq(workspaces.orgId, actor.orgId), isNull(schedules.deletedAt)));

    const [activeScheduleCountRow] = await db
      .select({ total: count() })
      .from(schedules)
      .innerJoin(workspaces, eq(schedules.workspaceId, workspaces.id))
      .where(and(eq(workspaces.orgId, actor.orgId), eq(schedules.isActive, true), isNull(schedules.deletedAt)));

    return reply.send({
      totalPlays: Number(totals?.totalPlays ?? 0),
      totalDurationMs: Number(totals?.totalDurationMs ?? 0),
      uniqueDevices: Number(totals?.uniqueDevices ?? 0),
      uniqueContents: Number(totals?.uniqueContents ?? 0),
      byDay: byDay.map((row) => ({
        ...row,
        plays: Number(row.plays),
        durationMs: Number(row.durationMs ?? 0),
      })),
      byContent: byContent.map((row) => ({
        ...row,
        plays: Number(row.plays),
        durationMs: Number(row.durationMs ?? 0),
      })),
      deviceUptime,
      connectivityEvents: connectivityEvents.map((row) => ({
        deviceId: row.deviceId,
        deviceName: row.deviceName,
        workspaceName: row.workspaceName,
        type: row.type,
        total: Number(row.total ?? 0),
      })),
      playlistStats: playlistStats.map((row) => ({
        playlistId: row.playlistId,
        playlistName: row.playlistName,
        plays: Number(row.plays ?? 0),
        completedPlays: Number(row.completedPlays ?? 0),
        completionRatePct:
          Number(row.plays ?? 0) > 0
            ? Number(((Number(row.completedPlays ?? 0) / Number(row.plays ?? 0)) * 100).toFixed(1))
            : 0,
      })),
      orgSummary: {
        storageUsedBytes: Number(storageUsageRow?.usedBytes ?? 0),
        storageLimitBytes: Number(quotaRow?.limitBytes ?? 0),
        deviceCount: Number(deviceCountRow?.total ?? 0),
        scheduleCount: Number(scheduleCountRow?.total ?? 0),
        activeScheduleCount: Number(activeScheduleCountRow?.total ?? 0),
      },
    });
  });

  app.get('/play-events', { onRequest: [app.authenticate] }, async (req, reply) => {
    const actor = req.user as AuthUser;
    const q = req.query as {
      workspaceId?: string;
      contentId?: string;
      deviceId?: string;
      from?: string;
      to?: string;
      page?: string;
      limit?: string;
    };

    const to = parseDate(q.to, new Date());
    const from = parseDate(q.from, new Date(to.getTime() - 30 * 86_400_000));
    const page = Math.max(1, parseInt(q.page ?? '1'));
    const limit = Math.min(500, Math.max(1, parseInt(q.limit ?? '50')));
    const offset = (page - 1) * limit;
    const where = buildWhereClause(actor.orgId, q.workspaceId, from, to, q.deviceId, q.contentId);

    const events = await db
      .select({
        id: playEvents.id,
        deviceId: playEvents.deviceId,
        deviceName: devices.name,
        workspaceId: devices.workspaceId,
        workspaceName: workspaces.name,
        contentId: playEvents.contentId,
        playlistId: playEvents.playlistId,
        scheduleId: playEvents.scheduleId,
        contentName: contentItems.name,
        contentType: contentItems.type,
        playlistName: playlists.name,
        zoneId: playEvents.zoneId,
        startedAt: playEvents.startedAt,
        endedAt: playEvents.endedAt,
        durationMs: playEvents.durationMs,
        completedFull: playEvents.completedFull,
        source: playEvents.source,
      })
      .from(playEvents)
      .innerJoin(devices, eq(playEvents.deviceId, devices.id))
      .innerJoin(workspaces, eq(devices.workspaceId, workspaces.id))
      .leftJoin(contentItems, eq(playEvents.contentId, contentItems.id))
      .leftJoin(playlists, eq(playEvents.playlistId, playlists.id))
      .where(where)
      .orderBy(desc(playEvents.startedAt))
      .limit(limit)
      .offset(offset);

    const totalRows = await db
      .select({ total: count() })
      .from(playEvents)
      .innerJoin(devices, eq(playEvents.deviceId, devices.id))
      .innerJoin(workspaces, eq(devices.workspaceId, workspaces.id))
      .where(where);

    return reply.send({ events, total: Number(totalRows[0]?.total ?? 0), page, limit });
  });

  app.get('/export.csv', { onRequest: [app.authenticate] }, async (req, reply) => {
    const actor = req.user as AuthUser;
    const q = req.query as {
      workspaceId?: string;
      contentId?: string;
      deviceId?: string;
      from?: string;
      to?: string;
    };

    const to = parseDate(q.to, new Date());
    const from = parseDate(q.from, new Date(to.getTime() - 30 * 86_400_000));
    const where = buildWhereClause(actor.orgId, q.workspaceId, from, to, q.deviceId, q.contentId);

    const events = await db
      .select({
        startedAt: playEvents.startedAt,
        endedAt: playEvents.endedAt,
        deviceName: devices.name,
        workspaceName: workspaces.name,
        contentName: contentItems.name,
        contentType: contentItems.type,
        playlistName: playlists.name,
        zoneId: playEvents.zoneId,
        durationMs: playEvents.durationMs,
        completedFull: playEvents.completedFull,
        source: playEvents.source,
      })
      .from(playEvents)
      .innerJoin(devices, eq(playEvents.deviceId, devices.id))
      .innerJoin(workspaces, eq(devices.workspaceId, workspaces.id))
      .leftJoin(contentItems, eq(playEvents.contentId, contentItems.id))
      .leftJoin(playlists, eq(playEvents.playlistId, playlists.id))
      .where(where)
      .orderBy(desc(playEvents.startedAt))
      .limit(50_000);

    const escape = (value: string) => `"${value.replace(/"/g, '""')}"`;
    const headers = [
      'Started At',
      'Ended At',
      'Device',
      'Workspace',
      'Content',
      'Type',
      'Playlist',
      'Zone',
      'Duration (s)',
      'Completed',
      'Source',
    ];

    const rows = events.map((event) => [
      event.startedAt ? new Date(event.startedAt).toISOString() : '',
      event.endedAt ? new Date(event.endedAt).toISOString() : '',
      event.deviceName ?? '',
      event.workspaceName ?? '',
      event.contentName ?? '(unknown)',
      event.contentType ?? '',
      event.playlistName ?? '',
      event.zoneId ?? '',
      (Number(event.durationMs) / 1000).toFixed(1),
      event.completedFull ? 'Yes' : 'No',
      event.source,
    ]);

    const csv = [headers, ...rows].map((row) => row.map(escape).join(',')).join('\r\n');

    void reply.header('Content-Type', 'text/csv; charset=utf-8');
    void reply.header('Content-Disposition', `attachment; filename="proof-of-play-${Date.now()}.csv"`);
    return reply.send(csv);
  });

  app.get('/export.pdf', { onRequest: [app.authenticate] }, async (req, reply) => {
    const actor = req.user as AuthUser;
    const q = req.query as { workspaceId?: string; from?: string; to?: string };

    const to = parseDate(q.to, new Date());
    const from = parseDate(q.from, new Date(to.getTime() - 30 * 86_400_000));
    const where = buildWhereClause(actor.orgId, q.workspaceId, from, to);

    const events = await db
      .select({
        startedAt: playEvents.startedAt,
        endedAt: playEvents.endedAt,
        deviceName: devices.name,
        workspaceName: workspaces.name,
        contentName: contentItems.name,
        playlistName: playlists.name,
        durationMs: playEvents.durationMs,
        completedFull: playEvents.completedFull,
        source: playEvents.source,
      })
      .from(playEvents)
      .innerJoin(devices, eq(playEvents.deviceId, devices.id))
      .innerJoin(workspaces, eq(devices.workspaceId, workspaces.id))
      .leftJoin(contentItems, eq(playEvents.contentId, contentItems.id))
      .leftJoin(playlists, eq(playEvents.playlistId, playlists.id))
      .where(where)
      .orderBy(desc(playEvents.startedAt))
      .limit(200);

    const payload = {
      orgId: actor.orgId,
      workspaceId: q.workspaceId ?? null,
      from: from.toISOString(),
      to: to.toISOString(),
      rowCount: events.length,
      events: events.map((event) => ({
        startedAt: new Date(event.startedAt).toISOString(),
        endedAt: new Date(event.endedAt).toISOString(),
        deviceName: event.deviceName,
        workspaceName: event.workspaceName,
        contentName: event.contentName,
        playlistName: event.playlistName,
        durationMs: Number(event.durationMs ?? 0),
        completedFull: event.completedFull,
        source: event.source,
      })),
    };

    let signature;
    try {
      signature = signProofOfPlayPayload(payload);
    } catch (error) {
      return reply.status(503).send({
        error: error instanceof Error ? error.message : 'Proof of Play signing not configured',
      });
    }

    const pdfBuffer = await renderPdfBuffer((doc) => {
      doc.fontSize(20).text('Proof of Play Report');
      doc.moveDown(0.5);
      doc.fontSize(10).fillColor('#555').text(`Range: ${from.toISOString()} to ${to.toISOString()}`);
      doc.text(`Rows included: ${events.length}`);
      doc.text(`Workspace filter: ${q.workspaceId ?? 'All workspaces'}`);
      doc.moveDown(1);

      doc.fillColor('#000').fontSize(12).text('Playback Events', { underline: true });
      doc.moveDown(0.5);

      for (const event of events) {
        const line = [
          new Date(event.startedAt).toLocaleString(),
          event.deviceName ?? 'Unknown device',
          event.contentName ?? 'Unknown content',
          event.playlistName ?? 'No playlist',
          formatDuration(Number(event.durationMs ?? 0)),
          event.completedFull ? 'Complete' : 'Partial',
        ].join(' | ');

        doc.fontSize(9).text(line, { width: 520 });
        if (doc.y > 730) doc.addPage();
      }

      doc.addPage();
      doc.fontSize(12).text('Digital Signature', { underline: true });
      doc.moveDown(0.5);
      doc.fontSize(9).text(`Algorithm: ${signature.algorithm}`);
      doc.text(`Public key fingerprint: ${signature.publicKeyFingerprint}`);
      doc.moveDown(0.5);
      doc.text('Signature (base64):');
      doc.fontSize(8).text(signature.signatureBase64, { width: 520 });
    });

    void reply.header('Content-Type', 'application/pdf');
    void reply.header('Content-Disposition', `attachment; filename="proof-of-play-${Date.now()}.pdf"`);
    return reply.send(pdfBuffer);
  });

  // ── GET /analytics/schedule-adherence (4-G) ───────────────────────────────
  app.get('/schedule-adherence', { onRequest: [app.authenticate] }, async (req, reply) => {
    const user = req.user as AuthUser;
    const { scheduleId, deviceId, from: fromStr, to: toStr } = req.query as {
      scheduleId?: string;
      deviceId?: string;
      from?: string;
      to?: string;
    };

    if (!scheduleId) return reply.status(400).send({ error: 'scheduleId required' });

    const schedule = await db.query.schedules.findFirst({
      where: eq(schedules.id, scheduleId),
    });
    if (!schedule) return reply.status(404).send({ error: 'Schedule not found' });

    const member = await db.query.workspaceMembers.findFirst({
      where: and(
        eq(workspaceMembers.workspaceId, schedule.workspaceId),
        eq(workspaceMembers.userId, user.sub),
      ),
    });
    if (!member) return reply.status(403).send({ error: 'Forbidden' });

    const now = new Date();
    const from = fromStr ? new Date(fromStr) : new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const to   = toStr   ? new Date(toStr)   : now;

    // Fetch all slots for this schedule
    const slots = await db.query.scheduleSlots.findMany({
      where: eq(scheduleSlots.scheduleId, scheduleId),
    });

    // Fetch actual play events in the window, optionally filtered by device
    const events = await db.select({
      playlistId: playEvents.playlistId,
      contentId: playEvents.contentId,
      deviceId: playEvents.deviceId,
      startedAt: playEvents.startedAt,
      durationMs: playEvents.durationMs,
    }).from(playEvents)
      .where(
        and(
          deviceId ? eq(playEvents.deviceId, deviceId) : undefined,
          gte(playEvents.startedAt, from),
          lte(playEvents.startedAt, to),
        ),
      );

    // Build per-slot adherence
    const adherence = slots.map(slot => {
      // Expected duration per day in seconds: endTime - startTime
      const [sh = '0', sm = '0'] = slot.startTime.split(':');
      const [eh = '0', em = '0'] = slot.endTime.split(':');
      const slotMinutes = (parseInt(eh, 10) * 60 + parseInt(em, 10)) - (parseInt(sh, 10) * 60 + parseInt(sm, 10));
      const expectedSecondsPerOccurrence = Math.max(slotMinutes, 0) * 60;

      // Count how many times the slot should have occurred in the window
      let occurrenceCount = 0;
      const cursor = new Date(from);
      cursor.setHours(0, 0, 0, 0);
      while (cursor <= to) {
        // simple daily check — for a full implementation use slotMatchesDate
        if (slot.recurrenceType === 'daily') occurrenceCount++;
        else if (slot.recurrenceType === 'weekly') {
          const jsDay = cursor.getDay();
          const schemaDay = jsDay === 0 ? 6 : jsDay - 1;
          if ((slot.daysOfWeek ?? []).includes(schemaDay)) occurrenceCount++;
        } else if (slot.recurrenceType === 'once' && slot.date === cursor.toISOString().slice(0, 10)) {
          occurrenceCount++;
        }
        cursor.setDate(cursor.getDate() + 1);
      }

      const expectedSeconds = occurrenceCount * expectedSecondsPerOccurrence;

      // Actual seconds for events matching this slot's playlist/content
      const matchingEvents = events.filter(e =>
        (slot.playlistId && e.playlistId === slot.playlistId) ||
        (slot.contentId && e.contentId === slot.contentId),
      );
      const actualSeconds = matchingEvents.reduce((acc, e) => acc + Number(e.durationMs ?? 0) / 1000, 0);

      return {
        slotId: slot.id,
        label: slot.label,
        startTime: slot.startTime,
        endTime: slot.endTime,
        recurrenceType: slot.recurrenceType,
        playlistId: slot.playlistId,
        contentId: slot.contentId,
        occurrenceCount,
        expectedSeconds,
        actualSeconds,
        adherencePercent: expectedSeconds > 0
          ? Math.min(100, Math.round((actualSeconds / expectedSeconds) * 100))
          : null,
      };
    });

    return reply.send({
      scheduleId,
      deviceId: deviceId ?? null,
      from: from.toISOString(),
      to: to.toISOString(),
      slots: adherence,
    });
  });

  // ── GET /analytics/content/:id  (6-B) ─────────────────────────────────────
  app.get('/content/:id', { onRequest: [app.authenticate] }, async (req, reply) => {
    const actor = req.user as AuthUser;
    const { id } = req.params as { id: string };
    const q = req.query as { from?: string; to?: string };

    const content = await db.query.contentItems.findFirst({
      where: and(eq(contentItems.id, id), isNull(contentItems.deletedAt)),
      columns: { id: true, name: true, type: true, workspaceId: true },
    });
    if (!content) return reply.status(404).send({ error: 'Content not found' });

    // Verify org access
    const ws = await db.query.workspaces.findFirst({
      where: and(eq(workspaces.id, content.workspaceId), eq(workspaces.orgId, actor.orgId)),
    });
    if (!ws) return reply.status(403).send({ error: 'Forbidden' });

    const to   = parseDate(q.to,   new Date());
    const from = parseDate(q.from, new Date(to.getTime() - 30 * 86_400_000));

    const [totals] = await db.select({
      plays: count(),
      totalDurationMs: sum(playEvents.durationMs),
      completedPlays: sql<number>`COUNT(*) FILTER (WHERE ${playEvents.completedFull})::int`,
      uniqueDevices: sql<number>`COUNT(DISTINCT ${playEvents.deviceId})::int`,
    }).from(playEvents)
      .where(and(
        eq(playEvents.contentId, id),
        gte(playEvents.startedAt, from),
        lte(playEvents.startedAt, to),
      ));

    const byDay = await db.select({
      date: sql<string>`DATE_TRUNC('day', ${playEvents.startedAt})::DATE::TEXT`,
      plays: count(),
      durationMs: sum(playEvents.durationMs),
    }).from(playEvents)
      .where(and(
        eq(playEvents.contentId, id),
        gte(playEvents.startedAt, from),
        lte(playEvents.startedAt, to),
      ))
      .groupBy(sql`DATE_TRUNC('day', ${playEvents.startedAt})`)
      .orderBy(asc(sql`DATE_TRUNC('day', ${playEvents.startedAt})`))
      .limit(90);

    const byDevice = await db.select({
      deviceId: playEvents.deviceId,
      deviceName: devices.name,
      plays: count(),
      durationMs: sum(playEvents.durationMs),
    }).from(playEvents)
      .innerJoin(devices, eq(playEvents.deviceId, devices.id))
      .where(and(
        eq(playEvents.contentId, id),
        gte(playEvents.startedAt, from),
        lte(playEvents.startedAt, to),
      ))
      .groupBy(playEvents.deviceId, devices.name)
      .orderBy(desc(count()))
      .limit(20);

    const plays = Number(totals?.plays ?? 0);
    return reply.send({
      content: { id: content.id, name: content.name, type: content.type },
      from: from.toISOString(),
      to: to.toISOString(),
      plays,
      totalDurationMs: Number(totals?.totalDurationMs ?? 0),
      completedPlays: Number(totals?.completedPlays ?? 0),
      completionRatePct: plays > 0
        ? Number(((Number(totals?.completedPlays ?? 0) / plays) * 100).toFixed(1))
        : 0,
      uniqueDevices: Number(totals?.uniqueDevices ?? 0),
      byDay: byDay.map(r => ({ date: r.date, plays: Number(r.plays), durationMs: Number(r.durationMs ?? 0) })),
      byDevice: byDevice.map(r => ({ deviceId: r.deviceId, deviceName: r.deviceName, plays: Number(r.plays), durationMs: Number(r.durationMs ?? 0) })),
    });
  });

  // ── GET /analytics/playlists/:id  (6-C) ───────────────────────────────────
  app.get('/playlists/:id', { onRequest: [app.authenticate] }, async (req, reply) => {
    const actor = req.user as AuthUser;
    const { id } = req.params as { id: string };
    const q = req.query as { from?: string; to?: string };

    const playlist = await db.query.playlists.findFirst({
      where: and(eq(playlists.id, id), isNull(playlists.deletedAt)),
      columns: { id: true, name: true, workspaceId: true },
    });
    if (!playlist) return reply.status(404).send({ error: 'Playlist not found' });

    const ws = await db.query.workspaces.findFirst({
      where: and(eq(workspaces.id, playlist.workspaceId), eq(workspaces.orgId, actor.orgId)),
    });
    if (!ws) return reply.status(403).send({ error: 'Forbidden' });

    const to   = parseDate(q.to,   new Date());
    const from = parseDate(q.from, new Date(to.getTime() - 30 * 86_400_000));

    const [totals] = await db.select({
      plays: count(),
      totalDurationMs: sum(playEvents.durationMs),
      completedPlays: sql<number>`COUNT(*) FILTER (WHERE ${playEvents.completedFull})::int`,
      uniqueDevices: sql<number>`COUNT(DISTINCT ${playEvents.deviceId})::int`,
    }).from(playEvents)
      .where(and(
        eq(playEvents.playlistId, id),
        gte(playEvents.startedAt, from),
        lte(playEvents.startedAt, to),
      ));

    const byContent = await db.select({
      contentId: playEvents.contentId,
      contentName: contentItems.name,
      contentType: contentItems.type,
      plays: count(),
      completedPlays: sql<number>`COUNT(*) FILTER (WHERE ${playEvents.completedFull})::int`,
      durationMs: sum(playEvents.durationMs),
    }).from(playEvents)
      .leftJoin(contentItems, eq(playEvents.contentId, contentItems.id))
      .where(and(
        eq(playEvents.playlistId, id),
        gte(playEvents.startedAt, from),
        lte(playEvents.startedAt, to),
      ))
      .groupBy(playEvents.contentId, contentItems.name, contentItems.type)
      .orderBy(desc(count()))
      .limit(50);

    const plays = Number(totals?.plays ?? 0);
    return reply.send({
      playlist: { id: playlist.id, name: playlist.name },
      from: from.toISOString(),
      to: to.toISOString(),
      plays,
      totalDurationMs: Number(totals?.totalDurationMs ?? 0),
      completedPlays: Number(totals?.completedPlays ?? 0),
      completionRatePct: plays > 0
        ? Number(((Number(totals?.completedPlays ?? 0) / plays) * 100).toFixed(1))
        : 0,
      uniqueDevices: Number(totals?.uniqueDevices ?? 0),
      byContent: byContent.map(r => {
        const p = Number(r.plays);
        const c = Number(r.completedPlays ?? 0);
        return {
          contentId: r.contentId,
          contentName: r.contentName,
          contentType: r.contentType,
          plays: p,
          completedPlays: c,
          completionRatePct: p > 0 ? Number(((c / p) * 100).toFixed(1)) : 0,
          durationMs: Number(r.durationMs ?? 0),
        };
      }),
    });
  });

  // ── GET /analytics/storage  (6-D) ─────────────────────────────────────────
  app.get('/storage', { onRequest: [app.authenticate] }, async (req, reply) => {
    const actor = req.user as AuthUser;
    const { workspaceId } = req.query as { workspaceId?: string };

    if (workspaceId) {
      const member = await db.query.workspaceMembers.findFirst({
        where: and(
          eq(workspaceMembers.workspaceId, workspaceId),
          eq(workspaceMembers.userId, actor.sub),
        ),
      });
      if (!member) return reply.status(403).send({ error: 'Forbidden' });
    }

    const byType = await db.select({
      type: contentItems.type,
      count: count(),
      totalBytes: sum(contentItems.fileSize),
    }).from(contentItems)
      .innerJoin(workspaces, eq(contentItems.workspaceId, workspaces.id))
      .where(and(
        eq(workspaces.orgId, actor.orgId),
        isNull(workspaces.deletedAt),
        isNull(contentItems.deletedAt),
        workspaceId ? eq(contentItems.workspaceId, workspaceId) : undefined,
      ))
      .groupBy(contentItems.type)
      .orderBy(desc(sum(contentItems.fileSize)));

    const [totalRow] = await db.select({ totalBytes: sum(contentItems.fileSize) })
      .from(contentItems)
      .innerJoin(workspaces, eq(contentItems.workspaceId, workspaces.id))
      .where(and(
        eq(workspaces.orgId, actor.orgId),
        isNull(workspaces.deletedAt),
        isNull(contentItems.deletedAt),
        workspaceId ? eq(contentItems.workspaceId, workspaceId) : undefined,
      ));

    const [quotaRow] = await db.select({ limitBytes: orgStorageQuotas.limitBytes })
      .from(orgStorageQuotas)
      .where(eq(orgStorageQuotas.orgId, actor.orgId));

    const usedBytes  = Number(totalRow?.totalBytes ?? 0);
    const limitBytes = Number(quotaRow?.limitBytes ?? 0);

    return reply.send({
      usedBytes,
      limitBytes,
      usedPct: limitBytes > 0 ? Number(((usedBytes / limitBytes) * 100).toFixed(1)) : null,
      byType: byType.map(r => ({
        type: r.type,
        count: Number(r.count),
        totalBytes: Number(r.totalBytes ?? 0),
      })),
    });
  });

  // ── GET /analytics/expiring-content  (6-E) ────────────────────────────────
  app.get('/expiring-content', { onRequest: [app.authenticate] }, async (req, reply) => {
    const actor = req.user as AuthUser;
    const { workspaceId, days: rawDays } = req.query as { workspaceId?: string; days?: string };

    if (workspaceId) {
      const member = await db.query.workspaceMembers.findFirst({
        where: and(
          eq(workspaceMembers.workspaceId, workspaceId),
          eq(workspaceMembers.userId, actor.sub),
        ),
      });
      if (!member) return reply.status(403).send({ error: 'Forbidden' });
    }

    const days = Math.min(Math.max(1, Number(rawDays ?? 30)), 365);
    const now  = new Date();
    const until = new Date(now.getTime() + days * 86_400_000);

    const expiring = await db.select({
      id: contentItems.id,
      name: contentItems.name,
      type: contentItems.type,
      workspaceId: contentItems.workspaceId,
      workspaceName: workspaces.name,
      validUntil: contentItems.validUntil,
      fileSize: contentItems.fileSize,
    }).from(contentItems)
      .innerJoin(workspaces, eq(contentItems.workspaceId, workspaces.id))
      .where(and(
        eq(workspaces.orgId, actor.orgId),
        isNull(workspaces.deletedAt),
        isNull(contentItems.deletedAt),
        workspaceId ? eq(contentItems.workspaceId, workspaceId) : undefined,
        gt(contentItems.validUntil, now),
        lte(contentItems.validUntil, until),
      ))
      .orderBy(asc(contentItems.validUntil))
      .limit(200);

    return reply.send({
      days,
      until: until.toISOString(),
      count: expiring.length,
      items: expiring.map(r => ({
        ...r,
        fileSize: Number(r.fileSize ?? 0),
        validUntil: r.validUntil ? new Date(r.validUntil).toISOString() : null,
        expiresInMs: r.validUntil ? new Date(r.validUntil).getTime() - now.getTime() : null,
      })),
    });
  });
}
