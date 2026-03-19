# Digital Signage Platform — Project Plan

> **Codename**: OmniHub Signage  
> **Target Host**: Raspberry Pi 5 · Ubuntu · 16 GB RAM · NVMe · Nginx · systemd  
> **Date**: March 2026

---

## Table of Contents

1. [Product Overview](#1-product-overview)
2. [User & Organization Model](#2-user--organization-model)
3. [Core Modules](#3-core-modules) *(incl. 3.7 Tagging & Discovery · 3.8 Emergency Override · 3.9 Audit Log · 3.10 Proof of Play · 3.11 Sensor Integration · 3.12 Notifications · 3.13 API Keys · 3.14 Approval Workflow)*
4. [System Architecture](#4-system-architecture)
5. [Tech Stack](#5-tech-stack)
6. [Monorepo Structure](#6-monorepo-structure)
7. [Database Schema](#7-database-schema) *(incl. 7.9 Tags, Folders & Discovery · 7.10 Audit Log, Emergency Alerts & Quotas · 7.11 Sensors & Trigger Rules)*
8. [API Design](#8-api-design)
9. [Frontend — Web Dashboard](#9-frontend--web-dashboard)
10. [Samsung Tizen Player App](#10-samsung-tizen-player-app)
11. [Content Pipeline](#11-content-pipeline)
12. [Scheduling Engine](#12-scheduling-engine)
13. [Theme System](#13-theme-system)
14. [Infrastructure & Deployment](#14-infrastructure--deployment)
15. [Development Phases](#15-development-phases)

---

## 1. Product Overview

A **multi-tenant digital signage SaaS platform** where organizations manage fleets of Samsung commercial displays, compose playlists from rich media content, and schedule those playlists to run on specific devices at specific times.

### Roles at a glance

| Role | Scope | Capabilities |
|---|---|---|
| **Super Admin** | Platform-wide | Manage orgs, invite org owners, view global analytics, billing |
| **Org Owner** | Organization | Invite & manage users, manage all workspaces/devices, billing |
| **Org Admin** | Organization | Manage workspaces, devices, content; cannot change billing |
| **Workspace Admin** | Workspace | Full CRUD on content, playlists, schedules, devices in workspace |
| **Workspace Editor** | Workspace | Create/edit content, playlists, schedules; cannot delete |
| **Workspace Viewer** | Workspace | Read-only access, view analytics |

---

## 2. User & Organization Model

```
Platform
└── Organizations  (tenants)
    ├── Users          (invited per org, have an org-level role)
    └── Workspaces     (logical grouping inside an org)
        ├── WorkspaceMembers  (user ↔ workspace role mapping)
        ├── Devices
        ├── ContentItems
        ├── Playlists
        └── Schedules
```

### Key rules

- An **organization** is a paying tenant. All data is isolated per `org_id`.
- A **workspace** is a project/brand/location group — e.g. "Dubai Mall", "Head Office".
- A user can belong to **multiple workspaces** with different roles in each.
- **Invitation flow**: Super Admin invites Org Owner → Org Owner/Admin invites org members → each member can then be assigned to one or more workspaces.
- A device belongs to **one workspace** at a time but can be reassigned.

---

## 3. Core Modules

### 3.1 Device Management

- **Register**: Device reads its hardware DUID from the Samsung ProductInfo API and sends it with `modelName`, `modelCode` during pairing. Server issues a long-lived device JWT stored securely in the WidgetData encrypted store on the device. Dashboard user claims the device via a 6-character one-time code displayed on screen.
- **DUID-based identity**: `webapis.productinfo.getDuid()` is the canonical hardware identity. Re-pairing the same physical device reuses the existing device record (DUID dedupe on the server).
- **Status Monitoring**: Online/offline, last seen, firmware/player version, serial number, screen resolution, screen orientation, uptime, IP address, MAC address, Wi-Fi SSID & signal strength, NTP config, power state, CPU load, storage free, temperature.
- **Remote Commands**: Reboot, clear cache, force-refresh schedule, screenshot, power off/on, set NTP server, set IR lock, set button lock, set on/off timers (Tizen Timer API), firmware OTA update, dump remote logs.
- **Screenshot**: Device captures via `webapis.systemcontrol.captureScreen()`, reads the resulting JPEG from the filesystem, and streams it base64-encoded over the WebSocket. Server stores to `device_screenshots` table.
- **Screenshot history**: Stored and viewable in a chronological gallery on the device detail page.
- **Auto-screenshot on content change**: The Tizen player automatically captures a screenshot every time the active content item transitions (new item starts rendering). The capture fires ~2 s after transition to ensure the frame is fully rendered. This gives a passive visual proof-of-display record for every content play without any server intervention. Additionally, a `screenshotIntervalMin` setting (0 = disabled) provides a time-based fallback cap — e.g. set to 60 to guarantee at minimum one screenshot per hour even during long-running content. Screenshots are rate-limited to at most 1 per 10 s to prevent bursts during rapid playlist cycling.
- **Boot auto-config**: On first boot after pairing, the Tizen player automatically applies the recommended LFD settings via Partner-privilege Samsung APIs: `setAutoPowerOn('ON')`, `setMessageDisplay('OFF')`, `setIRLock('ON')`, `setButtonLock('ON')`, `setNTP(...)`, `setSafetyLock('OFF')`.
- **Power schedule**: On/off timers enforced locally using the Samsung Timer API (`webapis.timer.setOnTimer` / `setOffTimer`). Up to 7 on-timers and 7 off-timers, configurable from the dashboard.
- **Remote log streaming**: A `dump_logs` WS command triggers the device to flush its last 500 console log entries as a `device_log` WS message. Invaluable for diagnosing field issues without physical access. Logs are also auto-flushed on WS reconnect if the error buffer is non-empty.
- **Device map view**: Devices store optional `latitude` + `longitude` set during pairing (browser geolocation) or manually on the detail page. Dashboard shows all devices on an interactive map — useful for multi-site clients with 50+ displays.
- **Multi-zone layout**: A device can be configured with 2–4 named screen zones, each assigned its own playlist and a display rect (`x, y, w, h`). Each zone runs an independent `ZoneRunner` (playlist + scheduler). All content renderers accept a display rect so AVPlay and Document API layers render into the correct screen region.
- **Device replacement**: When a physical display is swapped, a "Replace device" action copies all settings, tags, and active schedule assignments from the old device record to a newly paired device. The old record is soft-deleted.
- **Groups**: Devices can be tagged and bulk-managed.
- **Video walls (future)**: Devices can be assigned to a Sync Group where all members play the same pre-downloaded content in hardware-synchronized lockstep via `webapis.syncplay`.
- **Idle / fallback content**: When no schedule slot is active the player walks a fallback chain before showing the built-in idle screen: device default playlist → workspace default playlist → built-in idle screen. Both defaults are configurable from the dashboard. The built-in idle screen is bundled inside the `.wgt` and requires no network or storage.
- **Signed Proof-of-Play export**: The `play_events` table can be exported as a date-range CSV or PDF, signed with an org-scoped RSA private key stored in the server's secrets vault. Recipients can verify authenticity independently — essential for advertising clients.
- **Platform**: Samsung LFD commercial displays running **Tizen 6.5+** with the Tizen web player app (see §10).

### 3.2 Content Management

| Type | Accepted Formats | Server Output | Notes |
|---|---|---|---|
| Image | JPEG, PNG, GIF, WebP, SVG, HEIC, BMP | WebP (lossy 85%) + JPEG thumbnail | HEIC converted server-side; GIF animated preserved |
| Video | MP4, MOV, AVI, MKV, WebM, TS | H.264 High Profile MP4 + AAC-LC (primary); H.265 MP4 (optional variant for 4K) | Played via `webapis.avplaystore` (hardware decoder); `-movflags +faststart` |
| HTML5 | ZIP package | Stored as-is | `index.html` required at root; extracted to `wgt-private/html5/<id>/` on device via JSZip; Playwright thumbnail |
| Presentation | PPTX, PPT | Stored as-is | Played natively on device via `webapis.document` (Partner privilege) — no server-side rasterisation needed |
| PDF | PDF | Stored as-is | Played natively on device via `webapis.document` (Partner privilege) — no server-side rasterisation needed |

- **Storage**: NVMe local storage at `/var/signage/uploads/` with per-org folder isolation.
- **CDN / delivery**: Nginx serves media files directly; Tizen player caches locally for offline resilience.
- **Thumbnail generation**: Auto-generated for all types at upload time (Sharp for images, FFmpeg for video, LibreOffice for PPTX/PDF).
- **Metadata**: Duration (auto-detected for video; configurable for images/HTML5), file size, dimensions, upload date, tags.
- **Validity window**: Each content item has optional `valid_from` and `valid_until` timestamps. The scheduling engine and Tizen player suppress content outside its validity window automatically. The content library shows an "⏱ Expires soon" warning within 7 days of `valid_until`.
- **Orientation flag**: Each content item has an `orientation` field (`landscape` | `portrait` | `any`). The playlist editor warns if a portrait item is added to a playlist assigned to a landscape device.
- **Clone / Duplicate**: Any content item can be duplicated — creates a new record pointing to the same processed files (no re-upload), with " (copy)" appended to the name.
- **Approval workflow** (optional, configurable per workspace): when enabled, newly uploaded content starts in `draft` state. An Editor submits it for review; a Workspace Admin approves or rejects it. Only `approved` content can be added to a playlist. Approval state machine: `draft → pending_review → approved | rejected → draft`.

### 3.3 Playlist Management

- A **playlist** is an ordered list of content items.
- Each item has a **display duration** (overridable per item), **transition effect**, and optional **conditions** (e.g. time-of-day override).
- Playlists can be set to **loop** or play once.
- **Preview**: Browser-based playlist preview without needing a physical device.
- **Nested playlists**: A playlist can include another playlist as a sub-item (max 1 level deep to avoid circular refs).
- **Clone / Duplicate**: Copy a playlist (deep clone — new playlist record + new playlist_items rows, same content references).

### 3.4 Schedule Management

- A **schedule** maps a playlist → a device (or device group) → a time rule.
- **Rule types**:
  - `always` — runs this playlist by default (lowest priority).
  - `time_window` — runs between `start_at` and `end_at` timestamps.
  - `recurring` — cron-style rule (e.g. "every weekday 09:00–17:00").
  - `event` — triggered manually or via webhook.
- **Priority**: Higher-priority schedules override lower ones; ties resolved by most-recently-created.
- **Conflict detection**: UI warns when two active schedules overlap on the same device.
- **Clone / Duplicate**: Copy a schedule with all its fields pre-filled; cloned schedule is inactive by default.
- The **Scheduling Engine** computes a resolved "what plays now and next" manifest per device (see §12).

### 3.5 Super Admin Portal

- Separate UI at `/superadmin`.
- Create / suspend / delete organizations.
- Invite org owners by email.
- View platform-wide analytics: total devices online, content storage usage, active orgs.
- Impersonate any org for support (audit-logged).
- System health dashboard (CPU, RAM, disk, active WS connections).
- **Storage quota management**: set per-org storage cap (GB). API enforces the cap on every upload; returns `507 Insufficient Storage` when exceeded. Dashboard shows a usage bar per org.

### 3.6 Analytics

- **Device analytics**: uptime %, connectivity events, screenshot log.
- **Content analytics**: play-count per content item, total duration played.
- **Playlist analytics**: completion rate, skip events (when schedule switches mid-playlist).
- **Org-level report**: storage quota used, device count, active schedule count.
- Data stored in `analytics_events` table; aggregated nightly by a worker job.

### 3.7 Tagging & Discovery

With thousands of content items, playlists, schedules, and devices, structured navigation is critical. The platform uses a **unified tag + folder system** across all four entity types.

#### Tags

- **Workspace-scoped tag registry** — each tag has a name, a hex colour, and optional description. Managed centrally at `/:wsSlug/tags`.
- **Applied to**: Content, Playlists, Schedules, and Devices — any entity can carry multiple tags.
- **Tag-based schedule targeting** (§3.4) reuses the same `tags` field on devices: a schedule targeted at tag `"floor-2"` automatically applies to all devices carrying that tag.
- **Autocomplete** on tag input: suggests existing workspace tags as the user types.
- **Bulk tagging**: select multiple items in any list view → "Apply Tags" in the bulk action bar.
- **Deleting a tag**: removes it from all entities workspace-wide in one DB update (`UPDATE … SET tags = array_remove(tags, $1)`).

#### Folders (Content library only)

- Hierarchical folder tree for content items; max 5 levels deep.
- A content item belongs to exactly one folder (or the implicit root).
- Moving items between folders never breaks playlist/schedule references — folder is purely organizational.
- Folder path is shown as a breadcrumb in the content library header.
- Deleting a folder moves its contents to the parent folder (no orphans).

#### Smart Views (Saved Filters)

- Any active filter combination (tags, type, status, uploader, date range, usage) can be saved as a named **Smart View** by clicking "Save view".
- Smart Views appear in the left sidebar under each section (Content, Playlists, Schedules) as personal quick-access shortcuts.
- Scoped per user per workspace — not shared (avoiding clutter for other team members).

#### Filter dimensions across all list views

| Dimension | Applies to | Values |
|---|---|---|
| **Tags** (AND match) | Content, Playlists, Schedules, Devices | Multi-select from tag registry |
| **Tags** (OR match) | Content, Playlists, Schedules, Devices | "Any of" toggle on tag selector |
| **Type** | Content | image / video / html5 / presentation / pdf |
| **Status** | Content | processing / ready / error |
| **Status** | Schedules | active / upcoming / expired / disabled |
| **Status** | Devices | online / offline / error / unclaimed |
| **Folder** | Content | Folder tree picker; optional recursive |
| **Uploaded / Created by** | Content, Playlists, Schedules | User picker |
| **Date range** | All | Created / modified between two dates |
| **Usage — orphan** | Content | Not used in any active playlist |
| **Usage — orphan** | Playlists | Not referenced by any active schedule |
| **Duration** | Content | < 30 s / 30 s – 5 min / > 5 min |
| **File size** | Content | < 50 MB / 50 – 500 MB / > 500 MB |
| **Orientation** | Devices | landscape / portrait |
| **Sort** | All | Name / Created / Modified / Size / Duration / Play count (asc / desc) |

#### Global search (`Cmd / Ctrl + K`)

- Single search bar queries content, playlists, schedules, and devices **simultaneously** within the current workspace.
- Backed by **PostgreSQL `pg_trgm`** trigram index on `name` + `description` — supports partial-word and fuzzy matches.
- Returns grouped results (e.g. "3 content items · 1 playlist · 2 devices") with keyboard navigation.

#### Pinned / Starred items

- Any item can be starred by a user; starred items appear in a **"Starred"** section in the sidebar.
- Stored in `user_pins` table (indexed by `user_id + entity_type + entity_id`).

#### Recently viewed

- Last 20 items a user viewed or edited per entity type, stored in Redis as a sorted set (`user:{id}:recent:{entity}`, scored by timestamp).
- Surfaced in a **"Recent"** section in the sidebar and inside pickers (e.g. the playlist content picker).

### 3.8 Emergency Override

A broadcast alert mechanism that instantly interrupts all running playlists on selected devices and displays an urgent full-screen message.

- **Trigger**: any Workspace Admin or Org Admin can activate an emergency override from the dashboard header (prominent red button) or via the API / webhook.
- **Targets**: entire organization, specific workspace, tag group, or individual device.
- **Content**: plain text message (rendered full-screen on device) or a pre-uploaded content item (image / HTML5).
- **Duration**: runs until manually cleared, or until an optional `auto_clear_at` timestamp.
- **Priority**: emergency override is priority `99` — always wins over every other schedule. Stored in `emergency_overrides` table.
- **Player behaviour**: Tizen receives a `EMERGENCY_START` WS command with payload; displays the alert content immediately, suppresses normal scheduler loop until `EMERGENCY_CLEAR` is received.
- **Audit**: every activation and clearance is written to the audit log with the acting user.
- **UI**: active overrides show a persistent red banner in the dashboard indicating which devices are currently in override mode.

### 3.9 Audit Log

Immutable append-only record of all significant actions in the platform. Required for compliance, debugging, and impersonation transparency.

**Recorded events** (non-exhaustive):

| Category | Events |
|---|---|
| Auth | Login, logout, failed login, password reset, invite sent/accepted |
| Users | Role changed, user suspended, user deleted, user impersonated |
| Devices | Paired, renamed, command sent (reboot/screenshot/etc.), unpaired, workspace reassigned |
| Content | Uploaded, renamed, deleted, validity dates set |
| Playlists | Created, edited (items changed), cloned, deleted |
| Schedules | Created, activated, deactivated, cloned, deleted |
| Emergency | Override activated, override cleared |
| Quotas | Quota limit reached (blocked upload), quota changed by super admin |

- Log entries are **never deleted** — no `deleted_at`; archive to cold storage after 2 years.
- Viewable by Org Owner/Admin at `/:wsSlug/audit` (filtered to their org); Super Admin sees all.
- API returns paginated log with filters: actor, entity type, entity ID, date range, action type.

### 3.10 Proof of Play

A tamper-evident, per-item play log providing evidence that specific content was displayed on a specific device at a specific time. Distinct from general analytics counts.

- **Source**: Tizen player emits a `proof_of_play` event for every content item it starts displaying, including: `device_id`, `content_id`, `playlist_id`, `schedule_id`, `played_at` (device clock), `server_received_at`.
- **Stored** in a dedicated `proof_of_play` table (separate from `analytics_events`, never aggregated/mutated).
- **Export**: Org Admin can export a signed CSV/PDF report for any date range filtered by device or content item. Useful for ad-display verification, retail compliance, and SLA reporting.
- **Signature**: each export batch is HMAC-SHA256 signed with a server key so the exported file can be independently verified.

### 3.11 Sensor Integration

Allows physical or external data sources to dynamically change what content is displayed on screens in real time, without manual intervention.

#### Sensor input methods

| Method | Description |
|---|---|
| **ESP32 gateway** | An ESP32 microcontroller reads attached sensors (I²C, SPI, GPIO, analog) and POSTs readings to the API via HTTP or publishes to the MQTT broker over Wi-Fi |
| **Manufacturer cloud API** | Third-party sensors with their own cloud APIs (e.g. SwitchBot, AWS IoT, weather services, people-counting cameras). A worker polls these on a configurable interval |
| **Webhook / push** | Any external system can `POST /sensors/:sensor_id/reading` with a bearer token — useful for BMS, POS systems, queue management software |

#### Sensor types (planned support)

| Category | Examples |
|---|---|
| Environmental | Temperature, humidity, CO₂ / air quality (SCD40, BME688), ambient light level (BH1750) |
| Presence & motion | PIR motion (HC-SR501), ultrasonic distance (HC-SR04), mmWave radar (LD2410) |
| People counting | IR beam counter, overhead camera count API (Xovis, RetailNext) |
| External data | Weather API (OpenWeatherMap), sports scores API, stock/commodity prices |
| Retail / venue | Queue length webhook, POS transaction event, occupancy capacity |
| Generic numeric | Any custom numeric or boolean reading via the generic webhook endpoint |

#### Trigger rules (rule engine)

Each sensor can have one or more **trigger rules** — condition → action mappings evaluated on every new reading.

| Field | Description |
|---|---|
| `condition_operator` | `>`, `<`, `>=`, `<=`, `==`, `!=`, `between` |
| `condition_value` | Threshold (or `[min, max]` for `between`) |
| `cooldown_seconds` | Minimum time between consecutive firings of the same rule |
| `action_type` | `switch_playlist`, `switch_content`, `send_notification`, `webhook_out` |
| `action_target_id` | Playlist ID, content item ID, or notification channel |
| `device_scope` | `all` (workspace), specific `device_id`, or `device_tag` |

**Multiple conditions**: rules support AND/OR logic via a `conditions` JSONB array, not just a single threshold. Example: trigger only if `temperature > 30 AND hour_of_day >= 10`.

#### Data flow

```
ESP32 / Cloud API / Webhook
       │
       ▼
 MQTT broker (:1883) ─────────────────────┐
       │                                   │
       ▼                                   ▼
 Sensor Worker (BullMQ)        API route  POST /sensors/:id/reading
       │
       ▼
 Persist reading → sensor_readings table
       │
       ▼
 Evaluate trigger rules
       │
  Rule fires?──YES──► Push WS command to matched devices
       │                  { cmd: "SWITCH_PLAYLIST", playlist_id: "..." }
      NO
       │
  Discard / log only
```

- **MQTT topic convention**: `signage/{org_id}/sensors/{sensor_id}` — wildcard subscription `signage/+/sensors/+` processes all orgs in a single worker.
- **Auth**: ESP32 devices authenticate to MQTT with a per-device username/password (stored hashed in `sensor_sources`). Webhook endpoint uses a workspace-scoped API key.
- **Reading retention**: raw readings stored for 30 days; aggregated hourly/daily stats stored indefinitely for analytics dashboards.
- **UI**: Sensor Management page at `/:wsSlug/sensors` — list sensors, view live readings, create/edit trigger rules with a visual rule builder.

### 3.12 In-App Notification Center

A persistent notification tray (bell icon in the nav bar) delivers real-time and historical alerts inside the dashboard, complementing email.

**Event types**:

| Event | Who sees it |
|---|---|
| Device went offline (after configurable threshold) | Workspace Admins |
| Device came back online | Workspace Admins |
| Content processing failed | Uploader |
| Storage quota reached 80% / 100% | Org Admin, uploader |
| Content validity expiring in 7 days | Workspace Admins |
| Emergency override activated / cleared | All workspace members |
| Sensor rule fired | Workspace Admins |
| Scheduled report ready for download | Requester |
| Invitation accepted | Inviter |

- **Delivery**: pushed via WebSocket to all open dashboard sessions; persisted in `notifications` table for users who are offline.
- **Tray UI**: unread count badge on bell icon; dropdown list with read/unread state; "Mark all read".
- **Device offline threshold**: configurable per device in `devices.settings` as `offline_alert_after_minutes` (default 5). Prevents noise from brief network blips.

### 3.13 API Key Management

Workspace-scoped API keys allow external systems (sensor webhooks, BMS, POS, third-party tools) to authenticate to the platform without user credentials.

- **Scopes**: `sensor:write` (ingest readings), `analytics:read`, `schedules:read`, `emergency:write`.
- **Lifecycle**: create (named key + selected scopes), view (one-time reveal of raw key at creation), rotate (invalidate old, issue new), revoke.
- **Auth**: Bearer token in `Authorization` header; keys stored as `sha256(key)` in `api_keys` table.
- **Rate limiting**: per-key rate limit configurable at creation (default 1 000 req/min).
- **Audit**: all API key creation, rotation, and revocation events are written to the audit log.
- **UI**: `/:wsSlug/settings/api-keys` — table of keys with name, scopes, last-used, created-by.

### 3.14 Content Approval Workflow

Optional, toggled per workspace in workspace settings.

| State | Meaning |
|---|---|
| `draft` | Newly uploaded or re-submitted after rejection; not usable in playlists |
| `pending_review` | Submitted by Editor; awaiting Workspace Admin review |
| `approved` | Cleared for use in playlists and schedules |
| `rejected` | Returned with feedback; editor can revise and re-submit |

- When disabled (default), all content goes straight to `approved` state upon processing completion.
- Playlist editor hides non-approved content from the content picker when workflow is enabled.
- Reviewer can leave a rejection reason (stored as `review_note` on `content_items`).
- Approval/rejection events are written to the audit log.

---

## 4. System Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                    Raspberry Pi 5 · Ubuntu                       │
│                                                                  │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │                    Nginx (port 80/443)                   │    │
│  │  / → Web Dashboard     /api → API Server                │    │
│  │  /superadmin → SA UI   /ws  → WebSocket Server          │    │
│  │  /uploads   → Static files (media)                      │    │
│  └──────────────────────────┬──────────────────────────────┘    │
│                             │                                    │
│    ┌────────────┐  ┌────────┴──────┐  ┌───────────────────┐    │
│    │  API       │  │  WS Server    │  │  Worker Process   │    │
│    │  :3000     │  │  :3001        │  │  (BullMQ)         │    │
│    │  Fastify   │  │               │  │  - media process  │    │
│    │  REST/JWT  │  │  Device ↔ Hub │  │  - schedule sync  │    │
│    └─────┬──────┘  └────────┬──────┘  │  - analytics roll │    │
│                                        │  - sensor eval    │    │
│          │                  │         └───────────────────┘    │
│    ┌─────┴──────────────────┴──────────────────┐               │
│    │              PostgreSQL :5432              │               │
│    └────────────────────────────────────────────┘               │
│    ┌───────────────────┐   ┌────────────────────┐              │
│    │  Redis :6379      │   │  /var/signage/      │              │
│    │  sessions, queues │   │  uploads/ (NVMe)    │              │
│    └───────────────────┘   └────────────────────┘              │
│    ┌───────────────────┐                                        │
│    │  Mosquitto :1883  │  ← ESP32 sensors publish here         │
│    │  (MQTT broker)    │                                        │
│    └───────────────────┘                                        │
└─────────────────────────────────────────────────────────────────┘
       ▲                      ▲                  ▲
       │ HTTPS + WSS          │ HTTPS + WS       │ MQTT / HTTP
  Web Browsers         Samsung Tizen Apps    ESP32 Gateways
  (Org Dashboard,      (Player on           (Sensor nodes
   Super Admin UI)      commercial TV)       on local LAN)
```

### Communication flows

| Flow | Protocol | Notes |
|---|---|---|
| Browser → API | HTTPS REST | JWT Bearer token in `Authorization` header |
| Browser → WS | WSS | For real-time device status updates in dashboard |
| Tizen → API | HTTPS REST | Device JWT (separate from user tokens) |
| Tizen → WS | WSS | Persistent connection; receives `PLAY`, `RELOAD`, `REBOOT`, `SWITCH_PLAYLIST` commands |
| Worker → DB | Internal | Direct Postgres connection |
| Worker → Redis | Internal | BullMQ job queue |
| ESP32 → MQTT | MQTT 3.1.1 | Publishes sensor readings; authenticated per device |
| Cloud Sensor API → Worker | HTTPS polling | BullMQ repeatable job polls manufacturer APIs |
| External system → API | HTTPS REST | Webhook push to `POST /sensors/:id/reading` with API key |

---

## 5. Tech Stack

### Backend — API & Worker

| Concern | Choice | Reason |
|---|---|---|
| Runtime | **Node.js 22 LTS** | Proven ecosystem, great WS support, runs well on Pi 5 |
| Framework | **Fastify 5** | 2× faster than Express, built-in TypeScript, schema validation |
| ORM / DB toolkit | **Drizzle ORM** | Type-safe SQL, lightweight, no magic, migrations via `drizzle-kit` |
| Database | **PostgreSQL 14** | Multi-tenant JSONB, row-level queries, reliable |
| Cache / Queue | **Redis 7 + BullMQ** | Session storage, job queues for media processing & scheduling |
| Auth | **JWT (access + refresh)** | `@fastify/jwt`; refresh tokens stored in Redis with rotation |
| WebSockets | **`ws` library** | Thin, performant; keyed by `device_id` |
| File uploads | **Fastify Multipart** | Streams to disk, no memory buffering |
| Media processing | **FFmpeg** (video) + **Sharp** (images) + **LibreOffice headless** (PPTX/PDF) + **Ghostscript** (PDF rasterise fallback) + **Playwright** (HTML5 screenshot/thumbnail) | Best-in-class CLI tools |
| Validation | **Zod** | Shared with frontend for schema reuse |
| Password hashing | **`argon2`** (`argon2id` variant) | Winner of Password Hashing Competition; stronger than bcrypt; Node binding via `argon2` npm |
| 2FA / TOTP | **`otplib`** | Actively maintained TOTP/HOTP library (RFC 6238); `speakeasy` is abandoned |
| Email | **Nodemailer + SMTP** | Invitations, alerts |
| Cron / scheduling | **BullMQ repeatable jobs** | Schedule manifests recomputed on change or on cron tick |
| MQTT broker | **Mosquitto 2** | Lightweight MQTT broker; ESP32 sensor gateway ingestion |
| MQTT client | **`mqtt` npm package** | Sensor worker subscribes to `signage/+/sensors/+` wildcard |

### Frontend — Web Dashboard

| Concern | Choice |
|---|---|
| Framework | **React 19 + TypeScript** |
| Build | **Vite 6** |
| Routing | **React Router v7** |
| Server state | **TanStack Query v5** |
| UI components | **Radix UI primitives** (unstyled, accessible) |
| Styling | **Tailwind CSS v4** + CSS custom properties for theming |
| Forms | **React Hook Form + Zod resolver** |
| Drag & drop (playlist) | **@dnd-kit/core** |
| Charts (analytics) | **Recharts** |
| Video preview | **Video.js** |
| Rich calendar (schedule) | **FullCalendar** |
| Icons | **Lucide React** |
| Toasts / alerts | **Sonner** |
| Themes | Brand (default) + Cyberpunk (toggle) — see §13 |

### Samsung Tizen Player

| Concern | Choice |
|---|---|
| Platform | **Tizen Web App** (HTML5 + JavaScript) |
| Target OS | **Tizen 6.5+** (Samsung LFD / Smart Signage Platform, 2022+ models) |
| Dev tooling | **Tizen Studio 6+** + **Tizen CLI** + VS Code extension |
| Web engine | **Chromium-based** (Blink renderer + V8 JS engine) — ES2022+, WebAssembly |
| Video renderer | **`webapis.avplaystore`** (hardware decoder, double-buffer, seamless via `setVideoStillMode`) — NOT `<video>` |
| Image renderer | `<img>` double-buffer with CSS opacity crossfade (HTML layer above AVPlay hardware layer) |
| HTML5 renderer | `<iframe sandbox>` (extracted from ZIP via JSZip to `wgt-private/html5/<id>/`) |
| PDF/PPTX renderer | **`webapis.document`** (Partner privilege `documentplay`) — native hardware rendering, no server rasterisation |
| Document control | `open(docinfo)` → `play(slideTime)` → `stop()` + `close()`; `gotoPage(n)` for manual advance |
| File downloads | **`tizen.download`** API (streams to disk, pause/resume/cancel, no RAM buffering) — NOT XHR |
| Credential storage | **`webapis.widgetdata`** (encrypted, app-private, Public privilege) — stores device JWT + deviceId |
| Scheduling | Local schedule JSON — pushed via WS + periodic HTTPS pull fallback; evaluated fully on-device |
| Offline storage | **`tizen.filesystem`** (`wgt-private`) for media files; `manifest.json` in same location |
| Communication | WSS persistent + HTTPS REST (device JWT); exponential backoff reconnect |
| Packaging | `.wgt` file (signed ZIP); deploy via Tizen CLI or Samsung VXT |

### Infrastructure

| Component | Choice |
|---|---|
| Host | Raspberry Pi 5 (16 GB RAM, NVMe SSD) |
| OS | Ubuntu 24.04 LTS (64-bit) |
| Reverse proxy | Nginx 1.26 |
| TLS | Let's Encrypt via Certbot (or self-signed for LAN-only) |
| Process management | systemd (one unit per service) |
| Package manager | pnpm 9 (monorepo workspaces) |
| Node version manager | nvm |

---

## 6. Monorepo Structure

```
/  (pnpm workspace root)
├── apps/
│   ├── api/                  # Fastify REST + WS API server
│   │   ├── src/
│   │   │   ├── routes/       # /auth, /devices, /content, /playlists, /schedules, /analytics, /sensors
│   │   │   ├── ws/           # WebSocket hub & device registry
│   │   │   ├── services/     # Business logic (separate from HTTP layer)
│   │   │   ├── jobs/         # BullMQ job definitions (media, scheduling, analytics, sensor-poll)
│   │   │   ├── plugins/      # Fastify plugins (auth, multipart, cors)
│   │   │   └── index.ts
│   │   └── package.json
│   │
│   ├── web/                  # React dashboard (Org users + Super Admin)
│   │   ├── src/
│   │   │   ├── pages/
│   │   │   │   ├── auth/     # Login, accept-invite, reset-password
│   │   │   │   ├── org/      # Org settings, members, billing
│   │   │   │   ├── workspace/
│   │   │   │   │   ├── devices/
│   │   │   │   │   ├── content/
│   │   │   │   │   ├── playlists/
│   │   │   │   │   ├── schedules/
│   │   │   │   │   ├── analytics/
│   │   │   │   │   └── sensors/
│   │   │   │   └── superadmin/
│   │   │   │       ├── orgs/
│   │   │   │       ├── users/
│   │   │   │       └── system/
│   │   │   ├── components/
│   │   │   │   ├── ui/            # Base components (Button, Card, Modal…)
│   │   │   │   ├── devices/
│   │   │   │   ├── content/
│   │   │   │   ├── playlists/
│   │   │   │   ├── schedules/
│   │   │   │   ├── analytics/
│   │   │   │   └── sensors/       # SensorCard, LiveReadingChart, RuleBuilder
│   │   │   ├── hooks/
│   │   │   ├── lib/               # API client, WS client, auth helpers
│   │   │   ├── styles/
│   │   │   │   ├── globals.css    # Brand (default) theme tokens
│   │   │   │   └── cyberpunk.css  # Cyberpunk overlay (data-theme="cy")
│   │   │   └── main.tsx
│   │   └── package.json
│   │
│   ├── sensor-worker/        # Standalone process: MQTT subscription + cloud API polling
│   │   ├── src/
│   │   │   ├── mqtt/          # Mosquitto subscriber, message parser
│   │   │   ├── pollers/       # Per-manufacturer API polling jobs (OpenWeatherMap, SwitchBot, …)
│   │   │   ├── rules/         # Trigger rule evaluator
│   │   │   └── index.ts
│   │   └── package.json
│   │
│   └── tizen/                # Samsung Tizen Web App (player)
│       ├── src/
│       │   ├── player/        # Content renderer (image, video, html5, pdf, pptx)
│       │   ├── scheduler/     # Local schedule manifest processor
│       │   ├── sync/          # WS + HTTP sync with API
│       │   ├── cache/         # IndexedDB + file cache manager
│       │   └── index.html     # Entry point (Tizen requires index.html at root)
│       ├── config.xml         # Tizen app manifest
│       └── package.json
│
├── packages/
│   ├── db/                   # Drizzle schema + migrations (shared by api)
│   │   ├── schema/
│   │   └── migrations/
│   ├── shared/               # Zod schemas, TS types, constants (used by all apps)
│   └── media/                # FFmpeg / Sharp wrappers (used by api worker)
│
├── infra/
│   ├── nginx/
│   │   ├── signage.conf      # Main nginx site config
│   │   └── snippets/         # SSL, gzip, security headers
│   └── systemd/
│       ├── signage-api.service
│       ├── signage-worker.service
│       ├── signage-ws.service
│       ├── signage-sensor-worker.service
│       └── mosquitto.service  # (managed by apt; overrides for config path)
│
├── Docs/
│   └── Plan/
│       ├── PROJECT_PLAN.md   # ← this file
│       └── logo/
│           ├── nexari.png    # Primary wordmark / logotype (PNG)
│           └── favicon.svg   # SVG favicon
│
├── pnpm-workspace.yaml
├── package.json
└── tsconfig.base.json
```

---

## 7. Database Schema

All tables include `created_at TIMESTAMPTZ DEFAULT now()` and `updated_at TIMESTAMPTZ`. Soft-deletes via `deleted_at` where applicable.

### 7.1 Platform & Auth

```sql
-- Super admins (platform operators)
super_admins (
  id           UUID PK,
  email        TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  name         TEXT,
  last_login   TIMESTAMPTZ
)

-- Organizations (tenants)
organizations (
  id           UUID PK,
  name         TEXT NOT NULL,
  slug         TEXT UNIQUE NOT NULL,   -- used in subpath/subdomain
  plan         TEXT DEFAULT 'starter', -- starter | pro | enterprise
  settings     JSONB DEFAULT '{}',     -- logo_url, timezone, max_devices, etc.
  suspended_at TIMESTAMPTZ,
  deleted_at   TIMESTAMPTZ
)
```

### 7.2 Users & Roles

```sql
users (
  id             UUID PK,
  org_id         UUID FK organizations,
  email          TEXT NOT NULL,  -- unique per org
  password_hash  TEXT,           -- NULL if SSO only
  name           TEXT,
  avatar_url     TEXT,
  org_role       TEXT NOT NULL,  -- owner | admin | member
  status         TEXT DEFAULT 'active',  -- active | suspended
  totp_secret    TEXT,           -- TOTP secret (encrypted at rest); NULL = 2FA not enrolled
  totp_enabled   BOOLEAN DEFAULT FALSE,
  backup_codes   TEXT[],         -- hashed single-use backup codes (8)
  last_login     TIMESTAMPTZ,
  deleted_at     TIMESTAMPTZ,
  UNIQUE(org_id, email)
)

org_invitations (
  id          UUID PK,
  org_id      UUID FK organizations,
  invited_by  UUID FK users,
  email       TEXT NOT NULL,
  org_role    TEXT NOT NULL,
  token       TEXT UNIQUE NOT NULL,  -- secure random token
  expires_at  TIMESTAMPTZ NOT NULL,
  accepted_at TIMESTAMPTZ
)

-- Refresh tokens (stored in Redis too for fast revocation)
refresh_tokens (
  id          UUID PK,
  user_id     UUID FK users,
  token_hash  TEXT UNIQUE,
  expires_at  TIMESTAMPTZ,
  revoked_at  TIMESTAMPTZ,
  ip_address  INET,
  user_agent  TEXT
)
```

### 7.3 Workspaces & Membership

```sql
workspaces (
  id       UUID PK,
  org_id   UUID FK organizations,
  name     TEXT NOT NULL,
  slug     TEXT NOT NULL,
  settings JSONB DEFAULT '{}',   -- default_timezone, branding overrides
  default_playlist_id UUID FK playlists NULLABLE,  -- played on all devices when no slot is active (overridden per device)
  deleted_at TIMESTAMPTZ,
  UNIQUE(org_id, slug)
)

workspace_members (
  workspace_id UUID FK workspaces,
  user_id      UUID FK users,
  role         TEXT NOT NULL,  -- admin | editor | viewer
  added_by     UUID FK users,
  PRIMARY KEY (workspace_id, user_id)
)
```

### 7.4 Devices

```sql
devices (
  id               UUID PK,
  org_id           UUID FK organizations,
  workspace_id     UUID FK workspaces,
  name             TEXT NOT NULL,
  -- Pairing
  pairing_code     CHAR(6),              -- shown on screen during registration; cleared after claim
  pairing_expires_at TIMESTAMPTZ,
  status           TEXT DEFAULT 'unclaimed', -- unclaimed | online | offline | error
  device_token     TEXT,                 -- long-lived device JWT (stored as-issued, not hashed)
  -- Hardware identity (populated at pair/request from Samsung APIs)
  duid             TEXT UNIQUE,          -- webapis.productinfo.getDuid() — canonical hardware ID
  model_name       TEXT,                 -- webapis.productinfo.getModel()
  model_code       TEXT,                 -- webapis.productinfo.getModelCode()
  serial_number    TEXT,                 -- webapis.systemcontrol.getSerialNumber()
  firmware_version TEXT,                 -- webapis.productinfo.getFirmware()
  player_version   TEXT,
  -- Network (updated on connect + every 5 min)
  ip_address       TEXT,
  mac_address      TEXT,
  connection_type  TEXT,                 -- WIRED | WIRELESS
  wifi_ssid        TEXT,
  wifi_strength    SMALLINT,             -- 1–5
  -- System state (updated after boot auto-config)
  resolution       TEXT,                 -- e.g. "1920x1080"
  screen_orientation TEXT DEFAULT 'landscape', -- LANDSCAPE_0 | PORTRAIT | LANDSCAPE_180
  timezone         TEXT DEFAULT 'UTC',   -- IANA tz
  power_state      TEXT,                 -- ON | STANDBY
  ir_lock          TEXT DEFAULT 'ON',    -- ON | OFF
  button_lock      TEXT DEFAULT 'ON',    -- ON | OFF
  auto_power_on    TEXT DEFAULT 'ON',    -- ON | OFF
  ntp_enabled      TEXT DEFAULT 'ON',
  ntp_server       TEXT,
  ntp_timezone     TEXT,
  clock_drift_ms   INTEGER DEFAULT 0,    -- device clock vs server clock
  last_seen        TIMESTAMPTZ,
  settings         JSONB DEFAULT '{}',   -- misc device settings
  deleted_at       TIMESTAMPTZ
)

-- Migration 0008 adds: duid, model_name, model_code, serial_number, mac_address,
-- connection_type, wifi_ssid, wifi_strength, screen_orientation, power_state,
-- ir_lock, button_lock, auto_power_on, ntp_enabled, ntp_server, ntp_timezone,
-- clock_drift_ms, pairing_expires_at; renames: token_hash → device_token,
-- model → model_name, orientation → screen_orientation; drop: platform

device_heartbeats (
  id                 UUID PK,
  device_id          UUID FK devices,
  ts                 TIMESTAMPTZ DEFAULT now(),
  ip                 INET,
  player_ver         TEXT,
  firmware_ver       TEXT,
  power_state        TEXT,
  clock_drift_ms     INTEGER,
  current_content_id UUID FK content_items NULLABLE,  -- "now playing" snapshot
  next_content_id    UUID FK content_items NULLABLE,  -- "up next" snapshot
  cpu_load           SMALLINT,   -- 0–100
  storage_free_mb    INTEGER,    -- available storage in MB
  temperature_c      SMALLINT    -- panel temperature °C (from webapis.systemcontrol.getTemperature())
)
-- Partitioned by month, keep 90 days rolling

-- Proof-of-play event log
play_events (
  id               UUID PK,
  device_id        UUID FK devices,
  content_id       UUID FK content_items,
  started_at       TIMESTAMPTZ NOT NULL,
  ended_at         TIMESTAMPTZ NOT NULL,
  duration_ms      INTEGER NOT NULL,      -- actual ms played
  completed_full   BOOLEAN DEFAULT false, -- true = played to natural end
  source           TEXT NOT NULL,         -- 'schedule' | 'emergency' | 'manual'
  created_at       TIMESTAMPTZ DEFAULT now()
)
-- Index: (device_id, started_at DESC), (content_id, started_at DESC)
-- Partitioned by month; keep 13 months for annual proof-of-play reports

-- VideoWall sync groups (Phase 3+)
sync_groups (
  id           UUID PK,
  org_id       UUID FK organizations,
  workspace_id UUID FK workspaces,
  name         TEXT NOT NULL,
  group_id     SMALLINT NOT NULL,        -- 16-bit int passed to webapis.syncplay.start()
  layout       JSONB DEFAULT '{}',       -- {cols: 2, rows: 2}
  deleted_at   TIMESTAMPTZ
)

sync_group_members (
  id            UUID PK,
  sync_group_id UUID FK sync_groups,
  device_id     UUID FK devices UNIQUE,  -- device belongs to at most one sync group
  tile_col      SMALLINT NOT NULL,
  tile_row      SMALLINT NOT NULL
)
```

### 7.5 Content

```sql
content_items (
  id             UUID PK,
  workspace_id   UUID FK workspaces,
  uploaded_by    UUID FK users,
  type           TEXT NOT NULL,    -- image | video | html5 | presentation | pdf
  name           TEXT NOT NULL,
  description    TEXT,
  file_path      TEXT NOT NULL,    -- relative to /var/signage/uploads/
  original_name  TEXT,
  mime_type      TEXT,
  file_size      BIGINT,           -- bytes
  duration       INT,              -- seconds (0 = manual advance)
  width          INT,
  height         INT,
  orientation    TEXT DEFAULT 'any',  -- landscape | portrait | any
  valid_from     TIMESTAMPTZ,      -- NULL = no start restriction
  valid_until    TIMESTAMPTZ,      -- NULL = never expires
  thumbnail_path TEXT,
  approval_state TEXT DEFAULT 'approved',  -- draft | pending_review | approved | rejected (only meaningful when workspace approval workflow is enabled)
  review_note    TEXT,             -- rejection reason from reviewer
  reviewed_by    UUID FK users NULL,
  reviewed_at    TIMESTAMPTZ,
  status         TEXT DEFAULT 'processing',  -- processing | ready | error
  tags           TEXT[],
  metadata       JSONB DEFAULT '{}',   -- page_count for PDF, slide_count for PPTX, etc.
  deleted_at     TIMESTAMPTZ
)

-- For HTML5 packages — extracted files listing
content_files (
  id            UUID PK,
  content_id    UUID FK content_items,
  path          TEXT,   -- relative path within the package
  size          BIGINT
)
```

### 7.6 Playlists

```sql
playlists (
  id           UUID PK,
  workspace_id UUID FK workspaces,
  created_by   UUID FK users,
  name         TEXT NOT NULL,
  description  TEXT,
  settings     JSONB DEFAULT '{}',  -- loop: bool, transition_default, bg_color
  total_duration INT,               -- computed: sum of item durations
  tags         TEXT[] DEFAULT '{}', -- organizational tags (GIN indexed)
  deleted_at   TIMESTAMPTZ
)

playlist_items (
  id                  UUID PK,
  playlist_id         UUID FK playlists,
  content_id          UUID FK content_items NULL,  -- NULL if sub-playlist
  sub_playlist_id     UUID FK playlists NULL,
  sort_order          SMALLINT NOT NULL,
  duration_override   INT,     -- NULL = use content default
  transition          TEXT DEFAULT 'cut',  -- cut | fade | slide_left | slide_right
  conditions          JSONB DEFAULT '{}',  -- future: conditional display rules
  CHECK (content_id IS NOT NULL OR sub_playlist_id IS NOT NULL)
)
```

### 7.7 Schedules

```sql
schedules (
  id           UUID PK,
  workspace_id UUID FK workspaces,
  created_by   UUID FK users,
  name         TEXT NOT NULL,
  device_id    UUID FK devices NULL,       -- NULL = applies to a device group
  device_tag   TEXT NULL,                  -- tag-based targeting
  playlist_id  UUID FK playlists NOT NULL,
  rule_type    TEXT NOT NULL,  -- always | time_window | recurring | event
  start_at     TIMESTAMPTZ,   -- for time_window & recurring start
  end_at       TIMESTAMPTZ,   -- for time_window
  cron_rule    TEXT,           -- cron expression for recurring (e.g. "0 9 * * 1-5")
  cron_tz      TEXT DEFAULT 'UTC',
  priority     SMALLINT DEFAULT 5,   -- 1–10, higher wins
  active       BOOLEAN DEFAULT TRUE,
  tags         TEXT[] DEFAULT '{}',  -- organizational tags (GIN indexed)
  deleted_at   TIMESTAMPTZ
)

-- Resolved manifest — recomputed by worker after any schedule change
device_manifests (
  device_id    UUID PK FK devices,
  manifest     JSONB NOT NULL,   -- ordered list of {playlist_id, start, end, priority}
  computed_at  TIMESTAMPTZ DEFAULT now()
)
```

### 7.8 Analytics

```sql
analytics_events (
  id           BIGSERIAL PK,
  device_id    UUID FK devices,
  workspace_id UUID FK workspaces,
  event_type   TEXT NOT NULL,   -- content_play | content_complete | schedule_switch | device_online | device_offline
  content_id   UUID,
  playlist_id  UUID,
  schedule_id  UUID,
  ts           TIMESTAMPTZ DEFAULT now(),
  meta         JSONB DEFAULT '{}'
)
-- Partitioned by week; kept 1 year then archived

analytics_daily (
  id              BIGSERIAL PK,
  device_id       UUID FK devices,
  workspace_id    UUID FK workspaces,
  content_id      UUID,
  date            DATE NOT NULL,
  play_count      INT DEFAULT 0,
  total_duration  INT DEFAULT 0,   -- seconds
  UNIQUE (device_id, content_id, date)
)
```

### 7.12 Notifications, API Keys & Screenshots

```sql
-- In-app notifications
notifications (
  id           UUID PK,
  org_id       UUID FK organizations,
  workspace_id UUID FK workspaces NULL,
  user_id      UUID FK users,         -- recipient
  type         TEXT NOT NULL,         -- device_offline | content_failed | quota_warning | ...
  title        TEXT NOT NULL,
  body         TEXT,
  entity_type  TEXT,                  -- device | content | sensor_rule | ...
  entity_id    UUID,
  read_at      TIMESTAMPTZ,           -- NULL = unread
  created_at   TIMESTAMPTZ DEFAULT now()
)
CREATE INDEX idx_notif_user_unread ON notifications (user_id, created_at DESC) WHERE read_at IS NULL;

-- Workspace-scoped API keys for external integrations
api_keys (
  id            UUID PK,
  workspace_id  UUID FK workspaces,
  created_by    UUID FK users,
  name          TEXT NOT NULL,
  key_hash      TEXT NOT NULL UNIQUE,  -- sha256(raw_key); raw key shown only once at creation
  scopes        TEXT[] NOT NULL,       -- e.g. ["sensor:write", "analytics:read"]
  rate_limit    INT DEFAULT 1000,      -- requests per minute
  last_used_at  TIMESTAMPTZ,
  revoked_at    TIMESTAMPTZ,
  deleted_at    TIMESTAMPTZ
)

-- Device screenshot history
device_screenshots (
  id           UUID PK,
  device_id    UUID FK devices,
  content_id   UUID FK content_items NULLABLE,  -- what was playing when the screenshot was taken
  file_path    TEXT NOT NULL,          -- /var/signage/uploads/screenshots/<device_id>/<ts>.jpg
  captured_at  TIMESTAMPTZ DEFAULT now(),
  trigger      TEXT DEFAULT 'auto',    -- 'auto_change' | 'auto_interval' | 'manual'
  triggered_by UUID FK users NULL      -- NULL = automated capture
)
CREATE INDEX idx_screenshots_device ON device_screenshots (device_id, captured_at DESC);
-- Keep last 90 screenshots per device (worker evicts oldest)

-- Scheduled reports
report_schedules (
  id            UUID PK,
  workspace_id  UUID FK workspaces,
  created_by    UUID FK users,
  name          TEXT NOT NULL,
  report_type   TEXT NOT NULL,         -- analytics | proof_of_play
  cron_rule     TEXT NOT NULL,         -- e.g. "0 8 * * 1" = every Monday 08:00
  cron_tz       TEXT DEFAULT 'UTC',
  recipients    TEXT[] NOT NULL,       -- email addresses
  filters       JSONB DEFAULT '{}',    -- {device_id, content_id, date_range_days: 7}
  last_run_at   TIMESTAMPTZ,
  active        BOOLEAN DEFAULT TRUE,
  deleted_at    TIMESTAMPTZ
)
```

---

## 8. API Design

Auth:

```sql
-- Workspace-scoped tag registry (names, colours, autocomplete)
workspace_tags (
  id           UUID PK,
  workspace_id UUID FK workspaces,
  name         TEXT NOT NULL,
  color        CHAR(7) DEFAULT '#6366f1',  -- hex colour for UI chip
  description  TEXT,
  UNIQUE (workspace_id, name)
)

-- Hierarchical content folders (content only, max 5 levels)
content_folders (
  id           UUID PK,
  workspace_id UUID FK workspaces,
  parent_id    UUID FK content_folders NULL,  -- NULL = root
  name         TEXT NOT NULL,
  path         TEXT NOT NULL,  -- materialised path e.g. "/marketing/q1/videos"
  created_by   UUID FK users,
  UNIQUE (workspace_id, path)
)
-- content_items gains: folder_id UUID FK content_folders NULL

-- User-saved filter views (personal, per workspace)
saved_filters (
  id           UUID PK,
  workspace_id UUID FK workspaces,
  user_id      UUID FK users,
  entity_type  TEXT NOT NULL,  -- content | playlists | schedules | devices
  name         TEXT NOT NULL,
  filters      JSONB NOT NULL, -- serialised filter state {tags, type, status, ...}
  sort_by      TEXT,
  sort_dir     TEXT DEFAULT 'desc'
)

-- Per-user starred items
user_pins (
  user_id      UUID FK users,
  entity_type  TEXT NOT NULL,  -- content | playlist | schedule | device
  entity_id    UUID NOT NULL,
  pinned_at    TIMESTAMPTZ DEFAULT now(),
  PRIMARY KEY (user_id, entity_type, entity_id)
)
```

#### GIN indexes for tag array queries

```sql
-- O(1) set-intersection queries: @> (contains all), && (overlaps)
CREATE INDEX idx_devices_tags      ON devices       USING GIN (tags);
CREATE INDEX idx_content_tags      ON content_items USING GIN (tags);
CREATE INDEX idx_playlists_tags    ON playlists     USING GIN (tags);
CREATE INDEX idx_schedules_tags    ON schedules     USING GIN (tags);

-- Trigram full-text search (fuzzy / partial-word match)
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX idx_content_name_trgm   ON content_items USING GIN (name gin_trgm_ops);
CREATE INDEX idx_playlists_name_trgm ON playlists     USING GIN (name gin_trgm_ops);
CREATE INDEX idx_schedules_name_trgm ON schedules     USING GIN (name gin_trgm_ops);
CREATE INDEX idx_devices_name_trgm   ON devices       USING GIN (name gin_trgm_ops);

-- Example: content tagged "campaign" AND "retail", in a specific folder tree
SELECT c.* FROM content_items c
JOIN   content_folders f ON f.id = c.folder_id
WHERE  c.workspace_id = $1
  AND  c.tags @> ARRAY['campaign','retail']  -- AND match
  AND  f.path LIKE '/marketing/%'           -- recursive folder filter
  AND  c.deleted_at IS NULL
ORDER BY c.created_at DESC;
```

### 7.10 Audit Log, Emergency Alerts & Quotas

```sql
-- Immutable audit trail
audit_log (
  id           BIGSERIAL PK,
  org_id       UUID FK organizations NOT NULL,
  workspace_id UUID FK workspaces NULL,  -- NULL for org-level actions
  actor_id     UUID,                     -- user_id or NULL for system/device
  actor_type   TEXT DEFAULT 'user',      -- user | device | system | super_admin
  actor_email  TEXT,                     -- denormalised snapshot at time of action
  action       TEXT NOT NULL,            -- e.g. content.deleted, schedule.activated
  entity_type  TEXT,                     -- content | playlist | schedule | device | user | ...
  entity_id    UUID,
  entity_name  TEXT,                     -- denormalised snapshot
  diff         JSONB DEFAULT '{}',       -- {before: {...}, after: {...}} for updates
  ip_address   INET,
  user_agent   TEXT,
  ts           TIMESTAMPTZ DEFAULT now()
  -- NO deleted_at; immutable by design
)
CREATE INDEX idx_audit_org_ts      ON audit_log (org_id, ts DESC);
CREATE INDEX idx_audit_entity      ON audit_log (entity_type, entity_id);
CREATE INDEX idx_audit_actor       ON audit_log (actor_id);

-- Emergency overrides
emergency_overrides (
  id             UUID PK,
  org_id         UUID FK organizations,
  workspace_id   UUID FK workspaces NULL,  -- NULL = org-wide
  device_id      UUID FK devices NULL,     -- NULL = all in scope
  device_tag     TEXT NULL,                -- tag-based scope
  created_by     UUID FK users,
  content_id     UUID FK content_items NULL,  -- NULL = plain text message
  message        TEXT,                     -- plain text shown on screen if no content_id
  active         BOOLEAN DEFAULT TRUE,
  auto_clear_at  TIMESTAMPTZ,              -- NULL = manual clear only
  cleared_by     UUID FK users NULL,
  cleared_at     TIMESTAMPTZ,
  created_at     TIMESTAMPTZ DEFAULT now()
)
CREATE INDEX idx_emergency_active ON emergency_overrides (org_id) WHERE active = TRUE;

-- Per-org storage quota
org_storage_quotas (
  org_id        UUID PK FK organizations,
  quota_bytes   BIGINT NOT NULL DEFAULT 10737418240,  -- 10 GB default
  used_bytes    BIGINT NOT NULL DEFAULT 0,            -- updated atomically on upload/delete
  warn_pct      SMALLINT DEFAULT 80,                  -- send warning email at this %
  updated_at    TIMESTAMPTZ DEFAULT now()
)

-- Proof of Play (tamper-evident, never mutated)
proof_of_play (
  id                UUID PK,
  org_id            UUID FK organizations,
  workspace_id      UUID FK workspaces,
  device_id         UUID FK devices,
  content_id        UUID FK content_items,
  playlist_id       UUID,
  schedule_id       UUID,
  played_at         TIMESTAMPTZ NOT NULL,   -- device local clock
  server_received_at TIMESTAMPTZ DEFAULT now(),
  duration_played   INT,                   -- seconds actually shown
  completed         BOOLEAN DEFAULT FALSE  -- false if cut short by schedule switch
)
CREATE INDEX idx_pop_device_date ON proof_of_play (device_id, played_at DESC);
CREATE INDEX idx_pop_content     ON proof_of_play (content_id, played_at DESC);
-- Partitioned by month; retained 3 years
```

### 7.11 Sensors & Trigger Rules

```sql
-- Registered sensor sources (ESP32 node, cloud API, or webhook)
sensor_sources (
  id               UUID PK,
  workspace_id     UUID FK workspaces,
  name             TEXT NOT NULL,
  type             TEXT NOT NULL,        -- esp32_mqtt | cloud_api | webhook
  protocol         TEXT NOT NULL,        -- mqtt | http_poll | http_push
  sensor_type      TEXT NOT NULL,        -- temperature | humidity | motion | people_count | air_quality | generic
  unit             TEXT,                 -- e.g. "°C", "%", "persons", "boolean"
  mqtt_topic       TEXT,                 -- full MQTT topic (for esp32_mqtt type)
  api_url          TEXT,                 -- for cloud_api type
  api_key_hash     TEXT,                 -- webhook API key (hashed)
  poll_interval_s  INT DEFAULT 60,       -- for cloud_api type
  mqtt_username    TEXT,                 -- hashed in mosquitto password file
  last_reading     NUMERIC,              -- cached latest value (denormalised for fast rule eval)
  last_reading_at  TIMESTAMPTZ,
  tags             TEXT[],
  active           BOOLEAN DEFAULT TRUE,
  deleted_at       TIMESTAMPTZ
)

-- Raw sensor readings (time-series; partitioned by month, purged after 30 days)
sensor_readings (
  id          BIGSERIAL,
  source_id   UUID FK sensor_sources NOT NULL,
  value       NUMERIC NOT NULL,          -- numeric for all types; boolean stored as 0/1
  raw         JSONB DEFAULT '{}',        -- full raw payload from ESP32 or cloud API
  received_at TIMESTAMPTZ DEFAULT now()
)
CREATE INDEX idx_readings_source_ts ON sensor_readings (source_id, received_at DESC);
-- Partition by month, retain 30 days raw; hourly aggregates kept indefinitely

-- Hourly aggregates (kept indefinitely for analytics)
sensor_hourly (
  source_id    UUID FK sensor_sources,
  bucket       TIMESTAMPTZ NOT NULL,  -- truncated to hour
  min          NUMERIC,
  max          NUMERIC,
  avg          NUMERIC,
  sample_count INT,
  PRIMARY KEY (source_id, bucket)
)

-- Trigger rules
sensor_rules (
  id                UUID PK,
  workspace_id      UUID FK workspaces,
  source_id         UUID FK sensor_sources,
  name              TEXT NOT NULL,
  conditions        JSONB NOT NULL,  -- [{field, operator, value}, ...] with root AND/OR logic
  -- Example: {"op":"AND", "conditions":[{"field":"value","op":">","val":30}]}
  cooldown_seconds  INT DEFAULT 300,     -- min gap between consecutive fires
  action_type       TEXT NOT NULL,       -- switch_playlist | switch_content | send_notification | webhook_out
  action_target_id  UUID,               -- playlist_id or content_id
  device_scope      TEXT DEFAULT 'workspace',  -- workspace | device | tag
  device_id         UUID FK devices NULL,
  device_tag        TEXT NULL,
  webhook_url       TEXT,               -- for webhook_out action type
  active            BOOLEAN DEFAULT TRUE,
  last_fired_at     TIMESTAMPTZ,
  deleted_at        TIMESTAMPTZ
)

-- Rule fire log (for debugging and analytics)
sensor_rule_events (
  id            BIGSERIAL PK,
  rule_id       UUID FK sensor_rules,
  source_id     UUID FK sensor_sources,
  reading_value NUMERIC,
  fired_at      TIMESTAMPTZ DEFAULT now(),
  action_taken  TEXT,
  devices_count INT,
  success       BOOLEAN DEFAULT TRUE,
  error_msg     TEXT
)
CREATE INDEX idx_rule_events_rule ON sensor_rule_events (rule_id, fired_at DESC);
### 7.9 Tags, Folders & Discovery `Authorization: Bearer <access_token>` (15 min expiry)  
Refresh: `POST /api/v1/auth/refresh` with refresh token in `httpOnly` cookie

### Auth

```
GET    /health                   returns {status:"ok", db:"ok"|"error", redis:"ok"|"error", uptime_s, version}; HTTP 200 or 503

POST   /auth/login
POST   /auth/logout
POST   /auth/refresh
POST   /auth/forgot-password
POST   /auth/reset-password
GET    /auth/accept-invite/:token
POST   /auth/accept-invite/:token

-- Two-factor authentication
POST   /auth/2fa/setup        generate TOTP secret + QR code URI
POST   /auth/2fa/verify       confirm TOTP code and enable 2FA
POST   /auth/2fa/disable      disable 2FA (requires current password + TOTP code)
GET    /auth/2fa/backup-codes  regenerate backup codes
POST   /auth/login/2fa        submit TOTP code after successful password step
```

### Super Admin (prefix: `/superadmin`)

```
GET    /superadmin/orgs               list all organizations
POST   /superadmin/orgs               create organization
PATCH  /superadmin/orgs/:id           update / suspend
DELETE /superadmin/orgs/:id
POST   /superadmin/orgs/:id/invite    invite an org owner
GET    /superadmin/analytics          platform-wide stats
GET    /superadmin/system             server health (CPU, RAM, disk, WS connections)
POST   /superadmin/impersonate/:orgId  issue short-lived impersonation token
```

### Organization

```
GET    /org                            current org details
PATCH  /org                            update name, settings
GET    /org/members                    list users
POST   /org/invitations                invite a user
DELETE /org/invitations/:id
PATCH  /org/members/:userId            change role / suspend
DELETE /org/members/:userId
GET    /org/workspaces                 list workspaces user can access
POST   /org/workspaces                 create workspace (owner/admin)
```

### Workspace (prefix: `/workspaces/:wsId`)

```
GET    /workspaces/:wsId               workspace details
PATCH  /workspaces/:wsId               update name, settings
GET    /workspaces/:wsId/members       list members
POST   /workspaces/:wsId/members       add member
PATCH  /workspaces/:wsId/members/:uid  change role
DELETE /workspaces/:wsId/members/:uid
```

### Devices

```
GET    /workspaces/:wsId/devices             list devices
POST   /workspaces/:wsId/devices             register (start pairing)
GET    /workspaces/:wsId/devices/:id         device detail + current status
PATCH  /workspaces/:wsId/devices/:id         update name/settings
DELETE /workspaces/:wsId/devices/:id         unpair
POST   /workspaces/:wsId/devices/:id/command  send command (reboot|refresh|screenshot)
GET    /workspaces/:wsId/devices/:id/status  real-time status snapshot
GET    /workspaces/:wsId/devices/:id/logs    heartbeat log
GET    /workspaces/:wsId/devices/:id/screenshots  screenshot history (paginated)
POST   /workspaces/:wsId/devices/:id/replace  replace with a newly paired device {new_device_id}

-- Device self-service (Tizen uses device JWT)
POST   /devices/pair                 submit pairing code, receive device token
POST   /devices/heartbeat            report health metrics
GET    /devices/manifest             pull resolved schedule manifest
```

### Content

```
GET    /workspaces/:wsId/content             list with filters (see params below)
POST   /workspaces/:wsId/content/upload      multipart upload
GET    /workspaces/:wsId/content/:id         detail + processing status
PATCH  /workspaces/:wsId/content/:id         rename, retag, set folder, update duration
DELETE /workspaces/:wsId/content/:id
GET    /workspaces/:wsId/content/:id/preview  signed URL for preview
POST   /workspaces/:wsId/content/bulk        bulk tag / move-folder / delete

Content list query params:
  ?q=<text>                          trigram search on name + description
  &type=image,video,...              comma-separated; OR match
  &tags=campaign,retail              AND match — must have ALL tags
  &tags_any=summer,winter            OR match  — must have ANY tag
  &folder=<folderId>|root            exact folder; "root" = unfoldered
  &folder_recursive=true             include all descendant folders
  &status=ready|processing|error
  &uploaded_by=<userId>
  &created_after=<ISO>&created_before=<ISO>
  &usage=in_playlist|orphan          orphan = not in any active playlist
  &duration_max=30                   seconds
  &sort=name|created_at|size|duration|play_count
  &order=asc|desc
  &page=1&limit=50

-- Content approval
PATCH  /workspaces/:wsId/content/:id/submit-review   editor submits for approval
PATCH  /workspaces/:wsId/content/:id/approve         admin approves
PATCH  /workspaces/:wsId/content/:id/reject          admin rejects {note}

Content folder endpoints:
  GET    /workspaces/:wsId/content/folders         full folder tree
  POST   /workspaces/:wsId/content/folders         create folder
  PATCH  /workspaces/:wsId/content/folders/:id     rename / move
  DELETE /workspaces/:wsId/content/folders/:id     delete (children promoted to parent)
  POST   /workspaces/:wsId/content/move-to-folder  move N items to a folder
```

### Playlists

```
GET    /workspaces/:wsId/playlists            list with filters
  ?q=<text>  &tags=a,b  &tags_any=a,b  &created_by=<userId>
  &usage=in_schedule|orphan  &sort=name|created_at|total_duration  &order=asc|desc
  &page=1&limit=50
POST   /workspaces/:wsId/playlists
GET    /workspaces/:wsId/playlists/:id
PATCH  /workspaces/:wsId/playlists/:id
DELETE /workspaces/:wsId/playlists/:id
PUT    /workspaces/:wsId/playlists/:id/items   replace all items (ordered)
PATCH  /workspaces/:wsId/playlists/:id/items/:itemId  update single item
POST   /workspaces/:wsId/playlists/bulk        bulk tag / delete
```

### Schedules

```
GET    /workspaces/:wsId/schedules             list with filters
  ?q=<text>  &tags=a,b  &tags_any=a,b  &status=active|upcoming|expired|disabled
  &device_id=<id>  &playlist_id=<id>  &rule_type=always|time_window|recurring|event
  &sort=name|created_at|priority|start_at  &order=asc|desc
  &page=1&limit=50
POST   /workspaces/:wsId/schedules
GET    /workspaces/:wsId/schedules/:id
PATCH  /workspaces/:wsId/schedules/:id
DELETE /workspaces/:wsId/schedules/:id
GET    /workspaces/:wsId/devices/:id/schedule-timeline   resolved timeline for UI calendar
POST   /workspaces/:wsId/schedules/bulk        bulk tag / activate / delete
```

### Analytics

```
GET    /workspaces/:wsId/analytics/overview    summary stats
GET    /workspaces/:wsId/analytics/content     per-content play stats
GET    /workspaces/:wsId/analytics/devices     per-device uptime + events
GET    /workspaces/:wsId/analytics/exports     CSV/XLSX export job trigger
```

### Tags, Saved Filters & Pins

```
-- Saved filter views (personal Smart Views)
GET    /workspaces/:wsId/saved-filters          list user's saved views
POST   /workspaces/:wsId/saved-filters          save current filter state
PATCH  /workspaces/:wsId/saved-filters/:id      rename
DELETE /workspaces/:wsId/saved-filters/:id

-- Starred items
GET    /workspaces/:wsId/pins                   list starred items (all entity types)
POST   /workspaces/:wsId/pins                   pin {entityType, entityId}
DELETE /workspaces/:wsId/pins/:entityType/:id   unpin

-- Recently viewed (read from Redis)
GET    /workspaces/:wsId/recent/:entityType     last 20 viewed items for entity type

-- Global cross-entity search
GET    /workspaces/:wsId/search?q=<query>&limit=5  returns {content[], playlists[], schedules[], devices[]}
```

### Emergency Override

```
GET    /workspaces/:wsId/emergency              list active/recent overrides
POST   /workspaces/:wsId/emergency              activate override {scope, content_id|message, auto_clear_at}
DELETE /workspaces/:wsId/emergency/:id          clear override

-- Org-wide (available to Org Admin)
GET    /org/emergency                           all active overrides across workspaces
POST   /org/emergency                           org-wide override
```

### Audit Log

```
GET    /org/audit              paginated log for this org
  ?actor=<userId>  &entity_type=content|playlist|...  &entity_id=<id>
  &action=<text>   &from=<ISO>  &to=<ISO>  &page=1&limit=50

GET    /superadmin/audit       platform-wide log (super admin only)
```

### Proof of Play

```
GET    /workspaces/:wsId/proof-of-play
  ?device_id=<id>  &content_id=<id>  &from=<ISO>  &to=<ISO>
  &page=1&limit=100

POST   /workspaces/:wsId/proof-of-play/export  trigger signed CSV/PDF export job
GET    /workspaces/:wsId/proof-of-play/exports/:jobId  poll export status + download URL
```

### Notifications

```
GET    /notifications               unread + recent notifications for current user
PATCH  /notifications/:id/read      mark single notification read
POST   /notifications/read-all      mark all read
DELETE /notifications/:id
```

### API Keys

```
GET    /workspaces/:wsId/api-keys           list keys (name, scopes, last-used; key never returned)
POST   /workspaces/:wsId/api-keys           create key {name, scopes} → returns raw key ONCE
PATCH  /workspaces/:wsId/api-keys/:id       rename
POST   /workspaces/:wsId/api-keys/:id/rotate  invalidate + issue new key → returns raw key ONCE
DELETE /workspaces/:wsId/api-keys/:id       revoke
```

### Scheduled Reports

```
GET    /workspaces/:wsId/report-schedules         list
POST   /workspaces/:wsId/report-schedules         create {name, report_type, cron_rule, cron_tz, recipients, filters}
PATCH  /workspaces/:wsId/report-schedules/:id     update
DELETE /workspaces/:wsId/report-schedules/:id
POST   /workspaces/:wsId/report-schedules/:id/run  trigger immediately (test send)
```

### Storage Quota

```
GET    /org/storage            used_bytes, quota_bytes, percentage, per-workspace breakdown
PATCH  /superadmin/orgs/:id/quota  set quota_bytes for an org (super admin only)
POST   /workspaces/:wsId/content/purge-orphans  delete all content not in any playlist (dry-run mode available)
```

### Sensors

```
-- Sensor sources
GET    /workspaces/:wsId/sensors               list all sensors
  ?type=temperature|motion|...  &active=true  &tags[]=<tag>
POST   /workspaces/:wsId/sensors               register new sensor source
GET    /workspaces/:wsId/sensors/:id           sensor detail + last reading
PATCH  /workspaces/:wsId/sensors/:id           update name, config, active state
DELETE /workspaces/:wsId/sensors/:id           soft delete

-- Readings
GET    /workspaces/:wsId/sensors/:id/readings  recent raw readings (paginated)
  ?from=<ISO>  &to=<ISO>  &limit=100
GET    /workspaces/:wsId/sensors/:id/aggregate hourly/daily aggregates
  ?from=<ISO>  &to=<ISO>  &resolution=hour|day
POST   /sensors/:id/reading                    ingest reading via webhook (API key auth)

-- Trigger rules
GET    /workspaces/:wsId/sensors/:id/rules     list rules for a sensor
POST   /workspaces/:wsId/sensors/:id/rules     create rule
PATCH  /workspaces/:wsId/sensors/:id/rules/:ruleId  update rule
DELETE /workspaces/:wsId/sensors/:id/rules/:ruleId
GET    /workspaces/:wsId/sensors/:id/rules/:ruleId/history  fire history

-- Global sensor overview
GET    /workspaces/:wsId/sensors/live          latest reading for every active sensor (SSE stream)
```

---

## 9. Frontend — Web Dashboard

### Page map

```
/ (redirect to /login or /dashboard)
/login
/accept-invite/:token
/reset-password/:token

/org/                                     Org root (workspace picker)
/org/settings                             Org profile, branding
/org/members                              User list + invite
/org/workspaces

/:wsSlug/dashboard                        Workspace overview
/:wsSlug/devices                          Device list (grid/list)
/:wsSlug/devices/:id                      Device detail + map + live status
/:wsSlug/content                          Content library (grid)
/:wsSlug/content/:id                      Content detail + preview
/:wsSlug/playlists                        Playlist list
/:wsSlug/playlists/:id                    Playlist editor (drag-drop items)
/:wsSlug/schedules                        Schedule calendar / list
/:wsSlug/schedules/new                    Schedule creator
/:wsSlug/schedules/:id                    Schedule detail / edit
/:wsSlug/analytics                        Analytics dashboard

/:wsSlug/sensors                          Sensor list
/:wsSlug/sensors/new                      Register sensor
/:wsSlug/sensors/:id                      Sensor detail + live chart + rules

/:wsSlug/settings/api-keys                API key management
/:wsSlug/settings/approval                Approval workflow toggle + pending queue
/:wsSlug/settings/report-schedules        Scheduled report management

/account/security                         User 2FA setup + backup codes

/superadmin/                              SA overview
/superadmin/orgs                          Org list + create
/superadmin/orgs/:id                      Org detail
/superadmin/system                        System health
/superadmin/analytics                     Platform analytics
```

### Key UI interactions

**Device Dashboard**
- Grid of device cards showing: **auto-screenshot thumbnail** (most recent capture), name, status indicator (online/offline/error), **now-playing content thumbnail + name**, **up-next content name + countdown**, last seen.
- **Now Playing strip** on each card: content thumbnail (served via `AuthImg`), content name, content type badge, elapsed/total duration progress bar. Refreshed on every heartbeat.
- **Up Next** sub-line: content name + "in Xs" countdown, greyed out if scheduler is idle.
- Real-time status updates via WebSocket (no polling needed).
- Bulk action bar: restart, push refresh, move to workspace, apply tags.
- Filter bar: status pills (online / offline / error), tag multi-select, orientation toggle, text search.
- **Emergency Override banner**: persistent red bar at top of dashboard when any override is active; shows scope and a "Clear Override" button.
- **Device settings drawer**: set timezone, power-on/off time, reboot schedule, brightness, volume, offline alert threshold, **device default playlist** (device-level idle fallback; overrides workspace default) per device.
- Under **Workspace Settings → Player Defaults**: set the workspace-wide default playlist shown on all devices when no schedule slot is active. Both device and workspace defaults can be cleared (reverts to built-in idle screen). Also set workspace logo URL — shown on the built-in idle screen.
- **Device detail page**: dedicated **Now Playing panel** at the top — large content thumbnail, content name + type, slot name (from schedule), progress bar, up-next item. Below it: screenshot history gallery tab showing chronological thumbnails with timestamps **and a content-name label** (linked from `device_screenshots.content_id`); click to enlarge.

**Content Library**
- Masonry/grid layout with type badge chips and tag chips on each card.
- Cards with a `valid_until` within 7 days show an "⏱ Expires soon" badge; expired content shows a greyed "✕ Expired" badge.
- Portrait-only content shows a rotation icon indicator.
- Left sidebar: folder tree (collapsible), tag filter panel (checkbox list with counts), Smart Views section.
- Top bar: type toggles, status filter, sort dropdown, view toggle (grid / list), search input.
- Upload drag-drop zone with progress bars and processing state.
- Inline preview modal (video player, image viewer, iframe for HTML5, paginated for PDF/PPTX).
- Bulk select (checkbox on hover) → bulk action bar: apply/remove tags, move to folder, delete.
- **Orphan filter**: "Not in any playlist" quick-filter badge in the toolbar.
- **Validity date editor**: inline date pickers for `valid_from` / `valid_until` in the content detail sidebar.

**Playlist List & Editor**
- List view: tag chips, usage indicator ("used in N schedules" or "⚠ not scheduled"), duration badge.
- Filter bar: tag multi-select, usage filter, created-by picker, sort.
- Editor left panel: content library mini-search with same tag / type filters.
- Bulk actions: apply tags, duplicate, delete.

**Schedule List & Calendar**
- List view (default for large fleets): tag chips, status badge (active/upcoming/expired), target device/tag, priority badge.
- Calendar view: FullCalendar week/day with schedule blocks colour-coded by tag.
- Filter bar: tag multi-select, status filter, rule-type filter, device/playlist picker.
- Conflict highlight when schedules overlap on the same device.
- Bulk actions: activate, deactivate, apply tags, delete.

**Tag Manager (`/:wsSlug/tags`)**
- Table of all workspace tags with name, colour swatch, and usage counts per entity type (e.g. "12 content · 3 playlists · 5 devices").
- Click a tag row → opens a filtered view of all items carrying that tag across entity types.
- Rename, recolor, merge (reassign one tag's entities to another), delete.

**Global Search (`Cmd/Ctrl + K`)**
- Floating command palette: type to search across content, playlists, schedules, and devices.
- Grouped results with type icon; click to navigate directly to the item.
- Recent items surfaced before typing.

**Sidebar Smart Views**
- Under each section (Content, Playlists, Schedules, Devices): user's saved filter views listed as clickable rows.
- "Save current view" button in the filter toolbar when any filters are active.
- "Starred" section at the top of the sidebar showing pinned items from all entity types.
- "Recent" section showing the last 10 items the user touched.

**Proof of Play & Audit**
- `/:wsSlug/proof-of-play`: date-range table of every play event per device/content; export to signed CSV/PDF.
- `/:wsSlug/audit`: paginated audit log filtered by actor, entity, action, date.

**Sensor Management (`/:wsSlug/sensors`)**
- List of all registered sensors with type badge, last reading value + unit, last-seen timestamp, and a colour-coded status chip (live / stale / offline).
- Live reading sparklines on each sensor card (Server-Sent Events stream — no polling needed).
- **Register sensor wizard**: choose input method (ESP32 / MQTT, Cloud API, or Webhook), enter connection details, test connection, assign tags.
- **Sensor detail page**: full time-series chart (1h / 24h / 7d / 30d, Recharts), current value hero display, raw readings table.
- **Rule Builder**: visual condition builder — pick sensor, pick operator and threshold(s), set cooldown, choose action (switch playlist / switch content / notify), choose device scope (all / tag / specific device).
- Rule fire history log: timestamp, reading that triggered it, devices affected, success/error.
- **Live dashboard widget** (optional): sensor readings block embeddable in the workspace dashboard for a quick overview.

**Notification Center**
- Bell icon in the nav bar with unread count badge.
- Dropdown tray showing recent notifications grouped by type; click to navigate to the related entity.
- "Mark all read" button; individual dismiss.
- Browser Web notifications (Notification API) for high-priority alerts (device offline, emergency override) when the tab is in the background.

**Account Security (`/account/security`)**
- TOTP 2FA setup: QR code + manual entry key, confirmation field, list of 8 one-time backup codes (downloadable).
- 2FA status badge; disable button (requires password re-entry + valid TOTP).

**Workspace Switcher**
- Persistent sidebar or top-drop showing all workspaces the user has access to.
- Badge showing device online count per workspace.

---

## 10. Samsung Tizen Player App

### Platform target

- Samsung **Smart Signage Platform (SSP) / LFD** displays running **Tizen OS 6.5+** (2022+ model year)
- All hardware-control and document APIs (`systemcontrol`, `devicetimer`, `documentplay`, `syncplay`) require a **Samsung Partner certificate** — public-privilege features (ProductInfo, Network, WidgetData, AVPlay) work with a standard developer certificate
- Tizen Web App (HTML5/JS) — web engine is **Chromium-based (Blink + V8)**, giving near-desktop compatibility
- Packaged as `.wgt` (signed ZIP) — side-loaded via Tizen CLI or deployed via Samsung VXT

### Media format support (Tizen 7.0+ Signage)

#### Video

| Container | Codecs | Max Resolution | Max Bitrate | Notes |
|---|---|---|---|---|
| MP4 / M4V | H.264 (AVC) Baseline/Main/High | 3840×2160 (4K) | 80 Mbps | Primary delivery format |
| MP4 / MKV | H.265 (HEVC) Main/Main10 | 3840×2160 (4K) | 80 Mbps | HDR10 on supported panels |
| WebM | VP8, VP9 | 3840×2160 | 60 Mbps | VP9 preferred over VP8 |
| MP4 / MKV | AV1 | 3840×2160 | — | Supported on newer 2023+ signage hardware |
| MKV / AVI | MPEG-4 Part 2 (DivX/Xvid) | 1920×1080 | 60 Mbps | Legacy support |
| TS / MTS | MPEG-2 Video | 1920×1080 | 60 Mbps | Broadcast compatibility |

> **Server transcoding target**: Always transcode uploads to **H.264 High Profile, MP4 container, AAC audio, ≤ 30 Mbps** for guaranteed playback across all Tizen 7+ devices. H.265 is an optional high-efficiency variant.

#### Audio

| Format | Codec | Notes |
|---|---|---|
| MP3 | MPEG-1/2 Audio Layer III | Universal support |
| AAC / M4A | AAC-LC, HE-AAC v1/v2 | Preferred for video audio tracks |
| WAV | PCM (LPCM) | Uncompressed; large files |
| FLAC | FLAC lossless | Tizen 7.0+ |
| OGG | Vorbis | Web-standard |
| OGG | Opus | Tizen 7.0+ |
| AC3 / EAC3 | Dolby Digital / Dolby Digital Plus | Passthrough on supported hardware |
| WMA | WMA Standard/Pro | **Deprecated from 2025 Signage models (Tizen 9+); do not use** |

#### Images

| Format | Notes |
|---|---|
| JPEG / JPG | Universal; preferred for photos and thumbnails |
| PNG | Transparency supported |
| GIF | Animated; CPU-intensive for large sizes |
| WebP | Tizen 6.0+; preferred for web-optimised delivery |
| BMP | Supported; not recommended (no compression) |
| HEIC | Tizen 6.0+ (2021+ models); convert to JPEG/WebP on server for safety |
| SVG | Rendered by Blink — full SVG 2 support via browser engine |

> **Server-side rule**: Convert all HEIC uploads to WebP or JPEG before serving to devices to ensure compatibility with any Tizen 6+ device without HEIC hardware decode.

### Web Engine capabilities (Tizen 7.0+)

#### JavaScript

| Feature | Support |
|---|---|
| ES2022+ (ES13) — classes, optional chaining, nullish coalescing, etc. | ✅ |
| WebAssembly (WASM) | ✅ |
| Web Workers | ✅ |
| Service Workers | ✅ (Tizen 5.5+) |
| Promises / async-await | ✅ |
| Dynamic `import()` | ✅ |
| WebCrypto API | ✅ |
| WebSockets API | ✅ |
| Fetch API | ✅ |
| IndexedDB | ✅ |
| Cache API | ✅ |
| Tizen Filesystem API (`tizen.filesystem`) | ✅ — use for media blobs > a few MB |

#### Graphics & Layout CSS

| Feature | Support |
|---|---|
| CSS Flexbox Level 1 | ✅ |
| CSS Grid Level 1 + 2 | ✅ |
| CSS Custom Properties (variables) Level 1/2 | ✅ |
| CSS Nesting | ✅ (Tizen 7.0+) |
| CSS Animations Level 1/2 | ✅ |
| CSS Transitions + Transition Level 2 | ✅ |
| CSS Transforms Level 1/2 (2D + 3D) | ✅ |
| CSS View Transitions Level 1 | ✅ (Tizen 8.0+; degrade gracefully on 7.0) |
| CSS Color Level 4 (`oklch`, `color-mix`) | ✅ (Tizen 7.0+) |
| CSS Masking / Clip-path | ✅ |
| CSS Filter Effects Level 1/2 | ✅ |
| CSS Scroll Snap Level 1/2 | ✅ |
| Canvas 2D API | ✅ |
| WebGL 1.0 / 2.0 | ✅ |
| `backdrop-filter` | ✅ |
| `will-change` | ✅ — use on animated elements for GPU compositing |

#### Known constraints & limitations

| Constraint | Detail |
|---|---|
| `getUserMedia` / camera | ❌ Not available on signage displays |
| WebRTC | ❌ Not supported |
| `<video autoplay>` without `muted` | ❌ Blocked (browser autoplay policy — always add `muted`) |
| Multiple simultaneous `<video>` | Limit to **1 active decoder** at a time; use off-screen preload → swap technique |
| H.265 iframe-only trick play | Use `EXT-X-I-FRAME-STREAM-INF` tag in HLS for H.265 trick play |
| `color-mix()` on Tizen 7.0 | Partial — test or polyfill; fully supported on 8.0+ |
| IndexedDB blob size | Practical limit ~100 MB per entry; use Tizen Filesystem for larger files |
| Secure contexts (HTTPS) | WS must use **WSS**; all API calls must be **HTTPS** — no mixed content |
| HEIC decode | Hardware-dependent; always convert to JPEG/WebP server-side |
| RA / RMVB audio | ❌ Removed from Tizen 10.0+ Signage; never use |
| WMA audio | ❌ Removed from Tizen 9.0+ (2025+ signage); avoid |

### DRM support (relevant for premium content)

| DRM | Support |
|---|---|
| **Widevine Modular** (L3) | ✅ Tizen 2.4+ |
| **PlayReady** | ✅ Tizen 3.0+ |
| Widevine Classic | ❌ Deprecated — removed Tizen 4.0+ |
| Verimatrix Web Client | ❌ Removed from 2023+ models |

> For signage content in this platform, DRM is **not required** (content is served from within the org's private server). Widevine/PlayReady only needed if integrating third-party premium media sources in future.

### Samsung API privilege summary

| API | Privilege | Level | Usage |
|---|---|---|---|
| `webapis.productinfo` | `http://developer.samsung.com/privilege/productinfo` | Public | DUID, model, firmware |
| `webapis.widgetdata` | `http://developer.samsung.com/privilege/widgetdata` | Public | Encrypted credential storage |
| `webapis.avplay` / `avplaystore` | Standard web platform | Public | Video hardware decode |
| `webapis.document` | `http://developer.samsung.com/privilege/documentplay` | **Partner** | PDF/PPTX native rendering |
| `webapis.systemcontrol` | `http://developer.samsung.com/privilege/systemcontrol` | **Partner** | Reboot, serial, IR/button lock, orientation, firmware OTA, screenshot |
| `webapis.timer` | `http://developer.samsung.com/privilege/devicetimer` | **Partner** | NTP set/get, on/off timers |
| `webapis.syncplay` | `http://developer.samsung.com/privilege/syncplay` | **Partner** | Multi-device sync/videowall |
| `tizen.tvinputdevice` | `http://tizen.org/privilege/tv.inputdevice` | Public | Remote control key registration |
| `tizen.download` | `http://tizen.org/privilege/download` | Public | File download to filesystem |
| `tizen.filesystem` | `http://tizen.org/privilege/filesystem.write` | Public | Read/write `wgt-private` storage |

### App source module structure

```
apps/tizen/
├── config.xml              Samsung privileges, Tizen 6.5, Partner cert ref
├── index.html              $WEBAPIS injection, mounts #app shell
├── package.json            Vite, TypeScript, JSZip
├── vite.config.ts          Output: dist/ bundled as flat WGT
└── src/
    ├── main.ts             Boot state machine entry point
    ├── state.ts            Global reactive state (emergency, clockDriftMs, wsConnected)
    │
    ├── device/
    │   ├── identity.ts     getDuid, getModel, getModelCode, getSerialNumber, getFirmware
    │   ├── network.ts      getMac, gateway, dns, connType, wifiSsid/strength
    │   ├── system.ts       getOrientation, setMessageDisplay, setIRLock, setButtonLock,
    │   │                   setAutoPowerOn, setSafetyLock, captureScreen
    │   ├── power.ts        getPowerState
    │   └── time.ts         setNTP, getNTP, setOnTimer, setOffTimer, clearTimer (TIMER1–TIMER7)
    │
    ├── api/
    │   ├── client.ts       Authenticated fetch wrapper (attach device JWT)
    │   ├── schedule.ts     GET /device/schedule
    │   ├── content.ts      GET /device/content/:id/file
    │   └── emergency.ts    GET /device/emergency
    │
    ├── ws/
    │   ├── manager.ts      WS connect, reconnect (exp backoff), message dispatch
    │   └── handlers.ts     Handle each WS command type
    │
    ├── scheduler/
    │   ├── index.ts        SchedulerEngine — 10s tick, slot matching, emergency check
    │   ├── slotMatcher.ts  evaluateSlots(slots, now) → best matching slot
    │   └── playlistRunner.ts PlaylistRunner — walks items, duration timer, loop
    │
    ├── cache/
    │   ├── manifest.ts     Read/write wgt-private/cache/manifest.json
    │   ├── downloader.ts   tizen.download priority queue, pause/resume/cancel
    │   └── html5.ts        JSZip extract → write to tizen.filesystem
    │
    ├── renderer/
    │   ├── index.ts        Double-buffer swap coordinator, cross-type transitions
    │   ├── avplayer.ts     avplaystore double-buffer, setVideoStillMode ping-pong
    │   ├── image.ts        <img> double-buffer with CSS fade
    │   ├── iframe.ts       <iframe> for web_url and html5
    │   ├── document.ts     webapis.document open/play/stop/close/gotoPage
    │   └── transition.ts   fade / none CSS transition coordinator
    │
    └── ui/
        ├── pairing.ts      Pairing screen (DUID display, 6-char code entry)
        ├── emergency.ts    Emergency overlay (text + media types)
        └── osd.ts          INFO key OSD (time, device name, IP, schedule name)
```

### App lifecycle

```
Boot
 └─ webapis.widgetdata.read()
     ├─ NotFoundError → Show PAIRING SCREEN
     │    · getDuid(), getModel(), getModelCode(), getFirmware(), getSerialNumber()
     │    · POST /devices/pair/request  { duid, modelName, modelCode, serialNumber, firmwareVersion }
     │    · Display 6-char code + QR on screen
     │    · Poll GET /devices/pair/status?code=XXXXXX until { deviceToken }
     │    · webapis.widgetdata.write({ token, deviceId })
     │    · Run boot auto-config (setAutoPowerOn, setMessageDisplay, setIRLock, setButtonLock,
     │      setNTP, setSafetyLock)
     │    · Reload
     └─ Has token → CONNECT to WS (wss://host/ws/device?token=<jwt>)
                     GET /device/schedule  → cache to wgt-private/schedule.json
                     GET /device/emergency → check for active override
                     Send heartbeat + network_info + system_state
                     Start SCHEDULER LOOP + PREFETCH LOOP
```

### Scheduler loop

```
Schedule refresh (every 5 min + on WS "refresh_schedule" command):
  1. GET /device/schedule  → compare to cached version
  2. If changed: update wgt-private/schedule.json, trigger PREFETCH
  3. PREFETCH: collect all contentIds for next 24h → diff vs manifest.json
              → queue missing/stale files via tizen.download (priority: now-playing first)

Scheduler tick (every 10s):
  1. adjustedNow = Date.now() - clockDriftMs
  2. Check emergency state → if active, show emergency overlay, skip
  3. evaluateSlots(allSlots, adjustedNow):
       filter by time window + recurrence (daily/weekly/once)
       sort by override-type first, then priority DESC
  4. If best slot found:
       If best slot === current slot → no-op
       Else: destroy current runner, start new PlaylistRunner / ZoneRunner for new slot
  5. If NO slot matches (gap in schedule or no schedule assigned):
       Walk fallback chain:
         a. device.defaultPlaylistId   → run as PlaylistRunner (loop indefinitely)
         b. workspace.defaultPlaylistId → run as PlaylistRunner (loop indefinitely)
         c. Built-in idle screen        → show ui/idle.ts (no network, no storage needed)
       Fallback re-evaluated every tick — if a slot activates it preempts immediately

PlaylistRunner:
  - Flattens nested playlists recursively
  - On each item: calls renderer for content type, starts duration timer
  - On timer/video-end: advance to next item, loop if configured
  - On emergency command: pause, show overlay; on clear: resume
```

### Content renderers & layer architecture

```
┌─────────────────────────────────────────────────────┐
│  z=100  #emergency-overlay  (full-screen HTML)       │  ← always on top
│  z=50   #osd-overlay        (INFO OSD, HTML)         │
│  z=10   #html-layer                                  │
│         ├─ #slot-a  (img / iframe double-buffer A)   │  ← images, web_url, html5
│         └─ #slot-b  (img / iframe double-buffer B)   │
─────────────────────────────────── hardware boundary ──
│         webapis.document                             │  ← pdf, presentation
│         webapis.avplaystore  p1 / p2 double-buffer   │  ← video (below HTML/document)
└─────────────────────────────────────────────────────┘
```

| Type | Renderer | Layer | Notes |
|---|---|---|---|
| `image` | `<img>` double-buffer + CSS fade | HTML | WebP/JPEG from local cache |
| `video` | `webapis.avplaystore` + `setVideoStillMode` | Hardware | Seamless ping-pong; no black flash between clips |
| `web_url` | `<iframe>` | HTML | Direct URL; no caching |
| `html5` | `<iframe>` → `wgt-private/html5/<id>/index.html` | HTML | JSZip extract on first use |
| `pdf` / `presentation` | `webapis.document.open({docpath, rect})` → `play(slideTime)` | Hardware | Partner privilege; `gotoPage()` for WS-commanded page jump |

**Key rendering facts:**
- `webapis.avplaystore.getPlayer()` provides independent named player instances (vs `webapis.avplay` singleton)
- Video still mode: `player.setVideoStillMode("true")` holds last frame on screen during swap — prevents black flash
- All video transitions: ping-pong between `p1` and `p2`; active player uses `onstreamcompleted` to trigger next
- HTML layer (img/iframe) renders on top of avplay hardware layer naturally — emergency overlay and OSD overlay require no special z-index tricks vs video
- `webapis.document` and `webapis.avplaystore` cannot both render simultaneously — scheduler stops one before starting the other

### WS protocol — server → device commands

```ts
// Commands pushed by server over WSS
type WsCommand =
  | { type: 'reboot' }                                   // webapis.systemcontrol.rebootDevice()
  | { type: 'screenshot' }                               // captureScreen() → read jpg → base64 → send back
  | { type: 'refresh_schedule' }                         // re-pull GET /device/schedule
  | { type: 'emergency_start'; payload: EmergencyPayload }
  | { type: 'emergency_clear' }
  | { type: 'power_off' }                                // device standby
  | { type: 'set_ntp'; payload: { use: 'ON'|'OFF'; address?: string; timeZone?: string } }
  | { type: 'set_ir_lock'; payload: { lock: 'ON'|'OFF' } }
  | { type: 'set_button_lock'; payload: { lock: 'ON'|'OFF' } }
  | { type: 'set_on_timer'; payload: { timerId: string; time: string; setup: string; volume?: number; manual?: string[] } }
  | { type: 'set_off_timer'; payload: { timerId: string; time: string; setup: string } }
  | { type: 'clear_on_timer'; payload: { timerId: string } }
  | { type: 'clear_off_timer'; payload: { timerId: string } }
  | { type: 'update_tv_firmware'; payload: { softwareId: string; fileName: string; version: string; url: string; totalBytes: number } }
  | { type: 'update_player'; payload: { downloadUrl: string; version: string } }
  | { type: 'clear_cache' }
  | { type: 'dump_logs' }                                // flush device_log buffer → device_log WS message
  | { type: 'set_screenshot_interval'; payload: { intervalMin: number } }  // 0 = disable interval fallback; on-change capture is always on
  | { type: 'set_zones'; payload: { zones: Array<{ id: string; name: string; x: number; y: number; w: number; h: number; playlistId: string | null }> } }
```

### WS protocol — device → server messages

```ts
type DeviceMessage =
  | { type: 'heartbeat'; payload: {
      playerVersion:    string;        // apps/tizen config.xml version
      firmwareVersion:  string;        // webapis.productinfo.getFirmware()
      powerState:       string;        // 'ON' | 'STANDBY'
      clockDriftMs:     number;        // device.now() - server.now() (ms)
      irLock:           string;        // 'ON' | 'OFF'
      buttonLock:       string;        // 'ON' | 'OFF'
      currentContentId: string | null; // currently displayed content UUID — live "now playing"
      nextContentId:    string | null; // next item in scheduler queue — "up next" indicator
      nextStartsAt:     string | null; // ISO 8601 — when next content begins
      cpuLoad:          number;        // 0–100 — tizen.systeminfo CPU.load × 100
      storageFreeBytes: number;        // tizen.systeminfo STORAGE.availableCapacity (wgt-private)
      temperatureCelsius: number;      // webapis.systemcontrol.getTemperature() — panel temp sensor
    }
  }
  | { type: 'network_info'; payload: { ipAddress: string; macAddress: string; connectionType: string; isGatewayConnected: boolean; wifiSsid?: string; wifiStrength?: number } }
  | { type: 'system_state'; payload: { screenOrientation: string; autoPowerOn: string; ntpEnabled: string; ntpServer: string; ntpTimezone: string } }
  | { type: 'screenshot_data'; payload: { imageBase64: string; capturedAt: string } }
  | { type: 'firmware_progress'; payload: { progress: number } }  // 0–100
  | { type: 'play_log'; payload: { events: Array<{
      contentId:     string;      // UUID of the content_items row
      zoneId:        string;      // 'default' or named zone id (multi-zone support)
      startedAt:     string;      // ISO 8601
      endedAt:       string;      // ISO 8601
      durationMs:    number;      // actual ms played (may be less than full duration if skipped)
      completedFull: boolean;     // true = played to natural end
      source:        string;      // 'schedule' | 'emergency' | 'manual'
    }> }
  }
  | { type: 'download_progress'; payload: {
      contentId:      string;
      receivedBytes:  number;
      totalBytes:     number;
      queueLength:    number;     // remaining items in download queue
    }
  }
  | { type: 'device_log'; payload: {
      level:    'info' | 'warn' | 'error';
      entries:  Array<{ ts: string; level: string; msg: string }>; // last ≤500 entries
    }
  }
  | { type: 'ack'; payload: { command: string; success: boolean; error?: string } }
```

### OTA Player Updates

The Tizen `.wgt` player app needs a mechanism to update itself without manual physical access.

- The API exposes a **player version endpoint**: `GET /devices/player-version` returns the current required `.wgt` version + download URL.
- On every boot and every 6-hour polling cycle, the Tizen app compares `config.xml` version to the server's required version.
- If a newer version exists: download the `.wgt` from the server, call `tizen.application.install()` to side-load, then relaunch.
- The Super Admin uploads a new `.wgt` via `POST /superadmin/player-releases` (versioned, with release notes). Rollout can be gated by `rollout_pct` (0–100%) to canary-test on a subset of devices before full deployment.
- Version history is kept in a `player_releases` table; super admin can pin an org to a specific version.

```sql
player_releases (
  id           UUID PK,
  version      TEXT NOT NULL UNIQUE,  -- semver e.g. "1.4.2"
  file_path    TEXT NOT NULL,         -- /var/signage/player/<version>.wgt
  release_notes TEXT,
  rollout_pct  SMALLINT DEFAULT 100,
  created_at   TIMESTAMPTZ DEFAULT now()
)
```

### Device Power & Timer Schedule

On/off schedule is managed by the Samsung **Timer API** (`webapis.timer`, Partner privilege `devicetimer`). Up to 7 independent on-timers and 7 off-timers can be set per device. The dashboard sends `set_on_timer` / `set_off_timer` WS commands which the device applies via:

```js
// Timer IDs: "TIMER1" through "TIMER7"
// setup: "TIMER_OFF" | "TIMER_ONCE" | "TIMER_EVERYDAY" | "TIMER_MON_FRI" | "TIMER_SAT_SUN" | "TIMER_MANUAL"
webapis.timer.setOnTimer({ timerID: "TIMER1", time: "08:00", setup: "TIMER_MON_FRI", volume: 10 });
webapis.timer.setOffTimer({ timerID: "TIMER1", time: "22:00", setup: "TIMER_MON_FRI" });
// For specific days: setup: "TIMER_MANUAL", manual: ["MON", "WED", "FRI"]
```

NTP sync is also set to the device via the Timer API:
```js
webapis.timer.setNTP({ use: "ON", address: "pool.ntp.org", timeZone: "Asia/Dubai" });
```

Device timer state is reported back to the server in the `system_state` WebSocket message and persisted to the `devices` table (`ntp_server`, `ntp_timezone`, etc.).

### Offline Resilience

- **Schedule JSON** stored at `wgt-private/schedule.json` (Tizen Filesystem).
- **Media files** stored via `tizen.filesystem.resolve('wgt-private')` — persistent writable sandbox:
  ```
  wgt-private/cache/
    manifest.json          { [contentId]: { path, contentVersion, cachedAt, size } }
    <contentId>.jpg        images
    <contentId>.mp4        videos
    <contentId>.pdf        PDF files (for webapis.document)
    <contentId>.pptx       presentations (for webapis.document)
    html5/<contentId>/     extracted HTML5 ZIP packages
      index.html
      assets/…
  ```
- **Downloads via `tizen.download`** (NOT XHR): streams directly to filesystem, supports pause/resume/cancel, no RAM buffering — critical for large video files. Sends `download_progress` WS messages so the dashboard shows a live prefetch indicator.
- **Cache version key**: `contentVersion` = content `updatedAt` timestamp — stale detection without server round-trip.
- **File integrity**: server includes `sha256` hash in the schedule JSON for every content item. Device verifies the hash of each cached file before playing — silently re-downloads if corrupt. Catches partial downloads and storage bit-rot.
- **Pre-fetch priority**: now-playing content → next-in-playlist → rest of 24h lookahead.
- **Cache eviction**: LRU eviction when storage > 80% full — removes content not in any upcoming slot.
- **PDF/PPTX**: stored as-is; `webapis.document.open({ docpath: "filesystem://wgt-private/cache/<id>.pdf", ... })` renders natively — no JPEG page extraction needed.
- **Proof-of-play buffer**: play events written to `wgt-private/proof-of-play.json` first (crash-safe), then batch-flushed via `play_log` WS message every 5 min or on reconnect.
- **Log buffer**: last 500 `console.log/warn/error` entries kept in a circular in-memory buffer + `wgt-private/device.log`. Auto-flushed on reconnect if errors are present; dump-on-demand via `dump_logs` WS command.
- Plays last-known schedule indefinitely if network is lost.
- WS reconnect exponential backoff: 1 s → 2 s → 4 s → 8 s → 30 s → 60 s max.
- On reconnect: re-authenticate, send heartbeat, refresh schedule, poll `/device/emergency`.

### VideoWall / SyncPlay (Future — Phase 3+)

All devices in a Sync Group download their assigned content to local cache, then play in hardware-synchronized lockstep via `webapis.syncplay` (Partner privilege).

**Two modes:**
- **Mode A — Full video sync**: All devices download the same file and play it in sync. Used for arrays of identical displays.
- **Mode B — Pre-cropped tile content**: Server generates per-tile cropped variants via FFmpeg (`-vf "crop=W:H:X:Y"`). Each device downloads only its tile. Combined screens form one large image/video.

**Sequence:**
```
1. Server: send WS message 'prefetch_sync_content' { contentId per device }
2. Devices: download tile content → send 'sync_ready' WS message
3. Server: when ALL members send 'sync_ready' → send 'start_sync_play' { groupId, playlist }
4. Devices: createPlaylist([local file]) → syncplay.start({ groupID, rectX:0, rectY:0, rectW:1920, rectH:1080 })
   All members share same groupID → hardware clock synchronised
```

No UDP multicast; all content is pre-downloaded MP4 played from local storage.

### Multi-Zone Layout

A device can be split into 2–4 named display zones. Each zone has its own playlist assignment and a bounding rect (`x, y, w, h` in pixels). The server stores the zone config in `devices.zones` as a JSONB array and sends it via the `set_zones` WS command.

On the Tizen side, `ZoneRunner` replaces the single `PlaylistRunner`. Each zone runs independently:

```
devices.zones: [
  { id: "main",   name: "Main",   x:    0, y:   0, w: 1440, h: 1080, playlistId: "aaa" },
  { id: "ticker", name: "Ticker", x:    0, y: 980, w: 1920, h:  100, playlistId: "bbb" },
  { id: "sidebar",name: "Sidebar",x: 1440, y:   0, w:  480, h:  980, playlistId: "ccc" }
]
```

- AVPlay `setDisplayRect(x, y, w, h)` and `webapis.document.open({ rectX, rectY, rectWidth, rectHeight })` already accept positional rects — no extra Samsung API needed
- HTML layer content (`<img>`, `<iframe>`) positioned with absolute CSS inside a zone wrapper div
- Emergency overlay always covers full screen (z=100) regardless of zone config
- Each zone reports `currentContentId` independently in heartbeat (heartbeat payload becomes `zones: Array<{ id, currentContentId, nextContentId }>` when multi-zone is active)
- Dashboard zone editor: drag-resize zone regions on a 1920×1080 canvas preview

### Built-in Idle Screen

When the fallback chain reaches its end (no schedules, no default playlists configured), the Tizen player shows the built-in idle screen. It is bundled inside the `.wgt` — no network or cached files required.

```
┌─────────────────────────────────────────────────────┐
│                                                     │
│              [  logo / org branding  ]               │
│                                                     │
│                     14:32                            │
│               Thursday, 19 March 2026               │
│                                                     │
│                                                     │
│   ● ONLINE    Lobby Screen A    192.168.1.42          │
└─────────────────────────────────────────────────────┘
```

- **Clock**: large digital clock, updates every second using local OS time (no network call)
- **Date**: full long-form date in the device timezone
- **Logo**: if `workspace.settings.logoUrl` is set and its file exists in `wgt-private`, show org logo; otherwise a minimal default mark
- **Status bar**: WS connection dot (green online / amber reconnecting / red offline), device name, IP address
- **Background**: dark `#0a0a0f` with a slow-panning subtle gradient — avoids OLED/LCD static-pixel burn-in
- **Fully offline**: clock and layout are pure HTML/CSS/JS bundled into the `.wgt` — shows even with no network and empty cache
- Dismissed instantly when a scheduled slot activates or a default playlist becomes available

### On-Device Debug Overlay

Hold the **INFO** remote key for **3 seconds** to show a full-screen diagnostic overlay — no server involved:

```
┌─────────────────────────────────────────────────────┐
│  DEVICE DEBUG       [press INFO to dismiss]          │
│                                                      │
│  WS: CONNECTED   Player: 1.4.2   Tizen: 6.5.0       │
│  IP: 192.168.1.42   MAC: AA:BB:CC:DD:EE:FF           │
│  CPU: 23%   Temp: 41°C   Storage: 14.2 GB free       │
│  Clock drift: +120 ms   Power: ON                    │
│                                                      │
│  Current slot: "Morning Retail"  (Playlist: Shop-AM) │
│  Now playing: product-hero-q1.mp4                    │
│  Up next: brand-reel-30s.mp4  (in 28s)               │
│                                                      │
│  Cache: 47 files / 8.3 GB   Queue: 0 pending         │
│                                                      │
│  Last 5 errors:                                      │
│  [10:24:01] WARN avplayer: stream completed early    │
│  [10:11:55] INFO ws: reconnected after 8s backoff    │
│  ...                                                 │
└─────────────────────────────────────────────────────┘
```

### Signed Proof-of-Play Export

The `play_events` table (13-month retention) feeds the Proof-of-Play report:

- Dashboard `/:wsId/proof-of-play` page: date-range picker, filter by device/content/tag
- Export triggers a server job that:
  1. Queries `play_events` for the selected range
  2. Generates a CSV and a formatted PDF
  3. Signs the payload with the org's **RSA-2048 private key** (stored in server secrets vault, never exposed to client)
  4. Embeds a detached PEM signature block in the PDF footer + a `.sig` file alongside the CSV
- Recipients verify with the org's public key (downloadable from `GET /orgs/:slug/public-key`)
- Signing covers: org ID, date range, row count, and SHA-256 of the CSV content — any tampering invalidates the signature

### Streaming support (optional, for larger deployments)

Tizen 7.0+ supports adaptive bitrate streaming natively via **MSE (W3C Media Source Extensions)**:

| Protocol | Container | DRM |
|---|---|---|
| HLS | TS / fMP4 | Widevine Modular, PlayReady |
| MPEG-DASH | fMP4 | Widevine Modular, PlayReady |
| Smooth Streaming | fMP4 | PlayReady |

For Phase 1 the player will use **direct file download + local playback** (simpler, fully offline-capable). Adaptive streaming can be added in a later phase for very large video assets.

---

## 11. Content Pipeline

```
Upload request (multipart)
  │
  ▼
Fastify route → streams to /var/signage/uploads/tmp/<uuid>.<ext>
  │
  ▼
BullMQ job: "process-content"
  │
  ├─ image   → Sharp: resize (max 3840×2160), convert to WebP (lossy 85%), strip metadata
  │           → Sharp: generate 320×180 thumbnail JPEG
  │           → if HEIC input: decode first, then re-encode (Sharp handles via libheif)
  │
  ├─ video   → FFmpeg: probe codec/resolution/duration/fps
  │           → FFmpeg: transcode to H.264 High Profile + AAC-LC, MP4 container
  │              · target: max 30 Mbps, max 4K (3840×2160), max 60fps
  │              · audio: 48 kHz, stereo, 192 kbps AAC
  │              · `-movflags +faststart` for progressive download
  │           → FFmpeg: extract frame at 2s → thumbnail JPEG (320×180)
  │           → Optional: generate H.265 variant if source > 1080p (stored as processed_hevc.mp4)
  │
  ├─ html5   → Unzip to uploads/content/<id>/package/ → validate index.html exists
  │           → enumerate all files → store in content_files table
  │           → Playwright headless (Chromium) → screenshot → thumbnail JPEG
  │
  ├─ pptx/ppt → LibreOffice headless: `soffice --headless --convert-to pdf`
  │           → Ghostscript: rasterise each page to JPEG @ 1920×1080, 85 quality
  │              · `gs -dNOPAUSE -dBATCH -sDEVICE=jpeg -r96 -dJPEGQ=85`
  │           → First page → resize to 320×180 thumbnail
  │           → Store page count in content_items.metadata.page_count
  │
  └─ pdf     → Ghostscript: rasterise each page to JPEG @ 1920×1080, 85 quality
              → First page → resize to 320×180 thumbnail
              → Store page count in content_items.metadata.page_count
  │
  ▼
Move to permanent path: uploads/<org_id>/<content_id>/
Update content_items: status='ready', width, height, duration, thumbnail_path, metadata
```

### Storage layout

```
/var/signage/uploads/
  <org_id>/
    <content_id>/
      original.<ext>        ← raw uploaded file
      processed.<ext>       ← transcoded/converted version
      thumbnail.jpg         ← 320×180 thumbnail
      pages/                ← for PDF/PPTX: 001.jpg, 002.jpg …
      package/              ← for HTML5: extracted zip
        index.html
        …
```

---

## 12. Scheduling Engine

The scheduling engine runs as a **BullMQ worker** that recomputes `device_manifests` whenever any schedule, playlist, or device-workspace assignment changes. It also runs on a 1-minute cron to catch time-based activations.

### Manifest computation algorithm

```
For each device D in organization:
  1. Query all active schedules targeting D (by device_id OR matching tag)
  2. Filter to schedules whose time rule is currently active:
     - always      → always included
     - time_window → now() BETWEEN start_at AND end_at
     - recurring   → evaluate cron expression for current time in cron_tz
     - event       → has been manually triggered and not yet cleared
  3. Sort by priority DESC, then created_at DESC
  4. Take the first (highest priority) → that is the "now playing" schedule
  5. Look ahead 24h: compute ordered list of schedule activations
  6. Serialise to JSON manifest:
     {
       "device_id": "...",
       "now": { "schedule_id", "playlist_id", "name" },
       "upcoming": [ { start, end, schedule_id, playlist_id }, … ],
       "hash": "sha256 of manifest JSON"
     }
  7. Upsert into device_manifests
  8. Publish "MANIFEST_UPDATED" to device WS channel
```

---

## 13. Theme System

The dashboard supports **two themes**, toggled by setting `data-theme` on `<body>`.

### Theme A — Brand (default)

Tokens implemented in `apps/web/src/styles/globals.css`. Logo assets: `Docs/Plan/logo/nexari.png` (used in the dashboard nav) and `Docs/Plan/logo/favicon.svg` (browser tab / PWA icon).

| Token | Value | Meaning |
|---|---|---|
| `--bg` | `#0f1115` | Base background |
| `--bg2` | `#0b0d11` | Gradient end |
| `--card` | `rgba(255,255,255,0.06)` | Card surface |
| `--blue` | `#3a7bff` | Primary action |
| `--aqua` | `#4ff2d1` | Accent / online status |
| `--magenta` | `#ff3ea5` | Danger / error |
| Font | Inter | System-ui fallback |

Radial gradient background (indigo/blue/aqua blobs), glass morphism cards, pill buttons, sticky blur header.  
Light mode variant via `[data-theme="light"]` token overrides.

### Theme B — Cyberpunk

Tokens implemented in `apps/web/src/styles/cyberpunk.css`.

| Token | Value | Meaning |
|---|---|---|
| `--cp-cyan` | `#00fff9` | Primary / connected |
| `--cp-pink` | `#ff2d78` | Error / offline |
| `--cp-yellow` | `#f5ff00` | Warning / working |
| `--cp-green` | `#39ff14` | Success / power-on |
| `--cp-bg` | `#03000e` | Deep background |
| Font | Orbitron / Share Tech Mono | Sci-fi monospace |

Animated grid drift, scanlines, corner-notch `clip-path` shapes, neon glow `box-shadow`, glitch title effects, HUD corner brackets, auto-hover simulator (for kiosk mode).

### Implementation

```tsx
// ThemeContext.tsx
type Theme = 'brand' | 'brand-light' | 'cyberpunk';

const ThemeContext = createContext<{ theme: Theme; setTheme: (t: Theme) => void }>(…);

function ThemeProvider({ children }) {
  const [theme, setTheme] = useState<Theme>(() =>
    (localStorage.getItem('theme') as Theme) ?? 'brand'
  );

  useEffect(() => {
    const body = document.body;
    body.removeAttribute('data-theme');
    if (theme === 'cyberpunk') body.setAttribute('data-theme', 'cy');
    if (theme === 'brand-light') body.setAttribute('data-theme', 'light');
    localStorage.setItem('theme', theme);
  }, [theme]);

  return <ThemeContext.Provider value={{ theme, setTheme }}>{children}</ThemeContext.Provider>;
}
```

CSS: `globals.css` defines brand tokens on `:root`; `cyberpunk.css` overrides everything under `body[data-theme="cy"]` — zero conflict, one import each.

---

## 14. Infrastructure & Deployment

### systemd services

```ini
# /etc/systemd/system/mosquitto.service  (installed by apt; override with drop-in)
# /etc/mosquitto/conf.d/signage.conf
# listener 1883
# allow_anonymous false
# password_file /etc/mosquitto/passwd
# topic read signage/#
# topic write signage/#

# /etc/systemd/system/signage-sensor-worker.service
[Unit]
Description=Signage Sensor Worker
After=network.target postgresql.service redis.service mosquitto.service

[Service]
User=signage
WorkingDirectory=/opt/signage/apps/sensor-worker
ExecStart=/usr/bin/node dist/index.js
Restart=on-failure
EnvironmentFile=/etc/signage/sensor-worker.env

[Install]
WantedBy=multi-user.target

# /etc/systemd/system/signage-api.service
[Unit]
Description=Signage API Server
After=network.target postgresql.service redis.service

[Service]
User=signage
WorkingDirectory=/opt/signage/apps/api
ExecStart=/usr/bin/node dist/index.js
Restart=on-failure
RestartSec=5
Environment=NODE_ENV=production
EnvironmentFile=/etc/signage/api.env

[Install]
WantedBy=multi-user.target
```

Three units: `signage-api`, `signage-ws`, `signage-worker` (or combine api+ws in one process).

### Nginx config sketch

```nginx
# /etc/nginx/sites-enabled/signage.conf

server {
  listen 80;
  server_name signage.example.com;
  return 301 https://$host$request_uri;
}

server {
  listen 443 ssl http2;
  server_name signage.example.com;

  ssl_certificate     /etc/letsencrypt/live/signage.example.com/fullchain.pem;
  ssl_certificate_key /etc/letsencrypt/live/signage.example.com/privkey.pem;

  # Gzip
  gzip on;
  gzip_types text/plain application/json application/javascript text/css;

  # Security headers
  add_header X-Frame-Options SAMEORIGIN;
  add_header X-Content-Type-Options nosniff;
  add_header Referrer-Policy strict-origin-when-cross-origin;
  add_header Content-Security-Policy "default-src 'self'; ...";

  # Static media served directly (NVMe performance)
  location /uploads/ {
    alias /var/signage/uploads/;
    expires 7d;
    add_header Cache-Control "public, immutable";
  }

  # API
  location /api/ {
    proxy_pass         http://127.0.0.1:3000;
    proxy_http_version 1.1;
    proxy_set_header   Host $host;
    proxy_set_header   X-Real-IP $remote_addr;
  }

  # WebSocket
  location /ws {
    proxy_pass          http://127.0.0.1:3001;
    proxy_http_version  1.1;
    proxy_set_header    Upgrade $http_upgrade;
    proxy_set_header    Connection "upgrade";
    proxy_read_timeout  3600s;
  }

  # React SPA (all non-matched routes → index.html)
  location / {
    root  /opt/signage/apps/web/dist;
    try_files $uri $uri/ /index.html;
  }
}
```

### Local Development Environment

Install PostgreSQL 14 and Redis 7 directly on the dev machine — no Docker required.

**Install backing services**:
```bash
# Windows (winget)
winget install PostgreSQL.PostgreSQL.14
winget install Redis.Redis

# macOS
brew install postgresql@14 redis

# Ubuntu / Debian
apt install postgresql-14 redis-server
```

**Create dev database** (run once):
```bash
# Windows — open psql as postgres superuser then:
psql -U postgres -c "CREATE USER signage WITH PASSWORD 'signage_dev_pw';"
psql -U postgres -c "CREATE DATABASE signage_dev OWNER signage;"

# macOS / Linux
createuser -s signage
createdb -O signage signage_dev
```

**Redis** starts automatically as a Windows service after install. Default port 6379, no password needed for local dev.

**First-time project setup**:
```bash
# 1. Install deps
pnpm install

# 2. Run DB migrations
pnpm --filter packages/db db:migrate

# 3. Start API + Web in watch mode
pnpm --filter apps/api dev          # :3000
pnpm --filter apps/web dev          # :5173 (Vite)
```

**System dependencies** (install once on dev machine):
```bash
# Windows (winget)
winget install Gyan.FFmpeg
winget install GhostScript.GhostScript
winget install TheDocumentFoundation.LibreOffice

# macOS
brew install ffmpeg ghostscript
brew install --cask libreoffice

# Ubuntu / Debian
apt install ffmpeg ghostscript libreoffice-headless

# Playwright (Chromium for HTML5 thumbnails — all platforms)
pnpm --filter packages/media exec playwright install chromium
```

**`.env.local` template** (copy to `apps/api/.env`):
```bash
DATABASE_URL=postgresql://signage:signage_dev_pw@localhost:5432/signage_dev
REDIS_URL=redis://localhost:6379
JWT_SECRET=replace_with_32+_random_chars
JWT_REFRESH_SECRET=replace_with_different_32+_random_chars
STORAGE_ROOT=C:/signage_uploads
SMTP_HOST=localhost
SMTP_PORT=1025
SMTP_USER=
SMTP_PASS=
SMTP_FROM=noreply@signage.local
FFMPEG_PATH=ffmpeg
LIBREOFFICE_PATH=soffice
GHOSTSCRIPT_PATH=gswin64c
APP_URL=http://localhost:5173
```

> **Local email**: install [Mailpit](https://github.com/axllent/mailpit/releases) — a single portable `.exe`, no install needed. Run `mailpit.exe` and open `http://localhost:8025` to catch all outgoing email.

### Backup & Disaster Recovery

The Pi 5 is a single host. A backup strategy is essential before going to production.

**Database**
```bash
# /etc/cron.d/signage-backup
# Daily pg_dump at 02:00, keep 14 daily dumps + 4 weekly
0 2 * * * signage pg_dump $DATABASE_URL | gzip > /var/signage/backups/db/$(date +\%Y\%m\%d).sql.gz
# Weekly full dump retained 28 days
0 3 * * 0 signage pg_dump $DATABASE_URL | gzip > /var/signage/backups/weekly/$(date +\%Y\%m\%d).sql.gz
# Prune: keep last 14 daily, 4 weekly
```

**Media files**
- Nightly `rsync` of `/var/signage/uploads/` to an external NAS, USB drive, or cloud bucket (e.g. Backblaze B2 via `rclone`).
- Exclude `tmp/` directory.

**Restore procedure**
1. `gunzip < backup.sql.gz | psql $DATABASE_URL`
2. `rsync` media back from backup destination to `/var/signage/uploads/`
3. Restart all systemd services.

**Offsite option**: `rclone sync /var/signage/uploads/ b2:bucket-name --transfers=4` — add as a weekly cron job once B2 credentials are configured in `/etc/signage/rclone.env`.

**Monitoring**: add a Healthchecks.io (or self-hosted equivalent) ping at the end of each backup cron — if the ping doesn't arrive, send an alert email.

### Environment files

```
/etc/signage/
  api.env         DATABASE_URL, REDIS_URL, JWT_SECRET, SMTP_*, STORAGE_ROOT
  worker.env      (same as api, + FFMPEG_PATH, LIBREOFFICE_PATH)
  sensor-worker.env  MQTT_URL, DATABASE_URL, REDIS_URL
```

### Recommended Pi 5 resource allocation

| Service | Estimated RAM | Notes |
|---|---|---|
| PostgreSQL 14 | 2–4 GB | Set `shared_buffers = 4GB` in postgresql.conf |
| Redis 7 | 256 MB | maxmemory 512mb |
| Node API / WS | 256–512 MB | Per process |
| Node Worker | 512 MB – 1 GB | FFmpeg child processes peak at 500 MB/job |
| Node Sensor Worker | 128 MB | MQTT subscriber + rule evaluator; lightweight |
| Mosquitto | 32 MB | MQTT broker; very low footprint |
| Nginx | 64 MB | |
| OS headroom | 2 GB | |
| **Total** | **~8–11 GB** | Well within 16 GB budget |

---

## 15. Development Phases

### Phase 1 — Foundation (Weeks 1–3)
- [ ] Monorepo scaffold (`pnpm workspaces`, `tsconfig.base.json`)
- [ ] `packages/db` — Drizzle schema + initial migrations (incl. `audit_log`, `org_storage_quotas`, `notifications`, `api_keys`)
- [ ] `apps/api` — Fastify skeleton, auth routes (login / refresh / invite flow), JWT middleware
- [ ] Two-factor authentication: TOTP setup (`/auth/2fa/setup`), verify, disable, backup codes; login 2FA step
- [ ] `apps/web` — Vite + React + Router scaffold, login page, 2FA login step, account security page, theme system
- [ ] Super admin UI: org list, create org, invite org owner, storage quota management
- [ ] Org user invite + accept flow
- [ ] Audit log middleware (hook on all mutating routes; write to `audit_log`)

### Phase 2 — Device Management & Tizen App (Weeks 4–8)

#### 2a — Server side
- [ ] DB migration 0008: add `duid`, `model_name`, `model_code`, `serial_number`, `mac_address`, `connection_type`, `wifi_ssid`, `wifi_strength`, `screen_orientation`, `power_state`, `ir_lock`, `button_lock`, `auto_power_on`, `ntp_enabled`, `ntp_server`, `ntp_timezone`, `clock_drift_ms`, `pairing_expires_at` to `devices` table
- [ ] Update `@signage/shared` — `PairRequestSchema` (add duid/modelName/modelCode/serialNumber/firmwareVersion), `DeviceSchema` (all new columns)
- [ ] Update `POST /devices/pair/request` — accept hardware identity body, DUID dedupe (upsert on existing record if DUID matches)
- [ ] New device route group `/device/*` (device JWT auth, separate from user routes):
  - `GET /device/schedule` — returns full resolved schedule tree for the device's workspace
  - `GET /device/content/:id/file` — stream content file with Range support (verifies device workspace membership)
  - `GET /device/emergency` — returns active emergency for this device or `null`
- [ ] Extend WS `handleDeviceMessage` — handle all new message types: `network_info`, `system_state`, `screenshot_data`, `firmware_progress`, `ack`
- [ ] Extend `WsCommand` type — all commands listed in §10 WS protocol
- [ ] WebSocket server + device registry
- [ ] Device heartbeat; real-time status on dashboard
- [ ] Device screenshot history: receive `screenshot_data` WS message → store to `device_screenshots` table; gallery UI on device detail page
- [ ] Device replacement flow: `POST /devices/:id/replace` — copy config + schedule assignments to new device
- [ ] Emergency override: API routes + WS `emergency_start`/`emergency_clear` + Tizen handler
- [ ] OTA player update: `player_releases` table, `GET /devices/player-version`, Tizen auto-install

#### 2b — Dashboard (DS) additions
- [ ] Device detail page: show DUID, serial number, MAC address, firmware version
- [ ] Device detail page: show network info (IP, connection type, Wi-Fi SSID + signal strength bar)
- [ ] Device detail page: show screen orientation, power state, IR lock, button lock state
- [ ] Device detail page: Timer Management tab — view/set on-timers and off-timers (TIMER1–TIMER7), send `set_on_timer`/`set_off_timer` WS commands
- [ ] Device detail page: NTP tab — view/set NTP server + timezone, send `set_ntp` WS command
- [ ] Device detail page: Power Control — send `power_off` WS command; show current power state
- [ ] Device detail page: Firmware tab — show current firmware version, trigger `update_tv_firmware` WS command
- [ ] Org dashboard device cards: add DUID / IP / orientation / last NTP sync info tooltip
- [ ] Device list: add orientation filter + connection type filter

#### 2c — Tizen app (`apps/tizen` scaffold)
- [ ] `apps/tizen` directory: `config.xml`, `index.html` with `$WEBAPIS` injection, `package.json`, `vite.config.ts`
- [ ] `device/identity.ts` — getDuid, getModel, getModelCode, getSerialNumber, getFirmware
- [ ] `device/network.ts` — getMac, gateway, dns, connType, wifiSsid/strength
- [ ] `device/system.ts` — getOrientation, setMessageDisplay, setIRLock, setButtonLock, setAutoPowerOn, setSafetyLock, captureScreen
- [ ] `device/power.ts` — getPowerState
- [ ] `device/time.ts` — setNTP, getNTP, setOnTimer, setOffTimer, clearTimer
- [ ] `api/client.ts`, `api/schedule.ts`, `api/content.ts`, `api/emergency.ts`
- [ ] `ws/manager.ts` — connect, reconnect with exp backoff, message dispatch
- [ ] `ws/handlers.ts` — handle all WS command types
- [ ] Pairing screen (`ui/pairing.ts`) — boot state machine, WidgetData read/write
- [ ] Boot auto-config sequence
- [ ] Heartbeat loop (30s) + network snapshot (5 min)
- [ ] Scheduler engine: `scheduler/index.ts`, `slotMatcher.ts`, `playlistRunner.ts`
- [ ] Cache system: `cache/manifest.ts`, `cache/downloader.ts` (tizen.download), `cache/html5.ts` (JSZip)
- [ ] Renderer layer: `renderer/avplayer.ts` (video), `renderer/image.ts`, `renderer/iframe.ts`, `renderer/document.ts` (pdf/pptx), `renderer/transition.ts`
- [ ] Emergency overlay (`ui/emergency.ts`) — text + media types, XSS-safe DOM injection
- [ ] OSD + remote key handling (`ui/osd.ts`)
- [ ] Screenshot via `captureScreen()` → filesystem read → base64 → WS send
- [ ] OTA firmware: `update_tv_firmware` command handler with progress reporting
- [ ] OTA player: download `.wgt`, `tizen.application.install()`, relaunch

### Phase 3 — Content (Weeks 9–11)
- [ ] `packages/media` — FFmpeg, Sharp, LibreOffice wrappers
- [ ] Upload API (multipart, streaming to disk) with storage quota enforcement (507 on overflow)
- [ ] BullMQ worker + media processing jobs (all 5 content types)
- [ ] Content library UI — grid, upload zone, progress, preview modal
- [ ] Thumbnail serving via Nginx
- [ ] Content `valid_from`/`valid_until` fields + expiry badge UI
- [ ] Content `orientation` flag + orientation mismatch warning in playlist editor
- [ ] Content approval workflow: `draft → pending_review → approved | rejected`; workspace toggle in settings
- [ ] Clone content API + UI ("Duplicate" context menu item)
- [ ] Tag system: `workspace_tags` table, tag CRUD API, tag chips on content cards
- [ ] Content folder tree: `content_folders` table, folder sidebar, move-to-folder
- [ ] Content list filters: type, status, tags, folder, uploaded-by, date range, sort
- [ ] `pg_trgm` extension + GIN indexes on name/description + tags
- [ ] Orphan filter (content not in any playlist)
- [ ] Storage usage API + org storage page

### Phase 4 — Playlists (Weeks 12–13)
- [ ] Playlist CRUD API (with `tags` field)
- [ ] Playlist editor UI (drag-drop with @dnd-kit, duration timeline)
- [ ] Orientation mismatch warning (portrait content in landscape playlist)
- [ ] Validity-expired content warning inside playlist editor
- [ ] Browser-based playlist preview
- [ ] Clone playlist API + UI
- [ ] Tizen: playlist renderer (sequenced content with transitions)
- [ ] Tizen: respect `valid_from`/`valid_until` — skip expired items during playback
- [ ] Playlist list filters: tags, usage (orphan), created-by, sort
- [ ] Bulk tag actions on playlist list

### Phase 5 — Scheduling (Weeks 14–15)
- [ ] Schedule CRUD API (with `tags` field)
- [ ] Scheduling engine: timezone-aware cron evaluation using `devices.timezone`
- [ ] Scheduling engine: skip content items outside `valid_from`/`valid_until` window
- [ ] Schedule calendar UI (FullCalendar integration, conflict detection)
- [ ] Schedule list view with filter bar (status, tags, rule-type, device/playlist)
- [ ] Clone schedule API + UI
- [ ] Tizen: manifest polling + scheduler loop + offline cache
- [ ] Tizen: device power schedule enforcement (power on/off, reboot, brightness)
- [ ] Bulk tag / activate / deactivate actions on schedule list

### Phase 6 — Analytics & Compliance (Weeks 16–17)
- [ ] Analytics event ingestion from Tizen player
- [ ] Proof of Play ingestion (`proof_of_play` table) from Tizen player
- [ ] Nightly aggregation job
- [ ] Analytics pages (org + workspace + device + content)
- [ ] Proof of Play report page + signed CSV/PDF export
- [ ] Audit log page (`/audit`) with actor/entity/date filters
- [ ] Super admin system health page

### Phase 7 — Polish & Hardening (Weeks 18–20)
- [ ] Multi-workspace switcher UX
- [ ] Bulk device actions (including tag application)
- [ ] Tag Manager page (`/:wsSlug/tags`) — usage counts, merge, delete
- [ ] Saved Filters (Smart Views) — save / load / delete per user per entity
- [ ] `user_pins` (starred items) — pin/unpin from any list card context menu
- [ ] Recent items — Redis sorted set per user; sidebar "Recent" section
- [ ] Global cross-entity search (`Cmd/Ctrl+K` command palette)
- [ ] Orphan content purge tool (`POST /content/purge-orphans` with dry-run mode)
- [ ] In-app notification center: bell tray, unread badge, WS push, `notifications` table; browser Web Notifications for high-priority alerts
- [ ] API key management UI (`/:wsSlug/settings/api-keys`): create, rotate, revoke
- [ ] Scheduled reports (`/:wsSlug/settings/report-schedules`): cron-triggered analytics/PoP email + BullMQ job
- [ ] Email notifications: invite, device offline alert, storage quota warning, content expiry warning
- [ ] Backup cron jobs: daily `pg_dump`, nightly `rsync` media; healthcheck ping; documented restore procedure
- [ ] Rate limiting, input validation audit (OWASP Top 10 pass)
- [ ] Nginx tuning, gzip, caching headers
- [ ] systemd unit files + deployment scripts
- [ ] Device screenshot capture + storage
- [ ] End-to-end testing (Playwright)

### Phase 8 — Sensor Integration (Weeks 21–24)

- [ ] Install and configure Mosquitto MQTT broker on Pi5; systemd unit
- [ ] `apps/sensor-worker` scaffold — MQTT subscriber (`signage/+/sensors/+` wildcard)
- [ ] ESP32 firmware guide (Arduino/PlatformIO): Wi-Fi connect, MQTT publish loop, per-sensor auth credentials
- [ ] `sensor_sources`, `sensor_readings`, `sensor_hourly`, `sensor_rules`, `sensor_rule_events` DB tables
- [ ] Webhook ingest endpoint (`POST /sensors/:id/reading`) with API key auth
- [ ] Cloud API poller framework (BullMQ repeatable job per sensor, configurable interval)
- [ ] Implement first-party pollers: OpenWeatherMap (weather), SwitchBot Cloud API (temp/humidity/motion)
- [ ] Rule evaluator: conditions JSONB parser, AND/OR logic, cooldown enforcement, `last_fired_at` update
- [ ] Rule action: `switch_playlist` — push `SWITCH_PLAYLIST` WS command to matched devices
- [ ] Rule action: `switch_content` — push `SWITCH_CONTENT` command
- [ ] Rule action: `webhook_out` — HTTP POST to external URL with reading payload
- [ ] Rule fire history logging to `sensor_rule_events`
- [ ] Sensor Management page (`/:wsSlug/sensors`) — list, register wizard, detail view
- [ ] Live reading SSE stream (`GET /workspaces/:wsId/sensors/live`)
- [ ] Rule Builder UI — visual condition builder, action picker, device scope picker
- [ ] Sensor sparklines and time-series chart (Recharts) with resolution toggle
- [ ] Tizen player: handle `SWITCH_PLAYLIST` and `SWITCH_CONTENT` WS commands (may already exist via emergency override; extend)
- [ ] Sensor readings analytics page (aggregate chart, rule fire frequency)
- [ ] Email/notification alert action type
- [ ] End-to-end test: ESP32 → MQTT → rule fires → device switches playlist

### Phase 9 — VideoWall & SyncPlay (Future)

- [ ] DB: `sync_groups` + `sync_group_members` tables
- [ ] API: Sync group CRUD (`/workspaces/:wsId/sync-groups`)
- [ ] API: Device sync group assignment endpoint
- [ ] Server: Tile crop job — FFmpeg `-vf "crop=W:H:X:Y"` per tile variant; store as child `content_items`
- [ ] API: WS broadcast `prefetch_sync_content` to all group members
- [ ] API: Track `sync_ready` messages; trigger `start_sync_play` when all members confirm
- [ ] Tizen: `syncplay` module — `createPlaylist`, `start`, `stop`, `removePlaylist`
- [ ] Tizen: `prefetch_sync_content` WS handler — download tile content, send `sync_ready`
- [ ] Tizen: `start_sync_play` WS handler — `createPlaylist` + `syncplay.start({groupID, rect})`
- [ ] Dashboard: Sync Group management page (`/:wsId/sync-groups`)
- [ ] Dashboard: Device detail page — sync group assignment + tile position picker
- [ ] Dashboard: Content upload — optional "Create videowall variants" toggle, tile count/layout picker

---

*Last updated: March 19, 2026*
