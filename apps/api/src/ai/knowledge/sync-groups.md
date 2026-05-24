# Sync Groups

A **sync group** is a set of devices that play a sync playlist in lockstep. Use sync groups when the user wants multiple screens to start together and stay aligned.

## Where to find sync groups
Sync groups are managed through **Workspace sidebar → Device Groups**. URL: `/workspaces/:workspaceId/devices/groups`.

Legacy sync group URLs redirect to Device Groups. Sync playlists are managed from **Workspace sidebar → Playlists**.

## Creating synchronized playback
The easiest flow is:
1. Go to **Playlists**.
2. Create a **Sync Playlist**.
3. Open the sync playlist editor and click **Add Content**.
4. Add the content items that every screen should play.
5. Set each item's duration and save.
6. From the sync playlist card, click **Publish**.
7. Select the screens that should play together.
8. Confirm. The platform creates or reuses a sync group and publishes it to those devices.

## Creating a sync group from Device Groups
1. Go to **Device Groups**.
2. Click **New Group**.
3. Choose **Sync** as the group type.
4. Name the group.
5. Select the member screens.
6. Configure relay/leader settings if shown.
7. Save, then assign or publish a sync playlist to the group.

## Important rules
- Devices in a sync group must belong to the same workspace.
- A sync playlist is different from a normal playlist. It is made for lockstep playback.
- Publishing a sync group clears the device's normal published content, playlist, and schedule targets.
- All-Samsung/Tizen groups use native Samsung SyncPlay when supported.
- Mixed-platform groups use the custom relay engine.
- LAN relay is best for screens on the same local network.
- Cloud relay is useful when devices cannot reach the leader on the LAN.
- A pinned leader can force a chosen screen to coordinate playback first.

## Troubleshooting sync playback
Check these first:
1. All intended screens are in the same sync group.
2. All screens are online.
3. The sync group has a sync playlist assigned.
4. The sync playlist has saved content items and durations.
5. The leader screen is online.
6. LAN relay screens are on the same reachable network, or cloud relay is selected.
7. Use **force resync** if the group is stuck or visibly out of sync.

## Good answer
If a user asks how to sync screens, say:

"Create a Sync Playlist first, add the content all screens should play, and save it. Then use Publish on that sync playlist, select the screens, and confirm. Nexari will create or reuse a sync group for those screens and publish synchronized playback to them."
