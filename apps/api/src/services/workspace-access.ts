import { db, workspaceMembers, users } from '@signage/db';
import { eq, and } from 'drizzle-orm';

/** Org roles that have implicit access to all workspaces in their organisation. */
const ORG_BYPASS_ROLES = new Set(['prime_owner', 'owner', 'admin']);

/**
 * Check whether `userId` may access `workspaceId`.
 *
 * - Org owners / admins bypass the workspace-member lookup and receive a
 *   synthetic `{ role: 'admin' }` record so all downstream `member.role`
 *   checks still pass correctly.
 * - All other roles must have an explicit row in `workspace_members`.
 *
 * Drop-in replacement for the per-file local helpers — no call-site changes
 * needed; the org-role lookup is done internally using the user's primary key.
 */
export async function checkWorkspaceAccess(
  workspaceId: string,
  userId: string,
): Promise<{ role: string } | undefined> {
  const user = await db.query.users.findFirst({
    where: eq(users.id, userId),
    columns: { orgRole: true },
  });

  if (user && ORG_BYPASS_ROLES.has(user.orgRole)) {
    return { role: 'admin' };
  }

  return db.query.workspaceMembers.findFirst({
    where: and(
      eq(workspaceMembers.workspaceId, workspaceId),
      eq(workspaceMembers.userId, userId),
    ),
  });
}
