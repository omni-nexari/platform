/** System control wrappers (Partner cert required) */

export function captureScreen(fileName: string): void {
  if (typeof webapis === 'undefined') return;
  webapis.systemcontrol.captureScreen(fileName);
}

export function reboot(): void {
  if (typeof webapis === 'undefined') { console.warn('[system] reboot skipped in dev'); return; }
  webapis.systemcontrol.rebootDevice();
}

export function setIRLock(lock: boolean): void {
  if (typeof webapis !== 'undefined') webapis.systemcontrol.setIRLock(lock);
}

export function setButtonLock(lock: boolean): void {
  if (typeof webapis !== 'undefined') webapis.systemcontrol.setButtonLock(lock);
}

export function setAutoPowerOn(on: boolean): void {
  if (typeof webapis !== 'undefined') webapis.systemcontrol.setAutoPowerOn(on);
}

export function getTemperature(): number {
  if (typeof webapis === 'undefined') return 35;
  try { return webapis.systemcontrol.getTemperature(); } catch { return 0; }
}

export function updateFirmware(): void {
  if (typeof webapis !== 'undefined') webapis.systemcontrol.updateFirmware();
}

/** Reads CPU load (0-100) and free storage bytes via tizen.systeminfo */
export async function getTelemetry(): Promise<{ cpuLoad: number; storageFreeBytes: number }> {
  return new Promise((resolve) => {
    if (typeof tizen === 'undefined') return resolve({ cpuLoad: 0, storageFreeBytes: 0 });
    tizen.systeminfo.getPropertyValue('CPU',
      (cpu) => {
        const cpuLoad = (cpu as { load: number }).load * 100;
        tizen.systeminfo.getPropertyValue('STORAGE',
          (storage) => {
            const units = (storage as { units: Array<{ availableCapacity: number }> }).units;
            const storageFreeBytes = units.reduce((s, u) => s + u.availableCapacity, 0);
            resolve({ cpuLoad, storageFreeBytes });
          },
          () => resolve({ cpuLoad, storageFreeBytes: 0 }),
        );
      },
      () => resolve({ cpuLoad: 0, storageFreeBytes: 0 }),
    );
  });
}
