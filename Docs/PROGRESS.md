# OmniHub Signage — Build Progress Tracker

> Last updated: March 20, 2026 (portal mobile polish + docs status refresh)  
> Codebase: `apps/ds` (React frontend) + `apps/api` (Fastify backend) + `apps/tizen` (Samsung LFD player)

---

## Legend

| Symbol | Meaning |
|---|---|
| ✅ | Done & working |
| 🔄 | In progress / partially built |
| 🟡 | Stub / Coming Soon placeholder |
| ❌ | Not started |

---

## Recent Milestones

| Date | Milestone | Status | Notes |
|---|---|---|---|
| March 20, 2026 | Reseller onboarding provisions client dashboard owner | ✅ | First-time reseller portal setup can now optionally create an active client-facing dashboard org/workspace owned by the same invited reseller email/password, so resellers can operate their own dashboard immediately and invite clients later |
| March 20, 2026 | Portal mobile UX polish + guarded reseller deletion | ✅ | Platform Owner, reseller, and client shells now use foldable mobile drawers; portal analytics tables/cards were tightened for small screens; and resellers can be soft-deleted only when no active client organizations remain |
| March 20, 2026 | Portal analytics persistence + notification routing | ✅ | Platform Owner and reseller analytics now persist alert thresholds and routing preferences, sync threshold-based analytics alerts into a platform-admin notification inbox, and support saved workspace drilldown presets for repeat operational views |
| March 20, 2026 | Analytics exports + drilldowns + period comparison | ✅ | Platform Owner and reseller analytics now support CSV export, click-through navigation from top reseller / organization tables into detail pages, and previous-period comparison with quick 7/30/90-day presets |
| March 20, 2026 | Platform Owner + reseller analytics dashboards | ✅ | `/superadmin/analytics` and `/management/analytics` now render real dashboards backed by a shared role-scoped analytics payload with date filters, growth charts, proof-of-play trend, top reseller / top organization tables, recent organizations, storage totals, invite counts, and device/content/workspace rollups |
| March 20, 2026 | Management company white-labeling expanded | ✅ | Management companies now support branded login at `/m/:slug`, company sidebar theming, typography presets, login background art, direct logo/favicon/background uploads from the portal and first-time invite acceptance flow, platform-owner branding override tools, and branded management invite / client-onboarding email templates |
| March 20, 2026 | Smart Views migration applied + repo validation clean | ✅ | `pnpm db:migrate` applied the new Smart Views migration in the target environment; `TagsPage.tsx` `ColorPicker` JSX was repaired; `ZoneLayoutEditor.tsx` drag nullability fixed; fresh `@signage/ds`, `@signage/db`, and `@signage/api` typechecks all pass |
| March 20, 2026 | Notification Center | ✅ | `NotificationTray` component — bell icon with unread badge, dropdown tray polling `GET /notifications` every 30 s (15 s when open), mark-read/dismiss/mark-all-read mutations, 8 event-type icons, footer link to Settings notifications section; wired into AppLayout header |
| March 20, 2026 | Analytics / Proof of Play | ✅ | `GET /analytics/summary`, `/analytics/play-events`, `/analytics/export.csv` routes + `AnalyticsPage` at `/workspaces/:wsId/analytics`; date-range picker, 4 stat cards, plays-per-day bar chart, top-content table, paginated event log, CSV export with Bearer auth; Analytics nav link in sidebar |
| March 20, 2026 | Management Company layer | ✅ | Migration `0012_management_companies`; Drizzle schema; superadmin CRUD + invite routes; `ManagementCompaniesListPage`, `ManagementCompanyDetailPage`, `AcceptManagementCompanyInvitePage`; SuperAdminLayout scoped nav; OrgsListPage company picker |
| March 20, 2026 | Smart Views + responsive workspace shell | ✅ | Added `smart_views` migration/schema/API/UI; content, playlist, schedule, and device list pages can now save/apply workspace smart views; sidebar now collapses into a mobile drawer and list pages use responsive spacing/grids/toolbars |
| March 20, 2026 | Drizzle migration metadata reconciled | ✅ | `0008_snapshot.json` and `0009_snapshot.json` regenerated from schema via Drizzle Kit API; `_journal.json` extended through 0009; `telemetry.ts`, `workspaces.ts`, `content.ts`, `playlists.ts` aligned with already-applied SQL; `packages/db/tools/rebuild-migration-meta.mjs` helper added |
| March 20, 2026 | Smoke test harness promoted | ✅ | `tools/tmp-smoke-test.mjs` → `tools/smoke-test.mjs`; host, credentials, org slug configurable via env vars (`SMOKE_BASE_URL`, `SMOKE_SUPERADMIN_*`, `SMOKE_OWNER_*`, `SMOKE_ORG_SLUG`); `pnpm smoke:test` root script added |
| March 20, 2026 | Runtime validation pass | ✅ | Live smoke tests now pass for super admin impersonation, workspace search, bulk tagging, device replacement, multi-zone save/push, and content folder create/filter/move/delete |
| March 20, 2026 | Content folders migration `0009` applied | ✅ | Live DB now has `content_folders` + `content_items.folder_id`; validated by end-to-end folder flows |
| March 19, 2026 | Structured tag system cutover | ✅ | Legacy per-entity `tags` flow removed from API and frontend; entity tags now come from `tag_assignments` only |
| March 19, 2026 | Structured tag display + filtering | ✅ | Content, playlists, schedules, and devices now show assigned tag pills and support workspace-tag-based list filters |
| March 19, 2026 | Legacy tag schema removal | ✅ | Migration `0007_milky_sir_ram` applied — `tags` columns dropped from `devices`, `content_items`, `playlists`, `schedules`; Drizzle journal baselined |
| March 19, 2026 | `entityTags` runtime fix | ✅ | `getAssignedTagsForEntities` replaced raw `db.execute(sql\`...ANY()\`)` with Drizzle query builder `inArray` — fixes 500 errors on content, playlist, schedule list routes |
| March 19, 2026 | Playlist item Conditions fix | ✅ | `PUT /playlists/:id/items` was silently dropping `conditions`; now saved and round-tripped correctly |
| March 19, 2026 | Schedule slot conflict detection | ✅ | Within-schedule overlap detection added to slot dialog; amber warning shows conflicting slot names |

---

## Auth & Onboarding

| Feature | Status | Notes |
|---|---|---|
| Login page | ✅ | `/login` — email + password |
| Two-factor auth (TOTP) | ✅ | Setup, verify, disable, backup codes |
| Forgot / reset password | ✅ | Email-based reset flow |
| Accept invite page | ✅ | Org owner setup (org name, slug, workspace, timezone) + member setup |
| Super Admin login | ✅ | Separate `/superadmin/login` |
| Management company onboarding | ✅ | First MCA invite can configure company name, portal URL, billing email, logo, title, favicon, colors, font presets, and login background, including direct asset uploads before first login, and can optionally provision a same-email client dashboard owner + initial workspace during setup before redirecting to `/m/:slug` |

---

## Super Admin Portal (`/superadmin`)

| Feature | Status | Notes |
|---|---|---|
| Reseller management | ✅ | Create, suspend/unsuspend, branding override, invite admins, and guarded delete when the reseller has no active client organizations |
| Orgs list + search | ✅ | Create, suspend/unsuspend |
| Org detail page | ✅ | Members, pending invites, quota management |
| Invite org owner | ✅ | Sends email invite |
| Management company branding override | ✅ | Platform Owner can edit and upload company branding assets from the management company detail page |
| Storage quota management | ✅ | Set per-org GB cap, view usage bar |
| Platform analytics dashboard | ✅ | `/superadmin/analytics` — date-filtered cross-platform analytics for resellers, organizations, storage, devices, and proof-of-play activity |
| System health dashboard | ✅ | `/superadmin/system` — process memory, OS metrics, DB pool stats |
| Impersonate org | ✅ | Audit-logged; SA gets a scoped JWT; banner shown in UI |

---

## Org Dashboard (`/dashboard`)

| Feature | Status | Notes |
|---|---|---|
| Workspace selector | ✅ | |
| Device card (total / online / offline / error) | ✅ | Live stats |
| Content card (total / published per type) | ✅ | Per-type totals + published counts |
| Playlist card (total / published / draft) | ✅ | Published = playlists with at least 1 item |
| Schedule card (total / active / inactive) | ✅ | Summary endpoint now returns real schedule counts |
| Storage usage bar | ✅ | |


## Settings Page (`/settings`)

| Section | Status | Notes |
|---|---|---|
| General — profile display | ✅ | Name, email, role |
| General — theme switcher | ✅ | Dark / Light / Cyberpunk |
| Security — 2FA setup & management | ✅ | TOTP + backup codes |
| Organization — role display | ✅ | |
| Organization — members management | ✅ | Role reference, members list, invite, pending invites |
| Organization — plan & billing | 🟡 | Coming Soon |
| Workspace — name edit | ✅ | PATCH `/workspaces/:id` |
| Workspace — timezone picker | ✅ | 47 IANA zones, saved with name |
| Workspace — content approval workflow toggle | ✅ | Wired — auto-saves to workspace settings JSON; role description shown |
| Tags — tag registry | ✅ | Full tag registry, category toggles, usage icons, usage modal |
| Emergency Alert — activate / clear | ✅ | Scope selector, text message |
| Audit Log | ✅ | Live data with pagination + actor filter |
| API Keys | ✅ | Create / revoke / delete — raw key shown once on creation |
| Notifications — preference toggles | ✅ | Inbox (read/dismiss/mark-all-read) + per-event in-app & email prefs |

---

## Workspace — Devices

| Feature | Status | Notes |
|---|---|---|
| Device list (workspace dashboard) | ✅ | Grid, live status poll every 30s; tag filter bar |
| Pair device (one-time code) | ✅ | |
| Device detail page | ✅ | Full: hardware identity, network, telemetry, now playing, timers, NTP, firmware, logs, location |
| Screenshot history gallery | ✅ | Chronological list on detail page |
| Device status badges | ✅ | online / offline / error / unclaimed |
| DUID / serial / model / firmware display | ✅ | Hardware Identity card |
| Network info (IP, MAC, WiFi SSID + signal) | ✅ | Network card with connection-type badge + signal bars |
| Screen orientation + power state | ✅ | Badges + power-off, auto-power-on toggle |
| IR lock / button lock toggles | ✅ | Toggle → `set_ir_lock` / `set_button_lock` WS commands |
| NTP configuration panel | ✅ | Server + timezone inputs → `set_ntp` WS command |
| Timer schedule (7 ON + 7 OFF) | ✅ | Time inputs + Set/Clear → `set_on_timer` / `clear_on_timer` WS commands |
| Firmware update panel | ✅ | TV firmware + player OTA buttons |
| Telemetry (temp, CPU, storage) | ✅ | TempBadge (amber/red thresholds) + MiniBar graphs |
| Now playing / Up next | ✅ | Current content + next item + countdown from heartbeat |
| Remote log viewer | ✅ | "Request Log Dump" → `dump_logs` WS command |
| Auto-screenshot interval setting | ✅ | Number input → `screenshotIntervalMin` |
| Device location | ✅ | Lat/lng + location label + Google Maps link |
| Multi-zone layout editor | ✅ | 1920×1080 drag-resize canvas; per-zone playlist assignment; `set_zones` WS |
| Default playlist (device-level) | ✅ | Playlist picker in device Settings; fallback when no schedule slot active |
| Default playlist (workspace-level) | ✅ | Playlist picker in Workspace Settings → Player Defaults |
| Workspace logo for idle screen | ✅ | Logo URL in Workspace Settings → Player Defaults |
| Device replacement workflow | ✅ | Transfer settings + tag assignments to new device via replacement modal |
| Bulk device management / tagging | ✅ | Multi-select + bulk tag assign (same as content/playlist/schedule) |

---

## Workspace — Content

| Feature | Status | Notes |
|---|---|---|
| Content list (grid lg / sm / list) | ✅ | Type filter, workspace-tag filter, sort, pagination |
| Upload modal (device files / HTML5 ZIP / Web URL) | ✅ | Multi-file, drag & drop |
| Content detail panel (side drawer) | ✅ | Metadata, structured tags, validity dates, approval state |
| Thumbnail generation display | ✅ | AuthImg with token |
| Approval workflow (draft → review → approve/reject) | ✅ | Role-based: upload (admin/a-mgr/c-mgr), approve/reject (admin/a-mgr+); c-mgr uploads start as draft when enabled |
| Content duplicate / clone | ✅ | Duplicate via ⋮ menu — server-side copy, keeps same files |
| Content folders (hierarchy) | ✅ | Folder tree sidebar; `folders` table with parent_id; content items have optional folderId |
| Validity window warnings ("Expires soon") | ✅ | Expired / Expires-within-7-days Callout in InfoTab |
| Orientation flag display | ✅ | Shown in detail panel, warned in playlist editor |
| Bulk tagging | ✅ | Multi-select checkboxes + bulk tag assign on content, device, playlist, schedule list pages |

---

## Workspace — Playlists

| Feature | Status | Notes |
|---|---|---|
| Playlist list | ✅ | Clone, delete, edit, workspace-tag filter |
| Playlist editor (drag & drop items) | ✅ | dnd-kit, reorder, per-item duration |
| Transition effects | ✅ | none / fade / slide / zoom |
| Loop toggle | ✅ | |
| Nested playlists (1 level deep) | ✅ | Shown in editor |
| Browser preview modal | ✅ | Auto-advance with progress bar |
| Playlist duplicate / clone | ✅ | Deep clone on list page |
| Orientation mismatch warning | ✅ | Warns if portrait content in landscape playlist |
| Conditions (time-of-day override per item) | ✅ | UI and save wired end-to-end; `conditions` JSON persisted via `PUT /playlists/:id/items` |

---

## Workspace — Schedules

| Feature | Status | Notes |
|---|---|---|
| Schedule list + mini calendar | ✅ | Month view with color dots + workspace-tag filter |
| Schedule editor (week grid + list view) | ✅ | Drag slots, weekly/once recurrence |
| Slot CRUD (create / edit / delete) | ✅ | Playlist or direct content target |
| Schedule activate / deactivate | ✅ | |
| Schedule clone | ✅ | |
| Conflict detection | ✅ | Within-schedule overlap warning shown in slot dialog (amber banner); higher-priority slot noted |
| Schedule priority | ✅ | Priority number input in slot dialog; preserved on edit; sent in PUT /schedules/:id/slots |

---

## Samsung Tizen LFD Player (`apps/tizen`)

| Area | Status | Notes |
|---|---|---|
| Scaffold (`config.xml`, `index.html`, Vite) | ✅ | Partner certificate + privileges; `$WEBAPIS` injection |
| `store.ts` — WidgetData JWT/deviceId | ✅ | Encrypted; vite/client types |
| `device/` modules (identity, network, system, power, time) | ✅ | DUID, model, serial, firmware; MAC, IP, WiFi; orientation, locks, NTP, timers |
| `api/client.ts` | ✅ | Device-JWT authenticated fetch |
| `ws/manager.ts` — connect + exponential backoff | ✅ | 1s→2s→4s→8s→30s→60s; all WS command handlers in `ws/handlers.ts` |
| Boot state machine + pairing screen | ✅ | WidgetData read → pairing or proceed; hardware identity sent at pair request |
| Boot auto-config | ✅ | setAutoPowerOn/NTP/locks/SafetyLock applied after first pairing |
| `ui/idle.ts` — idle screen | ✅ | Clock, IP, WS dot, org logo; burn-in-safe; shown when no slot active |
| `ui/emergency.ts` | ✅ | Full-screen overlay z=100; XSS-safe; text + image + video |
| `ui/osd.ts` | ✅ | Brief OSD on INFO; long-press (3 s) → full debug overlay |
| `cache/manifest.ts` + sha256 integrity | ✅ | Verify before play; re-download on mismatch |
| `cache/downloader.ts` | ✅ | `tizen.download` queue; priority (now-playing first); `download_progress` WS |
| `cache/html5.ts` | ✅ | JSZip + XHR ArrayBuffer; mkdirp + writeTizenFile |
| `cache/logger.ts` | ✅ | Circular 500-entry buffer + `wgt-private/device.log`; flush on `dump_logs` |
| LRU cache eviction | ✅ | Evict when storage > 80% full |
| Scheduler (`slotMatcher`, `playlistRunner`, `zoneRunner`, `index`) | ✅ | 10 s tick; clockDrift; emergency gate; multi-zone dispatch |
| Fallback chain | ✅ | No slot → device default playlist → workspace default → idle |
| Heartbeat (30 s) + network snapshot (5 min) | ✅ | Full telemetry including temperature |
| Auto-screenshot on content change | ✅ | ~2 s delay, 1/10 s rate limit; interval fallback |
| Renderers (image, iframe, avplayer, document, transition) | ✅ | Double-buffer; seamless AVPlay ping-pong; Document API for PDF/PPT |
| OTA firmware + player update handlers | ✅ | `systemcontrol.updateFirmware()` + `tizen.application.install()` |
| Backend: Migration 0008 (18 device cols + heartbeat + play_events) | ✅ | Applied |
| Backend: `GET /device/schedule`, `/device/content/:id/file`, `/device/emergency` | ✅ | All device-JWT authenticated |
| Backend: All WS message types + command types | ✅ | Full bi-directional protocol |

---

## Analytics

| Feature | Status | Notes |
|---|---|---|
| Device analytics (uptime %, connectivity) | ✅ | `GET /analytics/summary` now returns `deviceUptime` and `connectivityEvents`; workspace Analytics page renders uptime and offline/online reporting |
| Content analytics (play count, duration played) | ✅ | `GET /analytics/summary` — `byContent` top-20 table + `byDay` breakdown; Tizen player populates `play_events` via WS `play_log` flush |
| Playlist analytics (completion rate) | ✅ | `play_events` now stores `playlist_id` / `schedule_id`; Analytics page shows playlist completion rates |
| Org-level report (storage, devices, schedules) | ✅ | `GET /analytics/summary` now returns `orgSummary` with storage, device, and schedule counts |
| Proof of Play — date-range report page | ✅ | `AnalyticsPage` at `/workspaces/:wsId/analytics`; stat cards, day chart, top-content breakdown, paginated event log |
| Proof of Play export (CSV) | ✅ | `GET /analytics/export.csv` — up to 50 k rows, Bearer-authenticated blob download |
| Proof of Play export (signed PDF) | ✅ | `GET /analytics/export.pdf` — signed PDF export with RSA-SHA256 signature block; requires `PROOF_OF_PLAY_SIGNING_PRIVATE_KEY` |
| Platform/Reseller analytics export (CSV) | ✅ | `/superadmin/analytics/export.csv` — role-scoped CSV export for Platform Owner and reseller dashboards |
| Platform/Reseller analytics drilldowns | ✅ | Top reseller and top/recent organization tables link directly into Platform Owner or reseller detail pages |
| Platform/Reseller period comparison | ✅ | Previous-period comparison with quick 7/30/90-day presets and per-metric delta badges |
| Platform/Reseller analytics charting + alerts | ✅ | Platform Owner and reseller analytics now use hoverable trend charts, threshold-based storage/device/play alerts, workspace-level rollups, and direct drilldowns into filtered workspace/device/content views via scoped org impersonation |
| Platform/Reseller alert tuning + saved presets | ✅ | Both portal analytics pages now persist alert thresholds, repeat cadence, and inbox routing, and can save named workspace drilldown presets for repeat monitoring flows |
| Platform/Reseller notifications page | ✅ | Platform Owner and reseller portals now expose full-page `/superadmin/notifications` and `/management/notifications` inbox screens backed by the same portal notification endpoints as the tray, with refresh, unread filtering, pagination, and read/dismiss controls |

---

## Notification Center

| Feature | Status | Notes |
|---|---|---|
| Bell icon in AppLayout nav | ✅ | `NotificationTray` mounted in AppLayout header |
| Unread count badge | ✅ | Badge capped at "99+"; count from `unreadCount` field in API response |
| Notification tray dropdown | ✅ | 10 most-recent notifications; outside-click close; type icons for all 8 event types |
| Read / unread state + "Mark all read" | ✅ | Click row → mark read; X → dismiss; "Mark all read" header button |
| WebSocket push delivery | ✅ | Browser clients connect to `/api/notifications/ws`; AppLayout invalidates notification queries on push |
| Device offline / online alerts | ✅ | Device WS connect/disconnect now writes `device_online` / `device_offline` notifications |
| Content processing failed alerts | ✅ | Thumbnail regeneration failure now marks content `error` and creates `content_failed` notification |
| Storage quota 80% / 100% alerts | ✅ | Upload flow now emits `storage_warning` notifications when thresholds are crossed |
| Emergency override alerts | ✅ | Emergency activation route now creates `emergency_activated` notifications |
| Platform-admin analytics inbox | ✅ | Platform Owner and reseller layouts now mount a dedicated analytics notification tray backed by `/superadmin/notifications` and `/management/notifications`, with mark-read, dismiss, and mark-all-read actions for persisted analytics alerts |

---

## Sensor Integration

| Feature | Status | Notes |
|---|---|---|
| Sensor list page (`/:wsId/sensors`) | ❌ | Not started |
| Add / edit sensor source | ❌ | Not started |
| Live readings display | ❌ | Not started |
| Trigger rule builder (condition → action) | ❌ | Not started |
| MQTT / webhook / cloud API inputs | ❌ | Backend only — no frontend UI |

---

## Tags & Discovery

| Feature | Status | Notes |
|---|---|---|
| Tags — tag registry (create / rename / delete / colour) | ✅ | Full CategoryCard UI, ColorPicker, inline tag add/rename/delete |
| Apply tags to content | ✅ | Uses `tag_assignments`; editor + read-only views show structured assigned tags |
| Apply tags to playlists | ✅ | Uses `tag_assignments`; editor and list views show structured assigned tags |
| Apply tags to schedules | ✅ | Uses `tag_assignments`; editor and list views show structured assigned tags |
| Apply tags to devices | ✅ | Device detail page uses structured tag assignment UI and dashboard shows assigned tags |
| Bulk tag application | ✅ | Multi-select checkboxes + bulk tag assign on content, device, playlist, schedule list pages |
| Global search (`Cmd+K`) | ✅ | Modal search across content, playlists, schedules, devices in current workspace |
| Smart Views (saved filters) | ✅ | `smart_views` table + API + reusable SmartViewsBar on content, playlist, schedule, and device list pages |

---

## Management Company Branding

| Feature | Status | Notes |
|---|---|---|
| Branded company login URL | ✅ | `/m/:slug` public login page with company branding payload from API |
| Sidebar company branding | ✅ | Company name, logo, custom sidebar background, theme colors, and font presets apply across the management portal |
| Self-service branding page | ✅ | MCA admins can edit title, logo, favicon, primary/accent/sidebar colors, heading/body fonts, and login background art |
| Managed branding asset uploads | ✅ | Logo, favicon, and login background can be uploaded directly during first-time invite acceptance, in the management portal, and from the PO company detail page |
| Branded invite/onboarding emails | ✅ | Management admin and client org owner invites inherit stored company logo/title/colors when available |
| Custom domains | ❌ | Not started |

---

## UI Polish / Cross-Cutting

| Feature | Status | Notes |
|---|---|---|
| CSS theme system (Dark / Light / Cyberpunk) | ✅ | CSS custom properties |
| Select dropdown backgrounds | ✅ | Fixed with `select.input` CSS rules |
| Mobile / responsive layout | ✅ | Client, Platform Owner, and reseller shells all use foldable mobile drawers; admin tables switch to mobile cards where needed; analytics and list pages now fit small screens more cleanly, including drawer safe-area padding polish |
| Empty states | ✅ | EmptyState component in UiPrimitives |
| Confirm dialogs | ✅ | ConfirmDialog component |
| Toast notifications | ✅ | Sonner |
| Loading skeletons | ✅ | Shared skeleton states now cover dashboards, analytics, notifications, invite acceptance flows, major list/detail views, and editor loading shells |

---

## Build Status

| Date | Status | Notes |
|---|---|---|
| March 20, 2026 | ✅ | Notification event triggers + browser WS push + analytics expansion shipped; `@signage/db` and `@signage/shared` rebuilt; fresh `@signage/api`, `@signage/ds`, and Tizen TS checks clean |
| March 20, 2026 | ✅ | Smart Views migration applied in target DB via `pnpm db:migrate`; fresh `@signage/ds`, `@signage/db`, and `@signage/api` TypeScript checks all clean after repairing `TagsPage.tsx` and `ZoneLayoutEditor.tsx` |
| March 20, 2026 | ✅ | Notification Center + Analytics shipped; Management Company layer; API + DS TypeScript 0 errors |
| March 20, 2026 | ✅ | Smart Views shipped end-to-end (`0011_smart_views.sql`, snapshots/journal rebuilt through 0011, Fastify `/smart-views` routes, reusable DS SmartViewsBar); responsive pass completed for AppLayout, content, playlist, schedule, and device pages; changed files validate clean via editor diagnostics |
| March 20, 2026 | ✅ | Drizzle metadata reconciled (0008+0009 snapshots + journal chain); DB schema aligned with live SQL (`telemetry.ts`, `workspaces.ts`, `content.ts`, `playlists.ts`); smoke harness promoted to `tools/smoke-test.mjs` with env-configurable target; `pnpm smoke:test` script added; DB package typecheck 0 errors |
| March 20, 2026 | ✅ | API + DS + Tizen TypeScript 0 errors; live smoke tests passing for impersonation, `Cmd/Ctrl+K` search, bulk tagging, device replacement, zone save/push, and content folder flows; duplicate `/devices/:id/replace` route removed |
| March 19, 2026 | ✅ | DB migration applied; API + DS build passing; `entityTags` runtime bug fixed; all three list routes return structured assigned tags |
| March 18, 2026 | ✅ 3.30s | After timezone picker added |

---

## Next Steps

### Remaining / future

| # | Area | Task |
|---|---|---|
| 1 | Billing | Organization billing / plan management UI and ownership workflows |
| 2 | VideoWall / SyncPlay | Multi-device sync groups; FFmpeg tile crop; `syncplay` module |
| 3 | Sensors | Frontend UI for sensor sources and trigger rules |
