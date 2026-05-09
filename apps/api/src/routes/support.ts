import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { db, supportTickets, supportTicketMessages, organisations, platformOwners } from '@signage/db';
import { eq, and, asc, isNull } from 'drizzle-orm';
import { sql } from 'drizzle-orm';
import { randomBytes } from 'node:crypto';
import * as fs from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import path from 'node:path';
import { CreateSupportTicketSchema, ReplyToTicketSchema } from '@signage/shared';
import { sendSupportNotificationEmail } from '../services/email.js';

type AuthUser = { sub: string; orgId: string; name?: string; email?: string; orgRole?: string };

const STORAGE_ROOT = process.env['STORAGE_ROOT'] ?? './signage_uploads';

function randomToken(bytes = 12) {
  return randomBytes(bytes).toString('hex');
}

function formatMessage(m: {
  id: string; ticketId: string; senderType: string; senderId: string;
  senderName: string; body: string; attachmentUrls: string | null; createdAt: Date | string;
}) {
  return {
    ...m,
    attachmentUrls: (m.attachmentUrls ?? '').split('\n').filter(Boolean),
    createdAt: m.createdAt instanceof Date ? m.createdAt.toISOString() : m.createdAt,
  };
}

async function notifySuperAdmins(subject: string, body: string, ticketId: string) {
  const owners = await db.query.platformOwners.findMany({ columns: { email: true, name: true } });
  await Promise.allSettled(owners.map(o => sendSupportNotificationEmail({
    to: o.email,
    ...(o.name != null ? { recipientName: o.name } : {}),
    subject,
    body,
    ticketId,
    notifyTarget: 'superadmin',
  })));
}

export async function supportRoutes(app: FastifyInstance) {
  // ── GET /support/tickets ─────────────────────────────────────────────────
  app.get('/tickets', { onRequest: [app.authenticate] }, async (req, reply) => {
    const user = req.user as AuthUser;
    const { status, category } = req.query as { status?: string; category?: string };

    const filters = [
      sql`t.org_id = ${user.orgId}::uuid`,
      status   ? sql`t.status = ${status}`   : undefined,
      category ? sql`t.category = ${category}` : undefined,
    ].filter(Boolean);

    const rows = await db.execute<{
      id: string; category: string; subject: string; status: string; priority: string;
      submitted_by_name: string; message_count: number; created_at: string; updated_at: string;
    }>(sql`
      SELECT t.id, t.category, t.subject, t.status, t.priority,
        t.submitted_by_name,
        (SELECT COUNT(*) FROM support_ticket_messages m WHERE m.ticket_id = t.id)::int AS message_count,
        t.created_at, t.updated_at
      FROM support_tickets t
      WHERE ${sql.join(filters, sql` AND `)}
      ORDER BY t.updated_at DESC
      LIMIT 100
    `);

    return reply.send({ tickets: rows });
  });

  // ── GET /support/unread-count ─────────────────────────────────────────────
  app.get('/unread-count', { onRequest: [app.authenticate] }, async (req, reply) => {
    const user = req.user as AuthUser;
    const unreadRows = await db.execute<{ unread: number }>(sql`
      SELECT COUNT(DISTINCT t.id)::int AS unread
      FROM support_tickets t
      WHERE t.org_id = ${user.orgId}::uuid
        AND t.status NOT IN ('resolved', 'closed')
        AND EXISTS (
          SELECT 1 FROM support_ticket_messages m
          WHERE m.ticket_id = t.id
            AND m.sender_type = 'superadmin'
            AND m.created_at > COALESCE(
              (SELECT MAX(m2.created_at) FROM support_ticket_messages m2
               WHERE m2.ticket_id = t.id AND m2.sender_type != 'superadmin'),
              t.created_at - INTERVAL '1 second'
            )
        )
    `);
    const unread = (unreadRows[0] as { unread: number } | undefined)?.unread ?? 0;
    return reply.send({ unread });
  });

  // ── POST /support/tickets ─────────────────────────────────────────────────
  app.post('/tickets', { onRequest: [app.authenticate] }, async (req, reply) => {
    const user = req.user as AuthUser;
    const body = CreateSupportTicketSchema.safeParse(req.body);
    if (!body.success) return reply.status(400).send({ error: body.error.flatten() });

    const { category, subject, priority, message } = body.data;

    // Look up org's management company (if any)
    const org = await db.query.organisations.findFirst({
      where: and(eq(organisations.id, user.orgId), isNull(organisations.deletedAt)),
      columns: { managementCompanyId: true },
    });

    const [ticket] = await db.insert(supportTickets).values({
      partyType: 'client_org',
      companyId: org?.managementCompanyId ?? null,
      orgId: user.orgId,
      submittedByUserId: user.sub,
      submittedByName: user.name ?? user.email ?? 'User',
      submittedByEmail: user.email ?? '',
      category,
      subject,
      priority: priority ?? 'medium',
    }).returning();

    if (message) {
      await db.insert(supportTicketMessages).values({
        ticketId: ticket!.id,
        senderType: 'client',
        senderId: user.sub,
        senderName: user.name ?? user.email ?? 'User',
        body: message,
      });
    }

    void notifySuperAdmins(subject, message ?? '', ticket!.id).catch(() => undefined);

    return reply.status(201).send({ ticket: ticket! });
  });

  // ── GET /support/tickets/:id ──────────────────────────────────────────────
  app.get('/tickets/:id', { onRequest: [app.authenticate] }, async (req, reply) => {
    const user = req.user as AuthUser;
    const { id } = req.params as { id: string };

    const ticket = await db.query.supportTickets.findFirst({
      where: and(eq(supportTickets.id, id), eq(supportTickets.orgId as any, user.orgId)),
    });
    if (!ticket) return reply.status(404).send({ error: 'Ticket not found' });

    const messages = await db.query.supportTicketMessages.findMany({
      where: eq(supportTicketMessages.ticketId, id),
      orderBy: asc(supportTicketMessages.createdAt),
    });

    return reply.send({ ...ticket, messages: messages.map(formatMessage) });
  });

  // ── POST /support/tickets/:id/messages ───────────────────────────────────
  app.post('/tickets/:id/messages', { onRequest: [app.authenticate] }, async (req, reply) => {
    const user = req.user as AuthUser;
    const { id } = req.params as { id: string };
    const body = ReplyToTicketSchema.safeParse(req.body);
    if (!body.success) return reply.status(400).send({ error: body.error.flatten() });

    const ticket = await db.query.supportTickets.findFirst({
      where: and(eq(supportTickets.id, id), eq(supportTickets.orgId as any, user.orgId)),
    });
    if (!ticket) return reply.status(404).send({ error: 'Ticket not found' });
    if (ticket.status === 'closed') return reply.status(409).send({ error: 'Ticket is closed' });

    const [msg] = await db.insert(supportTicketMessages).values({
      ticketId: id,
      senderType: 'client',
      senderId: user.sub,
      senderName: user.name ?? user.email ?? 'User',
      body: body.data.body,
      attachmentUrls: body.data.attachmentUrls?.join('\n') ?? null,
    }).returning();

    await db.update(supportTickets)
      .set({ updatedAt: new Date(), ...(ticket.status === 'resolved' ? { status: 'in_progress' } : {}) })
      .where(eq(supportTickets.id, id));

    void notifySuperAdmins(ticket.subject, body.data.body, id).catch(() => undefined);

    return reply.status(201).send({ message: formatMessage(msg!) });
  });

  // ── POST /support/tickets/:id/attachments ────────────────────────────────
  app.post('/tickets/:id/attachments', { onRequest: [app.authenticate] }, async (req, reply) => {
    const user = req.user as AuthUser;
    const { id } = req.params as { id: string };

    const ticket = await db.query.supportTickets.findFirst({
      where: and(eq(supportTickets.id, id), eq(supportTickets.orgId as any, user.orgId)),
      columns: { id: true },
    });
    if (!ticket) return reply.status(404).send({ error: 'Ticket not found' });

    const file = await req.file();
    if (!file) return reply.status(400).send({ error: 'No file provided' });

    const ALLOWED_MIME = new Set([
      'image/png','image/jpeg','image/webp','image/gif',
      'application/pdf','text/plain','text/csv','application/zip',
    ]);
    if (!ALLOWED_MIME.has(file.mimetype)) return reply.status(400).send({ error: 'File type not allowed' });

    const ext = path.extname(file.filename).toLowerCase() || '.bin';
    const filename = `${randomToken(12)}${ext}`;
    const absDir = path.resolve(STORAGE_ROOT, 'support_attachments', id);
    await fs.mkdir(absDir, { recursive: true });
    const absPath = path.resolve(absDir, filename);

    let fileSize = 0;
    const ws = createWriteStream(absPath);
    for await (const chunk of file.file) {
      ws.write(chunk);
      fileSize += chunk.length;
      if (fileSize > 20 * 1024 * 1024) {
        ws.destroy();
        await fs.unlink(absPath).catch(() => undefined);
        return reply.status(413).send({ error: 'Attachment exceeds 20 MB limit' });
      }
    }
    await new Promise<void>((resolve, reject) => { ws.end(); ws.on('finish', resolve); ws.on('error', reject); });

    // Attachments served via the superadmin attachment endpoint (authenticated)
    const url = `/api/v1/superadmin/support/attachments/${id}/${filename}`;
    return reply.status(201).send({ url });
  });
}
