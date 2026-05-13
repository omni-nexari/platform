/**
 * sync-relay.ts — centralized cross-platform sync relay over WS.
 *
 * Mounted at GET /sync-relay (over the existing API host). Uses the same
 * protocol implemented in apps/nexari-html5-sync/js/logic.js so that Tizen,
 * Windows and e-paper players can all join the same sync group.
 *
 * Protocol (text JSON frames):
 *   client → relay  WS_REGISTER { deviceId, groupId, ip? }
 *   client → relay  PING        { t1 }                          → PONG { t1, t2 }
 *   client → relay  LOOP_READY  { groupId, deviceId }           — barrier
 *   relay  → group  LOOP_GO     { playAt }                      — barrier release
 *   relay  → group  PEERS       { peers, serverTimeMs }
 *   relay  → group  HEARTBEAT_PEERS { peers }                   — every 5 s
 *   anything else from a registered client is broadcast to its group with
 *   `from: deviceId` appended.
 *
 * Auth: the device JWT (issued during pairing) MUST be passed as
 * `?token=<jwt>` so browsers and B2B Tizen WebApps can both connect — neither
 * supports custom headers on WebSocket upgrade.
 */
import type { FastifyInstance } from 'fastify';

interface WsLikeClient {
  socket: any;
  deviceId: string;
  groupId: string;
  ip: string;
  registeredAt: number;
}

const clients = new Set<WsLikeClient>();
const loopReady = new Map<string, Set<string>>();

function send(ws: any, obj: unknown): void {
  try { ws.send(JSON.stringify(obj)); } catch { /* ignore broken pipe */ }
}

function clientsInGroup(groupId: string): WsLikeClient[] {
  const list: WsLikeClient[] = [];
  for (const c of clients) if (c.groupId === groupId) list.push(c);
  return list;
}

function broadcastGroup(groupId: string, obj: unknown, exclude: any | null): void {
  const payload = JSON.stringify(obj);
  for (const c of clients) {
    if (c.groupId !== groupId) continue;
    if (c.socket === exclude) continue;
    try { c.socket.send(payload); } catch { /* ignore */ }
  }
}

function sendPeers(groupId: string): void {
  const groupClients = clientsInGroup(groupId);
  const peers = groupClients.map((c) => ({
    deviceId: c.deviceId, ip: c.ip, registeredAt: c.registeredAt,
  }));
  for (const c of groupClients) {
    send(c.socket, { type: 'PEERS', groupId, peers, serverTimeMs: Date.now() });
  }
}

export async function syncRelayRoutes(app: FastifyInstance) {
  // Periodic peer-list heartbeat (5 s) — keeps follower-side `expectedPeers`
  // counters fresh in case a registration is missed.
  const heartbeat = setInterval(() => {
    const groups = new Set<string>();
    for (const c of clients) if (c.groupId) groups.add(c.groupId);
    for (const gid of groups) {
      const ids = clientsInGroup(gid).map((c) => c.deviceId);
      const frame = JSON.stringify({ type: 'HEARTBEAT_PEERS', peers: ids });
      for (const c of clientsInGroup(gid)) {
        try { c.socket.send(frame); } catch { /* ignore */ }
      }
    }
  }, 5000);

  app.addHook('onClose', async () => { clearInterval(heartbeat); });

  // GET /sync-relay/time — used as a clock-sync HTTP fallback (mirrors logic.js)
  app.get('/time', async (_req, reply) => reply.send({ serverTimeMs: Date.now() }));

  // GET /sync-relay/ws (WebSocket)
  // No `app.authenticate` here because pairing tokens are validated manually:
  // we accept the JWT via ?token= query so HTML/Tizen WebApps can connect.
  // Path is `/ws` (not `/`) because nginx prefix-proxying + Fastify root-prefix
  // routes don't reliably match an upgrade request without a path segment.
  (app as any).get('/ws', { websocket: true }, async (socket: any, req: any) => {
    let authedDeviceId: string | null = null;
    try {
      const token = (req.query as { token?: string })?.token;
      if (token) {
        const decoded: any = await app.jwt.verify(token);
        if (decoded?.type === 'device' && typeof decoded.sub === 'string') {
          authedDeviceId = decoded.sub;
        }
      }
    } catch { /* ignore — anonymous mode falls through, but won't be able to register */ }

    const client: WsLikeClient = {
      socket,
      deviceId: '',
      groupId: '',
      ip: (req.ip as string) || '',
      registeredAt: 0,
    };
    clients.add(client);

    socket.on('message', (raw: any) => {
      let msg: any;
      try { msg = JSON.parse(typeof raw === 'string' ? raw : raw.toString('utf8')); } catch { return; }

      // ── WS_REGISTER ────────────────────────────────────────────────────
      if (msg?.type === 'WS_REGISTER') {
        // JWT proves the device is paired/authorised. The relay deviceId is
        // the client's chosen identity for peer-listing and leader election —
        // it may differ from the JWT sub (e.g. Android uses a MAC-based ID).
        // We do not reject on mismatch; we only require a valid token to connect.
        const newDeviceId = String(msg.deviceId || authedDeviceId || `anon-${Date.now()}`);
        const newGroupId  = String(msg.groupId  || 'default');

        // Evict any stale entry for the same deviceId in the same group so
        // the PEERS list never shows the same device twice after a reconnect.
        for (const existing of clients) {
          if (existing !== client && existing.deviceId === newDeviceId && existing.groupId === newGroupId) {
            try { existing.socket.close(4000, 'superseded'); } catch { /* ignore */ }
            clients.delete(existing);
          }
        }

        client.deviceId     = newDeviceId;
        client.groupId      = newGroupId;
        client.ip           = String(msg.ip || client.ip || '');
        client.registeredAt = Date.now();
        sendPeers(client.groupId);
        return;
      }

      // ── PING / PONG (clock sync) ───────────────────────────────────────
      if (msg?.type === 'PING') {
        send(socket, { type: 'PONG', t1: msg.t1, t2: Date.now() });
        return;
      }

      // ── LOOP_READY barrier ─────────────────────────────────────────────
      if (msg?.type === 'LOOP_READY') {
        const gid = String(msg.groupId || client.groupId);
        if (!gid) return;
        let set = loopReady.get(gid);
        if (!set) { set = new Set(); loopReady.set(gid, set); }
        set.add(String(msg.deviceId || client.deviceId));

        const expected = clientsInGroup(gid).filter((c) => !!c.deviceId).length;
        if (expected >= 1 && set.size >= expected) {
          loopReady.set(gid, new Set());                    // reset for next loop
          const playAt = Date.now() + 400;
          broadcastGroup(gid, { type: 'LOOP_GO', playAt }, null);
        }
        return;
      }

      // ── Default: relay to peers in the same group ──────────────────────
      if (client.groupId && client.deviceId) {
        const relay = { ...msg, from: client.deviceId };
        broadcastGroup(client.groupId, relay, socket);
      }
    });

    const cleanup = () => {
      clients.delete(client);
      if (client.groupId) sendPeers(client.groupId);
    };
    socket.on('close', cleanup);
    socket.on('error', cleanup);
  });
}
