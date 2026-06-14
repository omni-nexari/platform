import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import * as argon2 from 'argon2';
import {
  db,
  platformOwners,
  organizations,
  users,
  workspaces,
  workspaceMembers,
  licenseConfig,
  managementCompanies,
  managementCompanyAdmins,
} from '@signage/db';
import { count, eq } from 'drizzle-orm';

// ── Validators ────────────────────────────────────────────────────────────────

const SetupBodySchema = z.object({
  // First admin account
  name: z.string().min(1).max(100),
  email: z.string().email().toLowerCase(),
  password: z.string().min(8).max(128),
  // Organisation name (the "company" that owns this platform install)
  orgName: z.string().min(1).max(200),
  // First workspace name (defaults to org name if omitted)
  workspaceName: z.string().min(1).max(200).optional(),
  // Optional — configure license on first-run if the partner already has a key
  licenseKey: z.string().optional(),
});

// ── Route plugin ──────────────────────────────────────────────────────────────

export async function setupRoutes(app: FastifyInstance) {
  /**
   * GET /setup/status
   *
   * Returns whether first-run setup has been completed.
   * Used by the DS SPA to decide whether to redirect to /setup.
   *
   * This endpoint is intentionally unauthenticated — it only returns a boolean,
   * revealing no sensitive information.
   */
  app.get('/status', async (_req, reply) => {
    const [row] = await db
      .select({ total: count() })
      .from(platformOwners);

    const complete = (row?.total ?? 0) > 0;
    return reply.status(200).send({ complete });
  });

  /**
   * POST /setup
   *
   * Creates the first platform owner account and default organisation.
   * Rejected with 409 if setup has already been completed.
   *
   * This endpoint is intentionally unauthenticated — it can only succeed once.
   */
  app.post('/', async (req, reply) => {
    // Reject if setup is already done (idempotency guard)
    const [existing] = await db
      .select({ total: count() })
      .from(platformOwners);

    if ((existing?.total ?? 0) > 0) {
      return reply.status(409).send({
        error: 'setup_already_complete',
        message: 'Platform setup has already been completed.',
      });
    }

    const parsed = SetupBodySchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({
        error: 'validation_error',
        issues: parsed.error.flatten().fieldErrors,
      });
    }

    const { name, email, password, orgName, workspaceName, licenseKey } = parsed.data;

    // Hash password with argon2id (same as the rest of the auth layer)
    const passwordHash = await argon2.hash(password);

    // Derive a URL-safe slug from the org name (shared by org + management company)
    const slug = orgName
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 63);

    // Create all records in a single transaction
    await db.transaction(async (tx) => {
      // 1. Platform owner account (Nexari superadmin identity)
      await tx.insert(platformOwners).values({
        name,
        email,
        passwordHash,
      });

      // 2. Default organisation
      await tx.insert(organizations).values({
        name: orgName,
        slug,
        plan: 'starter',
        status: 'active',
      });

      // 3. Management company — the partner's portal identity
      const [company] = await tx
        .insert(managementCompanies)
        .values({
          name: orgName,
          slug,
          plan: 'starter',
        })
        .returning({ id: managementCompanies.id });

      // 4. Management company admin — the credentials the partner uses to log in
      await tx.insert(managementCompanyAdmins).values({
        managementCompanyId: company!.id,
        name,
        email,
        passwordHash,
        role: 'owner',
      });

      // 5. Dashboard user — same credentials, owner role in the default org
      const [org] = await tx
        .select({ id: organizations.id })
        .from(organizations)
        .where(eq(organizations.slug, slug))
        .limit(1);

      const [newUser] = await tx.insert(users).values({
        orgId: org!.id,
        name,
        email,
        passwordHash,
        orgRole: 'owner',
        status: 'active',
      }).returning({ id: users.id });

      // 6. Default workspace + add owner as admin member
      const wsName = workspaceName?.trim() || orgName;
      const wsSlug = wsName
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '')
        .slice(0, 63);

      const [workspace] = await tx.insert(workspaces).values({
        orgId: org!.id,
        name: wsName,
        slug: wsSlug,
      }).returning({ id: workspaces.id });

      await tx.insert(workspaceMembers).values({
        workspaceId: workspace!.id,
        userId: newUser!.id,
        role: 'admin',
        addedBy: newUser!.id,
      });

      // 7. Optional license config seed
      if (licenseKey) {
        const [existingConfig] = await tx
          .select({ id: licenseConfig.id })
          .from(licenseConfig)
          .limit(1);

        if (!existingConfig) {
          await tx.insert(licenseConfig).values({
            licenseKey,
            isEnabled: true,
          });
        } else {
          await tx
            .update(licenseConfig)
            .set({ licenseKey, updatedAt: new Date() })
            .where(eq(licenseConfig.id, existingConfig.id));
        }
      }
    });

    const adminUrl = process.env['NEXARI_ADMIN_URL'] ?? null;
    const appUrl = (process.env['APP_URL'] ?? '').replace(/\/$/, '');
    // Pull the first entry from APP_EXTRA_ORIGINS as the LAN base URL
    const lanUrl = (process.env['APP_EXTRA_ORIGINS'] ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)[0] ?? null;

    return reply.status(201).send({
      ok: true,
      adminUrl,
      managementSlug: slug,
      appUrl: appUrl || null,
      lanUrl,
    });
  });
}
