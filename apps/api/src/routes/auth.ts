import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';
import { db, users, organisations, refreshTokens, orgStorageQuotas } from '@signage/db';
import { eq, and, isNull } from 'drizzle-orm';
import { totp } from 'otplib';
import QRCode from 'qrcode';
import {
  LoginSchema,
  LoginTotpSchema,
  ForgotPasswordSchema,
  ResetPasswordSchema,
  AcceptInviteSchema,
  AcceptOwnerInviteSchema,
} from '@signage/shared';
import {
  verifyLogin,
  createRefreshToken,
  rotateRefreshToken,
  revokeRefreshToken,
  generateTotpSecret,
  getTotpUri,
  verifyTotpCode,
  generateBackupCodes,
  verifyBackupCode,
  findValidInvite,
  acceptInvite,
} from '../services/auth.js';
import { sendPasswordResetEmail } from '../services/email.js';
import { writeAuditLog } from '../services/audit.js';

const REFRESH_COOKIE = 'refresh_token';

function setRefreshCookie(reply: FastifyReply, token: string) {
  void reply.setCookie(REFRESH_COOKIE, token, {
    httpOnly: true,
    secure: process.env['NODE_ENV'] === 'production',
    sameSite: 'lax',
    path: '/auth/refresh',
    maxAge: 60 * 60 * 24 * 30,
  });
}

export async function authRoutes(app: FastifyInstance) {
  // ── POST /auth/login ────────────────────────────────────────────────────────
  app.post('/login', async (req, reply) => {
    const body = LoginSchema.safeParse(req.body);
    if (!body.success) return reply.status(400).send({ error: body.error.flatten() });

    const result = await verifyLogin(body.data.email, body.data.password);
    if ('error' in result) return reply.status(401).send({ error: result.error });

    const { user } = result;

    // If 2FA is enabled return a short-lived temp token instead
    if (user.totpEnabled) {
      const tempToken = app.jwt.sign({ sub: user.id, type: '2fa_pending' }, { expiresIn: '5m' });
      return reply.send({ requiresTwoFactor: true, tempToken });
    }

    const accessToken = app.jwt.sign({ sub: user.id, orgId: user.orgId, role: user.orgRole });
    const refreshToken = await createRefreshToken(
      user.id,
      req.ip,
      req.headers['user-agent'] ?? undefined,
    );
    setRefreshCookie(reply, refreshToken);

    await db.update(users).set({ lastLogin: new Date() }).where(eq(users.id, user.id));

    await writeAuditLog({
      orgId: user.orgId,
      actorId: user.id,
      action: 'LOGIN',
      entityType: 'user',
      entityId: user.id,
      ipAddress: req.ip,
    });

    return reply.send({ accessToken, user: { id: user.id, name: user.name, email: user.email, orgRole: user.orgRole } });
  });

  // ── POST /auth/login/2fa ────────────────────────────────────────────────────
  app.post('/login/2fa', async (req, reply) => {
    const body = LoginTotpSchema.safeParse(req.body);
    if (!body.success) return reply.status(400).send({ error: body.error.flatten() });

    let payload: { sub: string; type: string };
    try {
      payload = app.jwt.verify<{ sub: string; type: string }>(body.data.tempToken);
    } catch {
      return reply.status(401).send({ error: 'Invalid or expired temporary token' });
    }
    if (payload.type !== '2fa_pending') return reply.status(401).send({ error: 'Invalid token type' });

    const user = await db.query.users.findFirst({ where: eq(users.id, payload.sub) });
    if (!user?.totpSecret) return reply.status(401).send({ error: 'Invalid token' });

    const valid =
      verifyTotpCode(user.totpSecret, body.data.token) ||
      (await verifyBackupCode(user.id, body.data.token));

    if (!valid) return reply.status(401).send({ error: 'Invalid two-factor code' });

    const accessToken = app.jwt.sign({ sub: user.id, orgId: user.orgId, role: user.orgRole });
    const refreshToken = await createRefreshToken(user.id, req.ip, req.headers['user-agent'] ?? undefined);
    setRefreshCookie(reply, refreshToken);
    await db.update(users).set({ lastLogin: new Date() }).where(eq(users.id, user.id));

    await writeAuditLog({
      orgId: user.orgId,
      actorId: user.id,
      action: 'LOGIN_2FA',
      entityType: 'user',
      entityId: user.id,
      ipAddress: req.ip,
    });

    return reply.send({ accessToken, user: { id: user.id, name: user.name, email: user.email, orgRole: user.orgRole } });
  });

  // ── POST /auth/refresh ──────────────────────────────────────────────────────
  app.post('/refresh', async (req, reply) => {
    const raw = req.cookies[REFRESH_COOKIE];
    if (!raw) return reply.status(401).send({ error: 'No refresh token' });

    const result = await rotateRefreshToken(raw, req.ip, req.headers['user-agent'] ?? undefined);
    if ('error' in result) {
      reply.clearCookie(REFRESH_COOKIE, { path: '/auth/refresh' });
      return reply.status(401).send({ error: result.error });
    }

    const user = await db.query.users.findFirst({ where: eq(users.id, result.userId) });
    if (!user) return reply.status(401).send({ error: 'User not found' });

    const accessToken = app.jwt.sign({ sub: user.id, orgId: user.orgId, role: user.orgRole });
    setRefreshCookie(reply, result.newRefreshToken);
    return reply.send({ accessToken });
  });

  // ── POST /auth/logout ───────────────────────────────────────────────────────
  app.post('/logout', async (req, reply) => {
    const raw = req.cookies[REFRESH_COOKIE];
    if (raw) await revokeRefreshToken(raw);
    reply.clearCookie(REFRESH_COOKIE, { path: '/auth/refresh' });
    return reply.status(204).send();
  });

  // ── GET/POST /auth/accept-invite/:token ─────────────────────────────────────
  app.get('/accept-invite/:token', async (req, reply) => {
    const { token } = req.params as { token: string };
    const invite = await findValidInvite(token);
    if (!invite) return reply.status(410).send({ error: 'Invite not found or expired' });
    const org = await db.query.organisations.findFirst({ where: eq(organisations.id, invite.orgId) });
    const isPendingSetup = org?.slug.startsWith('pending-') ?? false;
    return reply.send({ email: invite.email, orgRole: invite.orgRole, orgName: isPendingSetup ? '' : (org?.name ?? ''), isPendingSetup });
  });

  app.post('/accept-invite/:token', async (req, reply) => {
    const { token } = req.params as { token: string };

    const invite = await findValidInvite(token);
    if (!invite) return reply.status(410).send({ error: 'Invite not found or expired' });

    const org = await db.query.organisations.findFirst({ where: eq(organisations.id, invite.orgId) });
    const isPendingSetup = org?.slug.startsWith('pending-') ?? false;

    if (isPendingSetup) {
      const body = AcceptOwnerInviteSchema.safeParse(req.body);
      if (!body.success) return reply.status(400).send({ error: body.error.flatten() });

      // Ensure slug is not taken by another org
      const slugTaken = await db.query.organisations.findFirst({
        where: and(eq(organisations.slug, body.data.orgSlug), isNull(organisations.deletedAt)),
      });
      if (slugTaken) return reply.status(409).send({ error: 'Slug already taken' });

      const user = await acceptInvite(
        invite.id,
        invite.orgId,
        invite.email,
        invite.orgRole,
        body.data.name,
        body.data.password,
        undefined,
        { orgName: body.data.orgName, orgSlug: body.data.orgSlug, workspaceName: body.data.workspaceName, workspaceTimezone: body.data.workspaceTimezone },
      );

      if (user) {
        await writeAuditLog({
          orgId: invite.orgId,
          actorId: user.id,
          action: 'INVITE_ACCEPTED',
          entityType: 'user',
          entityId: user.id,
          ipAddress: req.ip,
        });
      }

      return reply.status(201).send({ id: user?.id });
    }

    const body = AcceptInviteSchema.safeParse(req.body);
    if (!body.success) return reply.status(400).send({ error: body.error.flatten() });

    const user = await acceptInvite(
      invite.id,
      invite.orgId,
      invite.email,
      invite.orgRole,
      body.data.name,
      body.data.password,
      invite.initialWorkspaceId ?? undefined,
    );

    if (user) {
      await writeAuditLog({
        orgId: invite.orgId,
        actorId: user.id,
        action: 'INVITE_ACCEPTED',
        entityType: 'user',
        entityId: user.id,
        ipAddress: req.ip,
      });
    }

    return reply.status(201).send({ id: user?.id });
  });

  // ── 2FA setup ───────────────────────────────────────────────────────────────
  app.post('/2fa/setup', { onRequest: [app.authenticate] }, async (req, reply) => {
    const userId = (req.user as { sub: string }).sub;
    const user = await db.query.users.findFirst({ where: eq(users.id, userId) });
    if (!user) return reply.status(404).send({ error: 'User not found' });
    if (user.totpEnabled) return reply.status(409).send({ error: '2FA already enabled' });

    const secret = generateTotpSecret();
    const uri = getTotpUri(secret, user.email);
    const qrDataUrl = await QRCode.toDataURL(uri);

    // Save secret unconfirmed — activated in /2fa/verify
    await db.update(users).set({ totpSecret: secret }).where(eq(users.id, userId));

    return reply.send({ secret, qrDataUrl });
  });

  app.post('/2fa/verify', { onRequest: [app.authenticate] }, async (req, reply) => {
    const userId = (req.user as { sub: string }).sub;
    const body = z.object({ token: z.string().length(6).regex(/^\d+$/) }).safeParse(req.body);
    if (!body.success) return reply.status(400).send({ error: body.error.flatten() });

    const user = await db.query.users.findFirst({ where: eq(users.id, userId) });
    if (!user?.totpSecret) return reply.status(400).send({ error: '2FA setup not started' });

    if (!verifyTotpCode(user.totpSecret, body.data.token))
      return reply.status(400).send({ error: 'Invalid TOTP code' });

    const { raw, hashed } = await generateBackupCodes();
    await db.update(users).set({ totpEnabled: true, backupCodes: hashed }).where(eq(users.id, userId));

    return reply.send({ backupCodes: raw });
  });

  app.post('/2fa/disable', { onRequest: [app.authenticate] }, async (req, reply) => {
    const userId = (req.user as { sub: string }).sub;
    const body = z.object({ password: z.string(), token: z.string() }).safeParse(req.body);
    if (!body.success) return reply.status(400).send({ error: body.error.flatten() });

    const user = await db.query.users.findFirst({ where: eq(users.id, userId) });
    if (!user?.passwordHash) return reply.status(400).send({ error: 'Cannot disable 2FA' });

    const { default: argon2 } = await import('argon2');
    const pwOk = await argon2.verify(user.passwordHash, body.data.password);
    if (!pwOk) return reply.status(401).send({ error: 'Invalid password' });

    if (!user.totpSecret || !verifyTotpCode(user.totpSecret, body.data.token))
      return reply.status(401).send({ error: 'Invalid TOTP code' });

    await db
      .update(users)
      .set({ totpEnabled: false, totpSecret: null, backupCodes: [] })
      .where(eq(users.id, userId));

    return reply.status(204).send();
  });

  app.get('/2fa/backup-codes', { onRequest: [app.authenticate] }, async (req, reply) => {
    const userId = (req.user as { sub: string }).sub;
    const user = await db.query.users.findFirst({ where: eq(users.id, userId) });
    if (!user?.totpEnabled) return reply.status(400).send({ error: '2FA not enabled' });

    const { raw, hashed } = await generateBackupCodes();
    await db.update(users).set({ backupCodes: hashed }).where(eq(users.id, userId));
    return reply.send({ backupCodes: raw });
  });

  // ── POST /auth/forgot-password ──────────────────────────────────────────────
  app.post('/forgot-password', async (req, reply) => {
    const body = ForgotPasswordSchema.safeParse(req.body);
    if (!body.success) return reply.status(400).send({ error: body.error.flatten() });

    // Always return 204 to prevent email enumeration
    const user = await db.query.users.findFirst({
      where: and(
        eq(users.email, body.data.email.toLowerCase()),
        isNull(users.deletedAt),
      ),
    });
    if (!user?.passwordHash) return reply.status(204).send();

    const resetToken = app.jwt.sign(
      { sub: user.id, type: 'pw_reset' },
      { expiresIn: '1h' },
    );

    try {
      await sendPasswordResetEmail(user.email, resetToken);
    } catch (err) {
      app.log.error({ err }, 'Failed to send password reset email');
    }

    return reply.status(204).send();
  });

  // ── POST /auth/reset-password ───────────────────────────────────────────────
  app.post('/reset-password', async (req, reply) => {
    const body = ResetPasswordSchema.safeParse(req.body);
    if (!body.success) return reply.status(400).send({ error: body.error.flatten() });

    let payload: { sub: string; type: string };
    try {
      payload = app.jwt.verify<{ sub: string; type: string }>(body.data.token);
    } catch {
      return reply.status(400).send({ error: 'Invalid or expired reset link' });
    }
    if (payload.type !== 'pw_reset') return reply.status(400).send({ error: 'Invalid token' });

    const { default: argon2 } = await import('argon2');
    const passwordHash = await argon2.hash(body.data.password);
    await db.update(users).set({ passwordHash, updatedAt: new Date() }).where(eq(users.id, payload.sub));

    // Revoke all active refresh tokens for security
    await db
      .update(refreshTokens)
      .set({ revokedAt: new Date() })
      .where(eq(refreshTokens.userId, payload.sub));

    return reply.status(204).send();
  });

  // ── GET /auth/me ──────────────────────────────────────────────────────────
  app.get('/me', { onRequest: [app.authenticate] }, async (req, reply) => {
    const { sub, orgId } = req.user as { sub: string; orgId: string };

    const user = await db.query.users.findFirst({
      where: and(eq(users.id, sub), isNull(users.deletedAt)),
      columns: { id: true, name: true, email: true, orgRole: true },
    });
    if (!user) return reply.status(404).send({ error: 'User not found' });

    const org = await db.query.organisations.findFirst({
      where: and(eq(organisations.id, orgId), isNull(organisations.deletedAt)),
      columns: { id: true, name: true, slug: true, plan: true },
    });
    if (!org) return reply.status(404).send({ error: 'Org not found' });

    const quota = await db.query.orgStorageQuotas.findFirst({
      where: eq(orgStorageQuotas.orgId, orgId),
      columns: { limitBytes: true, usedBytes: true },
    });

    const planDefaults: Record<string, number> = {
      starter: 5_368_709_120,
      pro: 53_687_091_200,
      enterprise: 536_870_912_000,
    };

    return reply.send({
      user,
      org,
      storage: {
        usedBytes: quota?.usedBytes ?? 0,
        limitBytes: quota?.limitBytes ?? planDefaults[org.plan] ?? planDefaults.starter,
      },
    });
  });
}
