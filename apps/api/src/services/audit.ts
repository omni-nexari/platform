import { db, auditLog } from '@signage/db';

export interface AuditEntry {
  orgId?: string | null;
  actorId?: string | null;
  actorType?: 'user' | 'device' | 'system';
  action: string;
  entityType?: string | null;
  entityId?: string | null;
  meta?: Record<string, unknown>;
  ipAddress?: string | null;
}

/**
 * Write an audit log entry. Failures are swallowed so audit logging
 * never breaks the main request flow.
 */
export async function writeAuditLog(entry: AuditEntry): Promise<void> {
  try {
    await db.insert(auditLog).values({
      orgId: entry.orgId ?? null,
      actorId: entry.actorId ?? null,
      actorType: entry.actorType ?? 'user',
      action: entry.action,
      entityType: entry.entityType ?? null,
      entityId: entry.entityId ?? null,
      meta: JSON.stringify(entry.meta ?? {}),
      ipAddress: entry.ipAddress ?? null,
    });
  } catch (err) {
    console.error('[audit] write failed:', err);
  }
}
