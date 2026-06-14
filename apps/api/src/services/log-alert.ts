/**
 * Error-spike alerting.
 *
 * Subscribes to the in-process logBus and fires a platformAdminNotification
 * when any single device emits SPIKE_THRESHOLD+ error entries within
 * SPIKE_WINDOW_MS milliseconds.
 *
 * Implements a per-device cooldown so repeated spikes don't flood the
 * notifications table.
 */

import {
  db,
  platformAdminNotifications,
  organizations,
  managementCompanyAdmins,
  platformOwners,
  devices,
} from '@signage/db';
import { eq, isNull, and } from 'drizzle-orm';
import { logBus, type LogBusEntry } from './log-bus.js';

const SPIKE_WINDOW_MS = 60_000;       // rolling 60-second window
const SPIKE_THRESHOLD = 5;            // ≥5 errors = spike
const COOLDOWN_MS     = 10 * 60_000;  // 10-minute silence per device after alert

// Sliding window: deviceId → array of error timestamps
const errorTimestamps = new Map<string, number[]>();
// Cooldown: deviceId → timestamp of last alert
const alertCooldown   = new Map<string, number>();

async function handleEntry(entry: LogBusEntry): Promise<void> {
  if (entry.level !== 'error') return;
  if (!entry.deviceId || !entry.orgId) return;

  const now      = Date.now();
  const deviceId = entry.deviceId;
  const orgId    = entry.orgId;

  // Maintain sliding window
  const ts     = errorTimestamps.get(deviceId) ?? [];
  ts.push(now);
  const recent = ts.filter((t) => t > now - SPIKE_WINDOW_MS);
  errorTimestamps.set(deviceId, recent);

  if (recent.length < SPIKE_THRESHOLD) return;

  // Cooldown guard
  const lastAlert = alertCooldown.get(deviceId) ?? 0;
  if (now - lastAlert < COOLDOWN_MS) return;
  alertCooldown.set(deviceId, now);

  // Reset window so we don't re-fire immediately after cooldown expires
  errorTimestamps.set(deviceId, []);

  try {
    const [device, org] = await Promise.all([
      db.query.devices.findFirst({ where: eq(devices.id, deviceId), columns: { name: true } }),
      db.query.organizations.findFirst({
        where: eq(organizations.id, orgId),
        columns: { name: true, managementCompanyId: true },
      }),
    ]);

    const deviceName = device?.name ?? deviceId.slice(0, 8);
    const orgName    = org?.name    ?? '(unknown org)';
    const title      = `Error spike — ${deviceName}`;
    const body       = `"${deviceName}" (${orgName}) logged ${recent.length} errors within 60 seconds.`;

    const recipients: Array<{ actorType: string; actorId: string }> = [];

    // Notify all platform owners
    const owners = await db.query.platformOwners.findMany({ columns: { id: true } });
    for (const o of owners) {
      recipients.push({ actorType: 'platform_owner', actorId: o.id });
    }

    // Notify management company admins responsible for this org
    if (org?.managementCompanyId) {
      const admins = await db.query.managementCompanyAdmins.findMany({
        where: and(
          eq(managementCompanyAdmins.managementCompanyId, org.managementCompanyId),
          isNull(managementCompanyAdmins.suspendedAt),
        ),
        columns: { id: true },
      });
      for (const a of admins) {
        recipients.push({ actorType: 'management_company_admin', actorId: a.id });
      }
    }

    if (recipients.length > 0) {
      await db.insert(platformAdminNotifications).values(
        recipients.map((r) => ({
          actorType:  r.actorType,
          actorId:    r.actorId,
          type:       'device_error_spike',
          title,
          body,
          entityType: 'device',
          entityId:   deviceId,
        })),
      );
    }
  } catch (err) {
    console.error('[log-alert] Failed to insert notification:', err);
  }
}

export function startLogAlerts(): void {
  logBus.on('entry', (e: LogBusEntry) => void handleEntry(e));
}
