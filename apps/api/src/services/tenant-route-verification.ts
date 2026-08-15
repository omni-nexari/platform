/**
 * DNS verification for tenant routes.
 *
 * Checks the TXT record `_nexari.{hostname}` against the stored
 * verificationToken.  If matched, marks the route `active` and sets the
 * appropriate TLS status:
 *   - `external`  — hostname is the primary SSL_DOMAIN or a subdomain; TLS is
 *                   handled by the main nginx/certbot cert.
 *   - `ready`     — a Let's Encrypt cert already exists for the hostname.
 *   - `pending`   — no cert found yet (certbot must still run).
 */

import dns from 'node:dns/promises';
import { promises as fs } from 'node:fs';
import { db, tenantRoutes } from '@signage/db';
import { and, eq, isNull } from 'drizzle-orm';

const SSL_DOMAIN = (process.env['SSL_DOMAIN'] ?? '').toLowerCase().trim();

async function resolveTlsStatus(hostname: string): Promise<'ready' | 'external' | 'pending'> {
  // Hostname is the primary domain or a direct subdomain — TLS is handled by
  // the existing nginx cert; no extra certbot run required.
  if (SSL_DOMAIN && (hostname === SSL_DOMAIN || hostname.endsWith(`.${SSL_DOMAIN}`))) {
    return 'external';
  }
  // A dedicated Let's Encrypt cert already exists for this hostname.
  try {
    await fs.access(`/etc/letsencrypt/live/${hostname}/fullchain.pem`);
    return 'ready';
  } catch {
    return 'pending';
  }
}

/**
 * Verify a single tenant route.
 *
 * Routes on the server's own domain (SSL_DOMAIN or subdomains) are trusted
 * automatically — no TXT check required since we already own and have TLS for
 * that hostname.  External partner domains require a TXT record.
 */
export async function verifyTenantRoute(
  routeId: string,
): Promise<{ verified: boolean; reason: string }> {
  const route = await db.query.tenantRoutes.findFirst({
    where: and(eq(tenantRoutes.id, routeId), isNull(tenantRoutes.deletedAt)),
  });
  if (!route) return { verified: false, reason: 'Route not found' };
  if (route.status === 'active') return { verified: true, reason: 'Already active' };

  const isOwnDomain =
    SSL_DOMAIN !== '' &&
    (route.hostname === SSL_DOMAIN || route.hostname.endsWith(`.${SSL_DOMAIN}`));

  if (!isOwnDomain) {
    // External partner domain — require TXT proof of ownership
    const txtName = `_nexari.${route.hostname}`;
    let txtRecords: string[][];
    try {
      txtRecords = await dns.resolveTxt(txtName);
    } catch {
      await db
        .update(tenantRoutes)
        .set({ lastCheckedAt: new Date(), updatedAt: new Date() })
        .where(eq(tenantRoutes.id, routeId));
      return { verified: false, reason: `TXT lookup failed for ${txtName}` };
    }

    const flat = txtRecords.flat();
    if (!flat.includes(route.verificationToken)) {
      await db
        .update(tenantRoutes)
        .set({ lastCheckedAt: new Date(), updatedAt: new Date() })
        .where(eq(tenantRoutes.id, routeId));
      return {
        verified: false,
        reason: `TXT record not found or does not match. Expected: ${route.verificationToken}`,
      };
    }
  }

  const tlsStatus = await resolveTlsStatus(route.hostname);

  await db
    .update(tenantRoutes)
    .set({
      status: 'active',
      verifiedAt: new Date(),
      lastCheckedAt: new Date(),
      tlsStatus,
      updatedAt: new Date(),
    })
    .where(eq(tenantRoutes.id, routeId));

  return { verified: true, reason: `Verified. TLS: ${tlsStatus}` };
}

/**
 * Scan all `pending_dns` routes and verify each one.
 * Called by the recurring job scheduler.
 */
export async function runTenantRouteVerification(): Promise<void> {
  const pending = await db.query.tenantRoutes.findMany({
    where: and(eq(tenantRoutes.status, 'pending_dns'), isNull(tenantRoutes.deletedAt)),
  });
  if (pending.length === 0) return;

  console.info(
    `[jobs/tenant-route-verification] Checking ${pending.length} pending route(s)...`,
  );
  let verified = 0;
  for (const route of pending) {
    try {
      const result = await verifyTenantRoute(route.id);
      if (result.verified) {
        console.info(
          `[jobs/tenant-route-verification] Verified: ${route.hostname}/${route.pathPrefix} — ${result.reason}`,
        );
        verified++;
      }
    } catch (err) {
      console.error(
        `[jobs/tenant-route-verification] Error checking ${route.hostname}:`,
        err,
      );
    }
  }
  if (verified > 0) {
    console.info(
      `[jobs/tenant-route-verification] ${verified}/${pending.length} route(s) verified.`,
    );
  }
}
