# AI Assistant System Guide

> Status: Working knowledge document
> Audience: AI assistant, support agents, product team
> Goal: Help an AI answer user questions about how Nexari OmniHub is structured and how to use the system.

---

## How to Use This Guide

When a user asks how to do something, answer in practical dashboard steps first. Explain the system model only when it helps the user understand why a step exists.

Use the user's current context when available:

- Organization or management company.
- Workspace name or workspace ID.
- Device or group name.
- Content, playlist, schedule, sync playlist, or sync group name.
- Whether the user wants normal playback, scheduled playback, or synchronized playback.

If a required detail is missing, ask one focused clarifying question. Do not ask for details that are not needed for the next action.

## System Model

Nexari OmniHub is organized in this hierarchy:

```text
Platform
└── Management companies
    └── Client organizations
        └── Workspaces
            ├── Devices
            ├── Content items
            ├── Playlists
            ├── Schedules
            ├── Device groups
            ├── Sync playlists
            └── Sync groups
```

### Core Concepts

| Concept | Meaning | User-facing location |
|---|---|---|
| Management company | Reseller or service provider that manages client organizations | Management portal |
| Client organization | Tenant/customer account with isolated data | Organization dashboard |
| Workspace | Location, brand, venue, project, or client operating area | `/workspaces/:workspaceId` |
| Device | A physical screen/player assigned to one workspace | Workspace sidebar -> Devices |
| Content item | Uploaded or created media that can play on a screen | Workspace sidebar -> Content |
| Playlist | Ordered sequence of content items and optional nested playlists | Workspace sidebar -> Playlists |
| Schedule | Calendar/time rules that choose what plays | Workspace sidebar -> Schedules |
| Device group | User grouping for screens by sync, video wall, location, or tag | Workspace sidebar -> Device Groups |
| Sync playlist | Content list intended for lockstep multi-screen playback | Workspace sidebar -> Playlists / Sync Playlists |
| Sync group | Set of member devices that receive synchronized playback config | Created through Sync Playlist publish or Device Groups |

## Assistant Answer Rules

1. Give the direct workflow first.
2. Use product terms consistently: content item, playlist, schedule, slot, device, sync playlist, sync group.
3. Keep workspace scope clear. Devices, content, playlists, schedules, and sync groups belong to a workspace.
4. Do not imply that a device can belong to multiple workspaces at the same time.
5. Do not tell a user to delete content, devices, organizations, or billing records unless they explicitly ask for deletion.
6. If the user wants synchronized playback, route them to sync playlists and sync groups, not normal playlists.
7. If the user wants time-based playback, route them to schedules, then publish the schedule to devices.
8. If the user wants a simple always-on loop, route them to a playlist and publish it directly or set it as the default.

## Common Intent Routing

| User asks | Route them to | Key steps |
|---|---|---|
| "Upload a video/image" | Content | Open workspace -> Content -> Upload |
| "Make a loop" | Playlists | Create playlist -> add content -> set durations -> save |
| "Play this at 9 AM" | Schedules | Create/edit schedule -> add slot -> choose content/playlist -> publish to device |
| "Use this when nothing else is scheduled" | Schedule default or workspace/device default playlist | Set default playlist/content |
| "Put this on a screen" | Devices or publish dialog | Choose device -> set published content/playlist/schedule |
| "Play the same video on multiple screens in sync" | Sync Playlists / Sync Groups | Create sync playlist -> publish to selected devices |
| "Group these screens" | Device Groups | Create group -> choose type -> select devices |
| "Video wall" | Video wall groups/playlists | Create video wall group -> configure grid -> publish video wall playlist |

## How to Create a Playlist

Use this answer when the user asks how to create a normal playlist or loop.

1. Open the target workspace.
2. Go to Playlists.
3. Select New Playlist.
4. Enter a name and optional description.
5. Choose whether it should loop and whether shuffle should be enabled.
6. Open the Playlist Editor.
7. Select Add Items.
8. Pick one or more content items, then add them.
9. Reorder items by dragging or using the move controls.
10. Set each item's duration in seconds if the default duration is not correct.
11. Choose transitions if needed.
12. Save the playlist.

### Playlist Details the Assistant Should Know

- A playlist is an ordered list of content items.
- Playlist items can have duration overrides.
- Playlist items can have transition effects such as none, fade, slide, or zoom.
- Playlist items can have playback conditions such as active time or days of week.
- A playlist can include another playlist, but nesting is guarded to prevent loops and excessive depth.
- Smart playlists can be populated by rules such as type, tags, folder, sorting, and item limits.
- If content orientation does not match the target screen, the editor can warn the user.

### Good Playlist Answer Template

```text
To create a playlist, open your workspace, go to Playlists, and choose New Playlist. Give it a name, then open the editor and use Add Items to pick the content you want. Arrange the items in order, set durations if needed, and save. After that you can publish the playlist directly to a device or use it inside a schedule.
```

## How to Create a Schedule

Use this answer when the user asks how to schedule content, create dayparting, make a weekly plan, or run a promotion at a specific time.

1. Open the target workspace.
2. Go to Schedules.
3. Select New Schedule.
4. Enter a name, optional description, schedule type, and timezone.
5. Open the Schedule Editor.
6. Add a slot.
7. Choose the content item, playlist, sync playlist, or sync group that should play.
8. Set the start time and end time.
9. Choose recurrence:
   - One-time for a specific date.
   - Weekly for selected days of the week.
   - If the UI exposes daily/monthly/bi-weekly options, use them for those repeat patterns.
10. Select the days or date for the slot.
11. Add a label and color if helpful.
12. Resolve overlap warnings by changing the time, date, days, or priority.
13. Save the schedule.
14. Publish the schedule to one or more devices from the device publish controls.

### Schedule Details the Assistant Should Know

- A schedule controls when content plays.
- A schedule contains slots.
- A slot can point to a playlist, content item, sync group, or sync playlist.
- Slots have start time, end time, recurrence, optional date/days, label, color, and priority.
- The backend supports `once`, `daily`, `weekly`, `bi-weekly`, and `monthly` recurrence. The current dashboard flow commonly uses one-time and weekly slots; daily behavior can be represented as weekly with all days selected.
- A schedule can have a default playlist or default content for times when no slot matches.
- Schedule type can be `general` or `override`.
- Higher-priority slots win when overlapping slots are allowed.
- Blackout dates can suppress scheduled playback on specific dates.
- Preview can answer what would be active at a given time.
- A schedule is not useful on a screen until it is published to that device.

### Good Schedule Answer Template

```text
To schedule content, create or open a schedule in your workspace, then add a slot. Pick the playlist or content item, set the start and end time, choose whether it repeats weekly or runs once, and save. Then publish that schedule to the device from the Devices page so the player knows to use it.
```

### Common Schedule Patterns

| Request | Recommended setup |
|---|---|
| "Play lunch menu every day from 11:30 to 2" | Weekly slot, all days selected, 11:30-14:00, lunch playlist |
| "Play breakfast on weekdays" | Weekly slot, Mon-Fri, breakfast playlist |
| "Show holiday promotion only on Dec 24" | One-time slot for Dec 24 or override schedule |
| "Play this if nothing else is scheduled" | Set schedule default playlist/content or device/workspace default playlist |
| "Two things overlap" | Raise the intended winner's priority or adjust times |

## How to Publish to a Device

Use this when the user asks how to put something on a screen.

1. Open the workspace.
2. Go to Devices.
3. Select the target device.
4. Choose the published target:
   - Content for a single content item.
   - Playlist for a simple loop.
   - Schedule for time-based playback.
   - Sync group for synchronized playback.
5. Save or publish.
6. If the device is online, it should pick up the update on its next refresh or after a force-refresh command.

Important rule: a device should have one primary published target at a time. Publishing a sync group clears normal content, playlist, and schedule targets for that device.

## How to Create a Sync Playlist

Use this when the user asks about synchronized playback or multiple screens playing the same content at the same time.

1. Open the target workspace.
2. Go to Playlists and select the Sync Playlists view, or open Sync Playlists directly if the workspace sidebar exposes it.
3. Select New Sync Playlist.
4. Name the sync playlist.
5. Open the sync playlist editor.
6. Select Add Content.
7. Choose the content items that should play in lockstep.
8. Set duration for each item.
9. Reorder the items if needed.
10. Save.

### Sync Playlist Details

- A sync playlist is not the same as a normal playlist.
- It is designed for lockstep playback across devices.
- It contains content items with `durationSeconds`.
- It does not use nested playlists or smart playlist rules.
- It can be assigned to a sync group.

## How to Create a Sync Group

Use this when the user asks how to create a group of screens that play together.

### Fastest Flow: Publish a Sync Playlist

1. Create and save a sync playlist.
2. From the Sync Playlist card, select Publish.
3. Choose the screens that should play together.
4. Confirm the publish action.
5. The system creates or reuses a sync group for that sync playlist and adds the selected devices.

### Device Group Flow

1. Open the workspace.
2. Go to Device Groups.
3. Select New Group.
4. Choose Sync as the group type.
5. Name the group.
6. Select member devices.
7. Configure leader/relay settings if shown:
   - LAN relay for local-network groups.
   - Cloud relay for cross-network or mixed-platform groups.
   - Pinned leader when a specific device should coordinate playback.
8. Save the group.
9. Assign or publish a sync playlist to the sync group.

### Sync Group Details the Assistant Should Know

- Sync groups belong to one workspace.
- Member devices must come from the same workspace.
- When devices are added to a sync group, the system points those devices at the sync group and clears other published targets.
- The system detects playback mode from member platforms:
  - All Samsung/Tizen devices use Samsung-native SyncPlay when supported.
  - Mixed platforms use the custom relay engine.
- Leader priority determines which device coordinates first.
- A pinned leader can force a chosen device to the front of the leader order.
- LAN relay uses the leader's local relay when possible.
- Cloud relay uses the central API relay.
- A manifest push sends peers, leader priority, relay URL, mode, and playlist details to online members.
- Force resync sends a reset command to online group members.

### Good Sync Group Answer Template

```text
For synchronized playback, create a Sync Playlist first, add the content that all screens should play, and save it. Then use Publish on that sync playlist, select the screens, and confirm. Nexari will create or reuse a sync group for those screens and point the devices at that group.
```

## Device Groups vs Sync Groups

Device groups are a broader dashboard concept. They can be sync, video wall, location, or tag groups.

Sync groups are the playback configuration used for lockstep playback. A sync-type device group can create or connect to a sync group behind the scenes.

When answering users, use this distinction:

- If the user wants organization or bulk management, say device group.
- If the user wants screens to play in lockstep, say sync group and sync playlist.

## Fallback Playback Logic

When no active schedule slot matches, the player falls back through configured defaults before showing the built-in idle screen.

Recommended explanation:

```text
If nothing is scheduled at that time, Nexari uses the configured fallback: first the device's default playlist, then the workspace default playlist, and finally the built-in idle screen if no default exists.
```

## Troubleshooting Answers

### Playlist is not showing on screen

Check these in order:

1. Is the device online?
2. Is the playlist published directly, or included in the active schedule?
3. If using a schedule, is the schedule published to the device?
4. Is the current time inside a schedule slot?
5. Is the schedule timezone correct?
6. Does another higher-priority slot override it?
7. Are the content items valid and not expired?
8. Has the device refreshed since the change?

### Schedule is not playing

Check these in order:

1. The schedule exists in the same workspace as the device.
2. The schedule is active or published as intended.
3. The schedule is assigned to the target device.
4. The slot date/day/time matches now.
5. The timezone matches the venue.
6. There is no blackout date for today.
7. The slot target exists and is not deleted.
8. The player has refreshed the device schedule.

### Sync group is not synchronized

Check these in order:

1. All intended screens are members of the same sync group.
2. All devices are online.
3. The sync group has a sync playlist assigned.
4. The sync playlist has saved content items and durations.
5. The group manifest was pushed or the publish action completed.
6. The leader device is online.
7. LAN relay devices are on the same reachable network, or cloud relay is selected.
8. Use force resync if the group is stuck in preparation or drift is visible.

## API Reference for AI Reasoning

The assistant does not need to expose API paths in normal user answers, but these paths describe the underlying behavior:

| Area | API behavior |
|---|---|
| Playlists | `GET/POST/PATCH/DELETE /playlists`, `PUT /playlists/:id/items`, reorder, clone |
| Schedules | `GET/POST/PATCH/DELETE /schedules`, `PUT /schedules/:id/slots`, preview, blackouts, import/export |
| Sync playlists | `GET/POST/PATCH/DELETE /sync-playlists`, `PUT /sync-playlists/:id/items` |
| Sync groups | `GET/POST/PATCH/DELETE /sync-groups`, add/remove members, manifest, priorities, state, force-resync |
| Device schedule fetch | Players fetch `GET /devices/device/schedule` |

## User-Facing Response Examples

### "How do I make a playlist?"

```text
Open your workspace and go to Playlists. Choose New Playlist, enter a name, then open the editor and use Add Items to pick your content. Arrange the order, set durations if needed, and save. After that you can publish it directly to a screen or add it to a schedule.
```

### "How do I schedule my lunch menu?"

```text
Create a Lunch Menu playlist first if you do not already have one. Then go to Schedules, create or open a schedule, and add a slot for 11:30 to 14:00. Set it to repeat weekly with the days you want, choose the Lunch Menu playlist, save, then publish that schedule to the target screens.
```

### "How do I sync three screens?"

```text
Create a Sync Playlist, add the content that should play on all three screens, and save it. Then select Publish on that sync playlist and choose the three screens. Nexari will create or reuse a sync group, add the devices, and publish the synchronized playback target to them.
```

### "Why is my scheduled content not playing?"

```text
First check that the schedule is published to the device. Then confirm the current time falls inside the slot, the schedule timezone is correct, and no higher-priority slot or blackout date is overriding it. If everything looks right, force-refresh the device so it fetches the latest schedule.
```

## Keep This Document Updated When These Change

- Dashboard navigation labels.
- Playlist editor capabilities.
- Schedule recurrence options exposed in the UI.
- Device publish target behavior.
- Sync group creation/publish flow.
- SyncPlay mode detection and relay behavior.
- AI assistant permissions and autonomous action guardrails.
