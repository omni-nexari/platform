# Nexari OmniHub Marketing Overview

> Status: Working marketing document
> Audience: management companies, venue operators, restaurants, retail teams, and internal sales/support
> Product: multi-tenant digital signage, POS-aware content, scheduling, device management, and synchronized playback

---

## Executive Summary

Nexari OmniHub is a digital signage platform for organizations that need reliable screen networks without turning every content change into an IT project. It brings content uploads, playlists, schedules, device monitoring, reseller/client administration, and synchronized multi-screen playback into one web dashboard.

The platform is built for management companies as well as direct client organizations. A management company can onboard and support multiple client organizations from a branded portal, while each client organization manages its own workspaces, screens, content, playlists, and schedules with tenant isolation.

Nexari is especially strong for Samsung commercial displays, restaurant menu boards, retail promotions, lobby screens, and multi-screen environments where uptime, remote control, and predictable playback matter.

## Positioning

### One Platform for Signage Operations

Nexari combines the daily tools signage teams need:

- Upload and organize media content.
- Build playlists from images, videos, HTML5 packages, documents, and web content.
- Schedule playlists and one-off content by day, time, recurrence, and priority.
- Publish directly to screens, workspaces, device groups, or synchronized playback groups.
- Monitor device status, screenshots, playback, and connectivity from the portal.
- Manage multiple client organizations from a reseller or management-company layer.

### Built for Real Venues

The system supports the practical workflows that restaurants, retail sites, offices, and public venues ask for every week:

- Lunch menus that run only during lunch hours.
- Weekend promotions that override the normal program.
- Lobby screens that fall back to a default playlist when no schedule is active.
- Screen fleets that can be grouped by location, function, or tags.
- Multi-screen SyncPlay groups that start and stay aligned across displays.
- POS-connected menu boards that can reflect product and pricing changes.

## Core Value Propositions

### For Management Companies

- Manage a portfolio of client organizations from one branded portal.
- Invite client org owners and hand them a ready-to-use dashboard.
- Keep every client's users, content, devices, and billing context separated.
- Support clients remotely with device status, screenshots, logs, and forced refresh commands.
- Scale from a few screens to multi-location fleets without changing the operating model.

### For Client Organizations

- Update screens without calling an installer.
- Organize content by workspace, folder, tag, and playlist.
- Schedule the right content for the right time of day.
- Publish defaults so screens always have something useful to play.
- Use preview and status tools to reduce mistakes before content goes live.

### For Restaurants and Retail

- Create menu boards, promos, product loops, and event messaging.
- Schedule breakfast, lunch, dinner, happy hour, and holiday content.
- Connect POS/menu data so prices and items can stay consistent across signage and operations.
- Use synchronized screen groups for high-impact video walls, menu walls, and feature displays.

## Product Pillars

### 1. Multi-Tenant Administration

Nexari separates platform owner, management company, client organization, workspace, and device-level responsibilities. This allows one platform installation to support direct customers and reseller portfolios without mixing data between clients.

### 2. Content and Playlist Management

Users upload content items, organize them with tags and folders, and build playlists by ordering items, adjusting durations, choosing transitions, and optionally nesting playlists. Smart playlists can populate automatically from rules such as tags, content type, folder, or sort order.

### 3. Scheduling and Publishing

Schedules decide what plays and when. A schedule can include one-time or recurring slots, a default playlist or content item, blackout dates, labels, colors, and priorities. Publishing connects schedules, playlists, content, or sync groups to devices.

### 4. Device Fleet Operations

The dashboard tracks device health, online/offline state, workspace assignment, published targets, screenshots, power behavior, refresh commands, cache clearing, and other remote operations. The player fetches its schedule through the device API and can refresh when the server sends a WebSocket command.

### 5. Synchronized Playback

Sync playlists and sync groups allow multiple screens to play the same content in lockstep. Samsung-native SyncPlay is used when the group is all compatible Samsung/Tizen hardware; mixed-platform groups can use the custom relay engine. The system handles leader priority, relay mode, session config, manifest publishing, and force-resync controls.

### 6. POS and Business Workflows

For restaurants and SMB operations, Nexari can bridge signage with POS/menu workflows. Menu boards can use structured menu data, and the AI roadmap includes assisted content generation, menu updates, translation, moderation, and business intelligence.

## Feature Highlights

| Area | Capabilities |
|---|---|
| Organizations | platform owner, management company, client organization, workspace roles |
| Workspaces | location/brand/project grouping for devices, content, playlists, and schedules |
| Content | images, videos, HTML5, PDFs, presentations, web URLs, menu boards |
| Playlists | ordered items, durations, transitions, loop/shuffle, nested playlists, smart filters |
| Schedules | slots, recurrence, priority, defaults, blackouts, preview, import/export |
| Devices | pairing, monitoring, published targets, screenshots, commands, fallback content |
| Groups | location groups, tag groups, video wall groups, SyncPlay groups |
| SyncPlay | sync playlists, member devices, leader priority, LAN/cloud relay, force resync |
| Analytics | proof of play, screenshots, device state, workspace and org-level reporting |
| AI roadmap | content studio, CMS assistant, support assistant, local/private AI deployment |

## Common Customer Scenarios

### Restaurant Menu Boards

A restaurant creates breakfast, lunch, dinner, and happy-hour playlists. Each playlist contains menu-board content, promotional videos, and limited-time offers. A schedule switches between those playlists automatically through the day, while the default playlist catches gaps.

### Retail Promotion Network

A retailer organizes screens by store and department. Marketing uploads campaign assets once, tags them by product line, builds playlists, and schedules regional promotions. Store screens refresh remotely without manual USB updates.

### Corporate Lobby and Wayfinding

An office workspace runs a lobby playlist by default, schedules event signage for specific dates, and uses screen groups for lobby walls or floor-specific content.

### Multi-Screen Feature Wall

A venue builds a sync playlist, publishes it to selected displays, and lets the system create or reuse a sync group. The screens receive a synchronized manifest and play the same loop together.

## Differentiators

- Reseller-ready multi-tenant model instead of a single-org dashboard only.
- Samsung commercial-display focus with native player capabilities.
- Scheduling, playlists, device operations, and SyncPlay in the same workflow.
- POS and menu-board direction for restaurant use cases.
- Local/private AI roadmap for content creation, support, and platform operations.
- Practical remote support tools: screenshots, logs, refresh commands, and device state.

## Sales Narrative

Nexari helps teams operate screens like a managed channel instead of a collection of disconnected displays. Content is created once, organized once, scheduled once, and then delivered to the right screen at the right time. Management companies can support many customers from one branded portal, while each customer gets a clean workspace for its own venues and media.

The result is faster updates, fewer site visits, better visibility into what screens are doing, and a foundation for AI-assisted signage workflows as the platform grows.

## Suggested Short Pitch

Nexari OmniHub is a multi-tenant digital signage platform for managing screen fleets, playlists, schedules, devices, and synchronized playback from one dashboard. It is built for management companies and client organizations that need reliable content updates, remote support, Samsung commercial display integration, and future-ready AI signage workflows.

## Suggested Website Copy

### Hero

Manage every screen, playlist, schedule, and client workspace from one signage platform.

### Supporting Copy

Nexari OmniHub gives management companies and venue operators the tools to publish content, automate schedules, monitor devices, and synchronize multi-screen playback without field visits or fragmented tools.

### Feature Copy

- Build playlists from rich media, HTML5 content, documents, and menu boards.
- Schedule content by time, date, recurrence, priority, and fallback behavior.
- Monitor and refresh screens remotely with device status, screenshots, and commands.
- Support multiple client organizations from a branded management portal.
- Publish synchronized loops to groups of screens for high-impact displays.

## Proof Points to Collect

Use these as the platform moves toward customer-facing collateral:

- Number of supported display/player platforms in production.
- Average time from upload to live screen publish.
- Number of screens managed per workspace/client.
- Uptime and offline playback behavior from field deployments.
- SyncPlay drift measurements for synchronized groups.
- Restaurant/POS case studies and before/after menu update time.

## Brand Tone

Nexari should sound operationally confident, direct, and practical. The product is powerful, but the promise should stay simple: fewer manual updates, less support friction, better control of screen networks, and more reliable publishing for real venues.
