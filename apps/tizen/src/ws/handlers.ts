import { reboot, setIRLock, setButtonLock, setAutoPowerOn, updateFirmware, captureScreen } from '../device/system.js';
import { setNTP, setOnTimer, setOffTimer, clearOnTimer, clearOffTimer } from '../device/time.js';
import { send } from './manager.js';
import { showEmergency, clearEmergency } from '../ui/emergency.js';
import { scheduler } from '../scheduler/index.js';

/** Handles a WS command pushed from the server. */
export function handleServerCommand(cmd: { type: string; payload?: unknown }): void {
  const p = cmd.payload as Record<string, unknown> | undefined;

  switch (cmd.type) {
    case 'reboot':
      reboot();
      break;

    case 'screenshot':
      captureScreen(`screenshot_${Date.now()}.jpg`);
      break;

    case 'refresh_schedule':
      scheduler.refresh();
      break;

    case 'emergency_start':
      showEmergency(p?.text as string | undefined, p?.contentItemId as string | undefined);
      break;

    case 'emergency_clear':
      clearEmergency();
      break;

    case 'power_off':
      // webapis.systemcontrol doesn't have direct power-off; send standby
      if (typeof webapis !== 'undefined') webapis.systemcontrol.setAutoPowerOn(false);
      break;

    case 'set_ntp':
      setNTP(p!.server as string, p!.timezone as string);
      break;

    case 'set_ir_lock':
      setIRLock(p!.lock as boolean);
      break;

    case 'set_button_lock':
      setButtonLock(p!.lock as boolean);
      break;

    case 'set_on_timer':
      setOnTimer(p!.slot as number, p!.time as string);
      break;

    case 'set_off_timer':
      setOffTimer(p!.slot as number, p!.time as string);
      break;

    case 'clear_on_timer':
      clearOnTimer(p!.slot as number);
      break;

    case 'clear_off_timer':
      clearOffTimer(p!.slot as number);
      break;

    case 'update_tv_firmware':
      updateFirmware();
      break;

    case 'update_player': {
      const version = p!.version as string;
      const downloadUrl = p!.downloadUrl as string;
      import('../cache/downloader.js').then(({ queueDownload }) => {
        queueDownload({ id: `ota-${version}`, url: downloadUrl, fileName: `player-${version}.wgt`, type: 'ota' });
      });
      break;
    }

    case 'clear_cache':
      import('../cache/manifest.js').then(({ clearAll }) => clearAll());
      break;

    case 'dump_logs':
      import('../ui/osd.js').then(({ dumpLogs }) => dumpLogs());
      break;

    case 'set_screenshot_interval': {
      const minutes = p!.minutes as number;
      scheduler.setScreenshotInterval(minutes);
      break;
    }

    case 'set_zones': {
      const zones = p!.zones as unknown[];
      scheduler.setZones(zones);
      break;
    }

    case 'ack':
      // Server ACK — ignore on device side
      break;

    default:
      console.warn('[ws] unknown command:', cmd.type);
  }

  // Acknowledge any command that carries an id
  if (p && typeof p['commandId'] === 'string') {
    send({ type: 'ack', payload: { commandId: p['commandId'], success: true } });
  }
}
