/**
 * Calendar integrations: list / create / delete connections, OAuth flows for
 * Google + Microsoft, ICS / Apple credential entry, calendar list sync, and
 * preview events for the wizard.
 */
import type { FastifyInstance } from 'fastify';
import {
  db,
  workspaceMembers,
  calendarConnections,
  calendarConnectionCalendars,
} from '@signage/db';
import { and, desc, eq, isNull, or } from 'drizzle-orm';
import crypto from 'node:crypto';
import { encryptSecret, decryptSecret } from '../services/crypto.js';
import {
  buildAuthUrl as googleAuthUrl,
  exchangeCode as googleExchange,
  GOOGLE_SCOPES,
} from '../services/calendar/google.js';
import {
  buildAuthUrl as msAuthUrl,
  exchangeCode as msExchange,
  MS_SCOPES,
} from '../services/calendar/microsoft.js';
import { validateIcsUrl } from '../services/calendar/ics.js';
import { appleProbe } from '../services/calendar/apple.js';
import {
  listCalendarsForConnection,
  listEventsForConnection,
  type CalendarConnectionRow,
} from '../services/calendar/index.js';
import { getLicenseHmacSecret } from '../services/license-client.js';

type AuthUser = { sub: string; orgId: string; role: string };

const MANAGER_ROLES = new Set(['prime_owner', 'owner', 'admin', 'a-manager']);

async function checkWorkspaceAccess(workspaceId: string, userId: string) {
  return db.query.workspaceMembers.findFirst({
    where: and(
      eq(workspaceMembers.workspaceId, workspaceId),
      eq(workspaceMembers.userId, userId),
    ),
  });
}

/** Public-facing JSON projection: NEVER includes encrypted credential fields. */
function projectConnection(c: CalendarConnectionRow) {
  return {
    id: c.id,
    workspaceId: c.workspaceId,
    userId: c.userId,
    scope: (c.userId == null ? 'workspace' : 'personal') as 'workspace' | 'personal',
    provider: c.provider,
    displayName: c.displayName,
    accountEmail: c.accountEmail,
    status: c.status,
    lastSyncedAt: c.lastSyncedAt,
    tokenExpiresAt: c.tokenExpiresAt,
    lastErrorMessage: c.lastErrorMessage,
    createdAt: c.createdAt,
    updatedAt: c.updatedAt,
  };
}

/** Sign / verify the short-lived OAuth `state` cookie payload. */
function stateSecret(): string {
  return process.env['JWT_SECRET'] ?? 'dev-jwt-secret-change-me';
}
function signState(payload: object): string {
  const json = JSON.stringify(payload);
  const sig = crypto.createHmac('sha256', stateSecret()).update(json).digest('base64url');
  return `${Buffer.from(json, 'utf8').toString('base64url')}.${sig}`;
}
function verifyState<T = any>(token: string): T | null {
  const [body, sig] = token.split('.');
  if (!body || !sig) return null;
  let json: string;
  try { json = Buffer.from(body, 'base64url').toString('utf8'); } catch { return null; }
  const expect = crypto.createHmac('sha256', stateSecret()).update(json).digest('base64url');
  if (expect !== sig) return null;
  try { return JSON.parse(json) as T; } catch { return null; }
}

async function refreshCalendarCache(connection: CalendarConnectionRow) {
  const cals = await listCalendarsForConnection(connection);
  // Upsert: re-stamp lastSeenAt for present rows, leave stale ones (UI can prune later).
  for (const c of cals) {
    await db.insert(calendarConnectionCalendars).values({
      connectionId: connection.id,
      externalCalendarId: c.externalCalendarId,
      name: c.name,
      colorHex: c.colorHex ?? null,
      isPrimary: !!c.isPrimary,
      kind: c.kind ?? 'user',
      capacity: c.capacity ?? null,
      locationLabel: c.locationLabel ?? null,
    }).onConflictDoUpdate({
      target: [
        calendarConnectionCalendars.connectionId,
        calendarConnectionCalendars.externalCalendarId,
      ],
      set: {
        name: c.name,
        colorHex: c.colorHex ?? null,
        isPrimary: !!c.isPrimary,
        kind: c.kind ?? 'user',
        capacity: c.capacity ?? null,
        locationLabel: c.locationLabel ?? null,
        lastSeenAt: new Date(),
      },
    });
  }
  await db.update(calendarConnections)
    .set({ lastSyncedAt: new Date(), status: 'active', lastErrorMessage: null, updatedAt: new Date() })
    .where(eq(calendarConnections.id, connection.id));
}

async function loadConnection(id: string, user: AuthUser): Promise<CalendarConnectionRow | null> {
  const conn = await db.query.calendarConnections.findFirst({
    where: and(eq(calendarConnections.id, id), isNull(calendarConnections.deletedAt)),
  });
  if (!conn) return null;
  // Verify caller has access to the workspace AND is allowed to see this scope.
  const member = await checkWorkspaceAccess(conn.workspaceId, user.sub);
  if (!member) return null;
  if (conn.userId != null && conn.userId !== user.sub && !MANAGER_ROLES.has(user.role)) {
    return null;
  }
  return conn;
}

export async function integrationsRoutes(app: FastifyInstance) {
  // ── GET /integrations/calendar/connections?workspaceId= ─────────────────
  app.get('/calendar/connections', { onRequest: [app.authenticate] }, async (req, reply) => {
    const user = req.user as AuthUser;
    const { workspaceId } = req.query as { workspaceId?: string };
    if (!workspaceId) return reply.status(400).send({ error: 'workspaceId required' });
    const member = await checkWorkspaceAccess(workspaceId, user.sub);
    if (!member) return reply.status(403).send({ error: 'Forbidden' });

    const rows = await db.query.calendarConnections.findMany({
      where: and(
        eq(calendarConnections.workspaceId, workspaceId),
        isNull(calendarConnections.deletedAt),
        // Show: workspace-shared (userId NULL) + the current user's personal.
        or(
          isNull(calendarConnections.userId),
          eq(calendarConnections.userId, user.sub),
        ),
      ),
      orderBy: [desc(calendarConnections.createdAt)],
    });
    return reply.send(rows.map(projectConnection));
  });

  // ── GET /integrations/calendar/connections/:id/calendars ────────────────
  app.get('/calendar/connections/:id/calendars', { onRequest: [app.authenticate] }, async (req, reply) => {
    const user = req.user as AuthUser;
    const { id } = req.params as { id: string };
    const conn = await loadConnection(id, user);
    if (!conn) return reply.status(404).send({ error: 'Not found' });

    const cached = await db.query.calendarConnectionCalendars.findMany({
      where: eq(calendarConnectionCalendars.connectionId, id),
    });
    return reply.send(cached);
  });

  // ── POST /integrations/calendar/connections/:id/sync-calendars ──────────
  app.post('/calendar/connections/:id/sync-calendars', { onRequest: [app.authenticate] }, async (req, reply) => {
    const user = req.user as AuthUser;
    const { id } = req.params as { id: string };
    const conn = await loadConnection(id, user);
    if (!conn) return reply.status(404).send({ error: 'Not found' });
    try {
      await refreshCalendarCache(conn);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await db.update(calendarConnections)
        .set({ status: 'error', lastErrorMessage: msg, updatedAt: new Date() })
        .where(eq(calendarConnections.id, id));
      return reply.status(502).send({ error: 'Sync failed', detail: msg });
    }
    const cached = await db.query.calendarConnectionCalendars.findMany({
      where: eq(calendarConnectionCalendars.connectionId, id),
    });
    return reply.send({ calendars: cached });
  });

  // ── DELETE /integrations/calendar/connections/:id ───────────────────────
  app.delete('/calendar/connections/:id', { onRequest: [app.authenticate] }, async (req, reply) => {
    const user = req.user as AuthUser;
    const { id } = req.params as { id: string };
    const conn = await loadConnection(id, user);
    if (!conn) return reply.status(404).send({ error: 'Not found' });
    // Only the owner of a personal connection, or a manager+, may delete a
    // workspace-shared connection.
    if (conn.userId == null && !MANAGER_ROLES.has(user.role)) {
      return reply.status(403).send({ error: 'Manager role required' });
    }
    if (conn.userId != null && conn.userId !== user.sub && !MANAGER_ROLES.has(user.role)) {
      return reply.status(403).send({ error: 'Forbidden' });
    }

    await db.update(calendarConnections)
      .set({ deletedAt: new Date(), status: 'revoked', updatedAt: new Date() })
      .where(eq(calendarConnections.id, id));
    return reply.status(204).send();
  });

  // ── OAuth: GET /calendar/oauth/:provider/start ───────────────────────────
  app.get('/calendar/oauth/:provider/start', { onRequest: [app.authenticate] }, async (req, reply) => {
    const user = req.user as AuthUser;
    const { provider } = req.params as { provider: string };
    const { workspaceId, scope } = req.query as { workspaceId?: string; scope?: string };
    if (!workspaceId) return reply.status(400).send({ error: 'workspaceId required' });
    if (provider !== 'google' && provider !== 'microsoft') {
      return reply.status(400).send({ error: 'Unsupported provider' });
    }
    const desiredScope = scope === 'workspace' ? 'workspace' : 'personal';
    if (desiredScope === 'workspace' && !MANAGER_ROLES.has(user.role)) {
      return reply.status(403).send({ error: 'Manager role required for workspace-shared connections' });
    }
    const member = await checkWorkspaceAccess(workspaceId, user.sub);
    if (!member) return reply.status(403).send({ error: 'Forbidden' });

    const popup = (req.query as Record<string, string>)['popup'] === '1';
    const reconnectId = (req.query as Record<string, string>)['reconnectId'];
    // Validate the connection to reconnect belongs to this workspace.
    if (reconnectId) {
      const existing = await db.query.calendarConnections.findFirst({
        where: and(eq(calendarConnections.id, reconnectId), isNull(calendarConnections.deletedAt)),
      });
      if (!existing || existing.workspaceId !== workspaceId) {
        return reply.status(404).send({ error: 'Connection not found' });
      }
    }
    const nonce = crypto.randomBytes(16).toString('hex');

    // ── Proxy mode: route through admin.nexari.ca OAuth proxy ─────────────
    // When NEXARI_ADMIN_ORIGIN is set the Platform delegates consent to nexari.ca,
    // which owns the shared OAuth app credentials. Only ONE redirect URI per
    // provider needs to be registered — on nexari.ca — regardless of how many
    // partner domains exist.
    const nexariAdminOrigin = (process.env['NEXARI_ADMIN_ORIGIN'] ?? '').trim() || null;
    const licCreds = nexariAdminOrigin ? await getLicenseHmacSecret() : null;

    // If proxy mode is intended but the license secret is not yet provisioned,
    // fail loudly — this prevents a silent fallthrough to direct mode with
    // empty GOOGLE_OAUTH_CLIENT_ID which produces Google's "missing client_id" error.
    if (nexariAdminOrigin && !licCreds) {
      return reply.status(503).send({
        error: 'OAuth proxy mode requires a configured license key. Ensure LICENSE_KEY, LICENSE_SECRET, and LICENSE_SERVER_URL are set in the Platform API environment (or a license is activated in Settings → License).',
      });
    }

    if (nexariAdminOrigin && licCreds) {
      // callbackOrigin = where the postMessage is targeted (the DS window origin)
      const callbackOrigin = new URL(
        process.env['APP_URL'] ?? process.env['API_PUBLIC_URL'] ?? 'http://localhost:5174',
      ).origin;

      const statePayload = {
        licenseKey: licCreds.licenseKey,
        workspaceId,
        userId: desiredScope === 'personal' ? user.sub : null,
        scope: desiredScope,
        provider,
        callbackOrigin,
        ...(reconnectId ? { reconnectId } : {}),
        nonce,
        expiresAt: Date.now() + 10 * 60 * 1000,
      };
      const bodyB64 = Buffer.from(JSON.stringify(statePayload), 'utf8').toString('base64url');
      const sig = crypto.createHmac('sha256', licCreds.hmacSecret).update(bodyB64, 'utf8').digest('base64url');
      const proxyUrl = `${nexariAdminOrigin}/oauth/${provider}/start?state=${bodyB64}.${sig}`;
      return reply.send({ redirectUrl: proxyUrl, nexariOrigin: nexariAdminOrigin });
    }

    // ── Direct mode: self-hosted instances without nexari-admin ───────────
    const stateToken = signState({
      workspaceId,
      scope: desiredScope,
      userId: user.sub,
      provider,
      popup,
      ...(reconnectId ? { reconnectId } : {}),
      n: nonce,
      ts: Date.now(),
    });

    if (provider === 'google') {
      const cid = (process.env['GOOGLE_OAUTH_CLIENT_ID'] ?? '').trim();
      const sec = (process.env['GOOGLE_OAUTH_CLIENT_SECRET'] ?? '').trim();
      if (!cid || !sec) {
        return reply.status(503).send({
          error: 'Google OAuth is not configured for direct mode. Set NEXARI_ADMIN_ORIGIN for proxy mode or configure GOOGLE_OAUTH_CLIENT_ID/GOOGLE_OAUTH_CLIENT_SECRET.',
        });
      }
    }
    if (provider === 'microsoft') {
      const cid = (process.env['MICROSOFT_OAUTH_CLIENT_ID'] ?? process.env['MICROSOFT_CLIENT_ID'] ?? '').trim();
      const sec = (process.env['MICROSOFT_OAUTH_CLIENT_SECRET'] ?? process.env['MICROSOFT_CLIENT_SECRET'] ?? '').trim();
      if (!cid || !sec) {
        return reply.status(503).send({
          error: 'Microsoft OAuth is not configured for direct mode. Set NEXARI_ADMIN_ORIGIN for proxy mode or configure MICROSOFT_OAUTH_CLIENT_ID/MICROSOFT_OAUTH_CLIENT_SECRET.',
        });
      }
    }

    const url = provider === 'google' ? googleAuthUrl(stateToken) : msAuthUrl(stateToken);
    return reply.send({ redirectUrl: url });
  });

  // ── OAuth: GET /calendar/oauth/:provider/callback ───────────────────────
  // No `app.authenticate` — the user comes back here via the IdP redirect, the
  // `state` cookie carries identity.
  app.get('/calendar/oauth/:provider/callback', async (req, reply) => {
    const { provider } = req.params as { provider: string };
    const { code, state, error } = req.query as { code?: string; state?: string; error?: string };

    const dsBase = process.env['DS_PUBLIC_URL'] ?? 'http://localhost:5174';
    const finishUrl = (status: 'connected' | 'error', detail?: string) => {
      const u = new URL('/settings', dsBase);
      u.searchParams.set('section', 'integrations');
      u.searchParams.set('oauth', status);
      u.searchParams.set('provider', provider);
      if (detail) u.searchParams.set('detail', detail.slice(0, 200));
      return u.toString();
    };

    if (error || !code || !state) {
      // We can't read popup from state yet — fall back to page redirect on early errors.
      return reply.redirect(finishUrl('error', error ?? 'Missing code/state'));
    }
    const payload = verifyState<{
      workspaceId: string;
      scope: 'workspace' | 'personal';
      userId: string;
      provider: string;
      popup?: boolean;
      reconnectId?: string;
    }>(state);
    if (!payload || payload.provider !== provider) {
      return reply.redirect(finishUrl('error', 'State verification failed'));
    }

    const isPopup = !!payload.popup;
    const finish = (status: 'connected' | 'error', detail?: string) => {
      if (isPopup) {
        const dsOrigin = new URL(dsBase).origin;
        const html = `<!DOCTYPE html><html><head><meta charset="utf-8"></head><body><script>
          try { window.opener.postMessage(${JSON.stringify(JSON.stringify({ type: 'oauth_callback', oauth: status, provider, detail: detail ?? '' }))}, ${JSON.stringify(dsOrigin)}); } catch(e){}
          window.close();
        <\/script></body></html>`;
        return reply.type('text/html').send(html);
      }
      return reply.redirect(finishUrl(status, detail));
    };

    try {
      let exchanged: { accessToken: string; refreshToken?: string | undefined; expiresIn: number; email?: string | undefined };
      if (provider === 'google') {
        exchanged = await googleExchange(code);
      } else if (provider === 'microsoft') {
        exchanged = await msExchange(code);
      } else {
        return finish('error', 'Unsupported provider');
      }

      let conn: CalendarConnectionRow | undefined;
      if (payload.reconnectId) {
        // Reconnect: update existing connection's tokens in-place.
        await db.update(calendarConnections).set({
          accessToken: encryptSecret(exchanged.accessToken),
          ...(exchanged.refreshToken ? { refreshToken: encryptSecret(exchanged.refreshToken) } : {}),
          tokenExpiresAt: new Date(Date.now() + exchanged.expiresIn * 1000),
          status: 'active',
          lastErrorMessage: null,
          updatedAt: new Date(),
        }).where(and(
          eq(calendarConnections.id, payload.reconnectId),
          eq(calendarConnections.workspaceId, payload.workspaceId),
        ));
        conn = await db.query.calendarConnections.findFirst({
          where: eq(calendarConnections.id, payload.reconnectId),
        });
      } else {
        // New connection: insert.
        const [inserted] = await db.insert(calendarConnections).values({
          workspaceId: payload.workspaceId,
          userId: payload.scope === 'personal' ? payload.userId : null,
          provider,
          displayName: exchanged.email ?? `${provider} calendar`,
          accountEmail: exchanged.email ?? null,
          accessToken: encryptSecret(exchanged.accessToken),
          refreshToken: exchanged.refreshToken ? encryptSecret(exchanged.refreshToken) : null,
          tokenExpiresAt: new Date(Date.now() + exchanged.expiresIn * 1000),
          scopes: provider === 'google' ? GOOGLE_SCOPES : MS_SCOPES,
          status: 'active',
        }).returning();
        conn = inserted;
      }

      // Best-effort initial calendar sync.
      if (conn) {
        try { await refreshCalendarCache(conn); } catch (e) {
          // eslint-disable-next-line no-console
          console.warn('[oauth callback] initial calendar sync failed', e);
        }
      }
      return finish('connected');
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return finish('error', msg);
    }
  });

  // ── POST /calendar/oauth/:provider/relay ────────────────────────────────
  // Called from the DS after receiving an `oauth_relay` postMessage from the
  // nexari.ca OAuth proxy. Decrypts the AES-256-GCM token payload (key derived
  // from LICENSE_HMAC_SECRET) and stores the tokens in calendar_connections.
  app.post('/calendar/oauth/:provider/relay', { onRequest: [app.authenticate] }, async (req, reply) => {
    const user = req.user as AuthUser;
    const { provider } = req.params as { provider: string };
    const { encrypted } = req.body as { encrypted?: string };

    if (!encrypted) return reply.status(400).send({ error: 'encrypted payload required' });
    if (provider !== 'google' && provider !== 'microsoft') {
      return reply.status(400).send({ error: 'Unsupported provider' });
    }

    const licCreds = await getLicenseHmacSecret();
    if (!licCreds) return reply.status(503).send({ error: 'License not configured — relay unavailable' });

    // Derive the same relay key used by the nexari.ca proxy (deterministic).
    const relayKey = Buffer.from(
      crypto.createHmac('sha256', licCreds.hmacSecret).update('oauth-relay-v1', 'utf8').digest(),
    );

    // Decrypt: format is `iv:tag:cipher` (all base64url, colon-delimited)
    let payload: {
      type: string; provider: string; workspaceId: string;
      userId: string | null; scope: 'personal' | 'workspace'; reconnectId?: string;
      accessToken: string; refreshToken: string | null; expiresIn: number;
      email: string | null;
    };
    try {
      const parts = encrypted.split(':');
      if (parts.length !== 3) throw new Error('Malformed');
      const iv = Buffer.from(parts[0]!, 'base64url');
      const tag = Buffer.from(parts[1]!, 'base64url');
      const cipherBuf = Buffer.from(parts[2]!, 'base64url');
      const decipher = crypto.createDecipheriv('aes-256-gcm', relayKey, iv);
      decipher.setAuthTag(tag);
      const plain = Buffer.concat([decipher.update(cipherBuf), decipher.final()]).toString('utf8');
      payload = JSON.parse(plain);
    } catch {
      return reply.status(400).send({ error: 'Payload decryption failed — possible tampering or key mismatch' });
    }

    if (payload.type !== 'oauth_relay') {
      return reply.status(400).send({ error: 'Invalid payload type' });
    }

    // Authorise: verify the calling user has workspace access
    const member = await checkWorkspaceAccess(payload.workspaceId, user.sub);
    if (!member) return reply.status(403).send({ error: 'Forbidden' });

    // For personal scope: the authenticated user must be the one who initiated the flow
    if (payload.scope === 'personal' && payload.userId && payload.userId !== user.sub) {
      return reply.status(403).send({ error: 'User mismatch — please reconnect' });
    }
    if (payload.scope === 'workspace' && !MANAGER_ROLES.has(user.role)) {
      return reply.status(403).send({ error: 'Manager role required for workspace-shared connections' });
    }

    const scopeStr = provider === 'google' ? GOOGLE_SCOPES : MS_SCOPES;

    let conn: CalendarConnectionRow | undefined;
    if (payload.reconnectId) {
      await db.update(calendarConnections).set({
        accessToken: encryptSecret(payload.accessToken),
        ...(payload.refreshToken ? { refreshToken: encryptSecret(payload.refreshToken) } : {}),
        tokenExpiresAt: new Date(Date.now() + payload.expiresIn * 1000),
        status: 'active',
        lastErrorMessage: null,
        updatedAt: new Date(),
      }).where(and(
        eq(calendarConnections.id, payload.reconnectId),
        eq(calendarConnections.workspaceId, payload.workspaceId),
      ));
      conn = await db.query.calendarConnections.findFirst({
        where: eq(calendarConnections.id, payload.reconnectId),
      });
    } else {
      const [inserted] = await db.insert(calendarConnections).values({
        workspaceId: payload.workspaceId,
        userId: payload.scope === 'personal' ? (payload.userId ?? user.sub) : null,
        provider,
        displayName: payload.email ?? `${provider} calendar`,
        accountEmail: payload.email ?? null,
        accessToken: encryptSecret(payload.accessToken),
        refreshToken: payload.refreshToken ? encryptSecret(payload.refreshToken) : null,
        tokenExpiresAt: new Date(Date.now() + payload.expiresIn * 1000),
        scopes: scopeStr,
        status: 'active',
      }).returning();
      conn = inserted;
    }

    if (conn) {
      try { await refreshCalendarCache(conn); } catch (e) {
        console.warn('[relay] initial calendar sync failed', e);
      }
    }
    return reply.status(201).send(conn ? projectConnection(conn) : null);
  });

  // ── POST /calendar/connections/ics ──────────────────────────────────────
  app.post('/calendar/connections/ics', { onRequest: [app.authenticate] }, async (req, reply) => {
    const user = req.user as AuthUser;
    const body = req.body as {
      workspaceId?: string; scope?: 'workspace' | 'personal';
      name?: string; icsUrl?: string;
    };
    if (!body.workspaceId) return reply.status(400).send({ error: 'workspaceId required' });
    if (!body.name?.trim()) return reply.status(400).send({ error: 'name required' });
    if (!body.icsUrl?.trim()) return reply.status(400).send({ error: 'icsUrl required' });

    const validation = validateIcsUrl(body.icsUrl.trim());
    if (!validation.ok) return reply.status(400).send({ error: validation.error });

    const desiredScope = body.scope === 'workspace' ? 'workspace' : 'personal';
    if (desiredScope === 'workspace' && !MANAGER_ROLES.has(user.role)) {
      return reply.status(403).send({ error: 'Manager role required for workspace-shared connections' });
    }
    const member = await checkWorkspaceAccess(body.workspaceId, user.sub);
    if (!member) return reply.status(403).send({ error: 'Forbidden' });

    const [conn] = await db.insert(calendarConnections).values({
      workspaceId: body.workspaceId,
      userId: desiredScope === 'personal' ? user.sub : null,
      provider: 'ics',
      displayName: body.name.trim(),
      icsUrl: encryptSecret(validation.url.toString()),
      status: 'active',
    }).returning();

    if (conn) {
      try { await refreshCalendarCache(conn); } catch { /* non-fatal */ }
    }
    return reply.status(201).send(conn ? projectConnection(conn) : null);
  });

  // ── POST /calendar/connections/apple ────────────────────────────────────
  app.post('/calendar/connections/apple', { onRequest: [app.authenticate] }, async (req, reply) => {
    const user = req.user as AuthUser;
    const body = req.body as {
      workspaceId?: string; scope?: 'workspace' | 'personal';
      name?: string; appleId?: string; appPassword?: string; serverUrl?: string;
    };
    if (!body.workspaceId) return reply.status(400).send({ error: 'workspaceId required' });
    if (!body.name?.trim()) return reply.status(400).send({ error: 'name required' });
    if (!body.appleId?.trim()) return reply.status(400).send({ error: 'appleId required' });
    if (!body.appPassword?.trim()) return reply.status(400).send({ error: 'appPassword required' });

    const desiredScope = body.scope === 'workspace' ? 'workspace' : 'personal';
    if (desiredScope === 'workspace' && !MANAGER_ROLES.has(user.role)) {
      return reply.status(403).send({ error: 'Manager role required for workspace-shared connections' });
    }
    const member = await checkWorkspaceAccess(body.workspaceId, user.sub);
    if (!member) return reply.status(403).send({ error: 'Forbidden' });

    const baseUrl = body.serverUrl?.trim() || 'https://caldav.icloud.com';
    // Probe credentials before persisting.
    try {
      await appleProbe({ baseUrl, username: body.appleId.trim(), password: body.appPassword.trim() });
    } catch (e) {
      return reply.status(400).send({
        error: 'Could not authenticate against CalDAV server',
        detail: e instanceof Error ? e.message : String(e),
      });
    }

    const [conn] = await db.insert(calendarConnections).values({
      workspaceId: body.workspaceId,
      userId: desiredScope === 'personal' ? user.sub : null,
      provider: 'apple_caldav',
      displayName: body.name.trim(),
      accountEmail: body.appleId.trim(),
      caldavUrl: encryptSecret(baseUrl),
      caldavUsername: encryptSecret(body.appleId.trim()),
      caldavAppPassword: encryptSecret(body.appPassword.trim()),
      status: 'active',
    }).returning();

    if (conn) {
      try { await refreshCalendarCache(conn); } catch { /* non-fatal */ }
    }
    return reply.status(201).send(conn ? projectConnection(conn) : null);
  });

  // ── GET /calendar/connections/:id/preview ───────────────────────────────
  // Wizard preview — caller supplies optional list of calendar IDs and a
  // date range; we proxy events without ever exposing tokens to the dashboard.
  app.get('/calendar/connections/:id/preview', { onRequest: [app.authenticate] }, async (req, reply) => {
    const user = req.user as AuthUser;
    const { id } = req.params as { id: string };
    const q = req.query as {
      from?: string; to?: string; calendarIds?: string; keyword?: string;
    };
    const conn = await loadConnection(id, user);
    if (!conn) return reply.status(404).send({ error: 'Not found' });

    const fromD = q.from ? new Date(q.from) : new Date();
    const toD = q.to ? new Date(q.to) : new Date(Date.now() + 7 * 86_400_000);
    if (Number.isNaN(fromD.getTime()) || Number.isNaN(toD.getTime())) {
      return reply.status(400).send({ error: 'Invalid from/to' });
    }
    const calendarIds = q.calendarIds ? q.calendarIds.split(',').filter(Boolean) : undefined;

    try {
      const events = await listEventsForConnection(conn, {
        from: fromD, to: toD, calendarIds, keyword: q.keyword,
      });
      return reply.send({ events });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      await db.update(calendarConnections)
        .set({ status: 'error', lastErrorMessage: msg, updatedAt: new Date() })
        .where(eq(calendarConnections.id, id));
      return reply.status(502).send({ error: 'Provider error', detail: msg });
    }
  });
}
