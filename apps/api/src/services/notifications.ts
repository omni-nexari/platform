import { db, notifications, users, workspaceMembers } from '@signage/db';
import { and, eq, inArray, isNull, sql } from 'drizzle-orm';

export type NotificationEventKey =
  | 'device_offline'
  | 'device_online'
  | 'content_failed'
  | 'storage_warning'
  | 'content_expiring'
  | 'emergency_activated'
  | 'sensor_rule_fired'
  | 'invitation_accepted';

interface BrowserConn {
  send(data: string): void;
  close(code?: number, reason?: string | Buffer): void;
  readonly readyState: number;
}

interface CreateNotificationsInput {
  orgId: string;
  userIds: string[];
  type: NotificationEventKey;
  title: string;
  body: string;
  entityType?: string | null;
  entityId?: string | null;
}

type PrefRow = { user_id: string; in_app: boolean };

const browserConnections = new Map<string, Set<BrowserConn>>();

function uniqueIds(userIds: string[]): string[] {
  return [...new Set(userIds.filter(Boolean))];
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

async function filterUsersByInAppPreference(
  userIds: string[],
  eventKey: NotificationEventKey,
): Promise<string[]> {
  const ids = uniqueIds(userIds);
  if (ids.length === 0) return [];

  const rows = (await db.execute(sql`
    SELECT user_id, in_app
    FROM notification_prefs
    WHERE event_key = ${eventKey}
      AND user_id IN (${sql.join(ids.map((id) => sql`${id}`), sql`, `)})
  `)) as unknown as PrefRow[];

  const prefMap = new Map(rows.map((row) => [row.user_id, row.in_app]));
  return ids.filter((id) => prefMap.get(id) ?? true);
}

function pushBrowserEvent(userId: string, payload: Record<string, unknown>): void {
  const sockets = browserConnections.get(userId);
  if (!sockets || sockets.size === 0) return;

  const data = JSON.stringify(payload);
  for (const socket of sockets) {
    if (socket.readyState !== 1) continue;
    socket.send(data);
  }
}

export function registerBrowserClient(userId: string, socket: BrowserConn): void {
  const sockets = browserConnections.get(userId) ?? new Set<BrowserConn>();
  sockets.add(socket);
  browserConnections.set(userId, sockets);
}

export function unregisterBrowserClient(userId: string, socket: BrowserConn): void {
  const sockets = browserConnections.get(userId);
  if (!sockets) return;
  sockets.delete(socket);
  if (sockets.size === 0) {
    browserConnections.delete(userId);
  }
}

export async function listActiveOrgUserIds(orgId: string): Promise<string[]> {
  const rows = await db
    .select({ id: users.id })
    .from(users)
    .where(
      and(
        eq(users.orgId, orgId),
        eq(users.status, 'active'),
        isNull(users.deletedAt),
      ),
    );

  return rows.map((row) => row.id);
}

export async function listOrgAdminUserIds(orgId: string): Promise<string[]> {
  const rows = await db
    .select({ id: users.id })
    .from(users)
    .where(
      and(
        eq(users.orgId, orgId),
        inArray(users.orgRole, ['owner', 'admin']),
        eq(users.status, 'active'),
        isNull(users.deletedAt),
      ),
    );

  return rows.map((row) => row.id);
}

export async function listWorkspaceAdminUserIds(workspaceId: string): Promise<string[]> {
  const rows = await db
    .select({ userId: workspaceMembers.userId })
    .from(workspaceMembers)
    .innerJoin(users, eq(users.id, workspaceMembers.userId))
    .where(
      and(
        eq(workspaceMembers.workspaceId, workspaceId),
        eq(workspaceMembers.role, 'admin'),
        eq(users.status, 'active'),
        isNull(users.deletedAt),
      ),
    );

  return rows.map((row) => row.userId);
}

export async function listWorkspaceMemberUserIds(workspaceIds: string[]): Promise<string[]> {
  const ids = uniqueIds(workspaceIds);
  if (ids.length === 0) return [];

  const rows = await db
    .select({ userId: workspaceMembers.userId })
    .from(workspaceMembers)
    .innerJoin(users, eq(users.id, workspaceMembers.userId))
    .where(
      and(
        inArray(workspaceMembers.workspaceId, ids),
        eq(users.status, 'active'),
        isNull(users.deletedAt),
      ),
    );

  return uniqueIds(rows.map((row) => row.userId));
}

export async function createNotifications(
  input: CreateNotificationsInput,
): Promise<void> {
  const allowedUserIds = await filterUsersByInAppPreference(input.userIds, input.type);
  if (allowedUserIds.length === 0) return;

  await db.insert(notifications).values(
    allowedUserIds.map((userId) => ({
      orgId: input.orgId,
      userId,
      type: input.type,
      title: input.title,
      body: input.body,
      entityType: input.entityType ?? null,
      entityId: input.entityId ?? null,
    })),
  );

  for (const userId of allowedUserIds) {
    pushBrowserEvent(userId, {
      type: 'notifications.invalidate',
      eventKey: input.type,
      entityType: input.entityType ?? null,
      entityId: input.entityId ?? null,
    });
  }
}

export async function notifyDeviceStatusChange(input: {
  orgId: string;
  workspaceId: string;
  deviceId: string;
  deviceName: string;
  status: 'online' | 'offline';
}): Promise<void> {
  const userIds = await listWorkspaceAdminUserIds(input.workspaceId);
  await createNotifications({
    orgId: input.orgId,
    userIds,
    type: input.status === 'online' ? 'device_online' : 'device_offline',
    title: input.status === 'online' ? 'Device back online' : 'Device offline',
    body:
      input.status === 'online'
        ? `${input.deviceName} is back online.`
        : `${input.deviceName} went offline.`,
    entityType: 'device',
    entityId: input.deviceId,
  });
}

export async function notifyStorageThresholdCrossing(input: {
  orgId: string;
  actorUserId: string;
  previousUsedBytes: number;
  nextUsedBytes: number;
  limitBytes: number;
}): Promise<void> {
  if (input.limitBytes <= 0) return;

  const previousPct = (input.previousUsedBytes / input.limitBytes) * 100;
  const nextPct = (input.nextUsedBytes / input.limitBytes) * 100;
  const adminIds = await listOrgAdminUserIds(input.orgId);
  const userIds = uniqueIds([input.actorUserId, ...adminIds]);

  const thresholds: Array<80 | 100> = [80, 100];
  for (const threshold of thresholds) {
    if (previousPct < threshold && nextPct >= threshold) {
      await createNotifications({
        orgId: input.orgId,
        userIds,
        type: 'storage_warning',
        title: threshold === 100 ? 'Storage quota reached' : 'Storage quota warning',
        body:
          threshold === 100
            ? `Storage usage reached ${formatBytes(input.nextUsedBytes)} of ${formatBytes(input.limitBytes)}.`
            : `Storage usage exceeded ${threshold}% (${formatBytes(input.nextUsedBytes)} of ${formatBytes(input.limitBytes)}).`,
        entityType: 'organisation',
        entityId: input.orgId,
      });
    }
  }
}

export async function notifyEmergencyActivated(input: {
  orgId: string;
  scope: 'org' | 'workspace' | 'tag' | 'device';
  scopeId?: string;
  workspaceIds: string[];
  emergencyId: string;
}): Promise<void> {
  const userIds =
    input.scope === 'org'
      ? await listActiveOrgUserIds(input.orgId)
      : await listWorkspaceMemberUserIds(input.workspaceIds);

  await createNotifications({
    orgId: input.orgId,
    userIds,
    type: 'emergency_activated',
    title: 'Emergency override activated',
    body:
      input.scope === 'org'
        ? 'An organization-wide emergency override is active.'
        : 'An emergency override is active for one or more devices in your workspace.',
    entityType: 'emergency_override',
    entityId: input.emergencyId,
  });
}

export async function notifyContentFailed(input: {
  orgId: string;
  userId: string;
  contentId: string;
  contentName: string;
  reason: string;
}): Promise<void> {
  await createNotifications({
    orgId: input.orgId,
    userIds: [input.userId],
    type: 'content_failed',
    title: 'Content processing failed',
    body: `${input.contentName} failed processing: ${input.reason}`,
    entityType: 'content',
    entityId: input.contentId,
  });
}