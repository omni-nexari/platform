import { db, users, organisations, orgInvitations, refreshTokens, workspaceMembers, workspaces, managementCompanyAdmins, managementCompanyAdminInvitations, clientOrgOwnerInvitations, managementCompanies } from '@signage/db';
import { eq, and, isNull, gt } from 'drizzle-orm';
import * as argon2 from 'argon2';
import { authenticator } from 'otplib';
import { randomBytes, createHash } from 'node:crypto';
import type { User } from '@signage/shared';

const REFRESH_TTL_DAYS = 30;

// ── helpers ──────────────────────────────────────────────────────────────────

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function makeRefreshToken(): string {
  return randomBytes(40).toString('hex');
}

function refreshExpiry(): Date {
  const d = new Date();
  d.setDate(d.getDate() + REFRESH_TTL_DAYS);
  return d;
}

function deletedEmailTombstone(email: string, uniquePart: string): string {
  const [localPart, domainPart] = email.split('@');
  if (!localPart || !domainPart) {
    return `${email}--deleted-${uniquePart}`;
  }
  return `${localPart}+deleted-${uniquePart}@${domainPart}`;
}

// ── auth service ─────────────────────────────────────────────────────────────

export async function verifyLogin(
  email: string,
  password: string,
): Promise<{ user: typeof users.$inferSelect } | { error: string }> {
  const user = await db.query.users.findFirst({
    where: and(
      eq(users.email, email.toLowerCase()),
      isNull(users.deletedAt),
    ),
  });
  if (!user?.passwordHash) return { error: 'Invalid credentials' };
  if (user.status === 'suspended') return { error: 'Account suspended' };

  const valid = await argon2.verify(user.passwordHash, password);
  if (!valid) return { error: 'Invalid credentials' };

  return { user };
}

export async function createRefreshToken(
  userId: string,
  ipAddress?: string,
  userAgent?: string,
): Promise<string> {
  const raw = makeRefreshToken();
  await db.insert(refreshTokens).values({
    userId,
    tokenHash: hashToken(raw),
    expiresAt: refreshExpiry(),
    ipAddress: ipAddress ?? null,
    userAgent: userAgent ?? null,
  });
  return raw;
}

export async function rotateRefreshToken(
  rawToken: string,
  ipAddress?: string,
  userAgent?: string,
): Promise<
  | { userId: string; newRefreshToken: string }
  | { error: string }
> {
  const hash = hashToken(rawToken);
  const record = await db.query.refreshTokens.findFirst({
    where: and(
      eq(refreshTokens.tokenHash, hash),
      isNull(refreshTokens.revokedAt),
      gt(refreshTokens.expiresAt, new Date()),
    ),
  });
  if (!record) return { error: 'Invalid or expired refresh token' };

  // Revoke old token
  await db
    .update(refreshTokens)
    .set({ revokedAt: new Date() })
    .where(eq(refreshTokens.id, record.id));

  const newRaw = makeRefreshToken();
  await db.insert(refreshTokens).values({
    userId: record.userId,
    tokenHash: hashToken(newRaw),
    expiresAt: refreshExpiry(),
    ipAddress: ipAddress ?? null,
    userAgent: userAgent ?? null,
  });

  return { userId: record.userId, newRefreshToken: newRaw };
}

export async function revokeRefreshToken(rawToken: string): Promise<void> {
  const hash = hashToken(rawToken);
  await db
    .update(refreshTokens)
    .set({ revokedAt: new Date() })
    .where(eq(refreshTokens.tokenHash, hash));
}

// ── 2FA ──────────────────────────────────────────────────────────────────────

export function generateTotpSecret(): string {
  return authenticator.generateSecret();
}

export function getTotpUri(secret: string, email: string): string {
  return authenticator.keyuri(email, 'OmniHub Signage', secret);
}

export function verifyTotpCode(secret: string, token: string): boolean {
  return authenticator.verify({ token, secret });
}

export async function generateBackupCodes(): Promise<{ raw: string[]; hashed: string[] }> {
  const raw = Array.from({ length: 8 }, () => randomBytes(5).toString('hex'));
  const hashed = await Promise.all(raw.map((c) => argon2.hash(c)));
  return { raw, hashed };
}

export async function verifyBackupCode(
  userId: string,
  inputCode: string,
): Promise<boolean> {
  const user = await db.query.users.findFirst({ where: eq(users.id, userId) });
  if (!user?.backupCodes?.length) return false;

  for (let i = 0; i < user.backupCodes.length; i++) {
    const stored = user.backupCodes[i];
    if (!stored) continue;
    const match = await argon2.verify(stored, inputCode);
    if (match) {
      // Consume the used code
      const remaining = (user.backupCodes as string[]).filter((_: string, idx: number) => idx !== i);
      await db.update(users).set({ backupCodes: remaining }).where(eq(users.id, userId));
      return true;
    }
  }
  return false;
}

// ── invite accept ─────────────────────────────────────────────────────────────

export async function findValidInvite(token: string) {
  return db.query.orgInvitations.findFirst({
    where: and(
      eq(orgInvitations.token, token),
      isNull(orgInvitations.acceptedAt),
      gt(orgInvitations.expiresAt, new Date()),
    ),
  });
}

export async function acceptInvite(
  inviteId: string,
  orgId: string,
  email: string,
  orgRole: string,
  name: string,
  password: string,
  initialWorkspaceId?: string,
  orgSetup?: { orgName: string; orgSlug: string; workspaceName: string; workspaceTimezone: string },
) {
  let wsId = initialWorkspaceId;

  if (orgSetup) {
    // Owner is setting up their org for the first time
    await db
      .update(organisations)
      .set({ name: orgSetup.orgName, slug: orgSetup.orgSlug, updatedAt: new Date() })
      .where(eq(organisations.id, orgId));

    const wsSlug = orgSetup.workspaceName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    const [ws] = await db
      .insert(workspaces)
      .values({ orgId, name: orgSetup.workspaceName, slug: wsSlug, timezone: orgSetup.workspaceTimezone })
      .returning();
    wsId = ws?.id;
  }

  const passwordHash = await argon2.hash(password);
  const [user] = await db
    .insert(users)
    .values({ orgId, email, name, passwordHash, orgRole })
    .returning();

  await db
    .update(orgInvitations)
    .set({ acceptedAt: new Date() })
    .where(eq(orgInvitations.id, inviteId));

  if (user && wsId) {
    await db
      .insert(workspaceMembers)
      .values({ workspaceId: wsId, userId: user.id, role: 'admin', addedBy: user.id })
      .onConflictDoNothing();
  }

  return user;
}

// ── management company admin invite ──────────────────────────────────────────

export async function findValidMgmtAdminInvite(token: string) {
  return db.query.managementCompanyAdminInvitations.findFirst({
    where: and(
      eq(managementCompanyAdminInvitations.token, token),
      isNull(managementCompanyAdminInvitations.acceptedAt),
      isNull(managementCompanyAdminInvitations.revokedAt),
      gt(managementCompanyAdminInvitations.expiresAt, new Date()),
    ),
  });
}

export async function acceptMgmtAdminInvite(
  inviteId: string,
  managementCompanyId: string,
  email: string,
  role: string,
  name: string,
  password: string,
  ownerDashboard?: {
    orgName: string;
    orgSlug: string;
    workspaceName: string;
    workspaceTimezone: string;
  },
) {
  const normalizedEmail = email.toLowerCase();
  const passwordHash = await argon2.hash(password);

  const existingAdmin = await db.query.managementCompanyAdmins.findFirst({
    where: eq(managementCompanyAdmins.email, normalizedEmail),
  });

  if (existingAdmin) {
    const existingCompany = await db.query.managementCompanies.findFirst({
      where: eq(managementCompanies.id, existingAdmin.managementCompanyId),
      columns: { id: true, deletedAt: true },
    });

    if (existingCompany?.deletedAt) {
      await db
        .update(managementCompanyAdmins)
        .set({
          email: deletedEmailTombstone(existingAdmin.email, existingAdmin.id),
          suspendedAt: existingAdmin.suspendedAt ?? new Date(),
          updatedAt: new Date(),
        })
        .where(eq(managementCompanyAdmins.id, existingAdmin.id));
    }
  }

  return db.transaction(async (tx) => {
    const [admin] = await tx
      .insert(managementCompanyAdmins)
      .values({ managementCompanyId, email: normalizedEmail, name, passwordHash, role })
      .returning();

    await tx
      .update(managementCompanyAdminInvitations)
      .set({ acceptedAt: new Date(), updatedAt: new Date() })
      .where(eq(managementCompanyAdminInvitations.id, inviteId));

    await tx
      .update(managementCompanies)
      .set({ updatedAt: new Date() })
      .where(eq(managementCompanies.id, managementCompanyId));

    let ownerUser: typeof users.$inferSelect | null = null;
    let ownerOrg: typeof organisations.$inferSelect | null = null;
    let ownerWorkspace: typeof workspaces.$inferSelect | null = null;

    if (ownerDashboard && admin) {
      const [org] = await tx
        .insert(organisations)
        .values({
          name: ownerDashboard.orgName,
          slug: ownerDashboard.orgSlug,
          plan: 'starter',
          status: 'active',
          managementCompanyId,
          originatingAdminId: admin.id,
          primaryAccountManagerId: admin.id,
          billingOwnerCompanyId: managementCompanyId,
        })
        .returning();
      if (!org) {
        throw new Error('Failed to create onboarding organization');
      }

      const workspaceSlug = ownerDashboard.workspaceName
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '');

      const [workspace] = await tx
        .insert(workspaces)
        .values({
          orgId: org.id,
          name: ownerDashboard.workspaceName,
          slug: workspaceSlug,
          timezone: ownerDashboard.workspaceTimezone,
        })
        .returning();

      const [user] = await tx
        .insert(users)
        .values({
          orgId: org.id,
          email: normalizedEmail,
          name,
          passwordHash,
          orgRole: 'owner',
        })
        .returning();

      if (workspace && user) {
        await tx
          .insert(workspaceMembers)
          .values({ workspaceId: workspace.id, userId: user.id, role: 'admin', addedBy: user.id })
          .onConflictDoNothing();
      }

      ownerUser = user ?? null;
      ownerOrg = org ?? null;
      ownerWorkspace = workspace ?? null;
    }

    return { admin, ownerUser, ownerOrg, ownerWorkspace };
  });
}

// ── client org owner invite ───────────────────────────────────────────────────

export async function findValidClientOrgInvite(token: string) {
  return db.query.clientOrgOwnerInvitations.findFirst({
    where: and(
      eq(clientOrgOwnerInvitations.token, token),
      isNull(clientOrgOwnerInvitations.acceptedAt),
      isNull(clientOrgOwnerInvitations.revokedAt),
      gt(clientOrgOwnerInvitations.expiresAt, new Date()),
    ),
  });
}

export async function acceptClientOrgInvite(
  inviteId: string,
  organizationId: string,
  managementCompanyId: string,
  originatingAdminId: string,
  email: string,
  name: string,
  password: string,
  orgSetup: { orgName: string; orgSlug: string; workspaceName: string; workspaceTimezone: string },
) {
  // Finalise the pending org
  await db
    .update(organisations)
    .set({
      name: orgSetup.orgName,
      slug: orgSetup.orgSlug,
      status: 'active',
      managementCompanyId,
      originatingAdminId,
      primaryAccountManagerId: originatingAdminId,
      billingOwnerCompanyId: managementCompanyId,
      updatedAt: new Date(),
    })
    .where(eq(organisations.id, organizationId));

  // Create the default workspace
  const wsSlug = orgSetup.workspaceName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
  const [ws] = await db
    .insert(workspaces)
    .values({
      orgId: organizationId,
      name: orgSetup.workspaceName,
      slug: wsSlug,
      timezone: orgSetup.workspaceTimezone,
    })
    .returning();

  const passwordHash = await argon2.hash(password);
  const [user] = await db
    .insert(users)
    .values({ orgId: organizationId, email: email.toLowerCase(), name, passwordHash, orgRole: 'owner' })
    .returning();

  await db
    .update(clientOrgOwnerInvitations)
    .set({ acceptedAt: new Date(), updatedAt: new Date() })
    .where(eq(clientOrgOwnerInvitations.id, inviteId));

  if (user && ws) {
    await db
      .insert(workspaceMembers)
      .values({ workspaceId: ws.id, userId: user.id, role: 'admin', addedBy: user.id })
      .onConflictDoNothing();
  }

  return user;
}
