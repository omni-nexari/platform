/**
 * Diagnose and fix the org linkage for a specific user whose login is blocked.
 *
 * Usage:
 *   pnpm --filter @signage/api fix:user-org
 *
 * What it does:
 *  1. Looks up the user by the known ID (or by email if passed as first arg).
 *  2. Prints the full state of the linked org row.
 *  3. If the org row exists but has deletedAt set, clears deletedAt and reactivates it.
 *  4. If the org row does not exist at all, reports it so you can investigate manually.
 */

import { db, users, organisations } from '@signage/db';
import { eq, isNull } from 'drizzle-orm';

// The IDs extracted from the login-blocked diagnostic log
const TARGET_USER_ID = 'b5ad865b-c807-4b0f-9d55-237c6645b2ec';
const TARGET_EMAIL = process.argv[2] ?? null;

// ── 1. Resolve user ──────────────────────────────────────────────────────────

const userRow = TARGET_EMAIL
  ? await db.query.users.findFirst({ where: eq(users.email, TARGET_EMAIL) })
  : await db.query.users.findFirst({ where: eq(users.id, TARGET_USER_ID) });

if (!userRow) {
  console.error(`❌  No user found (id=${TARGET_USER_ID}, email=${TARGET_EMAIL ?? 'n/a'})`);
  process.exit(1);
}

console.log('User found:');
console.log(`  id      : ${userRow.id}`);
console.log(`  email   : ${userRow.email}`);
console.log(`  orgId   : ${userRow.orgId}`);
console.log(`  orgRole : ${userRow.orgRole}`);
console.log(`  status  : ${userRow.status}`);
console.log(`  deletedAt: ${userRow.deletedAt ?? 'null'}`);
console.log('');

// ── 2. Check the linked org ──────────────────────────────────────────────────

const orgRow = await db.query.organisations.findFirst({
  where: eq(organisations.id, userRow.orgId),
});

if (!orgRow) {
  console.error(`❌  Organisation row with id=${userRow.orgId} does not exist in the DB.`);
  console.error('    The user row has a dangling orgId FK. Manual data repair is needed.');
  console.error('    You can create the org manually or re-run the invite flow for this user.');
  process.exit(1);
}

console.log('Organisation found:');
console.log(`  id        : ${orgRow.id}`);
console.log(`  name      : ${orgRow.name}`);
console.log(`  slug      : ${orgRow.slug}`);
console.log(`  status    : ${orgRow.status}`);
console.log(`  deletedAt : ${orgRow.deletedAt ?? 'null'}`);
console.log(`  createdAt : ${orgRow.createdAt}`);
console.log('');

// ── 3. Determine what needs fixing ──────────────────────────────────────────

// Detect tombstoned slug: slug ends with --deleted-XXXXXXXX
const tombstoneMatch = orgRow.slug.match(/^(.+)--deleted-[0-9a-f]{8}$/);
const isTombstonedSlug = Boolean(tombstoneMatch);
const originalSlug = tombstoneMatch ? tombstoneMatch[1] : null;

const needsFix = orgRow.deletedAt || orgRow.status === 'suspended' || isTombstonedSlug;

if (!needsFix) {
  console.log('✅  Org looks healthy (deletedAt=null, status active, slug clean).');
  console.log('    If login is still blocked, try restarting the API.');
  process.exit(0);
}

const fixes: string[] = [];
if (orgRow.deletedAt) fixes.push('clear deletedAt');
if (orgRow.status === 'suspended') fixes.push('set status → active');
if (isTombstonedSlug && originalSlug) fixes.push(`restore slug to "${originalSlug}"`);

console.log(`⚠️  Org needs fixes: ${fixes.join(', ')}`);

const updatePayload: Record<string, unknown> = {
  deletedAt: null,
  status: 'active',
  updatedAt: new Date(),
};
if (isTombstonedSlug && originalSlug) {
  // Check the clean slug is not taken by another org first
  const slugConflict = await db.query.organisations.findFirst({
    where: eq(organisations.slug, originalSlug),
  });
  if (slugConflict && slugConflict.id !== orgRow.id) {
    console.warn(`⚠️  Slug "${originalSlug}" is already used by org ${slugConflict.id}. Skipping slug restore — fix manually.`);
  } else {
    updatePayload['slug'] = originalSlug;
  }
}

await db.update(organisations).set(updatePayload).where(eq(organisations.id, orgRow.id));

console.log('✅  Organisation restored. Restart the API and try logging in again.');
process.exit(0);
