/** NTP and on/off timer wrappers */

export function setNTP(server: string, timezone: string): void {
  if (typeof webapis !== 'undefined') webapis.timer.setNTP(server, timezone);
}

export function setOnTimer(slot: number, time: string): void {
  if (typeof webapis !== 'undefined') webapis.timer.setOnTimer(slot, time);
}

export function setOffTimer(slot: number, time: string): void {
  if (typeof webapis !== 'undefined') webapis.timer.setOffTimer(slot, time);
}

export function clearOnTimer(slot: number): void {
  if (typeof webapis !== 'undefined') webapis.timer.clearOnTimer(slot);
}

export function clearOffTimer(slot: number): void {
  if (typeof webapis !== 'undefined') webapis.timer.clearOffTimer(slot);
}
