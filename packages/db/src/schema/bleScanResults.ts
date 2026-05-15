import { pgTable, uuid, timestamp, jsonb } from 'drizzle-orm/pg-core';
import { devices } from './devices.js';

// ── BLE beacon type ───────────────────────────────────────────────────────────

export type ScannedBeacon = {
  /** iBeacon UUID or Eddystone namespace/URL identifier */
  uuid: string;
  /** iBeacon major value (optional) */
  major?: number;
  /** iBeacon minor value (optional) */
  minor?: number;
  /** Signal strength in dBm at time of scan */
  rssi: number;
  /** Advertised device name, if available */
  name?: string;
};

// ── Table ─────────────────────────────────────────────────────────────────────

/**
 * Stores the result of on-demand BLE scans triggered from the DS dashboard.
 * Only the latest 5 rows per device are kept (older rows deleted on insert).
 */
export const bleScanResults = pgTable('ble_scan_results', {
  id: uuid('id').primaryKey().defaultRandom(),
  deviceId: uuid('device_id').notNull().references(() => devices.id, { onDelete: 'cascade' }),
  /** When the TV performed the scan */
  scannedAt: timestamp('scanned_at', { withTimezone: true }).notNull().defaultNow(),
  /** All beacons observed during the scan window */
  beacons: jsonb('beacons').$type<ScannedBeacon[]>().notNull(),
});
