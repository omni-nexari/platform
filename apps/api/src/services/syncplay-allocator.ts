import { db, syncGroups } from '@signage/db';
import { and, eq, isNull } from 'drizzle-orm';

/**
 * Derive a Samsung SyncPlay groupId (0–65535) from a UUID string using CRC-16/CCITT.
 * Player-side fallback uses the same algorithm so derivations match.
 */
export function crc16(str: string): number {
  let crc = 0xFFFF;
  for (let i = 0; i < str.length; i++) {
    crc ^= str.charCodeAt(i) << 8;
    for (let j = 0; j < 8; j++) {
      crc = (crc & 0x8000) ? ((crc << 1) ^ 0x1021) : (crc << 1);
    }
  }
  return crc & 0xFFFF;
}

/**
 * Allocate a Samsung SyncPlay groupId (0–65535) that is unique within the org.
 * Tries CRC-16 of the UUID first; if that collides, increments until free.
 */
export async function allocateSyncPlayGroupId(orgId: string, syncGroupUuid: string): Promise<number> {
  const existing = await db.query.syncGroups.findMany({
    where: and(eq(syncGroups.orgId, orgId), isNull(syncGroups.deletedAt)),
    columns: { groupId: true },
  });
  const usedIds = new Set(existing.map((g) => g.groupId));
  const candidate = crc16(syncGroupUuid);
  for (let attempt = 0; attempt < 65536; attempt++) {
    const probe = (candidate + attempt) % 65536;
    if (!usedIds.has(probe)) return probe;
  }
  throw new Error('No available groupId in range 0–65535');
}
