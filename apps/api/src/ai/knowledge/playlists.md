# Playlists

A **playlist** is an ordered sequence of content items (images, videos, HTML pages, web URLs) that a digital sign plays back in a loop.

## Where to find playlists
Navigate to the **Workspace** sidebar → **Playlists**. URL: `/workspaces/:workspaceId/playlist`.

## Creating a playlist
1. Go to the Playlists page and click **+ New Playlist** (top right).
2. Enter a **name** (required) and optional **description**.
3. Choose **loop** (default: on) and **shuffle** (default: off).
4. Click **Create** — this opens the Playlist Editor.

## Adding content
In the Playlist Editor:
1. Click **+ Add Items** to open the content picker.
2. Select one or more content items, then click **Add**.
3. Drag items by their handle to reorder.
4. Click any item's **duration** to override how long it plays.
5. You can also nest other playlists (up to 3 levels deep).

## Smart playlists
Toggle **Smart Playlist** to auto-populate items based on rules:
- Filter by content type (image, video, html5, …)
- Filter by tags or folder
- Sort by newest, oldest, name, or random
- Cap maximum items

## Approval workflow
Playlists have an `approvalState`: `draft`, `pending_review`, `approved`, `rejected`.
- Owners, admins, and a-managers can approve playlists.
- Devices only play **approved** playlists.

## Tips
- Use **folders** to organise large libraries.
- Set a **workspace default playlist** so new devices have something to play immediately.
- Combine with a **schedule** to control *when* the playlist plays.
- For lockstep multi-screen playback, use a **Sync Playlist** instead of a normal playlist.
