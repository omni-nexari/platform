import type { FastifyInstance } from 'fastify';
import {
  db,
  playEvents,
  devices,
  workspaces,
  contentItems,
  deviceHeartbeats,
  playlists,
  notifications,
  orgStorageQuotas,
  schedules,
} from '@signage/db';
import { eq, and, gte, lte, desc, asc, sql, count, sum, isNull, inArray } from 'drizzle-orm';
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

    const [quotaRow] = await db
      .select({ usedBytes: orgStorageQuotas.usedBytes, limitBytes: orgStorageQuotas.limitBytes })
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
        storageUsedBytes: Number(quotaRow?.usedBytes ?? 0),
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
}
