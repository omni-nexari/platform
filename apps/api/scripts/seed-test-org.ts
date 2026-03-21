/**
 * Seed a test organisation with an owner user and a workspace for the user-facing dashboard.
 * Usage: pnpm --filter @signage/api seed:test
 *
 * Creates:
 *   Org      : Acme Digital  (slug: acme)
 *   Owner    : owner@acme.local / Test@1234!
 *   Workspace: Main Display (slug: main-display, timezone: UTC)
 */

import * as argon2 from 'argon2';
import { db, organisations, users, workspaces, workspaceMembers } from '@signage/db';
import { eq } from 'drizzle-orm';

function toSlug(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'default';
}

const ORG_NAME = process.env.TEST_ORG_NAME ?? 'Acme Digital';
const ORG_SLUG = process.env.TEST_ORG_SLUG ?? toSlug(ORG_NAME);
const OWNER_EMAIL = process.env.TEST_OWNER_EMAIL ?? 'owner@acme.local';
const OWNER_PASSWORD = process.env.TEST_OWNER_PASS ?? 'Test@1234!';
const OWNER_NAME = process.env.TEST_OWNER_NAME ?? 'Acme Owner';
const WS_NAME = process.env.TEST_WORKSPACE_NAME ?? 'Main Display';
const WS_SLUG = process.env.TEST_WORKSPACE_SLUG ?? toSlug(WS_NAME);

// ── 1. Org ────────────────────────────────────────────────────────────────────

let [org] = await db
  .select()
  .from(organisations)
  .where(eq(organisations.slug, ORG_SLUG))
  .limit(1);

if (org) {
  console.log(`Org already exists: ${org.name} (${org.id})`);
} else {
  [org] = await db
    .insert(organisations)
    .values({ name: ORG_NAME, slug: ORG_SLUG, plan: 'starter' })
    .returning();
  console.log(`Created org: ${org.name} (${org.id})`);
}

// ── 2. Owner user ─────────────────────────────────────────────────────────────

let [owner] = await db
  .select()
  .from(users)
  .where(eq(users.email, OWNER_EMAIL))
  .limit(1);

if (owner) {
  console.log(`Owner already exists: ${owner.email} (${owner.id})`);
} else {
  const passwordHash = await argon2.hash(OWNER_PASSWORD);
  [owner] = await db
    .insert(users)
    .values({
      orgId: org.id,
      email: OWNER_EMAIL,
      passwordHash,
      name: OWNER_NAME,
      orgRole: 'owner',
      status: 'active',
    })
    .returning();
  console.log(`Created owner: ${owner.email} (${owner.id})`);
}

// ── 3. Workspace ──────────────────────────────────────────────────────────────

let [workspace] = await db
  .select()
  .from(workspaces)
  .where(eq(workspaces.orgId, org.id))
  .limit(1);

if (workspace) {
  console.log(`Workspace already exists: ${workspace.name} (${workspace.id})`);
} else {
  [workspace] = await db
    .insert(workspaces)
    .values({ orgId: org.id, name: WS_NAME, slug: WS_SLUG, timezone: 'UTC' })
    .returning();
  console.log(`Created workspace: ${workspace.name} (${workspace.id})`);
}

// ── 4. Workspace membership ───────────────────────────────────────────────────

const existing = await db
  .select()
  .from(workspaceMembers)
  .where(eq(workspaceMembers.userId, owner.id))
  .limit(1);

if (existing.length === 0) {
  await db.insert(workspaceMembers).values({
    workspaceId: workspace.id,
    userId: owner.id,
    role: 'admin',
    addedBy: owner.id,
  });
  console.log(`Added owner to workspace as admin`);
} else {
  console.log(`Owner already a workspace member`);
}

console.log('');
console.log('Test org seeded successfully');
console.log(`  Org      : ${ORG_NAME} (slug: ${ORG_SLUG})`);
console.log(`  Email    : ${OWNER_EMAIL}`);
console.log(`  Password : ${OWNER_PASSWORD}`);
console.log(`  Workspace: ${WS_NAME}`);
process.exit(0);
