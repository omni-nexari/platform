/** Evaluates a list of schedule slots against a given timestamp and returns the best match. */

export interface ScheduleSlot {
  playlistId?: string | null;
  contentId?: string | null;
  playlist?: unknown;
  content?: unknown;
  startTime: string; // HH:MM
  endTime: string;   // HH:MM
  recurrenceType: 'once' | 'daily' | 'weekly';
  date?: string | null;     // YYYY-MM-DD (once)
  daysOfWeek?: number[] | null; // 0=Mon … 6=Sun
  priority: number;
}

function timeToMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}

export function evaluateSlots(slots: ScheduleSlot[], now: Date): ScheduleSlot | null {
  const todayMins = now.getHours() * 60 + now.getMinutes();
  // JS getDay() returns 0=Sun … 6=Sat; we want 0=Mon … 6=Sun
  const jsDay = now.getDay();
  const dayOfWeek = jsDay === 0 ? 6 : jsDay - 1;
  const todayStr = now.toISOString().slice(0, 10); // YYYY-MM-DD

  const candidates = slots.filter((slot) => {
    const start = timeToMinutes(slot.startTime);
    const end = timeToMinutes(slot.endTime);
    if (todayMins < start || todayMins >= end) return false;

    if (slot.recurrenceType === 'once') return slot.date === todayStr;
    if (slot.recurrenceType === 'daily') return true;
    if (slot.recurrenceType === 'weekly') return (slot.daysOfWeek ?? []).includes(dayOfWeek);
    return false;
  });

  if (candidates.length === 0) return null;

  // Highest priority wins; ties broken by most-specific recurrenceType
  const rank = { once: 3, daily: 2, weekly: 1 };
  return candidates.sort((a, b) =>
    b.priority - a.priority || (rank[b.recurrenceType] ?? 0) - (rank[a.recurrenceType] ?? 0),
  )[0] ?? null;
}
