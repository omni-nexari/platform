/**
 * PlaylistItemConditions — per-item conditional playback rules.
 * Stored as a JSON string in the `conditions` column.
 */
export interface PlaylistItemConditions {
  /** Play only within this wall-clock time range (HH:MM, 24h) */
  timeOfDay?: { from: string; to: string };
  /** ISO day-of-week numbers: 0=Sun, 1=Mon … 6=Sat */
  daysOfWeek?: number[];
  /** Only play on devices matching one of these types (e.g. 'tizen', 'pi') */
  deviceTypes?: string[];
  /** Only play on devices carrying all of these tag names */
  tags?: string[];
}

const TIME_REGEX = /^([01]\d|2[0-3]):[0-5]\d$/;

/**
 * Validates a PlaylistItemConditions object.
 * Returns an error string if invalid, or null if valid.
 */
export function validatePlaylistItemConditions(value: unknown): string | null {
  if (value === null || value === undefined || (typeof value === 'object' && Object.keys(value as object).length === 0)) {
    return null; // empty / absent conditions are always valid
  }
  if (typeof value !== 'object' || Array.isArray(value)) {
    return 'conditions must be an object';
  }
  const c = value as Record<string, unknown>;

  if (c['timeOfDay'] !== undefined) {
    const t = c['timeOfDay'];
    if (typeof t !== 'object' || Array.isArray(t) || t === null) {
      return 'conditions.timeOfDay must be an object';
    }
    const { from, to } = t as Record<string, unknown>;
    if (typeof from !== 'string' || !TIME_REGEX.test(from)) {
      return 'conditions.timeOfDay.from must be HH:MM (24h)';
    }
    if (typeof to !== 'string' || !TIME_REGEX.test(to)) {
      return 'conditions.timeOfDay.to must be HH:MM (24h)';
    }
  }

  if (c['daysOfWeek'] !== undefined) {
    if (!Array.isArray(c['daysOfWeek'])) return 'conditions.daysOfWeek must be an array';
    for (const d of c['daysOfWeek'] as unknown[]) {
      if (typeof d !== 'number' || d < 0 || d > 6) {
        return 'conditions.daysOfWeek values must be integers 0–6';
      }
    }
  }

  if (c['deviceTypes'] !== undefined) {
    if (!Array.isArray(c['deviceTypes'])) return 'conditions.deviceTypes must be an array';
    for (const d of c['deviceTypes'] as unknown[]) {
      if (typeof d !== 'string') return 'conditions.deviceTypes values must be strings';
    }
  }

  if (c['tags'] !== undefined) {
    if (!Array.isArray(c['tags'])) return 'conditions.tags must be an array';
    for (const t of c['tags'] as unknown[]) {
      if (typeof t !== 'string') return 'conditions.tags values must be strings';
    }
  }

  return null;
}
