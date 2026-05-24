/**
 * AI tool definitions and execution for the agentic chat mode (Phase 3).
 *
 * The AI uses these tools when it needs to create or look up platform data
 * on behalf of the user.  All write operations tag records with
 * createdByAi=true for the audit trail.
 *
 * Safety: the system prompt instructs the AI to describe its plan and ask
 * for confirmation before calling any write tool.  The tools themselves also
 * validate workspace ownership so they cannot be misused cross-workspace.
 */
import {
  db,
  playlists,
  playlistItems,
  schedules,
  scheduleSlots,
  contentItems,
  devices,
  deviceGroups,
  syncPlaylists,
} from '@signage/db';
import { and, eq, ilike, isNull, inArray } from 'drizzle-orm';
import { logActivity } from './activity-logger.js';
import { isDeviceOnline } from './ws.js';

// ── Context ──────────────────────────────────────────────────────────────────

export interface ToolContext {
  workspaceId: string;
  userId: string;
}

// ── Tool schemas (Ollama / OpenAI format) ────────────────────────────────────

export const AGENT_TOOLS = [
  {
    type: 'function',
    function: {
      name: 'search_content',
      description: 'Search for content items (images, videos, etc.) in the workspace. Returns id, name, type, and duration.',
      parameters: {
        type: 'object',
        properties: {
          search: { type: 'string', description: 'Name or partial name to search for' },
          type: {
            type: 'string',
            enum: ['image', 'video', 'html5', 'pdf', 'web_url'],
            description: 'Filter by content type',
          },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'create_playlist',
      description: 'Create a new playlist. Returns the new playlist id and name.',
      parameters: {
        type: 'object',
        required: ['name'],
        properties: {
          name: { type: 'string', description: 'Playlist name' },
          description: { type: 'string', description: 'Optional description' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'add_playlist_items',
      description: 'Add one or more content items to an existing playlist.',
      parameters: {
        type: 'object',
        required: ['playlistId', 'contentIds'],
        properties: {
          playlistId: { type: 'string', description: 'ID of the target playlist' },
          contentIds: {
            type: 'array',
            items: { type: 'string' },
            description: 'Array of content item IDs to add',
          },
          duration: {
            type: 'number',
            description: 'Optional duration override in seconds applied to every added item',
          },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'create_schedule',
      description: 'Create a new schedule containing one or more time slots. Returns schedule id.',
      parameters: {
        type: 'object',
        required: ['name', 'slots'],
        properties: {
          name: { type: 'string', description: 'Schedule name' },
          timezone: {
            type: 'string',
            description: 'IANA timezone e.g. UTC, Europe/London, America/New_York. Default: UTC',
          },
          slots: {
            type: 'array',
            description: 'Time slots to add',
            items: {
              type: 'object',
              required: ['startTime', 'endTime', 'recurrenceType'],
              properties: {
                startTime: { type: 'string', description: 'HH:MM — e.g. 09:00' },
                endTime: { type: 'string', description: 'HH:MM — e.g. 10:00' },
                recurrenceType: {
                  type: 'string',
                  enum: ['once', 'daily', 'weekly', 'monthly'],
                  description: 'How often the slot repeats',
                },
                daysOfWeek: {
                  type: 'array',
                  items: { type: 'number' },
                  description: '0=Mon 1=Tue 2=Wed 3=Thu 4=Fri 5=Sat 6=Sun — required when recurrenceType is weekly',
                },
                date: {
                  type: 'string',
                  description: 'YYYY-MM-DD — required when recurrenceType is once',
                },
                playlistId: { type: 'string', description: 'Playlist to play during this slot' },
                contentId: { type: 'string', description: 'Content item to play (alternative to playlistId)' },
                label: { type: 'string', description: 'Optional label for the slot' },
                priority: { type: 'number', description: 'Priority 0–100; higher wins when slots overlap. Default 0.' },
              },
            },
          },
        },
      },
    },
  },
  // ── Read / list tools ──────────────────────────────────────────────────────
  {
    type: 'function',
    function: {
      name: 'list_devices',
      description: 'List devices in the workspace. Optionally filter by online status, platform, or name. Returns id, name, online, platform, type.',
      parameters: {
        type: 'object',
        properties: {
          search:   { type: 'string', description: 'Partial device name to search for' },
          status:   { type: 'string', enum: ['online', 'offline'], description: 'Filter by live connection status' },
          platform: { type: 'string', description: 'Filter by platform: tizen, windows, android, browser, linux, webos' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'list_playlists',
      description: 'List playlists in the workspace. Returns id, name, itemCount, totalDuration.',
      parameters: {
        type: 'object',
        properties: {
          search: { type: 'string', description: 'Partial playlist name to search for' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'list_schedules',
      description: 'List schedules in the workspace. Returns id, name, timezone, type, isActive.',
      parameters: {
        type: 'object',
        properties: {
          search: { type: 'string', description: 'Partial schedule name to search for' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'list_sync_playlists',
      description: 'List sync playlists in the workspace. Returns id and name.',
      parameters: {
        type: 'object',
        properties: {
          search: { type: 'string', description: 'Partial name to search for' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'list_device_groups',
      description: 'List device groups in the workspace. Returns id, name, type (sync/videowall/location/tag).',
      parameters: {
        type: 'object',
        properties: {
          search: { type: 'string', description: 'Partial group name to search for' },
          type:   { type: 'string', enum: ['sync', 'videowall', 'location', 'tag'], description: 'Filter by group type' },
        },
      },
    },
  },
];

// ── Tool result type ──────────────────────────────────────────────────────────

export interface ToolResult {
  success: boolean;
  data?: unknown;
  error?: string;
  /** Short human-readable description of what happened */
  label: string;
}

// ── Intent detector — enables tool mode only for imperative action requests ───
//
// We use patterns rather than plain keywords to avoid false positives.
// "how do i make a playlist?" → asking for instructions → simple streaming
// "can you make a playlist for me?" → asking AI to act  → agent mode

const IMPERATIVE_PATTERNS = [
  /\b(can|could|would)\s+you\s+(create|make|build|schedule|add|set\s+up|setup|generate)\b/i,
  /\bplease\s+(create|make|build|schedule|add|set\s+up|setup|generate)\b/i,
  /\b(i want|i need)\s+you\s+to\b/i,
  // "create a playlist", "make a schedule", "build me a loop" — imperative, no "how"
  /^(?!.*\b(how|what|where|why|when|which|explain|show|tell)\b).*(create|make|build|set\s+up|setup|generate)\s+(a|an|the|my|new)\s*(playlist|schedule|loop|plan)\b/is,
  // "schedule this/it for monday", "schedule my content for..."
  /\bschedule\s+(this|it|them|my|the)\b/i,
  /\bauto[-\s]?(schedule|create|build)\b/i,
  // "add [something] to [a playlist/schedule]"
  /\badd\s+.{3,40}\s+to\s+(a|the|my|an?)?\s*(playlist|schedule)\b/i,
  // NOTE: list/query intents are handled by getDirectListQuery, not here.
];

export function shouldUseTools(message: string): boolean {
  return IMPERATIVE_PATTERNS.some((p) => p.test(message));
}

// ── Direct list query dispatcher ─────────────────────────────────────────────
//
// List queries are executed directly (no LLM tool-calling round-trip needed).
// This avoids the chatComplete-with-tools path on models that don't support it.

const DIRECT_LIST_PATTERNS: Array<{
  pattern: RegExp;
  tool: string;
  args?: Record<string, unknown>;
}> = [
  { pattern: /\b(show|list|get|find)\s+(me\s+)?(all\s+)?(my\s+)?devices?\b/i,       tool: 'list_devices' },
  { pattern: /\bwhich\s+devices?\s+are\s+online\b/i,                                  tool: 'list_devices',      args: { status: 'online' } },
  { pattern: /\bwhich\s+devices?\s+are\s+offline\b/i,                                 tool: 'list_devices',      args: { status: 'offline' } },
  { pattern: /\bhow\s+many\s+devices?\b/i,                                            tool: 'list_devices' },
  { pattern: /\bwhat\s+devices?\b/i,                                                  tool: 'list_devices' },
  { pattern: /\b(show|list|get|find)\s+(me\s+)?(all\s+)?(my\s+)?playlists?\b/i,     tool: 'list_playlists' },
  { pattern: /\bwhat\s+playlists?\b/i,                                                tool: 'list_playlists' },
  { pattern: /\b(show|list|get|find)\s+(me\s+)?(all\s+)?(my\s+)?schedules?\b/i,     tool: 'list_schedules' },
  { pattern: /\bwhat\s+schedules?\b/i,                                                tool: 'list_schedules' },
  { pattern: /\b(show|list|get|find)\s+(me\s+)?(all\s+)?(my\s+)?sync\s+playlists?\b/i, tool: 'list_sync_playlists' },
  { pattern: /\b(show|list|get|find)\s+(me\s+)?(all\s+)?(my\s+)?(device\s+)?groups?\b/i, tool: 'list_device_groups' },
  { pattern: /\bwhat\s+(device\s+)?groups?\b/i,                                       tool: 'list_device_groups' },
  { pattern: /\bhow\s+many\s+(playlists?|schedules?|groups?)\b/i,                    tool: 'list_playlists' }, // resolved further below if needed
];

export function getDirectListQuery(message: string): { tool: string; args: Record<string, unknown> } | null {
  const lower = message.toLowerCase();
  for (const entry of DIRECT_LIST_PATTERNS) {
    if (entry.pattern.test(lower)) {
      // Disambiguate "how many X" for non-device resources
      if (entry.tool === 'list_playlists' && /schedule/i.test(message)) {
        return { tool: 'list_schedules', args: {} };
      }
      if (entry.tool === 'list_playlists' && /group/i.test(message)) {
        return { tool: 'list_device_groups', args: {} };
      }
      return { tool: entry.tool, args: entry.args ?? {} };
    }
  }
  return null;
}

/** Format a list ToolResult as readable Markdown without involving the LLM. */
export function formatListResult(tool: string, result: ToolResult): string {
  if (!result.success) return `I couldn't retrieve that data: ${result.error}`;
  const data = (result.data ?? []) as Record<string, unknown>[];
  if (!data.length) return 'No items found.';

  switch (tool) {
    case 'list_devices':
      return `**${result.label}:**\n\n` + data.map((r) =>
        `- **${r['name']}** — ${r['online'] ? '🟢 online' : '⚫ offline'} · ${r['platform']}${
          r['type'] !== 'signage' ? ` · ${r['type']}` : ''}`,
      ).join('\n');

    case 'list_playlists':
      return `**${result.label}:**\n\n` + data.map((r) => {
        const dur = (r['totalDuration'] as number) > 0
          ? ` · ${Math.floor((r['totalDuration'] as number) / 60)}m ${(r['totalDuration'] as number) % 60}s` : '';
        return `- **${r['name']}** — ${r['itemCount']} item${r['itemCount'] !== 1 ? 's' : ''}${dur}${
          r['isSmartPlaylist'] ? ' _(smart)_' : ''}`;
      }).join('\n');

    case 'list_schedules':
      return `**${result.label}:**\n\n` + data.map((r) =>
        `- **${r['name']}** — ${r['type']} · ${r['timezone']}${!r['isActive'] ? ' · _inactive_' : ''}`,
      ).join('\n');

    case 'list_sync_playlists':
      return `**${result.label}:**\n\n` + data.map((r) => `- **${r['name']}**`).join('\n');

    case 'list_device_groups':
      return `**${result.label}:**\n\n` + data.map((r) => {
        const wall = r['type'] === 'videowall' && r['videoWallCols']
          ? ` · ${r['videoWallCols']}×${r['videoWallRows']} grid` : '';
        return `- **${r['name']}** — ${r['type']}${wall}`;
      }).join('\n');

    default:
      return `**${result.label}**`;
  }
}

// ── Tool dispatcher ───────────────────────────────────────────────────────────

export async function executeToolCall(
  name: string,
  args: Record<string, unknown>,
  ctx: ToolContext,
): Promise<ToolResult> {
  switch (name) {
    case 'search_content':       return searchContent(args, ctx);
    case 'create_playlist':      return createPlaylist(args, ctx);
    case 'add_playlist_items':   return addPlaylistItems(args, ctx);
    case 'create_schedule':      return createScheduleWithSlots(args, ctx);
    case 'list_devices':         return listDevices(args, ctx);
    case 'list_playlists':       return listPlaylists(args, ctx);
    case 'list_schedules':       return listSchedules(args, ctx);
    case 'list_sync_playlists':  return listSyncPlaylists(args, ctx);
    case 'list_device_groups':   return listDeviceGroups(args, ctx);
    default:
      return { success: false, error: `Unknown tool: ${name}`, label: name };
  }
}

// ── Tool implementations ──────────────────────────────────────────────────────

async function searchContent(
  args: Record<string, unknown>,
  ctx: ToolContext,
): Promise<ToolResult> {
  const search = typeof args['search'] === 'string' ? args['search'] : undefined;
  const type   = typeof args['type']   === 'string' ? args['type']   : undefined;

  const conditions = [
    eq(contentItems.workspaceId, ctx.workspaceId),
    isNull(contentItems.deletedAt),
    eq(contentItems.status, 'ready'),
  ];
  if (search) conditions.push(ilike(contentItems.name, `%${search}%`));
  if (type)   conditions.push(eq(contentItems.type, type));

  const rows = await db
    .select({ id: contentItems.id, name: contentItems.name, type: contentItems.type, duration: contentItems.duration })
    .from(contentItems)
    .where(and(...conditions))
    .limit(20);

  return {
    success: true,
    data: rows,
    label: `Found ${rows.length} content item${rows.length !== 1 ? 's' : ''}`,
  };
}

async function createPlaylist(
  args: Record<string, unknown>,
  ctx: ToolContext,
): Promise<ToolResult> {
  const name        = typeof args['name']        === 'string' ? args['name'].trim() : '';
  const description = typeof args['description'] === 'string' ? args['description'] : null;

  if (!name) return { success: false, error: 'name is required', label: 'Create playlist' };

  const [playlist] = await db.insert(playlists).values({
    workspaceId: ctx.workspaceId,
    createdBy: ctx.userId,
    name,
    description,
    createdByAi: true,
  }).returning();

  logActivity({
    userId: ctx.userId,
    workspaceId: ctx.workspaceId,
    eventType: 'playlist_created',
    eventData: { playlistId: playlist?.id, name, createdByAi: true },
  });

  return {
    success: true,
    data: { id: playlist?.id, name },
    label: `Created playlist "${name}"`,
  };
}

async function addPlaylistItems(
  args: Record<string, unknown>,
  ctx: ToolContext,
): Promise<ToolResult> {
  const playlistId = typeof args['playlistId'] === 'string' ? args['playlistId'] : '';
  const contentIds = Array.isArray(args['contentIds']) ? (args['contentIds'] as string[]) : [];
  const duration   = typeof args['duration'] === 'number' ? args['duration'] : null;

  if (!playlistId || contentIds.length === 0) {
    return { success: false, error: 'playlistId and contentIds are required', label: 'Add playlist items' };
  }

  // Verify playlist belongs to this workspace.
  const playlist = await db.query.playlists.findFirst({
    where: and(
      eq(playlists.id, playlistId),
      eq(playlists.workspaceId, ctx.workspaceId),
      isNull(playlists.deletedAt),
    ),
  });
  if (!playlist) return { success: false, error: 'Playlist not found in this workspace', label: 'Add playlist items' };

  // Only add content that belongs to this workspace.
  const validContent = await db
    .select({ id: contentItems.id })
    .from(contentItems)
    .where(and(
      inArray(contentItems.id, contentIds),
      eq(contentItems.workspaceId, ctx.workspaceId),
      isNull(contentItems.deletedAt),
    ));

  if (validContent.length === 0) {
    return { success: false, error: 'None of the specified content items were found in this workspace', label: 'Add playlist items' };
  }

  const startPosition = playlist.itemCount;
  await db.insert(playlistItems).values(
    validContent.map((c, i) => ({
      playlistId,
      contentId: c.id,
      position: startPosition + i,
      ...(duration !== null ? { duration } : {}),
    })),
  );

  // Keep itemCount accurate.
  await db
    .update(playlists)
    .set({ itemCount: startPosition + validContent.length, updatedAt: new Date() })
    .where(eq(playlists.id, playlistId));

  return {
    success: true,
    data: { addedCount: validContent.length },
    label: `Added ${validContent.length} item${validContent.length !== 1 ? 's' : ''} to "${playlist.name}"`,
  };
}

interface SlotInput {
  startTime?: unknown;
  endTime?: unknown;
  recurrenceType?: unknown;
  daysOfWeek?: unknown;
  date?: unknown;
  playlistId?: unknown;
  contentId?: unknown;
  label?: unknown;
  priority?: unknown;
}

async function createScheduleWithSlots(
  args: Record<string, unknown>,
  ctx: ToolContext,
): Promise<ToolResult> {
  const name     = typeof args['name']     === 'string' ? args['name'].trim() : '';
  const timezone = typeof args['timezone'] === 'string' ? args['timezone']    : 'UTC';
  const rawSlots = Array.isArray(args['slots']) ? (args['slots'] as SlotInput[]) : [];

  if (!name)          return { success: false, error: 'name is required', label: 'Create schedule' };
  if (!rawSlots.length) return { success: false, error: 'at least one slot is required', label: 'Create schedule' };

  const [schedule] = await db.insert(schedules).values({
    workspaceId: ctx.workspaceId,
    createdBy: ctx.userId,
    name,
    timezone,
    type: 'general',
    isActive: true,
    createdByAi: true,
  }).returning();

  if (!schedule) return { success: false, error: 'Failed to create schedule row', label: 'Create schedule' };

  let insertedSlots = 0;
  for (const slot of rawSlots) {
    const startTime      = typeof slot.startTime      === 'string' ? slot.startTime      : null;
    const endTime        = typeof slot.endTime        === 'string' ? slot.endTime        : null;
    const recurrenceType = typeof slot.recurrenceType === 'string' ? slot.recurrenceType : 'weekly';

    if (!startTime || !endTime) continue;

    const daysOfWeek = Array.isArray(slot.daysOfWeek)
      ? (slot.daysOfWeek as number[]).filter((d) => typeof d === 'number')
      : null;

    await db.insert(scheduleSlots).values({
      scheduleId:      schedule.id,
      startTime,
      endTime,
      recurrenceType:  recurrenceType as 'once' | 'daily' | 'weekly' | 'monthly',
      daysOfWeek:      daysOfWeek ?? null,
      date:            typeof slot.date       === 'string' ? slot.date       : null,
      playlistId:      typeof slot.playlistId === 'string' ? slot.playlistId : null,
      contentId:       typeof slot.contentId  === 'string' ? slot.contentId  : null,
      label:           typeof slot.label      === 'string' ? slot.label      : null,
      priority:        typeof slot.priority   === 'number' ? slot.priority   : 0,
    });
    insertedSlots++;
  }

  logActivity({
    userId: ctx.userId,
    workspaceId: ctx.workspaceId,
    eventType: 'schedule_created',
    eventData: { scheduleId: schedule.id, name, createdByAi: true, slotCount: insertedSlots },
  });

  return {
    success: true,
    data: { id: schedule.id, name, slotCount: insertedSlots },
    label: `Created schedule "${name}" with ${insertedSlots} slot${insertedSlots !== 1 ? 's' : ''}`,
  };
}

// ── List / query tools ────────────────────────────────────────────────────────

async function listDevices(
  args: Record<string, unknown>,
  ctx: ToolContext,
): Promise<ToolResult> {
  const search         = typeof args['search']   === 'string' ? args['search']   : undefined;
  const statusFilter   = typeof args['status']   === 'string' ? args['status']   : undefined;
  const platformFilter = typeof args['platform'] === 'string' ? args['platform'] : undefined;

  const conditions = [eq(devices.workspaceId, ctx.workspaceId), isNull(devices.deletedAt)];
  if (search)         conditions.push(ilike(devices.name, `%${search}%`));
  if (platformFilter) conditions.push(eq(devices.platform, platformFilter));

  const rows = await db
    .select({
      id: devices.id,
      name: devices.name,
      status: devices.status,
      platform: devices.platform,
      type: devices.type,
      lastSeen: devices.lastSeen,
    })
    .from(devices)
    .where(and(...conditions))
    .limit(50);

  const enriched = rows
    .map((r) => ({ ...r, online: isDeviceOnline(r.id) }))
    .filter((r) => !statusFilter || (statusFilter === 'online' ? r.online : !r.online));

  return {
    success: true,
    data: enriched,
    label: `Found ${enriched.length} device${enriched.length !== 1 ? 's' : ''}`,
  };
}

async function listPlaylists(
  args: Record<string, unknown>,
  ctx: ToolContext,
): Promise<ToolResult> {
  const search = typeof args['search'] === 'string' ? args['search'] : undefined;

  const conditions = [eq(playlists.workspaceId, ctx.workspaceId), isNull(playlists.deletedAt)];
  if (search) conditions.push(ilike(playlists.name, `%${search}%`));

  const rows = await db
    .select({
      id: playlists.id,
      name: playlists.name,
      itemCount: playlists.itemCount,
      totalDuration: playlists.totalDuration,
      isSmartPlaylist: playlists.isSmartPlaylist,
    })
    .from(playlists)
    .where(and(...conditions))
    .limit(50);

  return {
    success: true,
    data: rows,
    label: `Found ${rows.length} playlist${rows.length !== 1 ? 's' : ''}`,
  };
}

async function listSchedules(
  args: Record<string, unknown>,
  ctx: ToolContext,
): Promise<ToolResult> {
  const search = typeof args['search'] === 'string' ? args['search'] : undefined;

  const conditions = [eq(schedules.workspaceId, ctx.workspaceId), isNull(schedules.deletedAt)];
  if (search) conditions.push(ilike(schedules.name, `%${search}%`));

  const rows = await db
    .select({
      id: schedules.id,
      name: schedules.name,
      timezone: schedules.timezone,
      type: schedules.type,
      isActive: schedules.isActive,
    })
    .from(schedules)
    .where(and(...conditions))
    .limit(50);

  return {
    success: true,
    data: rows,
    label: `Found ${rows.length} schedule${rows.length !== 1 ? 's' : ''}`,
  };
}

async function listSyncPlaylists(
  args: Record<string, unknown>,
  ctx: ToolContext,
): Promise<ToolResult> {
  const search = typeof args['search'] === 'string' ? args['search'] : undefined;

  const conditions = [eq(syncPlaylists.workspaceId, ctx.workspaceId), isNull(syncPlaylists.deletedAt)];
  if (search) conditions.push(ilike(syncPlaylists.name, `%${search}%`));

  const rows = await db
    .select({ id: syncPlaylists.id, name: syncPlaylists.name, createdAt: syncPlaylists.createdAt })
    .from(syncPlaylists)
    .where(and(...conditions))
    .limit(50);

  return {
    success: true,
    data: rows,
    label: `Found ${rows.length} sync playlist${rows.length !== 1 ? 's' : ''}`,
  };
}

async function listDeviceGroups(
  args: Record<string, unknown>,
  ctx: ToolContext,
): Promise<ToolResult> {
  const search     = typeof args['search'] === 'string' ? args['search'] : undefined;
  const typeFilter = typeof args['type']   === 'string' ? args['type']   : undefined;

  const conditions = [eq(deviceGroups.workspaceId, ctx.workspaceId), isNull(deviceGroups.deletedAt)];
  if (search)     conditions.push(ilike(deviceGroups.name, `%${search}%`));
  if (typeFilter) conditions.push(eq(deviceGroups.type, typeFilter));

  const rows = await db
    .select({
      id: deviceGroups.id,
      name: deviceGroups.name,
      type: deviceGroups.type,
      videoWallCols: deviceGroups.videoWallCols,
      videoWallRows: deviceGroups.videoWallRows,
    })
    .from(deviceGroups)
    .where(and(...conditions))
    .limit(50);

  return {
    success: true,
    data: rows,
    label: `Found ${rows.length} device group${rows.length !== 1 ? 's' : ''}`,
  };
}
