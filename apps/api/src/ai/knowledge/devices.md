# Devices

A **device** is a physical display (Samsung Tizen TV, Android tablet, Windows PC, e-paper panel, web player) registered with the platform.

## Where to find devices
Workspace sidebar → **Devices**. URL: `/workspaces/:workspaceId/devices`.

## Pairing a new device
1. On the device, install the appropriate Nexari player (Tizen, Android, Windows, HTML5, etc.).
2. The player shows a **6-character pairing code**.
3. In the dashboard, click **+ Add Device** and enter the code.
4. Choose the workspace, give the device a friendly **name** and **location**.

## Assigning content
Open a device's detail page and set:
- **Published Playlist** — what plays by default.
- **Published Schedule** — optional; if set, the schedule's slots override the published playlist during matching times.
- **Default Playlist** — fallback shown when nothing else applies (idle screen).

Changes propagate to the player via WebSocket / sync engine on the next heartbeat.

For bulk publishing, publish to selected devices from the Content publish wizard or publish to a Device Group. Use a reusable "All Screens" device group when a customer frequently publishes to every signage screen in a workspace.

## Device status
Each device shows:
- **Online/Offline** — last heartbeat within 90s.
- **Last seen** timestamp.
- **Storage** usage and **memory** (when reported).
- **Currently playing** content.

## Device groups
Group devices together to publish playlists/schedules to many at once. Workspace sidebar → **Device Groups**.

Device group types include location, tag, sync, and video wall. Video wall groups add grid dimensions and per-cell screen assignment.

## Sync groups
For coordinated multi-screen playback (video walls, synchronised displays), use **Sync Groups** — devices in the same group play frame-synchronised content.

## Video wall groups
For tiled walls, create a **Video Wall** device group. Set the number of columns and rows, add screens, configure the panel layout, then use **Push to Screens** so online players receive the wall geometry.

## Device control
You can send real-time commands to any online device from its detail page (Devices → click device name). Available actions include:
- **Refresh Schedule** — re-fetch published content immediately
- **Screenshot** — request a new screenshot from the player
- **Clear Cache** — force re-download of media assets
- **Reboot** — restart the player OS
- **Power On / Power Off** — control display power
- **Return to Player** — re-launch the Nexari app on the TV
- **Wake-on-LAN** — wake an offline device using a peer relay
- **Live View** — stream real-time screenshots via SSE (Tizen/Windows)
- **MDC commands** — Samsung display hardware control (volume, source, standby, locks)
- **Emergency override** — broadcast urgent content to all devices immediately

For full details on every command see the `device-control` knowledge file.
