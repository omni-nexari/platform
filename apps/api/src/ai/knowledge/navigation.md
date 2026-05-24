# Platform Overview & Navigation

**Omni Signage** is a multi-tenant digital signage management platform.

## Hierarchy
- **Organisation** — the top-level tenant (your company).
- **Workspace** — a team/site within the org (e.g. "London Office", "Restaurant – Downtown"). Most day-to-day work happens inside a workspace.
- **Users** belong to an org and are members of one or more workspaces with a role (viewer, editor, manager, admin, owner, prime_owner).

## Main areas inside a workspace
| Area | What it's for | URL |
|------|---------------|-----|
| Dashboard | Overview & quick stats | `/workspaces/:id/` |
| Content | Media library | `/workspaces/:id/content` |
| Playlists | Sequences of content | `/workspaces/:id/playlists` |
| Schedules | Time-based programming | `/workspaces/:id/schedules` |
| Devices | Registered displays | `/workspaces/:id/devices` |
| Device Groups | Bulk-manage displays | `/workspaces/:id/device-groups` |
| Sync Groups | Multi-screen frame sync | `/workspaces/:id/sync-groups` |
| Canvas | Visual layout builder | `/workspaces/:id/canvas` |
| Templates | Reusable canvas designs | `/workspaces/:id/templates` |
| Tags | Organise content | `/workspaces/:id/tags` |
| Analytics | Playback & device stats | `/workspaces/:id/analytics` |
| Settings | Workspace configuration | `/workspaces/:id/settings` |

## Typical workflow
1. **Upload content** to the library (Content page).
2. **Create a playlist** sequencing that content (Playlists page).
3. **Create a schedule** if you want time-based playback (Schedules page).
4. **Assign** the playlist and/or schedule to one or more **devices**.
5. The players receive updates automatically via the sync engine.

## Top bar
- **Workspace switcher** (left) — change between workspaces you belong to.
- **Search** (Cmd/Ctrl+K) — global search across content, playlists, schedules, devices.
- **Notifications** (bell icon) — device offline alerts, content failures, invites.
- **Emergency override** (siren icon, admins only) — interrupt all displays with an urgent message.
- **Profile menu** (top right) — settings, theme, logout.

## Roles & permissions
- **Viewer** — read-only.
- **Editor** — create/edit content, playlists, schedules.
- **Manager / Admin** — also approve content, manage devices.
- **Owner / Prime Owner** — full control including users and billing.

If you ever feel lost: the **breadcrumbs** at the top of every page show you exactly where you are.
