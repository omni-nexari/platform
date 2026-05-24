import type { FastifyInstance } from 'fastify';
import {
  db,
  aiChatSessions,
  aiChatMessages,
  workspaceMembers,
} from '@signage/db';
import { and, asc, desc, eq, isNull } from 'drizzle-orm';
import { z } from 'zod';
import {
  chatStream,
  isOllamaAvailable,
  getOllamaConfig,
  type OllamaMessage,
} from '../services/ollama.js';
import { buildSystemPrompt } from '../services/ai-knowledge.js';
import { logActivity } from '../services/activity-logger.js';

type AuthUser = { sub: string; orgId: string; role: string };

// Cap how many prior messages are replayed into context to keep prompts small.
const MAX_HISTORY_MESSAGES = 20;

async function checkWorkspaceAccess(workspaceId: string, userId: string) {
  return db.query.workspaceMembers.findFirst({
    where: and(
      eq(workspaceMembers.workspaceId, workspaceId),
      eq(workspaceMembers.userId, userId),
    ),
  });
}

const sendMessageSchema = z.object({
  workspaceId: z.string().uuid(),
  sessionId: z.string().uuid().optional(),
  message: z.string().min(1).max(4000),
});

const listSessionsQuerySchema = z.object({
  workspaceId: z.string().uuid(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

export async function aiRoutes(app: FastifyInstance) {
  // ── GET /ai/health ────────────────────────────────────────────────────────
  app.get('/health', { onRequest: [app.authenticate] }, async (_req, reply) => {
    const available = await isOllamaAvailable();
    const cfg = getOllamaConfig();
    return reply.send({ available, model: cfg.model });
  });

  // ── POST /ai/activity ─ frontend page-view / interaction tracking ─────────
  app.post('/activity', { onRequest: [app.authenticate] }, async (req, reply) => {
    const actor = req.user as AuthUser;
    const body = req.body as { workspaceId?: string; eventType?: string; eventData?: Record<string, unknown> };
    if (!body.workspaceId || !body.eventType) return reply.code(400).send({ error: 'workspaceId and eventType required' });

    const allowed = new Set(['page_view', 'playlist_created', 'schedule_created', 'content_uploaded', 'device_assigned']);
    if (!allowed.has(body.eventType)) return reply.code(400).send({ error: 'Unknown eventType' });

    if (!(await checkWorkspaceAccess(body.workspaceId, actor.sub))) {
      return reply.code(403).send({ error: 'No access to workspace' });
    }

    logActivity({
      userId: actor.sub,
      workspaceId: body.workspaceId,
      eventType: body.eventType as Parameters<typeof logActivity>[0]['eventType'],
      ...(body.eventData ? { eventData: body.eventData } : {}),
    });

    return reply.code(204).send();
  });

  // ── GET /ai/sessions?workspaceId=&limit= ──────────────────────────────────
  app.get('/sessions', { onRequest: [app.authenticate] }, async (req, reply) => {
    const actor = req.user as AuthUser;
    const parsed = listSessionsQuerySchema.safeParse(req.query);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    const { workspaceId, limit } = parsed.data;

    if (!(await checkWorkspaceAccess(workspaceId, actor.sub))) {
      return reply.code(403).send({ error: 'No access to workspace' });
    }

    const rows = await db
      .select()
      .from(aiChatSessions)
      .where(
        and(
          eq(aiChatSessions.userId, actor.sub),
          eq(aiChatSessions.workspaceId, workspaceId),
          isNull(aiChatSessions.archivedAt),
        ),
      )
      .orderBy(desc(aiChatSessions.updatedAt))
      .limit(limit);

    return reply.send({ sessions: rows });
  });

  // ── GET /ai/sessions/:id/messages ─────────────────────────────────────────
  app.get('/sessions/:id/messages', { onRequest: [app.authenticate] }, async (req, reply) => {
    const actor = req.user as AuthUser;
    const { id } = req.params as { id: string };

    const session = await db.query.aiChatSessions.findFirst({
      where: eq(aiChatSessions.id, id),
    });
    if (!session) return reply.code(404).send({ error: 'Session not found' });
    if (session.userId !== actor.sub) {
      return reply.code(403).send({ error: 'Forbidden' });
    }

    const messages = await db
      .select()
      .from(aiChatMessages)
      .where(eq(aiChatMessages.sessionId, id))
      .orderBy(asc(aiChatMessages.createdAt));

    return reply.send({ session, messages });
  });

  // ── DELETE /ai/sessions/:id ───────────────────────────────────────────────
  app.delete('/sessions/:id', { onRequest: [app.authenticate] }, async (req, reply) => {
    const actor = req.user as AuthUser;
    const { id } = req.params as { id: string };

    const session = await db.query.aiChatSessions.findFirst({
      where: eq(aiChatSessions.id, id),
    });
    if (!session) return reply.code(404).send({ error: 'Session not found' });
    if (session.userId !== actor.sub) {
      return reply.code(403).send({ error: 'Forbidden' });
    }

    await db
      .update(aiChatSessions)
      .set({ archivedAt: new Date() })
      .where(eq(aiChatSessions.id, id));

    return reply.code(204).send();
  });

  // ── POST /ai/chat ─────────────────────────────────────────────────────────
  // Streaming chat endpoint. Uses Server-Sent Events. Body JSON:
  //   { workspaceId, sessionId?, message }
  // Events emitted (each as `data: <json>\n\n`):
  //   { type: 'session', sessionId }
  //   { type: 'delta', text }
  //   { type: 'done', messageId }
  //   { type: 'error', message }
  app.post('/chat', { onRequest: [app.authenticate] }, async (req, reply) => {
    const actor = req.user as AuthUser;
    const parsed = sendMessageSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.flatten() });
    }
    const { workspaceId, sessionId: existingSessionId, message } = parsed.data;

    if (!(await checkWorkspaceAccess(workspaceId, actor.sub))) {
      return reply.code(403).send({ error: 'No access to workspace' });
    }

    // Graceful fallback if Ollama is unreachable.
    if (!(await isOllamaAvailable())) {
      return reply.code(503).send({
        error: 'ai_unavailable',
        message: 'AI assistant is temporarily unavailable. Please try again in a moment.',
      });
    }

    // Resolve or create the chat session.
    let sessionId = existingSessionId;
    if (sessionId) {
      const existing = await db.query.aiChatSessions.findFirst({
        where: eq(aiChatSessions.id, sessionId),
      });
      if (!existing || existing.userId !== actor.sub) {
        return reply.code(403).send({ error: 'Forbidden' });
      }
    } else {
      const [created] = await db
        .insert(aiChatSessions)
        .values({
          workspaceId,
          userId: actor.sub,
          title: message.slice(0, 80),
        })
        .returning();
      sessionId = created!.id;
    }

    // Persist the user message.
    await db.insert(aiChatMessages).values({
      sessionId,
      role: 'user',
      content: message,
    });

    // Load history for context (oldest → newest, capped).
    const history = await db
      .select()
      .from(aiChatMessages)
      .where(eq(aiChatMessages.sessionId, sessionId))
      .orderBy(desc(aiChatMessages.createdAt))
      .limit(MAX_HISTORY_MESSAGES);
    history.reverse();

    const systemPrompt = await buildSystemPrompt(message);
    const ollamaMessages: OllamaMessage[] = [
      { role: 'system', content: systemPrompt },
      ...history.map((m) => ({
        role: (m.role === 'user' || m.role === 'assistant' ? m.role : 'user') as 'user' | 'assistant',
        content: m.content,
      })),
    ];

    // Open SSE stream.
    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });

    const send = (payload: unknown) => {
      reply.raw.write(`data: ${JSON.stringify(payload)}\n\n`);
    };

    send({ type: 'session', sessionId });

    const aborter = new AbortController();
    req.raw.on('close', () => aborter.abort());

    let fullAssistant = '';
    try {
      for await (const delta of chatStream(ollamaMessages, { signal: aborter.signal })) {
        fullAssistant += delta;
        send({ type: 'delta', text: delta });
      }

      const [saved] = await db
        .insert(aiChatMessages)
        .values({
          sessionId,
          role: 'assistant',
          content: fullAssistant,
        })
        .returning();

      // Bump session updatedAt so the sidebar list re-orders.
      await db
        .update(aiChatSessions)
        .set({ updatedAt: new Date() })
        .where(eq(aiChatSessions.id, sessionId));

      send({ type: 'done', messageId: saved?.id });
    } catch (err) {
      req.log.error({ err }, 'ai chat stream failed');
      send({
        type: 'error',
        message: err instanceof Error ? err.message : 'Unknown error',
      });

      // Persist whatever we got so the conversation isn't lost on error.
      if (fullAssistant) {
        await db.insert(aiChatMessages).values({
          sessionId,
          role: 'assistant',
          content: fullAssistant,
        });
      }
    } finally {
      reply.raw.end();
    }
  });
}
