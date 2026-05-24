# Device Control

Nexari lets administrators send real-time commands to any online player directly from the Device detail page. All commands are delivered via WebSocket; the device must be **online** for most of them to take effect.

---

## Where to find device controls

1. Workspace sidebar → **Devices**
2. Click any device name to open its **Device Detail** page
3. The control panel sections appear in the right-hand area of the page

---

## Quick commands (Device Actions panel)

These commands are available on every device type. All require the device to be online.

| Button / Action | What it does |
|---|---|
| **Refresh Schedule** | Tells the player to re-fetch its published schedule/playlist immediately. Use this when you have just published new content and want the screen to update now. |
| **Screenshot** | Requests a new screenshot from the player. The image appears in the Screenshots panel below after a few seconds. |
| **Clear Cache** | Clears the player's local media cache. The device will re-download assets on next playback. Useful when content appears stale. |
| **Reboot** | Sends a reboot command to the underlying OS of the player. The device will go offline briefly and reconnect. |
| **Power Off** | Tells the player (and the Samsung LFD display, if MDC is configured) to turn off the screen. |
| **Power On** | Turns the display back on. |
| **Dump Logs** | Asks the player to write diagnostic logs to its OSD / disk. Used for troubleshooting. |
| **Open Settings** | Opens the OS settings UI on the player device. |
| **Return to Player** | Re-launches the Nexari app on the TV. Works even if the app was killed — uses the Samsung Remote Control WebSocket API on port 8001 as a fallback. |

---

## Live view / screenshots

- The **Screenshot** button requests a one-off capture.
- **Live View** (available on Tizen/Windows players) streams a continuous screenshot feed as an SSE connection. Open it from the device detail page for real-time monitoring.
- Screenshots are stored per device. You can delete individual shots or clear all screenshots from the detail page.
- The screenshot interval can be configured (sent as `set_screenshot_interval` with a minutes value).

---

## Power and display control (Windows / desktop players)

For Windows/desktop players, additional power controls are available:

| Command | What it does |
|---|---|
| **Sleep** | Suspends the OS (`SetSuspendState` on Windows). |
| **Display Power on/off** | Toggles the monitor via DPMS without shutting down the OS. |
| **Set System Volume** | Changes OS audio volume (0–100). |
| **Set System Mute** | Mutes or un-mutes OS audio. |
| **Set Brightness** | DDC/CI brightness control (0–100) on Windows monitors. |
| **Set Display** | Moves the player window to a different attached monitor by display index. |

---

## Wake-on-LAN

If a device is offline (powered off but on the network), you can wake it remotely:

1. Open the Device detail page.
2. Click **Wake** (shown when device is offline and has a recorded MAC address).
3. The server finds another online device on the same /24 subnet and sends a Wake-on-LAN magic packet to the target's MAC address via that relay device.

**Requirements:**
- The target device must have its MAC address recorded in the system.
- At least one other Tizen, Windows, or e-paper player on the same LAN must be online to act as relay.
- The network must support UDP broadcast to 255.255.255.255:9.

---

## Samsung MDC (Multiple Display Control)

MDC is a Samsung commercial display protocol (TCP port 1515) that lets the server control LFD/commercial Samsung TVs at the hardware level — independent of the Nexari player app. The Nexari player acts as a bridge: it relays MDC commands from the server to the display over the local TCP socket.

### MDC settings available in the dashboard

| Setting | Description |
|---|---|
| **Volume** | Set audio volume (0–100) |
| **Mute** | Mute or un-mute |
| **Input/Source** | Switch input: HDMI1, HDMI2, HDMI3, HDMI4, PC, DVI, DP, AV, COMPONENT, INTERNAL_USB |
| **Standby** | Enable/disable panel standby mode |
| **Network Standby** | Keep network active while panel is off (required for Wake-on-LAN / remote power-on to work) |
| **Remote Control Lock** | Lock or unlock the physical IR remote control |
| **Safety Lock** | Enable/disable the panel's safety lock |
| **OSD Display** | Toggle individual OSD notification types on/off |
| **Menu Orientation** | Portrait / landscape for the OSD menu |
| **Source Orientation** | Portrait / landscape for the video source |
| **URL Launcher Address** | Get or set the browser URL launcher address |
| **MDC ID** | Assign a display ID (0–254) for daisy-chained setups |

### Remote key injection (MDC key codes, sent via LAN TCP)

For Samsung LFD displays, you can inject hardware key-press events:

| Key | Function |
|---|---|
| POWER_ON | Power on the panel |
| POWER_OFF | Power off the panel |
| REBOOT | Restart the display firmware |
| ARROW_UP / DOWN / LEFT / RIGHT | Navigate OSD menus |
| ENTER | Confirm selection in OSD |
| RETURN | Back / Return in OSD |
| MENU | Open OSD main menu |
| HOME | Go to Samsung Home screen |

### MDC Status (remote-status)

Click **Check MDC Status** on the device detail page to request a live status report from the Samsung display. This returns the current volume, mute state, input, standby state, and other hardware values.

### MDC ID scan

If you don't know your display's MDC ID (needed for daisy-chain setups), use the **MDC ID Scan** button to auto-detect it.

---

## Samsung / Tizen probes and commands

For Tizen-based Samsung players, advanced diagnostic tools are available:

| Action | What it does |
|---|---|
| **Tizen Probe** | Queries on-device Samsung Tizen APIs (installed apps, network info, firmware version, etc.) |
| **Tizen Command** | Runs a write action directly on the TV via WebSocket (e.g., set source, launch app) |

---

## Emergency override

The emergency override broadcasts an urgent message or content to **all devices in the workspace** at once, overriding all schedules.

### Start an emergency

1. From any Devices page (or the workspace overview), click the **Emergency** (siren) icon.
2. Enter an optional text message or select a content item.
3. Click **Activate** — all online devices immediately display the emergency content.

### Clear an emergency

1. Click the same **Emergency** icon.
2. Click **Clear Emergency**.
3. All devices return to their regular schedule/playlist.

**Notes:**
- Emergency scope can be org-wide or workspace-only.
- The player fetches the current emergency state on each heartbeat; offline devices will pick it up when they reconnect.

---

## Device rules (BLE automation)

Device rules let you trigger automatic actions when a BLE (Bluetooth Low Energy) beacon is detected near the device.

### How rules work
1. The device runs periodic BLE scans.
2. When a scan result matches a rule's **conditions** (e.g., a specific beacon UUID or RSSI threshold), the rule's **action** fires (e.g., switch to a specific playlist, trigger a scene).
3. Rules have a **priority** (higher number = higher priority); the highest-priority matching rule wins.

### Managing rules
- View rules: open a device's detail page → **Rules** tab.
- Add a rule: click **+ Add Rule**, define conditions and action.
- Enable/disable a rule: toggle the switch on the rule row.
- Delete a rule: click the trash icon.
- **Push Rules to Device**: after making changes, click **Push Rules** to send the current ruleset to the player via WebSocket.
- **Clear Rules**: removes all rules from the player (device returns to normal scheduling).

---

## E-paper panel controls

E-paper (electronic ink) panels have their own power and refresh cycle controls:

| Action | What it does |
|---|---|
| **Wake Panel** | Wake the panel out of sleep mode now |
| **Force Full Refresh** | Trigger a full-panel defrag refresh (clears ghosting) |
| **Force Sleep** | Put the panel into sleep mode immediately |
| **E-paper Settings** | Configure: Network Standby (ON/OFF), Auto Sleep timer, Screen Refresh Time, LED Mode (ON/OFF/AUTO), Battery Warning Icon, Minimum Swap Rate |

---

## BLE scan

Trigger a Bluetooth Low Energy scan on a device from the dashboard:

1. Open the device detail page → **BLE Scan** section.
2. Click **Trigger Scan** — the player performs a scan and reports nearby beacons.
3. View the latest scan results in the **BLE Scan** panel.
4. The live scan stream (SSE) can be opened to watch beacons appear in real time.

---

## Player update (OTA)

To update the Nexari player app on a device:

1. Open the Device detail page.
2. In the **Player** section, if a newer version is available, a **Update Player** button appears.
3. Click it — the server sends an `update_player` command with the download URL and SHA-256 checksum.
4. The player downloads and installs the update, then reconnects.

---

## Device heartbeats

Every online device sends periodic heartbeats (every ~30s) containing:
- Player version
- Current content being played (`currentContentName`, `currentContentId`)
- Storage free/total
- Memory free/total
- Power state (`on`, `off`, `standby`, `sleeping`)
- Next wake time (if sleeping)
- IP address, platform, firmware version

You can view the heartbeat history (last 48h) from the device detail page for diagnostics.

---

## Troubleshooting device control

**Command shows "Device is offline"**
- Wait for the device to reconnect and try again.
- Check the device's network connection and power.
- Use Wake-on-LAN if the device was powered off remotely.

**Schedule refresh does not update the screen**
- Confirm a playlist or schedule is published to the device.
- Check that the published content is in `ready` status (not still uploading or processing).
- Try **Clear Cache** followed by **Refresh Schedule**.

**Reboot button does nothing**
- The device must be online. Confirm status in the Devices list.
- For Samsung Tizen: the player must have background-support permission enabled.

**MDC command fails**
- Ensure the Samsung display's LAN IP is reachable from the player.
- Verify the MDC ID is correct (use MDC ID Scan if unsure).
- Network Standby must be enabled on the display for power-on commands to work.

**Return to Player fails**
- The command tries WebSocket first, then Samsung Remote Control API (port 8001).
- If both fail, physically relaunch the Nexari app on the TV.

**Wake-on-LAN does not wake the device**
- Confirm "Network Standby" is enabled via MDC before powering off.
- At least one peer device on the same /24 subnet must be online.
- The network must allow UDP broadcast to 255.255.255.255:9.

**Emergency does not clear**
- Use the Emergency icon → Clear Emergency button.
- If the screen still shows emergency content, send a **Refresh Schedule** command to the affected device.

---

## Good answer template

When a user asks how to control a device, always:
1. Tell them to open **Devices** in the workspace sidebar and click the device name.
2. Name the exact button or section they need (e.g., "Click **Reboot** in the Device Actions panel").
3. Note whether the device must be online.
4. Mention any prerequisites (e.g., MDC requires Samsung LFD display; Wake-on-LAN requires a peer device on the same subnet).
