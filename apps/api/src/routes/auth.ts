import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';
import { randomBytes } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import {
  db,
  users,
  organisations,
  refreshTokens,
  orgStorageQuotas,
  managementCompanies,
  contentItems,
  workspaces,
} from '@signage/db';
import { eq, and, isNull, isNotNull, sum } from 'drizzle-orm';
import { totp } from 'otplib';
import QRCode from 'qrcode';
import {
  LoginSchema,
  LoginTotpSchema,
  ForgotPasswordSchema,
  ResetPasswordSchema,
  AcceptInviteSchema,
  AcceptOwnerInviteSchema,
  AcceptManagementCompanyInviteSchema,
  AcceptClientOrgInviteSchema,
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
  findValidMgmtAdminInvite,
  acceptMgmtAdminInvite,
  findValidClientOrgInvite,
  acceptClientOrgInvite,
} from '../services/auth.js';
import { sendPasswordResetEmail, sendResellerOnboardingConfirmationEmail } from '../services/email.js';
import { writeAuditLog } from '../services/audit.js';

const REFRESH_COOKIE = 'refresh_token';
const STORAGE_ROOT = process.env['STORAGE_ROOT'] ?? './signage_uploads';
const BRANDING_ASSET_TYPES = new Set(['logo', 'favicon', 'login-background']);

function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString('hex');
}

function deletedSlugTombstone(slug: string): string {
  return `${slug}--deleted-${randomToken(4)}`;
}

function getBrandAssetExtension(filename: string, mime: string): string {
  const ext = path.extname(filename).toLowerCase();
  if (ext) return ext;

  switch (mime) {
    case 'image/png':
      return '.png';
    case 'image/jpeg':
      return '.jpg';
    case 'image/webp':
      return '.webp';
    case 'image/svg+xml':
      return '.svg';
    case 'image/gif':
      return '.gif';
    case 'image/x-icon':
    case 'image/vnd.microsoft.icon':
      return '.ico';
    default:
      return '';
  }
}

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

  // ── GET/POST /auth/accept-management-company-invite/:token ──────────────────
  app.get('/accept-management-company-invite/:token', async (req, reply) => {
    const { token } = req.params as { token: string };
    const invite = await findValidMgmtAdminInvite(token);
    if (!invite) return reply.status(410).send({ error: 'Invite not found or expired' });

    const company = await db.query.managementCompanies.findFirst({
      where: eq(managementCompanies.id, invite.managementCompanyId),
    });

    return reply.send({
      email: invite.email,
      role: invite.role,
      companyName: company?.name ?? '',
      // true when the company still has a pending-generated slug (first admin onboarding)
      isFirstSetup: company?.slug?.startsWith('pending-') ?? false,
      logoUrl: company?.logoUrl ?? null,
      portalTitle: company?.portalTitle ?? null,
      faviconUrl: company?.faviconUrl ?? null,
      primaryColor: company?.primaryColor ?? null,
      accentColor: company?.accentColor ?? null,
      sidebarBg: company?.sidebarBg ?? null,
      headingFontPreset: company?.headingFontPreset ?? null,
      bodyFontPreset: company?.bodyFontPreset ?? null,
      loginBackgroundUrl: company?.loginBackgroundUrl ?? null,
    });
  });

  app.post('/accept-management-company-invite/:token/branding-assets/:assetType', async (req, reply) => {
    const { token, assetType } = req.params as { token: string; assetType: string };

    if (!BRANDING_ASSET_TYPES.has(assetType)) {
      return reply.status(400).send({ error: 'Unsupported branding asset type' });
    }

    const invite = await findValidMgmtAdminInvite(token);
    if (!invite) return reply.status(410).send({ error: 'Invite not found or expired' });

    const company = await db.query.managementCompanies.findFirst({
      where: eq(managementCompanies.id, invite.managementCompanyId),
      columns: { id: true, slug: true },
    });
    if (!company) return reply.status(404).send({ error: 'Company not found' });
    if (!company.slug.startsWith('pending-')) {
      return reply.status(403).send({ error: 'Branding uploads are only available during initial company setup' });
    }

    const file = await req.file();
    if (!file) return reply.status(400).send({ error: 'No file provided' });
    if (!file.mimetype.startsWith('image/')) {
      return reply.status(400).send({ error: 'Branding assets must be image files' });
    }

    const ext = getBrandAssetExtension(file.filename, file.mimetype);
    const relDir = path.join('management_branding', company.id);
    const relFile = `${assetType}-${randomToken(8)}${ext}`;
    const absDir = path.resolve(STORAGE_ROOT, relDir);
    const absPath = path.resolve(absDir, relFile);

    await fs.mkdir(absDir, { recursive: true });

    let fileSize = 0;
    const writeStream = createWriteStream(absPath);
    for await (const chunk of file.file) {
      writeStream.write(chunk);
      fileSize += chunk.length;
      if (fileSize > 10 * 1024 * 1024) {
        writeStream.destroy();
        await fs.unlink(absPath).catch(() => undefined);
        return reply.status(413).send({ error: 'Branding asset exceeds 10 MB limit' });
      }
    }

    await new Promise<void>((resolve, reject) => {
      writeStream.end();
      writeStream.on('finish', resolve);
      writeStream.on('error', reject);
    });

    const url = `/api/superadmin/auth/company-assets/${company.id}/${relFile}`;

    await writeAuditLog({
      actorId: invite.id,
      actorType: 'system',
      action: 'MGMT_ADMIN_INVITE_BRANDING_ASSET_UPLOADED',
      entityType: 'management_company',
      entityId: company.id,
      meta: { assetType, url, inviteId: invite.id },
      ipAddress: req.ip,
    });

    return reply.status(201).send({ assetType, url });
  });

  app.post('/accept-management-company-invite/:token', async (req, reply) => {
    const { token } = req.params as { token: string };

    const invite = await findValidMgmtAdminInvite(token);
    if (!invite) return reply.status(410).send({ error: 'Invite not found or expired' });

    const body = AcceptManagementCompanyInviteSchema.safeParse(req.body);
    if (!body.success) return reply.status(400).send({ error: body.error.flatten() });

    // If this is the first-setup invite, persist company details before creating account
    const company = await db.query.managementCompanies.findFirst({
      where: eq(managementCompanies.id, invite.managementCompanyId),
    });

    if (company?.slug?.startsWith('pending-') && body.data.companyName && body.data.companyPortalUrl) {
      const deletedSlugMatch = await db.query.managementCompanies.findFirst({
        where: and(
          eq(managementCompanies.slug, body.data.companyPortalUrl),
          isNotNull(managementCompanies.deletedAt),
        ),
      });
      if (deletedSlugMatch && deletedSlugMatch.id !== company.id) {
        await db
          .update(managementCompanies)
          .set({ slug: deletedSlugTombstone(deletedSlugMatch.slug), updatedAt: new Date() })
          .where(eq(managementCompanies.id, deletedSlugMatch.id));
      }
      const slugTaken = await db.query.managementCompanies.findFirst({
        where: and(
          eq(managementCompanies.slug, body.data.companyPortalUrl),
          isNull(managementCompanies.deletedAt),
        ),
      });
      if (slugTaken && slugTaken.id !== company.id) {
        return reply.status(409).send({ error: 'This portal address is already taken, please choose another' });
      }
      await db
        .update(managementCompanies)
        .set({
          name: body.data.companyName,
          slug: body.data.companyPortalUrl,
          billingEmail: body.data.billingEmail || null,
          logoUrl: body.data.logoUrl || null,
          portalTitle: body.data.portalTitle || null,
          faviconUrl: body.data.faviconUrl || null,
          primaryColor: body.data.primaryColor || null,
          accentColor: body.data.accentColor || null,
          sidebarBg: body.data.sidebarBg || null,
          headingFontPreset: body.data.headingFontPreset || null,
          bodyFontPreset: body.data.bodyFontPreset || null,
          loginBackgroundUrl: body.data.loginBackgroundUrl || null,
          updatedAt: new Date(),
        })
        .where(eq(managementCompanies.id, company.id));
    }

    if (body.data.createOwnerDashboardAccount && body.data.ownerOrgSlug) {
      const softDeletedOrgSlugMatch = await db.query.organisations.findFirst({
        where: and(eq(organisations.slug, body.data.ownerOrgSlug), isNotNull(organisations.deletedAt)),
      });
      if (softDeletedOrgSlugMatch && softDeletedOrgSlugMatch.deletedAt) {
        await db
          .update(organisations)
          .set({ slug: deletedSlugTombstone(softDeletedOrgSlugMatch.slug), updatedAt: new Date() })
          .where(eq(organisations.id, softDeletedOrgSlugMatch.id));
      }
      const slugTaken = await db.query.organisations.findFirst({
        where: and(eq(organisations.slug, body.data.ownerOrgSlug), isNull(organisations.deletedAt)),
      });
      if (slugTaken) {
        return reply.status(409).send({ error: 'This dashboard organization slug is already taken, please choose another' });
      }
    }

    const result = await acceptMgmtAdminInvite(
      invite.id,
      invite.managementCompanyId,
      invite.email,
      invite.role,
      body.data.name,
      body.data.password,
      body.data.createOwnerDashboardAccount
        ? {
            orgName: body.data.ownerOrgName ?? '',
            orgSlug: body.data.ownerOrgSlug ?? '',
            workspaceName: body.data.ownerWorkspaceName ?? '',
            workspaceTimezone: body.data.ownerWorkspaceTimezone ?? 'UTC',
          }
        : undefined,
    );
    const admin = result.admin;
    if (!admin) return reply.status(500).send({ error: 'Failed to create admin account' });

    await writeAuditLog({
      actorId: admin.id,
      actorType: 'system',
      action: 'MGMT_ADMIN_INVITE_ACCEPTED',
      entityType: 'management_company_admin',
      entityId: admin.id,
      ipAddress: req.ip,
    });

    if (result.ownerOrg && result.ownerUser && result.ownerWorkspace) {
      await writeAuditLog({
        orgId: result.ownerOrg.id,
        actorId: result.ownerUser.id,
        actorType: 'system',
        action: 'RESELLER_OWNER_DASHBOARD_PROVISIONED',
        entityType: 'organisation',
        entityId: result.ownerOrg.id,
        meta: {
          managementCompanyId: invite.managementCompanyId,
          workspaceId: result.ownerWorkspace.id,
          sourceInviteId: invite.id,
        },
        ipAddress: req.ip,
      });
    }

    // Return companySlug so the frontend can redirect to /m/:slug
    const updatedCompany = await db.query.managementCompanies.findFirst({
      where: eq(managementCompanies.id, invite.managementCompanyId),
    });

    if (
      updatedCompany &&
      updatedCompany.slug &&
      !updatedCompany.slug.startsWith('pending-') &&
      result.ownerOrg &&
      result.ownerUser &&
      result.ownerWorkspace
    ) {
      const appUrl = (process.env['APP_URL'] ?? 'https://ds.chiho.app').replace(/\/+$/, '');
      const resellerPortalLink = `${appUrl}/m/${updatedCompany.slug}/login`;
      const dashboardLink = `${appUrl}/login`;

      try {
        await sendResellerOnboardingConfirmationEmail(invite.email, {
          recipientName: body.data.name,
          companyName: updatedCompany.name,
          resellerPortalLink,
          dashboardLink,
          branding: {
            portalTitle: updatedCompany.portalTitle ?? updatedCompany.name,
            logoUrl: updatedCompany.logoUrl ?? null,
            primaryColor: updatedCompany.primaryColor ?? null,
            accentColor: updatedCompany.accentColor ?? null,
          },
        });
      } catch (err) {
        req.log.error({ err, managementCompanyId: updatedCompany.id }, 'Failed to send reseller onboarding confirmation email');
      }
    }

    return reply.status(201).send({
      id: admin.id,
      companySlug: updatedCompany?.slug ?? null,
      ownerDashboardProvisioned: Boolean(result.ownerOrg && result.ownerUser && result.ownerWorkspace),
    });
  });

  // ── GET/POST /auth/accept-client-org-invite/:token ──────────────────────────
  app.get('/accept-client-org-invite/:token', async (req, reply) => {
    const { token } = req.params as { token: string };
    const invite = await findValidClientOrgInvite(token);
    if (!invite) return reply.status(410).send({ error: 'Invite not found or expired' });

    const company = await db.query.managementCompanies.findFirst({
      where: eq(managementCompanies.id, invite.managementCompanyId),
    });

    return reply.send({
      email: invite.email,
      managingCompanyName: company?.name ?? '',
    });
  });

  app.post('/accept-client-org-invite/:token', async (req, reply) => {
    const { token } = req.params as { token: string };

    const invite = await findValidClientOrgInvite(token);
    if (!invite) return reply.status(410).send({ error: 'Invite not found or expired' });

    const body = AcceptClientOrgInviteSchema.safeParse(req.body);
    if (!body.success) return reply.status(400).send({ error: body.error.flatten() });

    // Ensure org slug is not already taken
    const softDeletedOrgSlugMatch = await db.query.organisations.findFirst({
      where: eq(organisations.slug, body.data.orgSlug),
    });
    if (softDeletedOrgSlugMatch && softDeletedOrgSlugMatch.deletedAt) {
      await db
        .update(organisations)
        .set({ slug: deletedSlugTombstone(softDeletedOrgSlugMatch.slug), updatedAt: new Date() })
        .where(eq(organisations.id, softDeletedOrgSlugMatch.id));
    }
    const slugTaken = await db.query.organisations.findFirst({
      where: and(eq(organisations.slug, body.data.orgSlug), isNull(organisations.deletedAt)),
    });
    if (slugTaken) return reply.status(409).send({ error: 'Org slug already taken' });

    const user = await acceptClientOrgInvite(
      invite.id,
      invite.organizationId,
      invite.managementCompanyId,
      invite.invitedByAdminId ?? '',
      invite.email,
      body.data.name,
      body.data.password,
      {
        orgName: body.data.orgName,
        orgSlug: body.data.orgSlug,
        workspaceName: body.data.workspaceName,
        workspaceTimezone: body.data.workspaceTimezone,
      },
    );
    if (!user) return reply.status(500).send({ error: 'Failed to create user account' });

    await writeAuditLog({
      orgId: invite.organizationId,
      actorId: user.id,
      actorType: 'system',
      action: 'CLIENT_ORG_INVITE_ACCEPTED',
      entityType: 'user',
      entityId: user.id,
      ipAddress: req.ip,
    });

    return reply.status(201).send({ id: user.id, orgId: invite.organizationId });
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

    const [storageUsageRow] = await db
      .select({ usedBytes: sum(contentItems.fileSize) })
      .from(contentItems)
      .innerJoin(workspaces, eq(contentItems.workspaceId, workspaces.id))
      .where(
        and(
          eq(workspaces.orgId, orgId),
          isNull(workspaces.deletedAt),
          isNull(contentItems.deletedAt),
        ),
      );

    const quota = await db.query.orgStorageQuotas.findFirst({
      where: eq(orgStorageQuotas.orgId, orgId),
      columns: { limitBytes: true },
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
        usedBytes: Number(storageUsageRow?.usedBytes ?? 0),
        limitBytes: quota?.limitBytes ?? planDefaults[org.plan] ?? planDefaults.starter,
      },
    });
  });
}
