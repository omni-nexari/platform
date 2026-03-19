# OmniHub Signage — Build Progress Tracker

> Last updated: March 20, 2026 (smart views + responsive pass)  
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

---

## Super Admin Portal (`/superadmin`)

| Feature | Status | Notes |
|---|---|---|
| Orgs list + search | ✅ | Create, suspend/unsuspend |
| Org detail page | ✅ | Members, pending invites, quota management |
| Invite org owner | ✅ | Sends email invite |
| Storage quota management | ✅ | Set per-org GB cap, view usage bar |
| Platform analytics dashboard | ❌ | Phase 2+ |
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
| Device analytics (uptime %, connectivity) | ❌ | Not started |
| Content analytics (play count, duration played) | ❌ | Not started |
| Playlist analytics (completion rate) | ❌ | Not started |
| Org-level report (storage, devices, schedules) | ❌ | Not started |
| Proof of Play export (signed CSV/PDF) | ❌ | Not started |

---

## Notification Center

| Feature | Status | Notes |
|---|---|---|
| Bell icon in AppLayout nav | ❌ | Not started |
| Unread count badge | ❌ | Not started |
| Notification tray dropdown | ❌ | Not started |
| Read / unread state + "Mark all read" | ❌ | Not started |
| WebSocket push delivery | ❌ | Not started |
| Device offline / online alerts | ❌ | Not started |
| Content processing failed alerts | ❌ | Not started |
| Storage quota 80% / 100% alerts | ❌ | Not started |
| Emergency override alerts | ❌ | Not started |

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

## UI Polish / Cross-Cutting

| Feature | Status | Notes |
|---|---|---|
| CSS theme system (Dark / Light / Cyberpunk) | ✅ | CSS custom properties |
| Select dropdown backgrounds | ✅ | Fixed with `select.input` CSS rules |
| Mobile / responsive layout | ✅ | App shell uses a mobile drawer; page headers, grids, calendar split view, and bulk toolbars now adapt to small screens |
| Empty states | ✅ | EmptyState component in UiPrimitives |
| Confirm dialogs | ✅ | ConfirmDialog component |
| Toast notifications | ✅ | Sonner |
| Loading skeletons | 🔄 | Some pages have pulse skeletons |

---

## Build Status

| Date | Status | Notes |
|---|---|---|
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
| 1 | Notifications | Bell icon + unread badge + tray dropdown; real-time WS push |
| 2 | Analytics | Proof of Play report page + signed CSV/PDF export (RSA-2048) |
| 3 | VideoWall / SyncPlay | Multi-device sync groups; FFmpeg tile crop; `syncplay` module |
| 4 | Sensors | Frontend UI for sensor sources and trigger rules |
| 5 | Super Admin | Platform analytics dashboard (Phase 2+) |
