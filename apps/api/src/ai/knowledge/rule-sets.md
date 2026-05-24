# Rule Sets

Rule Sets are workspace-level automation rules. Each rule set watches for one or more conditions and fires a single action on its assigned devices when those conditions are met.

Navigate to a workspace → **Rule Sets** (sidebar) → `/workspaces/:wsId/rule-sets`.

## Concepts

| Concept | Meaning |
|---|---|
| **Condition** | A trigger test (time window, BLE beacon, sensor value, occupancy, etc.) |
| **Condition group** | A set of conditions combined with AND or OR logic |
| **Action** | What happens when conditions are met (play playlist, show overlay, control device, etc.) |
| **Target** | Which devices, device groups, or the whole workspace the rule applies to |
| **Priority** | Higher number wins when multiple rules match the same device at the same time |
| **Cooldown** | Minimum seconds between repeated firings of the same rule set |
| **Fire count** | How many times the rule set has triggered (shown in the list and header) |

## Editor tabs

The rule set editor has three tabs:

1. **Conditions** — Define when the rule triggers. Build a condition tree using AND/OR groups. Add leaf conditions by type.
2. **Action** — Choose one action that fires when conditions are met.
3. **Targets** — Assign the rule to all workspace devices, specific device groups, or individual devices.

## Available condition types

- Time window (time of day, day of week)
- BLE beacon proximity (UUID, RSSI threshold)
- Temperature / humidity sensor
- Occupancy count
- Device idle / content finished
- Schedule active
- Tag match
- Network speed
- Battery level
- Device orientation
- Ambient audio level
- Inbound webhook
- Recurring cron expression
- POS sale event
- Stock level
- Face detected / gesture / QR scan / NFC tap

## Available actions

**Playback**
- Play Playlist
- Play Schedule
- Stop Playback / Pause Playback
- Switch Zone Content

**Overlay**
- Show Message Overlay
- Emergency Override

**Device**
- Device Control (power, input, volume)
- Set Brightness Schedule
- Fade Volume
- Launch App (Tizen)

**Integration**
- Send Notification
- Webhook Call (outbound)
- Log Event
- Record Analytics

**Flow**
- Chain Rule Set (trigger another rule set)
- Delay

## How to create a rule set

1. Open the workspace → **Rule Sets**.
2. Click **New** in the list panel.
3. On the **Conditions** tab, add one or more condition leaves. Group them with AND/OR as needed.
4. On the **Action** tab, choose what the device should do when the rule fires.
5. On the **Targets** tab, select which devices, device groups, or the whole workspace should respond.
6. Set **Priority** and optional **Cooldown** in the header area.
7. Toggle the rule **Enabled**.
8. Click **Save**. The rule is pushed to all assigned devices immediately.

## Managing rule sets

- **Enable/disable**: use the toggle in the rule list row or the editor header.
- **Test / manual fire**: click **Fire Now** in the editor header to trigger the action immediately (without waiting for conditions).
- **Delete**: click the trash icon in the editor, then confirm. The rule is removed from all assigned devices.
- **Search**: use the search box in the list panel to filter by name.

## How rule sets relate to other features

- Rule sets are workspace-scoped and independent from schedules.
- A rule set action of **Play Playlist** or **Play Schedule** overrides whatever the device is currently playing.
- A rule set action of **Emergency Override** forces a full-screen message on all targeted devices.
- Unlike schedules (time-only), rule sets can react to real-world sensor and event triggers.
- The **device-level BLE rules** (on the individual device detail page) are a simpler per-device mechanism; Rule Sets are the workspace-level, multi-condition version.
