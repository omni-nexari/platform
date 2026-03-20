import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  db,
  platformOwners,
  organisations,
  users,
  orgStorageQuotas,
  managementCompanies,
  managementCompanyAdmins,
  managementCompanyAdminInvitations,
  clientOrgOwnerInvitations,
} from '@signage/db';
import { eq, isNull, count, sql, desc, and, inArray } from 'drizzle-orm';
import * as argon2 from 'argon2';
import { randomBytes } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import * as fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  CreateManagementCompanySchema,
  InviteManagementCompanyAdminSchema,
  InviteClientOrgOwnerSchema,
  ManagementCompanyBrandingSchema,
} from '@signage/shared';
import { sendInviteEmail } from '../services/email.js';
import { writeAuditLog } from '../services/audit.js';

const STORAGE_ROOT = process.env['STORAGE_ROOT'] ?? './signage_uploads';
const BRANDING_ASSET_TYPES = new Set(['logo', 'favicon', 'login-background']);

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

function getBrandAssetContentType(filename: string): string {
  switch (path.extname(filename).toLowerCase()) {
    case '.png':
      return 'image/png';
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg';
    case '.webp':
      return 'image/webp';
    case '.svg':
      return 'image/svg+xml';
    case '.gif':
      return 'image/gif';
    case '.ico':
      return 'image/x-icon';
    default:
      return 'application/octet-stream';
  }
}

function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString('hex');
}

function inviteExpiry(days = 7): Date {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d;
}

type PlatformAdminCaller =
  | { sub: string; type: 'platform_owner'; email: string; name: string }
  | {
      sub: string;
      type: 'management_company_admin';
      managementCompanyId: string;
      email: string;
      name: string;
      role: string;
    };

function isOwnerCaller(
  caller: PlatformAdminCaller,
): caller is Extract<PlatformAdminCaller, { type: 'platform_owner' }> {
  return caller.type === 'platform_owner';
}

export async function superAdminRoutes(app: FastifyInstance) {

  // ── GET /superadmin/auth/company-assets/:companyId/:fileName  (public) ─────
  app.get('/auth/company-assets/:companyId/:fileName', async (req, reply) => {
    const { companyId, fileName } = req.params as { companyId: string; fileName: string };
    const safeFileName = path.basename(fileName);

    const company = await db.query.managementCompanies.findFirst({
      where: and(eq(managementCompanies.id, companyId), isNull(managementCompanies.deletedAt)),
      columns: { id: true },
    });
    if (!company) return reply.status(404).send({ error: 'Not found' });

    const absPath = path.resolve(STORAGE_ROOT, 'management_branding', companyId, safeFileName);
    try {
      const buf = await fs.readFile(absPath);
      reply.header('content-type', getBrandAssetContentType(safeFileName));
      return reply.send(buf);
    } catch {
      return reply.status(404).send({ error: 'Not found' });
    }
  });

  // ── POST /superadmin/auth/login  (platform owner) ──────────────────────────
  app.post('/auth/login', async (req, reply) => {
    const body = z
      .object({ email: z.string().email(), password: z.string().min(1) })
      .safeParse(req.body);
    if (!body.success) return reply.status(400).send({ error: body.error.flatten() });

    const owner = await db.query.platformOwners.findFirst({
      where: eq(platformOwners.email, body.data.email.toLowerCase()),
    });
    if (!owner) return reply.status(401).send({ error: 'Invalid credentials' });

    const valid = await argon2.verify(owner.passwordHash, body.data.password);
    if (!valid) return reply.status(401).send({ error: 'Invalid credentials' });

    await db
      .update(platformOwners)
      .set({ lastLogin: new Date(), updatedAt: new Date() })
      .where(eq(platformOwners.id, owner.id));

    const accessToken = app.jwt.sign(
      { sub: owner.id, type: 'platform_owner', email: owner.email, name: owner.name ?? '' },
      { expiresIn: '8h' },
    );

    return reply.send({
      accessToken,
      user: { id: owner.id, email: owner.email, name: owner.name, type: 'platform_owner' },
    });
  });

  // ── GET /superadmin/auth/company/:slug  (public — login page branding) ──────
  app.get('/auth/company/:slug', async (req, reply) => {
    const { slug } = req.params as { slug: string };
    const company = await db.query.managementCompanies.findFirst({
      where: and(eq(managementCompanies.slug, slug), isNull(managementCompanies.deletedAt)),
    });
    if (!company || company.slug.startsWith('pending-')) {
      return reply.status(404).send({ error: 'Company not found' });
    }
    return reply.send({
      name: company.name,
      slug: company.slug,
      logoUrl: company.logoUrl ?? null,
      portalTitle: company.portalTitle ?? null,
      faviconUrl: company.faviconUrl ?? null,
      primaryColor: company.primaryColor ?? null,
      accentColor: company.accentColor ?? null,
      sidebarBg: company.sidebarBg ?? null,
      headingFontPreset: company.headingFontPreset ?? null,
      bodyFontPreset: company.bodyFontPreset ?? null,
      loginBackgroundUrl: company.loginBackgroundUrl ?? null,
      suspendedAt: company.suspendedAt ?? null,
    });
  });

  // ── POST /superadmin/auth/company-login  (management company admin) ─────────
  app.post('/auth/company-login', async (req, reply) => {
    const body = z
      .object({ email: z.string().email(), password: z.string().min(1) })
      .safeParse(req.body);
    if (!body.success) return reply.status(400).send({ error: body.error.flatten() });

    const admin = await db.query.managementCompanyAdmins.findFirst({
      where: eq(managementCompanyAdmins.email, body.data.email.toLowerCase()),
    });
    if (!admin) return reply.status(401).send({ error: 'Invalid credentials' });
    if (admin.suspendedAt) return reply.status(403).send({ error: 'Account suspended' });

    const valid = await argon2.verify(admin.passwordHash, body.data.password);
    if (!valid) return reply.status(401).send({ error: 'Invalid credentials' });

    await db
      .update(managementCompanyAdmins)
      .set({ lastLogin: new Date(), updatedAt: new Date() })
      .where(eq(managementCompanyAdmins.id, admin.id));

    const company = await db.query.managementCompanies.findFirst({
      where: eq(managementCompanies.id, admin.managementCompanyId),
    });

    const accessToken = app.jwt.sign(
      {
        sub: admin.id,
        type: 'management_company_admin',
        managementCompanyId: admin.managementCompanyId,
        email: admin.email,
        name: admin.name ?? '',
        role: admin.role,
      },
      { expiresIn: '8h' },
    );

    return reply.send({
      accessToken,
      user: {
        id: admin.id,
        email: admin.email,
        name: admin.name,
        role: admin.role,
        managementCompanyId: admin.managementCompanyId,
        type: 'management_company_admin',
        companyName: company?.name ?? null,
        companySlug: company?.slug ?? null,
        companyLogoUrl: company?.logoUrl ?? null,
        companyPortalTitle: company?.portalTitle ?? null,
        companyFaviconUrl: company?.faviconUrl ?? null,
        companyPrimaryColor: company?.primaryColor ?? null,
        companyAccentColor: company?.accentColor ?? null,
        companySidebarBg: company?.sidebarBg ?? null,
        companyHeadingFontPreset: company?.headingFontPreset ?? null,
        companyBodyFontPreset: company?.bodyFontPreset ?? null,
        companyLoginBackgroundUrl: company?.loginBackgroundUrl ?? null,
      },
    });
  });

  // ── GET /superadmin/management-companies  (platform owner only) ─────────────
  app.get(
    '/management-companies',
    { onRequest: [app.authenticatePlatformOwner] },
    async (_req, reply) => {
      const companies = await db.query.managementCompanies.findMany({
        where: isNull(managementCompanies.deletedAt),
        orderBy: [desc(managementCompanies.createdAt)],
      });

      const adminCounts = await db
        .select({ companyId: managementCompanyAdmins.managementCompanyId, cnt: count() })
        .from(managementCompanyAdmins)
        .where(isNull(managementCompanyAdmins.suspendedAt))
        .groupBy(managementCompanyAdmins.managementCompanyId);

      const orgCounts = await db
        .select({ companyId: organisations.managementCompanyId, cnt: count() })
        .from(organisations)
        .where(isNull(organisations.deletedAt))
        .groupBy(organisations.managementCompanyId);

      const adminMap = Object.fromEntries(adminCounts.map((r) => [r.companyId, Number(r.cnt)]));
      const orgMap = Object.fromEntries(orgCounts.map((r) => [r.companyId ?? '', Number(r.cnt)]));

      return reply.send(
        companies.map((c) => ({
          ...c,
          adminCount: adminMap[c.id] ?? 0,
          orgCount: orgMap[c.id] ?? 0,
        })),
      );
    },
  );

  // ── POST /superadmin/management-companies  (platform owner only) ────────────
  app.post(
    '/management-companies',
    { onRequest: [app.authenticatePlatformOwner] },
    async (req, reply) => {
      const body = CreateManagementCompanySchema.safeParse(req.body);
      if (!body.success) return reply.status(400).send({ error: body.error.flatten() });

      const caller = req.user as PlatformAdminCaller;
      const { initialAdminEmail, initialAdminName } = body.data;

      // Company name & slug filled in by the admin during onboarding
      const tempSlug = `pending-${randomToken(4)}`;
      const [company] = await db
        .insert(managementCompanies)
        .values({ name: '(pending setup)', slug: tempSlug, createdByOwnerId: caller.sub })
        .returning();
      if (!company) return reply.status(500).send({ error: 'Failed to create management company' });

      const token = randomToken();
      await db.insert(managementCompanyAdminInvitations).values({
        managementCompanyId: company.id,
        invitedByOwnerId: caller.sub,
        email: initialAdminEmail.toLowerCase(),
        role: 'owner',
        token,
        expiresAt: inviteExpiry(7),
      });

      try {
        await sendInviteEmail(initialAdminEmail, token, {
          recipientName: initialAdminName,
          orgRole: 'owner',
          inviteType: 'management_company_admin',
          companyName: 'your company portal',
          branding: {
            portalTitle: company.portalTitle ?? null,
            logoUrl: company.logoUrl ?? null,
            primaryColor: company.primaryColor ?? null,
            accentColor: company.accentColor ?? null,
          },
        });
      } catch (err) {
        app.log.error({ err }, 'Failed to send management company admin invite email');
      }

      await writeAuditLog({
        actorId: caller.sub,
        actorType: 'system',
        action: 'MANAGEMENT_COMPANY_CREATED',
        entityType: 'management_company',
        entityId: company.id,
        meta: { adminEmail: initialAdminEmail },
        ipAddress: req.ip,
      });

      return reply.status(201).send({ company, initialInviteSent: true });
    },
  );

  // ── GET /superadmin/management-companies/:id  (owner or own-company MCA) ────
  app.get(
    '/management-companies/:id',
    { onRequest: [app.authenticatePlatformAdmin] },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const caller = req.user as PlatformAdminCaller;

      if (!isOwnerCaller(caller) && caller.managementCompanyId !== id) {
        return reply.status(403).send({ error: 'Forbidden' });
      }

      const company = await db.query.managementCompanies.findFirst({
        where: and(eq(managementCompanies.id, id), isNull(managementCompanies.deletedAt)),
      });
      if (!company) return reply.status(404).send({ error: 'Not found' });

      const [adminsRow] = await db
        .select({ total: count() })
        .from(managementCompanyAdmins)
        .where(
          and(
            eq(managementCompanyAdmins.managementCompanyId, id),
            isNull(managementCompanyAdmins.suspendedAt),
          ),
        );
      const [orgsRow] = await db
        .select({ total: count() })
        .from(organisations)
        .where(and(eq(organisations.managementCompanyId, id), isNull(organisations.deletedAt)));

      return reply.send({
        ...company,
        adminCount: Number(adminsRow?.total ?? 0),
        orgCount: Number(orgsRow?.total ?? 0),
      });
    },
  );

  // ── PATCH /superadmin/management-companies/:id  (platform owner only) ───────
  app.patch(
    '/management-companies/:id',
    { onRequest: [app.authenticatePlatformOwner] },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const body = z
        .object({
          name: z.string().min(2).max(120).optional(),
          billingEmail: z.string().email().nullable().optional(),
          suspended: z.boolean().optional(),
        })
        .safeParse(req.body);
      if (!body.success) return reply.status(400).send({ error: body.error.flatten() });

      const company = await db.query.managementCompanies.findFirst({
        where: eq(managementCompanies.id, id),
      });
      if (!company || company.deletedAt) return reply.status(404).send({ error: 'Not found' });

      const newSuspendedAt: Date | null =
        body.data.suspended === true
          ? new Date()
          : body.data.suspended === false
            ? null
            : (company.suspendedAt ?? null);

      const [updated] = await db
        .update(managementCompanies)
        .set({
          name: body.data.name ?? company.name,
          billingEmail:
            body.data.billingEmail !== undefined ? body.data.billingEmail : company.billingEmail,
          suspendedAt: newSuspendedAt,
          updatedAt: new Date(),
        })
        .where(eq(managementCompanies.id, id))
        .returning();

      return reply.send(updated);
    },
  );

  // ── PATCH /superadmin/management-companies/:id/branding  ──────────────────
  app.patch(
    '/management-companies/:id/branding',
    { onRequest: [app.authenticatePlatformAdmin] },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const caller = req.user as PlatformAdminCaller;

      if (!isOwnerCaller(caller) && caller.managementCompanyId !== id) {
        return reply.status(403).send({ error: 'Forbidden' });
      }

      const body = ManagementCompanyBrandingSchema.safeParse(req.body);
      if (!body.success) return reply.status(400).send({ error: body.error.flatten() });

      const company = await db.query.managementCompanies.findFirst({
        where: and(eq(managementCompanies.id, id), isNull(managementCompanies.deletedAt)),
      });
      if (!company) return reply.status(404).send({ error: 'Not found' });

      const [updated] = await db
        .update(managementCompanies)
        .set({
          portalTitle:
            body.data.portalTitle !== undefined ? body.data.portalTitle : company.portalTitle,
          logoUrl: body.data.logoUrl !== undefined ? body.data.logoUrl : company.logoUrl,
          faviconUrl:
            body.data.faviconUrl !== undefined ? body.data.faviconUrl : company.faviconUrl,
          primaryColor:
            body.data.primaryColor !== undefined
              ? body.data.primaryColor
              : company.primaryColor,
          accentColor:
            body.data.accentColor !== undefined ? body.data.accentColor : company.accentColor,
          sidebarBg:
            body.data.sidebarBg !== undefined ? body.data.sidebarBg : company.sidebarBg,
          headingFontPreset:
            body.data.headingFontPreset !== undefined
              ? body.data.headingFontPreset
              : company.headingFontPreset,
          bodyFontPreset:
            body.data.bodyFontPreset !== undefined
              ? body.data.bodyFontPreset
              : company.bodyFontPreset,
          loginBackgroundUrl:
            body.data.loginBackgroundUrl !== undefined
              ? body.data.loginBackgroundUrl
              : company.loginBackgroundUrl,
          updatedAt: new Date(),
        })
        .where(eq(managementCompanies.id, id))
        .returning();

      await writeAuditLog({
        actorId: caller.sub,
        actorType: 'user',
        action: 'MANAGEMENT_COMPANY_BRANDING_UPDATED',
        entityType: 'management_company',
        entityId: id,
        meta: {
          portalTitle: updated?.portalTitle ?? null,
          logoUrl: updated?.logoUrl ?? null,
          faviconUrl: updated?.faviconUrl ?? null,
          primaryColor: updated?.primaryColor ?? null,
          accentColor: updated?.accentColor ?? null,
          sidebarBg: updated?.sidebarBg ?? null,
          headingFontPreset: updated?.headingFontPreset ?? null,
          bodyFontPreset: updated?.bodyFontPreset ?? null,
          loginBackgroundUrl: updated?.loginBackgroundUrl ?? null,
        },
        ipAddress: req.ip,
      });

      return reply.send(updated);
    },
  );

  // ── POST /superadmin/management-companies/:id/branding-assets/:assetType ───
  app.post(
    '/management-companies/:id/branding-assets/:assetType',
    { onRequest: [app.authenticatePlatformAdmin] },
    async (req, reply) => {
      const { id, assetType } = req.params as { id: string; assetType: string };
      const caller = req.user as PlatformAdminCaller;

      if (!BRANDING_ASSET_TYPES.has(assetType)) {
        return reply.status(400).send({ error: 'Unsupported branding asset type' });
      }

      if (!isOwnerCaller(caller) && caller.managementCompanyId !== id) {
        return reply.status(403).send({ error: 'Forbidden' });
      }

      const company = await db.query.managementCompanies.findFirst({
        where: and(eq(managementCompanies.id, id), isNull(managementCompanies.deletedAt)),
        columns: { id: true },
      });
      if (!company) return reply.status(404).send({ error: 'Not found' });

      const file = await req.file();
      if (!file) return reply.status(400).send({ error: 'No file provided' });
      if (!file.mimetype.startsWith('image/')) {
        return reply.status(400).send({ error: 'Branding assets must be image files' });
      }

      const ext = getBrandAssetExtension(file.filename, file.mimetype);
      const relDir = path.join('management_branding', id);
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

      const url = `/api/superadmin/auth/company-assets/${id}/${relFile}`;

      await writeAuditLog({
        actorId: caller.sub,
        actorType: 'user',
        action: 'MANAGEMENT_COMPANY_BRANDING_ASSET_UPLOADED',
        entityType: 'management_company',
        entityId: id,
        meta: { assetType, url },
        ipAddress: req.ip,
      });

      return reply.status(201).send({ assetType, url });
    },
  );

  // ── GET /superadmin/management-companies/:id/admins ─────────────────────────
  app.get(
    '/management-companies/:id/admins',
    { onRequest: [app.authenticatePlatformAdmin] },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const caller = req.user as PlatformAdminCaller;

      if (!isOwnerCaller(caller) && caller.managementCompanyId !== id) {
        return reply.status(403).send({ error: 'Forbidden' });
      }

      const admins = await db.query.managementCompanyAdmins.findMany({
        where: eq(managementCompanyAdmins.managementCompanyId, id),
        columns: {
          id: true,
          managementCompanyId: true,
          email: true,
          name: true,
          role: true,
          lastLogin: true,
          suspendedAt: true,
          createdAt: true,
        },
      });

      const pendingInvites = await db.query.managementCompanyAdminInvitations.findMany({
        where: and(
          eq(managementCompanyAdminInvitations.managementCompanyId, id),
          isNull(managementCompanyAdminInvitations.acceptedAt),
          isNull(managementCompanyAdminInvitations.revokedAt),
        ),
        columns: { id: true, email: true, role: true, expiresAt: true, createdAt: true },
      });

      return reply.send({ admins, pendingInvites });
    },
  );

  // ── POST /superadmin/management-companies/:id/admins  (invite) ──────────────
  app.post(
    '/management-companies/:id/admins',
    { onRequest: [app.authenticatePlatformAdmin] },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const caller = req.user as PlatformAdminCaller;

      if (!isOwnerCaller(caller) && caller.managementCompanyId !== id) {
        return reply.status(403).send({ error: 'Forbidden' });
      }

      const body = InviteManagementCompanyAdminSchema.safeParse(req.body);
      if (!body.success) return reply.status(400).send({ error: body.error.flatten() });

      const company = await db.query.managementCompanies.findFirst({
        where: eq(managementCompanies.id, id),
      });
      if (!company || company.deletedAt) return reply.status(404).send({ error: 'Not found' });

      const token = randomToken();
      await db.insert(managementCompanyAdminInvitations).values({
        managementCompanyId: id,
        invitedByOwnerId: isOwnerCaller(caller) ? caller.sub : null,
        invitedByAdminId: !isOwnerCaller(caller) ? caller.sub : null,
        email: body.data.email.toLowerCase(),
        role: body.data.role,
        token,
        expiresAt: inviteExpiry(7),
      });

      try {
        await sendInviteEmail(body.data.email, token, {
          ...(body.data.name ? { recipientName: body.data.name } : {}),
          orgRole: body.data.role,
          inviteType: 'management_company_admin',
          companyName: company.name,
          branding: {
            portalTitle: company.portalTitle ?? company.name,
            logoUrl: company.logoUrl ?? null,
            primaryColor: company.primaryColor ?? null,
            accentColor: company.accentColor ?? null,
          },
        });
      } catch (err) {
        app.log.error({ err }, 'Failed to send management company admin invite email');
      }

      return reply.status(201).send({
        email: body.data.email,
        role: body.data.role,
        managementCompanyId: id,
      });
    },
  );

  // ── PATCH /superadmin/management-companies/:id/admins/:adminId ──────────────
  app.patch(
    '/management-companies/:id/admins/:adminId',
    { onRequest: [app.authenticatePlatformAdmin] },
    async (req, reply) => {
      const { id, adminId } = req.params as { id: string; adminId: string };
      const caller = req.user as PlatformAdminCaller;

      if (!isOwnerCaller(caller) && caller.managementCompanyId !== id) {
        return reply.status(403).send({ error: 'Forbidden' });
      }

      const body = z
        .object({
          role: z.enum(['owner', 'admin', 'billing']).optional(),
          suspended: z.boolean().optional(),
        })
        .safeParse(req.body);
      if (!body.success) return reply.status(400).send({ error: body.error.flatten() });

      const admin = await db.query.managementCompanyAdmins.findFirst({
        where: and(
          eq(managementCompanyAdmins.id, adminId),
          eq(managementCompanyAdmins.managementCompanyId, id),
        ),
      });
      if (!admin) return reply.status(404).send({ error: 'Admin not found' });

      const newSuspendedAt: Date | null =
        body.data.suspended === true
          ? new Date()
          : body.data.suspended === false
            ? null
            : (admin.suspendedAt ?? null);

      const [updated] = await db
        .update(managementCompanyAdmins)
        .set({
          role: body.data.role ?? admin.role,
          suspendedAt: newSuspendedAt,
          updatedAt: new Date(),
        })
        .where(eq(managementCompanyAdmins.id, adminId))
        .returning();

      return reply.send(updated);
    },
  );

  // ── GET /superadmin/orgs ────────────────────────────────────────────────────
  app.get('/orgs', { onRequest: [app.authenticatePlatformAdmin] }, async (req, reply) => {
    const caller = req.user as PlatformAdminCaller;
    const companyId = isOwnerCaller(caller) ? null : caller.managementCompanyId;

    const whereClause = companyId
      ? and(isNull(organisations.deletedAt), eq(organisations.managementCompanyId, companyId))
      : isNull(organisations.deletedAt);

    const orgs = await db.query.organisations.findMany({
      where: whereClause,
      orderBy: [desc(organisations.createdAt)],
    });

    const memberCounts = await db
      .select({ orgId: users.orgId, cnt: count() })
      .from(users)
      .where(isNull(users.deletedAt))
      .groupBy(users.orgId);

    const countMap = Object.fromEntries(memberCounts.map((r) => [r.orgId, Number(r.cnt)]));
    return reply.send(orgs.map((o) => ({ ...o, memberCount: countMap[o.id] ?? 0 })));
  });

  // ── GET /superadmin/orgs/:id ────────────────────────────────────────────────
  app.get('/orgs/:id', { onRequest: [app.authenticatePlatformAdmin] }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const caller = req.user as PlatformAdminCaller;

    const org = await db.query.organisations.findFirst({ where: eq(organisations.id, id) });
    if (!org || org.deletedAt) return reply.status(404).send({ error: 'Not found' });

    if (!isOwnerCaller(caller) && org.managementCompanyId !== caller.managementCompanyId) {
      return reply.status(403).send({ error: 'Forbidden' });
    }

    const members = await db.query.users.findMany({
      where: eq(users.orgId, id),
      columns: { id: true, name: true, email: true, orgRole: true, status: true, createdAt: true },
    });

    const pendingInvites = await db.query.clientOrgOwnerInvitations.findMany({
      where: and(
        eq(clientOrgOwnerInvitations.organizationId, id),
        isNull(clientOrgOwnerInvitations.acceptedAt),
        isNull(clientOrgOwnerInvitations.revokedAt),
      ),
      columns: { id: true, email: true, expiresAt: true, createdAt: true },
    });

    return reply.send({ org, members, pendingInvites });
  });

  // ── POST /superadmin/orgs ───────────────────────────────────────────────────
  app.post('/orgs', { onRequest: [app.authenticatePlatformAdmin] }, async (req, reply) => {
    const caller = req.user as PlatformAdminCaller;

    const body = z
      .object({
        ownerEmail: z.string().email(),
        ownerName: z.string().min(1).max(120),
        managementCompanyId: z.string().uuid().optional(),
      })
      .safeParse(req.body);
    if (!body.success) return reply.status(400).send({ error: body.error.flatten() });

    const resolvedCompanyId = isOwnerCaller(caller)
      ? (body.data.managementCompanyId ?? null)
      : caller.managementCompanyId;

    if (!resolvedCompanyId) {
      return reply.status(400).send({
        error: 'managementCompanyId is required when creating an org as platform owner',
      });
    }

    const company = await db.query.managementCompanies.findFirst({
      where: eq(managementCompanies.id, resolvedCompanyId),
    });
    if (!company || company.deletedAt) {
      return reply.status(404).send({ error: 'Management company not found' });
    }

    const tempSlug = `pending-${randomToken(4)}`;
    const [org] = await db
      .insert(organisations)
      .values({
        name: '(pending)',
        slug: tempSlug,
        plan: 'starter',
        status: 'pending',
        managementCompanyId: resolvedCompanyId,
        originatingAdminId: isOwnerCaller(caller) ? null : caller.sub,
        primaryAccountManagerId: isOwnerCaller(caller) ? null : caller.sub,
        billingOwnerCompanyId: resolvedCompanyId,
      })
      .returning();
    if (!org) return reply.status(500).send({ error: 'Failed to create org' });

    const token = randomToken();
    await db.insert(clientOrgOwnerInvitations).values({
      organizationId: org.id,
      managementCompanyId: resolvedCompanyId,
      invitedByAdminId: caller.sub,
      email: body.data.ownerEmail.toLowerCase(),
      token,
      expiresAt: inviteExpiry(7),
    });

    try {
      await sendInviteEmail(body.data.ownerEmail, token, {
        recipientName: body.data.ownerName,
        orgRole: 'owner',
        inviteType: 'client_org_owner',
        companyName: company.name,
        branding: {
          portalTitle: company.portalTitle ?? company.name,
          logoUrl: company.logoUrl ?? null,
          primaryColor: company.primaryColor ?? null,
          accentColor: company.accentColor ?? null,
        },
      });
    } catch (err) {
      app.log.error({ err }, 'Failed to send client org owner invite email');
    }

    await writeAuditLog({
      actorId: caller.sub,
      actorType: 'system',
      action: 'CLIENT_ORG_CREATED',
      entityType: 'organisation',
      entityId: org.id,
      meta: { ownerEmail: body.data.ownerEmail, managementCompanyId: resolvedCompanyId },
      ipAddress: req.ip,
    });

    return reply.status(201).send({
      org: { id: org.id, slug: org.slug, status: org.status, managementCompanyId: resolvedCompanyId },
    });
  });

  // ── PATCH /superadmin/orgs/:id ──────────────────────────────────────────────
  app.patch('/orgs/:id', { onRequest: [app.authenticatePlatformAdmin] }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const caller = req.user as PlatformAdminCaller;

    const org = await db.query.organisations.findFirst({ where: eq(organisations.id, id) });
    if (!org || org.deletedAt) return reply.status(404).send({ error: 'Not found' });

    if (!isOwnerCaller(caller) && org.managementCompanyId !== caller.managementCompanyId) {
      return reply.status(403).send({ error: 'Forbidden' });
    }

    const body = z
      .object({
        name: z.string().min(2).max(100).optional(),
        plan: z.enum(['starter', 'pro', 'enterprise']).optional(),
        suspended: z.boolean().optional(),
      })
      .safeParse(req.body);
    if (!body.success) return reply.status(400).send({ error: body.error.flatten() });

    const newSuspendedAt: Date | null =
      body.data.suspended === true
        ? new Date()
        : body.data.suspended === false
          ? null
          : (org.suspendedAt ?? null);

    const [updated] = await db
      .update(organisations)
      .set({
        name: body.data.name ?? org.name,
        plan: body.data.plan ?? org.plan,
        suspendedAt: newSuspendedAt,
        updatedAt: new Date(),
      })
      .where(eq(organisations.id, id))
      .returning();

    return reply.send(updated);
  });

  // ── DELETE /superadmin/orgs/:id  (platform owner only) ─────────────────────
  app.delete('/orgs/:id', { onRequest: [app.authenticatePlatformOwner] }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const org = await db.query.organisations.findFirst({ where: eq(organisations.id, id) });
    if (!org || org.deletedAt) return reply.status(404).send({ error: 'Not found' });

    await db
      .update(organisations)
      .set({ deletedAt: new Date(), updatedAt: new Date() })
      .where(eq(organisations.id, id));

    await writeAuditLog({
      orgId: id,
      actorId: (req.user as { sub: string }).sub,
      actorType: 'system',
      action: 'ORG_DELETED',
      entityType: 'organisation',
      entityId: id,
      ipAddress: req.ip,
    });

    return reply.status(204).send();
  });

  // ── POST /superadmin/orgs/:id/invite ───────────────────────────────────────
  app.post('/orgs/:id/invite', { onRequest: [app.authenticatePlatformAdmin] }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const caller = req.user as PlatformAdminCaller;

    const org = await db.query.organisations.findFirst({ where: eq(organisations.id, id) });
    if (!org || org.deletedAt) return reply.status(404).send({ error: 'Org not found' });

    if (!isOwnerCaller(caller) && org.managementCompanyId !== caller.managementCompanyId) {
      return reply.status(403).send({ error: 'Forbidden' });
    }

    const body = z
      .object({
        email: z.string().email(),
        name: z.string().min(1).max(120).optional(),
      })
      .safeParse(req.body);
    if (!body.success) return reply.status(400).send({ error: body.error.flatten() });

    const companyId = org.managementCompanyId ?? (!isOwnerCaller(caller) ? caller.managementCompanyId : null);
    if (!companyId) return reply.status(400).send({ error: 'Org has no management company assigned' });

    const company = await db.query.managementCompanies.findFirst({
      where: eq(managementCompanies.id, companyId),
    });

    const token = randomToken();
    await db.insert(clientOrgOwnerInvitations).values({
      organizationId: id,
      managementCompanyId: companyId,
      invitedByAdminId: caller.sub,
      email: body.data.email.toLowerCase(),
      token,
      expiresAt: inviteExpiry(7),
    });

    try {
      await sendInviteEmail(body.data.email, token, {
        ...(body.data.name ? { recipientName: body.data.name } : {}),
        orgRole: 'owner',
        inviteType: 'client_org_owner',
        ...(company?.name ? { companyName: company.name } : {}),
        ...(company
          ? {
              branding: {
                portalTitle: company.portalTitle ?? company.name,
                logoUrl: company.logoUrl ?? null,
                primaryColor: company.primaryColor ?? null,
                accentColor: company.accentColor ?? null,
              },
            }
          : {}),
      });
    } catch (err) {
      app.log.error({ err }, 'Failed to send client org owner invite email');
    }

    return reply.status(201).send({ email: body.data.email });
  });

  // ── DELETE /superadmin/orgs/:id/invites/:inviteId ──────────────────────────
  app.delete(
    '/orgs/:id/invites/:inviteId',
    { onRequest: [app.authenticatePlatformAdmin] },
    async (req, reply) => {
      const { id, inviteId } = req.params as { id: string; inviteId: string };
      const caller = req.user as PlatformAdminCaller;

      const org = await db.query.organisations.findFirst({ where: eq(organisations.id, id) });
      if (!org || org.deletedAt) return reply.status(404).send({ error: 'Org not found' });

      if (!isOwnerCaller(caller) && org.managementCompanyId !== caller.managementCompanyId) {
        return reply.status(403).send({ error: 'Forbidden' });
      }

      const invite = await db.query.clientOrgOwnerInvitations.findFirst({
        where: and(
          eq(clientOrgOwnerInvitations.id, inviteId),
          eq(clientOrgOwnerInvitations.organizationId, id),
        ),
      });
      if (!invite) return reply.status(404).send({ error: 'Invitation not found' });
      if (invite.acceptedAt) return reply.status(409).send({ error: 'Invitation already accepted' });

      await db
        .update(clientOrgOwnerInvitations)
        .set({ revokedAt: new Date(), updatedAt: new Date() })
        .where(eq(clientOrgOwnerInvitations.id, inviteId));

      return reply.status(204).send();
    },
  );

  // ── GET /superadmin/analytics ───────────────────────────────────────────────
  app.get('/analytics', { onRequest: [app.authenticatePlatformAdmin] }, async (req, reply) => {
    const caller = req.user as PlatformAdminCaller;
    const companyId = isOwnerCaller(caller) ? null : caller.managementCompanyId;

    const orgWhere = companyId
      ? and(isNull(organisations.deletedAt), eq(organisations.managementCompanyId, companyId))
      : isNull(organisations.deletedAt);

    const [orgsRow] = await db.select({ total: count() }).from(organisations).where(orgWhere);
    const [suspRow] = await db
      .select({ suspended: count() })
      .from(organisations)
      .where(
        companyId
          ? and(
              sql`${organisations.suspendedAt} IS NOT NULL AND ${organisations.deletedAt} IS NULL`,
              eq(organisations.managementCompanyId, companyId),
            )
          : sql`${organisations.suspendedAt} IS NOT NULL AND ${organisations.deletedAt} IS NULL`,
      );
    const [usersRow] = await db
      .select({ total: count() })
      .from(users)
      .where(isNull(users.deletedAt));

    const result: Record<string, unknown> = {
      totalOrgs: Number(orgsRow?.total ?? 0),
      suspendedOrgs: Number(suspRow?.suspended ?? 0),
      totalUsers: Number(usersRow?.total ?? 0),
    };

    if (isOwnerCaller(caller)) {
      const [companiesRow] = await db
        .select({ total: count() })
        .from(managementCompanies)
        .where(isNull(managementCompanies.deletedAt));
      result.totalManagementCompanies = Number(companiesRow?.total ?? 0);
    }

    return reply.send(result);
  });

  // ── GET /superadmin/orgs/:id/quota ─────────────────────────────────────────
  app.get('/orgs/:id/quota', { onRequest: [app.authenticatePlatformAdmin] }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const caller = req.user as PlatformAdminCaller;

    const org = await db.query.organisations.findFirst({ where: eq(organisations.id, id) });
    if (!org || org.deletedAt) return reply.status(404).send({ error: 'Not found' });

    if (!isOwnerCaller(caller) && org.managementCompanyId !== caller.managementCompanyId) {
      return reply.status(403).send({ error: 'Forbidden' });
    }

    const quota = await db.query.orgStorageQuotas.findFirst({
      where: eq(orgStorageQuotas.orgId, id),
    });
    const defaults: Record<string, number> = {
      starter: 5_368_709_120,
      pro: 53_687_091_200,
      enterprise: 536_870_912_000,
    };

    return reply.send(
      quota ?? {
        orgId: id,
        limitBytes: defaults[org.plan] ?? defaults['starter'],
        usedBytes: 0,
        alertThresholdPct: 90,
      },
    );
  });

  // ── PATCH /superadmin/orgs/:id/quota ───────────────────────────────────────
  app.patch('/orgs/:id/quota', { onRequest: [app.authenticatePlatformAdmin] }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const caller = req.user as PlatformAdminCaller;

    const org = await db.query.organisations.findFirst({ where: eq(organisations.id, id) });
    if (!org || org.deletedAt) return reply.status(404).send({ error: 'Not found' });

    if (!isOwnerCaller(caller) && org.managementCompanyId !== caller.managementCompanyId) {
      return reply.status(403).send({ error: 'Forbidden' });
    }

    const body = z
      .object({
        limitBytes: z.number().int().positive(),
        alertThresholdPct: z.number().int().min(50).max(99).optional(),
      })
      .safeParse(req.body);
    if (!body.success) return reply.status(400).send({ error: body.error.flatten() });

    const existing = await db.query.orgStorageQuotas.findFirst({
      where: eq(orgStorageQuotas.orgId, id),
    });

    let quota;
    if (existing) {
      [quota] = await db
        .update(orgStorageQuotas)
        .set({
          limitBytes: body.data.limitBytes,
          alertThresholdPct: body.data.alertThresholdPct ?? existing.alertThresholdPct,
          updatedAt: new Date(),
        })
        .where(eq(orgStorageQuotas.orgId, id))
        .returning();
    } else {
      [quota] = await db
        .insert(orgStorageQuotas)
        .values({
          orgId: id,
          limitBytes: body.data.limitBytes,
          alertThresholdPct: body.data.alertThresholdPct ?? 90,
        })
        .returning();
    }

    await writeAuditLog({
      orgId: id,
      actorId: caller.sub,
      actorType: 'system',
      action: 'QUOTA_UPDATED',
      entityType: 'organisation',
      entityId: id,
      meta: { limitBytes: body.data.limitBytes },
      ipAddress: req.ip,
    });

    return reply.send(quota);
  });

  // ── GET /superadmin/system/health  (platform owner only) ───────────────────
  app.get(
    '/system/health',
    { onRequest: [app.authenticatePlatformOwner] },
    async (_req, reply) => {
      const mem = process.memoryUsage();
      const load = os.loadavg();
      const totalMem = os.totalmem();
      const freeMem = os.freemem();

      const [orgsRow] = await db
        .select({ total: count() })
        .from(organisations)
        .where(isNull(organisations.deletedAt));

      const [usersRow] = await db
        .select({ total: count() })
        .from(users)
        .where(isNull(users.deletedAt));

      return reply.send({
        process: {
          heapUsed: mem.heapUsed,
          heapTotal: mem.heapTotal,
          rss: mem.rss,
          uptime: process.uptime(),
          nodeVersion: process.version,
        },
        os: {
          platform: os.platform(),
          arch: os.arch(),
          totalMem,
          freeMem,
          usedMem: totalMem - freeMem,
          loadAvg1: load[0],
          loadAvg5: load[1],
          loadAvg15: load[2],
          uptime: os.uptime(),
          cpus: os.cpus().length,
        },
        db: {
          totalOrgs: Number(orgsRow?.total ?? 0),
          totalUsers: Number(usersRow?.total ?? 0),
        },
      });
    },
  );

  // ── POST /superadmin/orgs/:id/impersonate  (platform owner only) ────────────
  app.post(
    '/orgs/:id/impersonate',
    { onRequest: [app.authenticatePlatformOwner] },
    async (req, reply) => {
      const caller = req.user as PlatformAdminCaller;
      const { id } = req.params as { id: string };

      const org = await db.query.organisations.findFirst({ where: eq(organisations.id, id) });
      if (!org || org.deletedAt) return reply.status(404).send({ error: 'Organization not found' });
      if (org.suspendedAt) return reply.status(409).send({ error: 'Organization is suspended' });

      const owner = await db.query.users.findFirst({
        where: and(
          eq(users.orgId, id),
          inArray(users.orgRole, ['owner', 'admin']),
          isNull(users.deletedAt),
        ),
        orderBy: [sql`CASE WHEN ${users.orgRole} = 'owner' THEN 1 ELSE 2 END`],
      });
      if (!owner)
        return reply.status(404).send({ error: 'No admin-level user found in organization' });

      const accessToken = app.jwt.sign(
        {
          sub: owner.id,
          orgId: id,
          role: owner.orgRole,
          email: owner.email,
          name: owner.name ?? '',
          type: 'user',
          impersonatedBy: caller.sub,
        },
        { expiresIn: '2h' },
      );

      await writeAuditLog({
        orgId: id,
        actorId: caller.sub,
        actorType: 'system',
        action: 'IMPERSONATE_ORG',
        entityType: 'organisation',
        entityId: id,
        ipAddress: req.ip,
        meta: { impersonatedUserId: owner.id, impersonatedEmail: owner.email },
      });

      return reply.send({
        accessToken,
        org: { id: org.id, name: org.name, slug: org.slug },
        user: { id: owner.id, email: owner.email, name: owner.name, role: owner.orgRole },
      });
    },
  );
}
