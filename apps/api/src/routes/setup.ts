import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import * as argon2 from 'argon2';
import { db, platformOwners, organizations, licenseConfig } from '@signage/db';
import { count, eq } from 'drizzle-orm';

// ── Validators ────────────────────────────────────────────────────────────────

const SetupBodySchema = z.object({
  // First admin account
  name: z.string().min(1).max(100),
  email: z.string().email().toLowerCase(),
  password: z.string().min(8).max(128),
  // Organisation name (the "company" that owns this platform install)
  orgName: z.string().min(1).max(200),
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

    const { name, email, password, orgName, licenseKey } = parsed.data;

    // Hash password with argon2id (same as the rest of the auth layer)
    const passwordHash = await argon2.hash(password);

    // Create owner + org in a single transaction
    await db.transaction(async (tx) => {
      // 1. Platform owner account
      await tx.insert(platformOwners).values({
        name,
        email,
        passwordHash,
      });

      // 2. Default organisation (slug derived from orgName)
      const slug = orgName
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '')
        .slice(0, 63);

      await tx.insert(organizations).values({
        name: orgName,
        slug,
        plan: 'starter',
        status: 'active',
      });

      // 3. Optional license config seed
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
    return reply.status(201).send({ ok: true, adminUrl });
  });
}
