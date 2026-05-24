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
} from '@signage/db';
import { and, eq, ilike, isNull, inArray } from 'drizzle-orm';
import { logActivity } from './activity-logger.js';

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
];

// ── Tool result type ──────────────────────────────────────────────────────────

export interface ToolResult {
  success: boolean;
  data?: unknown;
  error?: string;
  /** Short human-readable description of what happened */
  label: string;
}

// ── Keyword detector — enables tool mode for action-oriented messages ─────────

const ACTION_KEYWORDS = [
  'create', 'make', 'schedule', 'add', 'set up', 'setup', 'build',
  'generate', 'new playlist', 'new schedule', 'assign', 'publish',
  'for me', 'can you', 'please', 'i want', 'i need',
];

export function shouldUseTools(message: string): boolean {
  const lower = message.toLowerCase();
  return ACTION_KEYWORDS.some((kw) => lower.includes(kw));
}

// ── Tool dispatcher ───────────────────────────────────────────────────────────

export async function executeToolCall(
  name: string,
  args: Record<string, unknown>,
  ctx: ToolContext,
): Promise<ToolResult> {
  switch (name) {
    case 'search_content':   return searchContent(args, ctx);
    case 'create_playlist':  return createPlaylist(args, ctx);
    case 'add_playlist_items': return addPlaylistItems(args, ctx);
    case 'create_schedule':  return createScheduleWithSlots(args, ctx);
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
