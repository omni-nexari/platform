/**
 * /api/v1/datasync  — WebSocket endpoint for the Tizen/Windows datasync renderer.
 *
 * The player connects here after loading the initial table via REST.
 * It sends:
 *   { event: 'subscribe', contentId: string, deviceId: string }
 *   { event: 'ping' }
 *
 * The server sends:
 *   { event: 'pong' }
 *   { event: 'table.reload' }   — when source data has changed
 *
 * A per-contentId background timer re-fetches the source URL every
 * `refreshSeconds` and broadcasts `table.reload` to all subscribers if the
 * data hash changed. Timers are cancelled when the last subscriber disconnects.
 */

import type { FastifyInstance } from 'fastify';
import { db, contentItems } from '@signage/db';
import { and, eq, isNull } from 'drizzle-orm';

// In-process subscription registry
const subscriptions = new Map<string, Set<any>>();   // contentId → socket set
const refreshTimers = new Map<string, ReturnType<typeof setTimeout>>(); // contentId → timer
const dataHashes    = new Map<string, string>();      // contentId → last JSON hash

async function scheduleRefresh(
  contentId: string,
  refreshSeconds: number,
  sourceUrl: string,
  dataPath: string,
): Promise<void> {
  const intervalMs = Math.max(60, refreshSeconds) * 1000;

  const doRefresh = async () => {
    const sockets = subscriptions.get(contentId);
    if (!sockets || sockets.size === 0) {
      // No listeners — stop timer
      refreshTimers.delete(contentId);
      return;
    }

    try {
      const res = await fetch(sourceUrl, {
        signal: AbortSignal.timeout(10_000),
        headers: { 'Accept': 'application/json, */*' },
      });
      if (!res.ok) { /* transient error — keep timer */ return scheduleNext(); }
      const json = await res.json();

      // Navigate to dataPath if configured
      let arr: unknown = json;
      if (dataPath) {
        for (const key of dataPath.split('.')) {
          if (arr && typeof arr === 'object' && !Array.isArray(arr)) {
            arr = (arr as Record<string, unknown>)[key];
          } else { arr = undefined; break; }
        }
      }
      if (!Array.isArray(arr) && arr && typeof arr === 'object') {
        for (const val of Object.values(arr as Record<string, unknown>)) {
          if (Array.isArray(val)) { arr = val; break; }
        }
      }

      const hash = JSON.stringify(arr);
      const prev = dataHashes.get(contentId);

      if (prev !== hash) {
        dataHashes.set(contentId, hash);
        const msg = JSON.stringify({ event: 'table.reload' });
        for (const socket of [...sockets]) {
          try { socket.send(msg); } catch { /* closed — will be cleaned up on 'close' */ }
        }
      }
    } catch { /* network error — keep timer */ }

    scheduleNext();
  };

  function scheduleNext() {
    const t = setTimeout(doRefresh, intervalMs);
    refreshTimers.set(contentId, t);
  }

  scheduleNext();
}

export async function datasyncRoutes(app: FastifyInstance) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (app as any).get('/', { websocket: true }, async (socket: any, req: any) => {
    // Authenticate via ?token= query param (browsers cannot set headers on WS)
    const token = (req.query as Record<string, string | undefined>).token;
    if (!token) { socket.close(4001, 'Missing token'); return; }

    let workspaceId = '';
    try {
      const p = app.jwt.verify<{ sub: string; type: string; workspaceId: string }>(token);
      if (p.type !== 'device') { socket.close(4003, 'Invalid token type'); return; }
      workspaceId = p.workspaceId;
    } catch { socket.close(4001, 'Invalid token'); return; }

    // Track which contentIds this socket is subscribed to (for cleanup)
    const mySubscriptions = new Set<string>();

    socket.on('message', async (rawMsg: Buffer | string) => {
      let msg: Record<string, unknown>;
      try { msg = JSON.parse(rawMsg.toString()); } catch { return; }

      if (msg.event === 'ping') {
        try { socket.send(JSON.stringify({ event: 'pong' })); } catch { /* closed */ }
        return;
      }

      if (msg.event === 'subscribe') {
        const contentId = typeof msg.contentId === 'string' ? msg.contentId : '';
        if (!contentId) return;
        if (mySubscriptions.has(contentId)) return; // already subscribed

        // Verify content belongs to this device's workspace
        const item = await db.query.contentItems.findFirst({
          where: and(eq(contentItems.id, contentId), isNull(contentItems.deletedAt)),
        });
        if (!item || item.type !== 'datasync' || item.workspaceId !== workspaceId) return;

        const meta = (() => { try { return JSON.parse(item.metadata ?? '{}'); } catch { return {}; } })() as {
          sourceUrl?: string; dataPath?: string; refreshSeconds?: number;
        };
        if (!meta.sourceUrl) return;

        // Add to subscription registry
        if (!subscriptions.has(contentId)) subscriptions.set(contentId, new Set());
        subscriptions.get(contentId)!.add(socket);
        mySubscriptions.add(contentId);

        // Start refresh timer if this is the first subscriber
        if (!refreshTimers.has(contentId)) {
          await scheduleRefresh(contentId, meta.refreshSeconds ?? 300, meta.sourceUrl, meta.dataPath ?? '');
        }
      }
    });

    socket.on('close', () => {
      for (const contentId of mySubscriptions) {
        const sockets = subscriptions.get(contentId);
        if (sockets) {
          sockets.delete(socket);
          if (sockets.size === 0) {
            subscriptions.delete(contentId);
            dataHashes.delete(contentId);
            const t = refreshTimers.get(contentId);
            if (t) { clearTimeout(t); refreshTimers.delete(contentId); }
          }
        }
      }
    });

    socket.on('error', () => { /* handled by close */ });
  });
}
