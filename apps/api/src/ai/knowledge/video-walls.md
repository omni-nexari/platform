# Video Walls

A **video wall** is a group of screens arranged as a physical grid. Nexari stores the wall as a **Video Wall** device group, then uses that group for full-wall content publishing or per-cell video wall playlists.

## Where to find video walls
Workspace sidebar -> **Device Groups**. URL: `/workspaces/:workspaceId/devices/groups`.

Video wall playlists are managed from **Playlists**. URL: `/workspaces/:workspaceId/playlist`.

## Create a video wall group
1. Go to **Device Groups**.
2. Click **New Group**.
3. Enter a group name, such as "Lobby Video Wall".
4. Choose **Video Wall** as the type.
5. Set **Grid Size**: columns across and rows high.
6. Continue and select the screens in the wall.
7. Choose sync settings: LAN for local-network screens, Cloud relay when central relay is needed.
8. Keep **Auto-select** leader unless a specific screen should coordinate playback.
9. Save the group.

## Configure the wall layout
1. Open the video wall group.
2. Click **Configure**.
3. In **Panel Layout**, assign each screen to the correct cell.
4. Use the L/P toggle if a panel is landscape or portrait.
5. Click **Save Layout**.
6. Optionally set **Bezel Compensation** in millimeters and click **Save Bezels**.
7. Optionally set **Sync Leader & Relay** and click **Save**.
8. Click **Push to Screens** to send the wall geometry and peer list to online players.

## Use the video wall feature
There are two main modes.

### One full-wall asset
Use this when one image or video should span the whole wall.
1. Go to **Content**.
2. Select the content item.
3. Click **Publish**.
4. Choose **Videowall** mode.
5. Select the video wall group.
6. Confirm **Publish to Videowall**.

Each panel receives the same content and renders its cropped region from the full wall.

### Different content per panel
Use this for menu walls, dashboards, or layouts where each panel has its own content.
1. Go to **Playlists**.
2. Create or open a **Video Wall** playlist.
3. Select the video wall group.
4. Click each cell and choose content for that panel.
5. Choose fit mode if needed: cover, contain, or fill.
6. Save.
7. Click **Publish to Wall**.

The current publish path assigns the first saved page's cell content to the matching member devices and refreshes online devices.

## Important rules
- A video wall group must have `videoWallCols` and `videoWallRows` set.
- Member screens should be assigned to their correct column and row.
- Save the layout before publishing.
- Use **Videowall** publish mode to crop one full-wall asset across panels.
- Use a **Video Wall playlist** to publish different content to each panel.
- **Single** publish mode to a video wall group plays the content full-screen on each member with P2P sync, not cropped wall mode.
- **Push to Screens** sends the geometry manifest; publishing content also pushes geometry for video wall mode.

## Troubleshooting
Check these first:
1. The group type is Video Wall.
2. Grid columns and rows match the physical wall.
3. Every screen is assigned to the correct cell.
4. The layout was saved.
5. Push to Screens was used after layout changes.
6. The content was published in the correct mode: Videowall for crop mode, Video Wall playlist for per-cell content.
7. Online devices received refresh commands; offline devices update after reconnect.

## Good answer
"Create the wall from Device Groups by choosing New Group, setting the type to Video Wall, choosing the grid size, and adding the screens. Then open Configure and assign each screen to the right grid cell. After saving the layout, publish one content item in Videowall mode to crop it across the wall, or create a Video Wall playlist from Playlists to assign different content to each cell."
