# POS Integration Plan

**Approach:** Option 4 — POS as an org-level module, fully refactored onto the platform stack  
**Status:** Implementation — In Progress  
**Created:** April 2026

---

## Refined Decisions (April 2026)

| # | Point | Decision |
|---|-------|----------|
| 1 | Module storage | Keep in `organisations.settings` JSON `{ modules: 'signage' \| 'pos' \| 'both' }` — no new column, stays simple |
| 2 | Approach | **Full migration** — rewrite POS into the platform stack (TSX, Node.js API, same DB) |
| 3 | Python backend | **Remove entirely** — no bridge, all endpoints rewritten in Fastify |
| 4 | UX consistency | POS pages must be **100% identical** to platform UX — same CSS vars, Tailwind, UiPrimitives, sonner, react-query |
| 5 | POS subscription system | **Removed** — controlled by platform plan (`cms_only` / `pos_only` / `both`) via superadmin/management |
| 6 | AI Chat widget | **Removed for now** — will re-add under AI Layer 5 once local AI hardware (AMD RX 9700) is deployed (see `AI_PLATFORM_PLAN.md`) |
| 7 | Required integrations | Listed in §7 — must be finished before POS launch |
| 8 | POS Settings | **Integrate into existing `SettingsPage.tsx`** — add a POS group to the current section registry (shown only when `pos` module is active) |
| 9 | Navigation model | **Unified resource model** — Devices, Analytics, and Dashboard are shared across both modules. CMS-only and POS-only sections are separated below. No duplicate resource pages. || 10 | Sync Groups | **Moved under Devices** — Device Groups sub-page at `/workspaces/:wsId/devices/groups`; group types: `sync`, `videowall`, `location`, `tag` |
| 11 | Player platform | **Manufacturer-agnostic from the start** — `devices.platform` and `devices.manufacturer` columns; Samsung Tizen/SSSP is first; WebOS, Android, Linux, Browser players targeted for future |
| 12 | WeatherWidget | **Platform CMS feature** — removed from POS, becomes a native live-data content widget available in the signage playlist editor (see §3.8) |
| 13 | Kiosk / Kitchen displays | Can run as **Tizen WGT apps** — separate WGT builds for kiosk portrait/landscape and kitchen display; same device registration model as signage |
---

## 1. Overview

The restaurant POS app (~90% feature-complete) is merged into the platform as a named module
(`pos`). Organisations can be on:

| Plan slug     | What's unlocked           |
|---------------|---------------------------|
| `cms_only`    | Signage workspace only    |
| `pos_only`    | POS workspace only        |
| `both`        | Signage + POS             |

Superadmin and management company admins set/upgrade the plan from the org detail page.
When the `pos` module is active for an org, a **POS section** appears automatically in the
left-side navigation of the org workspace.

---

## 2. POS App — Current State Review

### 2.1 Tech stack migration (old → target)
| Concern          | POS (now)                         | Platform target                      |
|------------------|-----------------------------------|--------------------------------------|
| Language         | React JSX                         | React TSX                            |
| Styling          | Per-component `.css` files        | Platform CSS vars + Tailwind v4 — **no per-component CSS** |
| Auth             | JWT in `localStorage`             | Cookie-based session (`useAuthStore`) |
| Backend          | Python FastAPI — **removed**      | Node.js/Fastify (same API server)    |
| DB access        | SQLAlchemy / ORM on Python side   | Drizzle ORM (PostgreSQL, same DB)    |
| Error monitoring | Sentry (own init)                 | Inherit platform Sentry config       |
| Routing          | `react-router-dom` v7, basename `/restaurantpos` | Platform router, nested under org workspace |
| Toasts           | Custom `Toast.jsx`                | `sonner` (platform standard)         |
| Data fetching    | Raw `fetch` / custom `apiClient`  | `@tanstack/react-query` + `api` helper |
| AI Chat          | `AIChat.jsx` widget — **removed** | Re-added later under AI Layer 5 (see `AI_PLATFORM_PLAN.md`) |
| Subscription UI  | `SubscriptionManagement.jsx` — **removed** | Platform plan via superadmin/management |

### 2.2 POS route inventory (current → target)

| Current route                   | Purpose                    | Target platform route                              |
|---------------------------------|----------------------------|----------------------------------------------------|
| `/`                             | Order entry (tables/takeout)| `/workspaces/:wsId/pos`                          |
| `/orders`                       | Order history              | `/workspaces/:wsId/pos/orders`                    |
| `/kitchen`                      | Kitchen display            | `/workspaces/:wsId/pos/kitchen`                   |
| `/payment`                      | Payment screen             | `/workspaces/:wsId/pos/payment`                   |
| `/inventory`                    | Inventory management       | `/workspaces/:wsId/pos/inventory`                 |
| `/expenses`                     | Expense tracking           | `/workspaces/:wsId/pos/expenses`                  |
| `/purchase-orders`              | Purchase orders            | `/workspaces/:wsId/pos/purchase-orders`           |
| `/employees`                    | Employee list              | `/workspaces/:wsId/pos/employees`                 |
| `/team`                         | Team management            | `/workspaces/:wsId/pos/team`                      |
| `/analytics`                    | POS analytics              | `/workspaces/:wsId/pos/analytics`                 |
| `/loyalty`                      | Loyalty program            | `/workspaces/:wsId/pos/loyalty`                   |
| `/loyalty/settings`             | Loyalty config             | `/workspaces/:wsId/pos/loyalty/settings`          |
| `/kiosk-manager`                | Kiosk configuration        | `/workspaces/:wsId/pos/kiosk`                     |
| `/kiosk-devices`                | Kiosk device list          | `/workspaces/:wsId/pos/kiosk/devices`             |
| `/hardware`                     | Hardware / printer setup   | `/workspaces/:wsId/pos/hardware`                  |
| `/settings`                     | Restaurant settings / menu | `/workspaces/:wsId/pos/settings`                  |
| `/settings/subscription`        | Subscription management    | Remove — handled by platform plan system          |
| `/kiosk/portrait`               | Kiosk display (public)     | `/kiosk/:wsId/portrait` (public, no auth)        |
| `/kiosk/landscape`              | Kiosk display (public)     | `/kiosk/:wsId/landscape` (public, no auth)       |
| `/accept-invitation`            | Team invite accept         | Platform `/accept-invite/:token` (already exists) |
| `/signup`                       | Self-serve signup          | Remove — platform superadmin/management creates orgs |
| `/login`                        | POS login                  | Platform `/login` (shared auth)                   |

### 2.3 POS feature modules (subscription feature-gates to preserve)

| Feature               | Maps to platform plan |
|-----------------------|-----------------------|
| Basic order entry     | `pos_only` / `both`   |
| Loyalty program       | pro+                  |
| Advanced analytics    | pro+                  |
| Employee time tracking| pro+                  |
| Expense management    | business+             |
| Purchase orders       | business+             |
| Kiosk / QR ordering   | business+             |
| Multi-location cross-analytics | enterprise+  |
| White-label / SSO     | enterprise+           |

### 2.4 POS components to keep / restyle / remove

| Component              | Keep | Action                                                       |
|------------------------|------|--------------------------------------------------------------|
| `App.jsx`              | ✅   | Convert to `PosOrderPage.tsx`, strip custom auth/state init  |
| `Orders.jsx`           | ✅   | Convert to `PosOrdersPage.tsx`                               |
| `Kitchen.jsx`          | ✅   | Convert to `PosKitchenPage.tsx`                              |
| `Payment.jsx`          | ✅   | Convert to `PosPaymentPage.tsx`                              |
| `Inventory.jsx`        | ✅   | Convert to `PosInventoryPage.tsx`                            |
| `Expenses.jsx`         | ✅   | Convert to `PosExpensesPage.tsx`                             |
| `PurchaseOrders.jsx`   | ✅   | Convert to `PosPurchaseOrdersPage.tsx`                       |
| `Employees.jsx`        | ✅   | Convert to `PosEmployeesPage.tsx`                            |
| `Analytics*.jsx`       | ✅   | Convert to `PosAnalyticsPage.tsx`                            |
| `Loyalty.jsx`          | ✅   | Convert to `PosLoyaltyPage.tsx`                              |
| `LoyaltySettings.jsx`  | ✅   | Decomposed into **POS Loyalty section** in `SettingsPage.tsx` |
| `KioskManager.jsx`     | ✅   | Convert to `PosKioskManagerPage.tsx`                         |
| `KioskDevices.jsx`     | ✅   | Convert to `PosKioskDevicesPage.tsx`                         |
| `KioskPortrait.jsx`    | ✅   | Convert to `PosKioskPortraitPage.tsx` (public route)        |
| `KioskLandscape.jsx`   | ✅   | Convert to `PosKioskLandscapePage.tsx` (public route)       |
| `Settings.jsx`         | ✅   | **Decomposed** — sections distributed into `SettingsPage.tsx` POS group (see §8) |
| `Hardware.jsx`         | ✅   | **Decomposed** — into **POS Hardware section** in `SettingsPage.tsx` |
| `Layout.jsx`           | 🔄  | **Replace** with platform `AppLayout` + POS nav sidebar section |
| `AuthContext.jsx`      | ❌  | **Remove** — use `useAuthStore`                              |
| `SubscriptionContext.jsx` | ❌ | **Remove** — platform plan only                             |
| `Login.jsx`            | ❌  | **Remove** — platform `LoginPage`                            |
| `Signup.jsx`           | ❌  | **Remove** — no self-serve signup                            |
| `AcceptInvitation.jsx` | ❌  | **Remove** — platform `AcceptInvitePage`                    |
| `TenantSelector.jsx`   | ❌  | **Remove** — platform workspace switcher                    |
| `SubscriptionManagement.jsx` | ❌ | **Remove** — plan controlled by superadmin/management     |
| `ProtectedRoute.jsx`   | ❌  | **Remove** — platform route guards                           |
| `WeatherWidget.jsx`    | 🔄  | **Move** → platform CMS live content widget (see §3.8); remove from POS |
| `AIChat.jsx`           | ❌  | **Remove** — re-add when AI hardware layer ships (see `AI_PLATFORM_PLAN.md`) |
| `ErrorBoundary.jsx`    | ✅  | Convert to `PosErrorBoundary.tsx`                            |
| `Toast.jsx`            | ❌  | **Remove** — use `sonner`                                    |

---

## 3. Platform Changes Required

### 3.1 Database schema additions

**Module flag — lives in `organisations.settings` JSON (no new column needed):**
```jsonc
// organisations.settings (already a TEXT column storing JSON)
{
  "modules": "signage" // | "pos" | "both"
}
```
This is the simplest approach. One read of the org already fetches this.  
A dedicated `modules` column can be promoted later if filtering by module at SQL level becomes necessary.

**New POS tables** (new file `packages/db/src/schema/pos.ts`):
```
pos_restaurants        — restaurant profile per workspace (name, address, table_count, currency)
pos_menu_items         — menu items (name, price, category, description, image_url, available)
pos_tables             — table definitions (number, name, seats, location, status)
pos_orders             — orders (workspace_id, table_id, type, status, total, tax, discount)
pos_order_items        — line items on orders
pos_payments           — payment records (order_id, method, amount, tip, reference)
pos_employees          — POS staff (user_id or standalone, role, pin_hash)
pos_time_entries       — clock-in/out records
pos_inventory_items    — inventory (name, unit, quantity, reorder_point, cost)
pos_expenses           — expense records
pos_purchase_orders    — purchase orders
pos_loyalty_customers  — loyalty members (phone, email, points, tier)
pos_loyalty_events     — points earn/redeem history
pos_kiosk_devices      — kiosk device registrations
pos_kiosk_config       — kiosk display settings per workspace
```

### 3.2 API routes additions

New route file: `apps/api/src/routes/pos.ts`  
Registers under prefix `/pos` inside the main Fastify app.

Route groups:
```
GET  /pos/restaurant            — get restaurant profile
PUT  /pos/restaurant            — update restaurant profile

GET  /pos/menu                  — list menu items
POST /pos/menu                  — create menu item
PUT  /pos/menu/:id              — update menu item
DEL  /pos/menu/:id              — delete menu item

GET  /pos/tables                — list tables
POST /pos/tables                — create/configure tables
PUT  /pos/tables/:id            — update table
DEL  /pos/tables/:id            — delete table

GET  /pos/orders                — list orders (filters: date, status, type)
POST /pos/orders                — create order
PUT  /pos/orders/:id            — update order (status, items)
POST /pos/orders/:id/payment    — record payment

GET  /pos/employees             — list POS employees
POST /pos/employees             — add employee
PUT  /pos/employees/:id         — update employee
DEL  /pos/employees/:id         — remove employee
POST /pos/employees/:id/clock   — clock in/out

GET  /pos/inventory             — list inventory items
POST /pos/inventory             — create item
PUT  /pos/inventory/:id         — update item

GET  /pos/expenses              — list expenses
POST /pos/expenses              — create expense

GET  /pos/purchase-orders       — list purchase orders
POST /pos/purchase-orders       — create PO
PUT  /pos/purchase-orders/:id   — update PO

GET  /pos/loyalty/customers     — loyalty customer lookup (phone/email)
POST /pos/loyalty/customers     — enroll new customer
PUT  /pos/loyalty/customers/:id — update customer
POST /pos/loyalty/points        — earn/redeem points

GET  /pos/kiosk/config          — kiosk display config
PUT  /pos/kiosk/config          — update kiosk config
GET  /pos/kiosk/devices         — list kiosk devices
POST /pos/kiosk/devices         — register kiosk device

GET  /pos/analytics/summary     — revenue, orders, avg ticket (date range)
GET  /pos/analytics/items       — top items
GET  /pos/analytics/employees   — employee performance

# Public (no auth, device token only)
GET  /pos/kiosk-public/:wsId/menu   — menu for kiosk display
POST /pos/kiosk-public/:wsId/order  — kiosk order submission
```

### 3.3 Shared types/schemas

New file: `packages/shared/src/pos.ts`  
Export Zod schemas for POS DTOs (orders, menu items, etc.) shared between API and frontend.

### 3.4 Plan / module control in superadmin & management

**Superadmin (`OrgDetailPage.tsx`):**
- Add "Modules" section with `<ToggleSwitch>` for `signage` and `pos`
- Plan selector: `cms_only` | `pos_only` | `both`
- Calls `PATCH /superadmin/orgs/:id` with `{ modules, plan }`

**Management (`ManagementCompanyDetailPage.tsx`):**
- Same controls visible to management company admins
- Restricted to orgs they own

### 3.5 AppLayout sidebar — unified navigation model

**Core principle:** Resources shared by both modules (Devices, Analytics, Dashboard) live at the top level and are always visible when the workspace is active. Pure-CMS and Pure-POS sections are separated below. No resource appears twice.

```
WORKSPACE
├── Dashboard            /workspaces/:wsId               ← unified: signage + POS KPIs
├── Devices              /workspaces/:wsId/devices        ← ALL devices, type-badged + grouped (see §3.6)
│   └── [Groups]         /workspaces/:wsId/devices/groups ← sync · videowall · location · tag
└── Analytics            /workspaces/:wsId/analytics      ← tabbed: Signage | POS Revenue | Combined

SIGNAGE  (hidden when modules = 'pos_only')
├── Content              /workspaces/:wsId/content
├── Playlists            /workspaces/:wsId/playlists
└── Schedules            /workspaces/:wsId/schedules

POS  (hidden when modules = 'cms_only')
├── Order Entry          /workspaces/:wsId/pos
├── Orders               /workspaces/:wsId/pos/orders
├── Kitchen              /workspaces/:wsId/pos/kitchen
├── Inventory            /workspaces/:wsId/pos/inventory
├── Employees            /workspaces/:wsId/pos/employees
├── Loyalty              /workspaces/:wsId/pos/loyalty
└── Expenses / POs       /workspaces/:wsId/pos/expenses

ACCOUNT
└── Settings             /settings                        ← grouped sections (see §6)
```

### 3.6 Unified Devices page — design & device model

`/workspaces/:wsId/devices` is the single place to manage **every screen** in a workspace: signage displays, kiosk touchscreens, and kitchen monitors — regardless of hardware manufacturer or software platform.

#### UX design principles
- **Clean list, powerful detail** — the device list is minimal (name, type, platform, status, last seen, group). Complexity lives inside the device detail drawer/page, not cluttering the list.
- **Two views:** toggle between **List** (default, dense, sortable table) and **Card** (icon grid, good for visual scan of many devices).
- **Search + filter:** full-text search by name / serial / IP; filter chips by type and by group; status filter (online / offline / warning).
- **Bulk actions:** select multiple → Power on/off · Restart · Assign content · Move to group · Delete.
- **Quick actions per row:** hover reveals `⋯` menu — Preview, Restart, Edit name, Move to group.

#### Device list columns

| Column | Notes |
|---|---|
| Name | Editable inline |
| Type badge | `Signage` / `Kiosk` / `Kitchen` — `<Badge tone>` |
| Platform badge | `Tizen` / `WebOS` / `Android` / `Linux` / `Browser` — `<Badge tone="neutral">` |
| Status dot | `Online` (green) / `Offline` (red) / `Warning` (amber) |
| Group(s) | Up to 3 tag-style chips; `+N more` if overflow |
| Last seen | Relative time |
| Quick actions | `⋯` menu |

#### Kiosk and Kitchen devices on Tizen

Kiosk (portrait/landscape) and kitchen display devices can run as **Tizen WGT apps** — separate WGT builds from the CMS signage player:

| WGT build | Renders | Target hardware |
|---|---|---|
| `SignagePlayer.wgt` | CMS playlist / zones | Samsung signage TVs (SSSP) |
| `KioskPlayer.wgt` | `/kiosk/:wsId/portrait` or `/landscape` public page | Samsung Kiosk / consumer touch display |
| `KitchenDisplay.wgt` | Kitchen order board | Any Samsung commercial display |

All three WGT builds use the same heartbeat + content API. Device type is determined at registration (pairing screen), not by the WGT build name.

#### Device detail page (`DeviceDetailPage.tsx`) — tab set by type

| Tab | Signage | Kiosk | Kitchen | Notes |
|-----|:-------:|:-----:|:-------:|-------|
| Info | ✅ | ✅ | ✅ | Name, platform, serial, IP, firmware |
| Power / MDC | ✅ | — | — | MDC commands, scheduled on/off |
| Content / Playlist | ✅ | — | — | Assigned playlist + override |
| Timers | ✅ | ✅ | — | On/off timer schedule |
| Kiosk Config | — | ✅ | — | Welcome screen, idle timeout, QR mode |
| Order Filter | — | — | ✅ | Which order types/stations to show |
| Settings | ✅ | ✅ | ✅ | Volume, brightness, orientation |
| Logs | ✅ | ✅ | ✅ | Heartbeat + player error log |

#### Device Groups (`/workspaces/:wsId/devices/groups`)

Replaces the old standalone **Sync Groups** nav item. Groups live inside the Devices section and support four group types:

| Group type | Purpose | Future |
|---|---|---|
| `sync` | Multi-screen synchronised playback (exact-frame sync) | Existing sync protocol |
| `videowall` | Tile one content item across N displays (bezel-corrected) | Phase 2 feature |
| `location` | Logical grouping by physical location (Floor 1, Bar Area) | Bulk scheduling by location |
| `tag` | Free-form label (promo-screens, permanent-displays, etc.) | Filter / bulk-action target |

A device can belong to **multiple groups of different types** (e.g. both a `location` group and a `sync` group).

**Groups page UX:** Two-column layout — group list on left, member device grid on right. Drag-and-drop to add/remove devices. Bulk assign all devices in a group to a playlist or schedule.

#### DB schema additions

```ts
// packages/db/src/schema/devices.ts — ADD columns
type:         text('type').notNull().default('signage'),       // 'signage' | 'kiosk' | 'kitchen'
platform:     text('platform').notNull().default('tizen'),     // 'tizen' | 'webos' | 'android' | 'linux' | 'browser' | 'other'
manufacturer: text('manufacturer'),                            // 'Samsung' | 'LG' | 'BrightSign' | etc.
model:        text('model'),                                   // e.g. 'QM65B'

// NEW tables in packages/db/src/schema/devices.ts
device_groups        — id, workspaceId, name, type ('sync'|'videowall'|'location'|'tag'), settings JSON
device_group_members — groupId, deviceId, position (for videowall tile index)
```

### 3.7 Unified Analytics page

The existing `AnalyticsPage.tsx` gains top-level tabs when `both` modules are active:

```
Analytics
  [Signage]  [POS Revenue]  [Combined]
```

- **Signage tab** — existing play events, device uptime, impression stats (unchanged)
- **POS Revenue tab** — orders, revenue, avg ticket, top items, hourly breakdown
- **Combined tab** — correlate signage performance with POS revenue (e.g. promotion play → order spike)

When only one module is active the tab bar is hidden and the relevant content is shown directly.

### 3.8 Weather Widget — platform CMS content type

`WeatherWidget.jsx` is **removed from the POS app** and rebuilt as a native live-data content widget inside the CMS signage platform — available to all orgs regardless of module.

**What it is:** A live widget block that can be added to any playlist item or content zone. Displays current weather (temperature, condition icon, city name) using a public weather API (Open-Meteo — no API key required for basic data).

**How it fits the platform content model:**

```
Content item (zone template)
  ├── Zone A — media (image / video)
  ├── Zone B — text overlay
  └── Zone C — Live Widget  ← WeatherWidget | Clock | RSS ticker (future)
```

**Weather widget config (stored in content item settings JSON):**
- Location: auto (from workspace timezone/coordinates) or manual (city name / lat-lon)
- Units: °C / °F
- Display style: minimal (temp + icon) | card (temp + condition + feels-like + humidity)
- Refresh interval: 15 min (default)

**DB:** No new table — widget config stored as JSON inside the content item's settings field.

**API:** Single route `GET /content/widgets/weather?lat=&lon=&units=` — Fastify proxies to Open-Meteo, caches response per location for 15 min (Redis or in-memory), returns simplified payload to the player.

**AI integration (Layer 1):** The AI Content Studio can use current weather data as a constraint. Example: "If raining → show hot drinks promo; if sunny → show cold drinks promo." The weather condition feeds into the content generation prompt.

### 3.9 Player Platform — manufacturer-agnostic model

Samsung Tizen (SSSP) is the current target but the platform is designed for **multiple manufacturers** from the start. The device model is platform-neutral; the player WGT/app is platform-specific but all communicate via the same API.

#### `devices` platform field values

| `platform` | Hardware examples | Player type |
|---|---|---|
| `tizen` | Samsung QM-series, QB-series, Kiosk displays | `.wgt` app via SSSP |
| `webos` | LG commercial displays (SuperSign) | `.ipk` hosted app |
| `android` | BrightSign (Android runtime), EPOS kiosks, generic Android stick | APK / PWA |
| `linux` | Raspberry Pi, NUC, BrightSign XD | Node.js or Electron app |
| `browser` | Any Chrome OS, PC browser, dev testing | PWA (full-screen browser) |
| `other` | Unknown / custom hardware | Generic heartbeat only |

#### Player architecture principles

- **API-first:** every player platform talks to the same REST API (`/devices/heartbeat`, `/devices/content`, etc.) — the backend never needs to know which player it is talking to  
- **WGT builds (Tizen):** `apps/tizen/` for signage, `apps/tizen-kiosk/` for kiosk/kitchen — separate config.xml, same JS core  
- **Future players:** a new manufacturer just needs a player app that hits the heartbeat and content endpoints; the portal, DB, and API need **no changes**  
- **Feature parity table:** MDC power commands and timer sync are Tizen-specific; other platforms get a subset of device controls — the detail page hides unavailable tabs automatically based on `device.platform`

#### Phase rollout

| Phase | Platform | Notes |
|---|---|---|
| Current | Tizen | Fully working — `apps/tizen/` and `apps/tizen-sbb/` |
| P1 | Browser PWA | For dev testing and low-cost deployments |
| P2 | Android | Broad hardware support, easy to deploy |
| P3 | WebOS | LG commercial displays for enterprise clients |
| Future | Linux | Pi-based installs, custom kiosk builds |

### 3.10 AI Integration Touchpoints

The POS integration unlocks several AI features from `AI_PLATFORM_PLAN.md`. This section maps where they plug in so they can be built in parallel with the POS migration.

| Feature | AI Layer | What it does | Data source |
|---|---|---|---|
| Auto-update menu boards on price change | Layer 1 | Detects POS menu change → regenerates affected content slides | `pos_menu_items` change event |
| Weather-aware content | Layer 1 | Selects/generates content variant based on live weather | WeatherWidget API (§3.8) |
| AI content moderation gate | Layer 1 | Checks generated content before publish (brand compliance, readability) | AI image model review |
| CMS chat assistant | Layer 2 | Help users navigate portal, update prices, manage schedules via chat | Org context (devices, content, schedules) |
| Device group alerting | Layer 3 | Monitors device groups — if all sync group devices go offline, fires group-level alert | `device_group_members` + heartbeat |
| POS business intelligence | Layer 5 | Correlate signage play events with POS order data; weekly AI digest | `pos_orders` + play_events |
| Menu board generator | Layer 1 | Client types "Lunch special: Salmon $24" → AI generates full menu board | Flux.1 image model |
| Kitchen / kiosk AI personalisation | Layer 5 | Adaptive kiosk recommendations based on time of day and bestsellers | `pos_order_items` aggregates |

**Integration pattern:** All AI routes go through `POST /api/v1/ai/...` on the Fastify API (per `AI_PLATFORM_PLAN.md §10.1`). The POS schema additions (especially `pos_orders`, `pos_menu_items`) are the primary data feeds for Layer 5. No AI builds are blocking for POS launch — AI is additive, not a dependency.

---

## 4. Frontend Migration Guide

### 4.1 Design system tokens — mapping POS CSS to platform vars

| POS CSS variable / style         | Platform equivalent               |
|----------------------------------|-----------------------------------|
| `background: #f5f5f5`            | `var(--bg)`                       |
| `background: white`              | `var(--card)`                     |
| `border: 1px solid #e2e8f0`      | `border: 1px solid var(--border)` |
| `color: #1a202c`                 | `color: var(--text)`              |
| `color: #718096`                 | `color: var(--text-muted)`        |
| `background: #667eea` (brand)    | `var(--blue)` (`#3a7bff`)         |
| `background: #22c55e` (success)  | `var(--success)`                  |
| `background: #f59e0b` (warning)  | `var(--warning)`                  |
| `background: #ff3ea5` (danger)   | `var(--danger)` / `var(--magenta)`|
| Custom `.card {}` styles         | `bg-[var(--card)] border border-[var(--border)] rounded-[var(--radius)]` |
| `border-radius: 8-12px`          | `rounded-[var(--radius)]` (`12px`)|
| Per-component `*.css` file       | Tailwind utilities + CSS vars     |

### 4.2 Component conventions (platform standard)

```tsx
// Page skeleton
import { PageHeader } from '../../components/UiPrimitives.js';
import { ShoppingCart } from 'lucide-react';

export default function PosOrdersPage() {
  return (
    <div className="px-4 py-6 lg:px-6">
      <PageHeader
        icon={<ShoppingCart size={20} />}
        title="Orders"
        subtitle="Today's order history"
      />
      {/* content */}
    </div>
  );
}
```

```tsx
// Status badges
import { Badge } from '../../components/UiPrimitives.js';
<Badge tone="success">Paid</Badge>
<Badge tone="warning">Pending</Badge>
<Badge tone="danger">Cancelled</Badge>
<Badge tone="neutral">Draft</Badge>
```

```tsx
// Toasts — replace useToasts() from POS with sonner
import { toast } from 'sonner';
toast.success('Order placed');
toast.error('Payment failed');
```

```tsx
// Data fetching — replace apiClient / fetch with @tanstack/react-query + platform api helper
import { useQuery, useMutation } from '@tanstack/react-query';
import { api } from '../../lib/api.js';

const { data: orders } = useQuery({
  queryKey: ['pos-orders', wsId],
  queryFn: () => api.get(`/pos/orders?wsId=${wsId}`),
});
```

```tsx
// Auth — remove AuthContext, use platform store
import { useAuthStore } from '../../lib/auth.js';
const { user } = useAuthStore();
```

### 4.3 Layout changes

There is **no separate `PosLayout.tsx`**. All POS screens live inside the existing `AppLayout.tsx`,
which now renders three conditional nav groups based on the `modules` flag:

```ts
// apps/ds/src/lib/modules.ts
export function usePosEnabled(): boolean {
  const { org } = useAuthStore();
  const modules: string = (org?.settings as any)?.modules ?? 'signage';
  return modules === 'pos' || modules === 'both';
}

export function useCmsEnabled(): boolean {
  const { org } = useAuthStore();
  const modules: string = (org?.settings as any)?.modules ?? 'signage';
  return modules === 'signage' || modules === 'both';
}
```

`AppLayout.tsx` sidebar rendering logic:
```tsx
{/* Always visible — unified resources */}
<NavLink to={`/workspaces/${wsId}`}>Dashboard</NavLink>
<NavLink to={`/workspaces/${wsId}/devices`}>Devices</NavLink>
<NavLink to={`/workspaces/${wsId}/analytics`}>Analytics</NavLink>

{/* CMS section — signage or both */}
{cmsEnabled && <NavSection label="Signage">…</NavSection>}

{/* POS section — pos or both */}
{posEnabled && <NavSection label="POS">…</NavSection>}
```

The device type badge (`Signage` / `Kiosk` / `Kitchen`) is rendered using `<Badge tone="neutral">` or `<Badge tone="accent">` — consistent with the platform badge system.

### 4.4 Kiosk screens

Kiosk portrait/landscape are **public** routes — no auth. They read menu/config via the
kiosk-public API endpoint using only a `wsId` param. These pages keep their full-screen
touch-optimised layout but adopt platform CSS vars so they share the same brand colours.

---

## 5. Migration Phases

### Phase 1 — Database & API foundation  _(~2 weeks)_

- [ ] Set `modules` in `organisations.settings` JSON — document format, update superadmin API to accept it
- [ ] Create `packages/db/src/schema/pos.ts` with all POS tables
- [ ] Run Drizzle migration
- [ ] Create `apps/api/src/routes/pos.ts` — skeleton with auth middleware, workspace-scoped
- [ ] Implement restaurant profile, menu, tables, orders CRUD
- [ ] Add Zod schemas to `packages/shared/src/pos.ts`
- [ ] `PATCH /superadmin/orgs/:id` accepts `{ modules, plan }`

### Phase 2 — Superadmin & management plan UI  _(~1 week)_

- [ ] `OrgDetailPage.tsx` — Modules section: signage / pos / both toggles
- [ ] `OrgsListPage.tsx` — module badge alongside plan badge
- [ ] `ManagementCompanyDetailPage.tsx` — same controls for management admins
- [ ] Plan badge labels: `CMS Only` / `POS Only` / `Both`

### Phase 3 — Unified layout & routing scaffold  _(~2–3 weeks)_

- [ ] `apps/ds/src/lib/modules.ts` — `usePosEnabled()` and `useCmsEnabled()` hooks
- [ ] `devices` table — add `type`, `platform`, `manufacturer`, `model` columns, Drizzle migration
- [ ] `device_groups` + `device_group_members` tables — Drizzle schema + migration
- [ ] `WorkspaceDashboardPage.tsx` → extend to `DevicesPage.tsx` — list/card view toggle, type + platform badges, filter chips, search, bulk actions
- [ ] `DeviceGroupsPage.tsx` at `/workspaces/:wsId/devices/groups` — group CRUD (sync, videowall, location, tag), drag-and-drop member assignment
- [ ] `DeviceDetailPage.tsx` — tab set adapts to `device.type` and `device.platform`
- [ ] `AppLayout.tsx` — unified nav: Dashboard / Devices (+ Groups sub-link) / Analytics always shown; CMS group conditional (no Sync Groups nav item); POS group conditional
- [ ] `AnalyticsPage.tsx` — add tab bar (Signage / POS Revenue / Combined), wire to module flags
- [ ] Add POS routes to `App.tsx` under `/workspaces/:wsId/pos/*`
- [ ] Public kiosk routes under `/kiosk/:wsId/portrait` and `/kiosk/:wsId/landscape`
- [ ] Page stubs for all POS routes
- [ ] Weather widget content type: `GET /content/widgets/weather` API route, widget config schema in content item settings JSON

### Phase 4 — POS Settings sections in `SettingsPage.tsx`  _(~1 week)_

Extend the existing settings page with the POS group:

- [ ] `pos-restaurant` section — restaurant profile form
- [ ] `pos-menu` section — category + item management (CRUD table)
- [ ] `pos-tables` section — table layout config
- [ ] `pos-hardware` section — receipt printer, scanner, cash drawer
- [ ] `pos-kiosk` section — kiosk display config
- [ ] `pos-loyalty` section — loyalty program config
- [ ] Sections hidden behind `usePosEnabled()` guard

### Phase 5 — Core POS operational screens  _(~3–4 weeks)_

Port in business-critical order:

1. **Order Entry** (`App.jsx` → `PosOrderPage.tsx`)  
   Table/takeout selection, menu browsing, cart, loyalty lookup
2. **Payment** (`Payment.jsx` → `PosPaymentPage.tsx`)
3. **Orders History** (`Orders.jsx` → `PosOrdersPage.tsx`)
4. **Kitchen Display** (`Kitchen.jsx` → `PosKitchenPage.tsx`)

### Phase 6 — Secondary operational screens  _(~2–3 weeks)_

5. **Inventory** → `PosInventoryPage.tsx`
6. **Employees + Time Tracking** → `PosEmployeesPage.tsx`
7. **Loyalty Dashboard** → `PosLoyaltyPage.tsx`
8. **Analytics** → `PosAnalyticsPage.tsx`
9. **Expenses + Purchase Orders** → `PosExpensesPage.tsx`, `PosPurchaseOrdersPage.tsx`

### Phase 7 — Kiosk screens  _(~1–2 weeks)_

- [ ] `PosKioskPortraitPage.tsx` (public, full-screen, touch)
- [ ] `PosKioskLandscapePage.tsx` (public, full-screen, touch)
- [ ] `PosKioskManagerPage.tsx`
- [ ] `PosKioskDevicesPage.tsx`

### Phase 8 — Python backend removal  _(~3–4 weeks, run parallel with 5–7)_

Reference `Docs/sample/Pos/python-backend/app/` for all existing endpoints.  
For each Python endpoint, implement the equivalent in `apps/api/src/routes/pos.ts`.  
**Once all endpoints are ported and tested, the Python process is deleted.**

Priority follows phases 5–7.

### Phase 9 — Polish, testing & launch  _(~2 weeks)_

- [ ] Full dark/light theme pass on all POS pages
- [ ] Mobile responsiveness audit (order entry is tablet-primary)
- [ ] E2E tests for order flow + payment
- [ ] Kiosk smoke tests
- [ ] Confirm Python backend fully removed
- [ ] Update `infra/` (nginx) if POS kiosk needs separate routing

---

## 6. Settings Page Integration

### Design decision
**Do NOT create a separate POS Settings page.**  
Instead, extend the existing `SettingsPage.tsx` by adding a `'POS'` group to the `SECTIONS` registry.  
The POS sections are rendered only when the org's `settings.modules` includes `pos`.
See §9 for the full UX consistency rules that apply to these sections.

### New sections added to `SettingsPage.tsx`

Current section groups and proposed additions:

```
Account
  ├── general           (existing)
  └── security          (existing)

Organization
  └── organization      (existing — members, invites, roles)

Workspace (CMS — only shown when modules includes 'signage')
  ├── workspace         (existing — name, tz, approval workflow, player defaults)
  ├── tags              (existing)
  ├── emergency         (existing)
  ├── audit             (existing)
  └── api-keys          (existing)

POS  ←── NEW GROUP (only shown when modules includes 'pos')
  ├── pos-restaurant    Restaurant profile (name, address, currency, table count)
  ├── pos-menu          Menu item management (categories, items, pricing, images)
  ├── pos-tables        Table layout config (count, names, seats, locations)
  ├── pos-hardware      Receipt printer + barcode scanner setup
  ├── pos-kiosk         Kiosk display config (branding, idle screen, QR settings)
  └── pos-loyalty       Loyalty program config (points rate, tiers, expiry)

Preferences
  └── notifications     (existing — already covers both modules)
```

> **Note on Devices in Settings:** Device-level settings (player defaults, timers, pairing) remain on the per-device detail page (`DeviceDetailPage.tsx`), not in `SettingsPage.tsx`. The `pos-kiosk` section only covers workspace-level kiosk _defaults_ — individual kiosk devices are configured from the unified Devices page.

### `SECTIONS` registry addition (TypeScript)

```ts
// In SettingsPage.tsx — extend SectionId union and SECTIONS array

type SectionId =
  | 'general' | 'security' | 'organization'
  | 'workspace' | 'tags' | 'emergency' | 'audit' | 'api-keys'
  | 'notifications'
  // POS additions:
  | 'pos-restaurant' | 'pos-menu' | 'pos-tables'
  | 'pos-hardware' | 'pos-kiosk' | 'pos-loyalty';

// POS entries added dynamically — only rendered when posEnabled:
const POS_SECTIONS = [
  { id: 'pos-restaurant', label: 'Restaurant',   icon: Store,       group: 'POS' },
  { id: 'pos-menu',       label: 'Menu',          icon: UtensilsCrossed, group: 'POS' },
  { id: 'pos-tables',     label: 'Tables',        icon: LayoutGrid,  group: 'POS' },
  { id: 'pos-hardware',   label: 'Hardware',      icon: Printer,     group: 'POS' },
  { id: 'pos-kiosk',      label: 'Kiosk',         icon: Monitor,     group: 'POS' },
  { id: 'pos-loyalty',    label: 'Loyalty',       icon: Gift,        group: 'POS' },
] as const;
```

### What each POS section contains

**`pos-restaurant`** — pulled from `pos_restaurants` table (workspace-scoped)
- Restaurant name, address, phone
- Currency and locale settings
- Receipt header/footer text
- Business hours

**`pos-menu`** — pulled from `pos_menu_items`
- Category management (add / rename / order)
- Item CRUD (name, price, category, description, image URL, availability toggle)
- AI-assisted menu scan (placeholder, wired up in AI layer when hardware ships)

**`pos-tables`** — pulled from `pos_tables`
- Table count slider/input
- Per-table: name, seats, location/zone label
- Bulk reset to defaults

**`pos-hardware`** — receipt printer + peripheral config
- Receipt printer: connection type (USB / Network / BT), IP/port, test print
- Barcode scanner: mode (USB HID, auto-detect)
- Cash drawer settings

**`pos-kiosk`** — pulled from `pos_kiosk_config`
- Kiosk display orientation default (portrait / landscape)
- Welcome screen message and idle timeout
- Logo URL override for kiosk
- QR ordering: enabled/disabled, table assignment mode

**`pos-loyalty`** — pulled from `pos_loyalty_config` (or stored in `pos_restaurants.settings` JSON)
- Points earn rate (e.g. 1 point per $1)
- Redemption rate (e.g. 100 points = $1 off)
- Tier names and thresholds
- Points expiry (months, or never)
- Enrolment method (phone / email)

---

## 7. Required Integrations to Finish Before Launch

These are hard dependencies that must be complete before POS goes live:

| # | Integration                      | Status        | Notes                                                   |
|---|----------------------------------|---------------|---------------------------------------------------------|
| 1 | Platform auth — POS routes       | Completed     | Workspace POS routes are session-authenticated; kiosk/kitchen remain public by design |
| 2 | Org module guard on sidebar nav  | Completed     | `usePosEnabled()` / `useCmsEnabled()` are live in the DS app |
| 3 | Superadmin plan UI (modules)     | Completed     | `OrgDetailPage.tsx` supports plan + module changes      |
| 4 | Management plan UI (modules)     | Not started   | `ManagementCompanyDetailPage.tsx` parity still pending  |
| 5 | `pos_restaurants` + core DB schema | Completed   | POS schema and migrations exist in `packages/db`        |
| 6 | `pos_menu_items` + API CRUD      | Completed     | Menu/category/item CRUD is wired through the Fastify POS routes |
| 7 | `pos_orders` + `pos_order_items` | Completed     | Core order flow, history, kitchen, and editing endpoints are in place |
| 8 | `pos_payments` API               | Completed     | Payment capture / mark-paid flow is implemented         |
| 9 | `pos_tables` API                 | Completed     | Table config CRUD exists in the POS route set           |
|10 | POS Settings sections in `SettingsPage.tsx` | In progress | Restaurant/menu/tables/kiosk/loyalty exist; hardware is still a placeholder |
|11 | Public kiosk routes (no auth)    | Completed     | `/kiosk/:wsId/:orientation` and `/kitchen/:wsId` are live |
|12 | Receipt print (browser print API)| Completed     | Orders history now supports browser receipt printing and export |
|13 | Unified Devices page             | In progress   | Type/platform handling exists, but the unified UX still needs polish and deeper feature completion |
|14 | Device Groups                    | In progress   | Group schema and DS pages exist; richer group workflows still need completion |
|15 | Weather widget content type      | In progress   | Weather proxy route exists; full content-type/editor wiring is still pending |
|16 | Tizen Kiosk WGT build            | In progress   | `apps/tizen-kiosk/` exists, but rollout validation and final integration remain |

**Phase 4–6 screens can be worked on in parallel with items 5–13 above.**

---

## 8. File Structure (target)

```
apps/ds/src/
  pages/
    workspace/
      DevicesPage.tsx               ← UNIFIED: all device types, list + card views, bulk actions
      DeviceGroupsPage.tsx          ← NEW: sync / videowall / location / tag groups
      AnalyticsPage.tsx             ← EXTENDED: tabbed Signage | POS Revenue | Combined
      pos/
        PosOrderPage.tsx            ← main order entry
        PosOrdersPage.tsx           ← order history
        PosKitchenPage.tsx          ← kitchen display
        PosPaymentPage.tsx          ← payment
        PosInventoryPage.tsx
        PosEmployeesPage.tsx
        PosLoyaltyPage.tsx
        PosAnalyticsPage.tsx        ← detailed POS analytics (linked from Analytics tab)
        PosExpensesPage.tsx
        PosPurchaseOrdersPage.tsx
        PosKioskManagerPage.tsx     ← kiosk assignment / pairing (links to DevicesPage)
    kiosk/                          ← public kiosk routes (no auth)
      PosKioskPortraitPage.tsx
      PosKioskLandscapePage.tsx
  pages/account/
    SettingsPage.tsx                ← EXTENDED with POS group (pos-restaurant,
                                       pos-menu, pos-tables, pos-hardware,
                                       pos-kiosk, pos-loyalty)
  components/
    AppLayout.tsx                   ← EXTENDED: unified nav (Dashboard/Devices+Groups/Analytics
                                       always; CMS group conditional; POS group conditional)
  lib/
    modules.ts                      ← usePosEnabled(), useCmsEnabled()

apps/tizen/                         ← EXISTING: signage Tizen WGT
apps/tizen-kiosk/                   ← NEW: kiosk/kitchen Tizen WGT (separate build)

packages/db/src/schema/
  devices.ts                        ← ADD: type, platform, manufacturer, model columns
                                       ADD: device_groups, device_group_members tables
  pos.ts                            ← all POS DB tables

packages/shared/src/
  pos.ts                            ← POS Zod schemas + types

apps/api/src/routes/
  pos.ts                            ← all POS Fastify routes
  devices.ts                        ← EXTENDED: type/platform filter, group endpoints, kiosk/kitchen registration
  content.ts                        ← EXTENDED: GET /content/widgets/weather proxy + cache
```

---

## 9. Design Consistency Rules (strict)

The POS UI is "old" — strict rules for the rewrite:

| Rule | Detail |
|------|--------|
| **No per-component CSS files** | All styling via Tailwind utilities + CSS vars only |
| **Dark-first** | `var(--bg)`, `var(--card)`, `var(--surface)` backgrounds everywhere |
| **Cards** | `bg-[var(--card)] border border-[var(--border)] rounded-[var(--radius)]` |
| **Status** | Always use `<Badge tone="...">` — no custom coloured spans |
| **Buttons** | Use `ActionButton` from `UiPrimitives` or `.workspace-page-action` class |
| **Inputs** | `className="input"` (platform class) — no custom input styles |
| **Modals** | `Modal`, `ModalHeader`, `ModalBody`, `ModalFooter` from `UiPrimitives` |
| **Loading** | `Skeleton` components from `UiPrimitives` — no custom spinners |
| **Toasts** | `toast.success()` / `toast.error()` from `sonner` |
| **Page structure** | Every page opens with `<PageHeader icon={...} title="..." subtitle="..." />` |
| **Data fetching** | `useQuery` / `useMutation` from `@tanstack/react-query` only |
| **Typography** | Inter, Tailwind scale (`text-sm`, `text-base`, `text-lg`) — no custom font sizes |
| **Kiosk screens** | Keep full-screen touch layout; adopt brand colours via CSS vars |

---

## 10. Key Risk / Decision Log

| # | Decision                                    | Chosen approach                              | Notes                            |
|---|---------------------------------------------|----------------------------------------------|----------------------------------|
| 1 | Where does `modules` live?                  | `organisations.settings` JSON — **permanent** | Simple, no migration needed     |
| 2 | Python backend                              | **Remove entirely** — rewrite in Fastify     | Unified deploy, clean stack      |
| 3 | POS subscription tiers                      | **Removed** — platform plan + module flag    | Simpler, consistent billing      |
| 4 | AI Chat widget                              | **Removed** — re-add after AI hardware layer | See `AI_PLATFORM_PLAN.md` Layer 5 |
| 5 | POS Settings page                           | **Merged into `SettingsPage.tsx`** POS group | Single settings home, consistent UX |
| 6 | POS auth / tenant model                     | **Removed** — platform org + workspace session | POS "tenants" → orgs            |
| 7 | Kiosk UX                                    | Full-screen, brand tokens, workspace logo    | Can override logo per workspace  |
| 8 | UberEats integration                        | Keep routes but out of scope for phases 1–6  | Experimental, low priority       |
| 9 | Receipt printing                            | Browser print API + receipt CSS template     | No native driver dependency      |
| 10 | Navigation model | **Unified resource model** — Devices, Analytics, Dashboard shared across modules. No duplicate pages. | `both` clients get one nav, no friction |
| 11 | Kiosk/kitchen devices in Devices page | Yes — `devices.type` column, filter chips, adaptive detail tabs | Single place to manage all hardware |
| 12 | Sync Groups | **Moved inside Devices** — Device Groups page at `/devices/groups`; supports sync, videowall, location, tag types | Removes dedicated nav item; same power, better UX |
| 13 | Player platform model | **Manufacturer-agnostic** from day one — `devices.platform` + `devices.manufacturer` columns; Tizen first, WebOS/Android/Linux/Browser roadmapped | Future-proof; API never changes per manufacturer |
| 14 | WeatherWidget | **Remove from POS, promote to platform CMS feature** — live weather content widget usable by all orgs, weather-aware AI content (Layer 1) | Value for all clients, not just POS |
| 15 | Kiosk / Kitchen Tizen WGT | Separate `apps/tizen-kiosk/` WGT build for kiosk portrait/landscape and kitchen display | Same API, distinct rendering target |

---

## 11. Out of Scope

- Accounting software integrations (Xero, QuickBooks)
- Delivery platform integrations (UberEats, DoorDash) — experimental only
- Native mobile app for POS
- Offline / PWA mode for POS
- Multi-currency support (beyond initial currency config per restaurant)
- AI Chat widget — tracked in `AI_PLATFORM_PLAN.md`, added in AI Layer 5 phase
