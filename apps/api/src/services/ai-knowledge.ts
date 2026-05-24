/**
 * Knowledge base loader — reads the markdown docs in apps/api/src/ai/knowledge
 * at startup and exposes a simple keyword-based context selector.
 *
 * Phase 1 deliberately avoids embeddings/vector DBs: with a handful of docs,
 * keyword scoring is fast, deterministic, and good enough. Upgrade to
 * pgvector + nomic-embed-text when the knowledge base grows past ~30 docs.
 */

import { readFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
// Try dev (src/) first, then prod build (dist/ → ../../src/) — knowledge
// markdown files are kept in source and not copied into dist by tsc.
const KNOWLEDGE_DIR_CANDIDATES = [
  join(__dirname, '..', 'ai', 'knowledge'),
  join(__dirname, '..', '..', 'src', 'ai', 'knowledge'),
];

export interface KnowledgeDoc {
  /** filename without extension */
  id: string;
  title: string;
  content: string;
  /** Lowercased token set for fast keyword scoring */
  tokens: Set<string>;
}

const STOPWORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'but', 'is', 'are', 'was', 'were',
  'be', 'been', 'being', 'have', 'has', 'had', 'do', 'does', 'did',
  'will', 'would', 'could', 'should', 'may', 'might', 'i', 'you',
  'he', 'she', 'it', 'we', 'they', 'me', 'him', 'her', 'us', 'them',
  'my', 'your', 'his', 'its', 'our', 'their', 'this', 'that',
  'these', 'those', 'of', 'to', 'in', 'on', 'at', 'by', 'for',
  'with', 'about', 'as', 'from', 'how', 'what', 'where', 'when',
  'why', 'who', 'which', 'can', 'cannot', 'cant', 'not',
]);

function tokenise(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length > 2 && !STOPWORDS.has(t));
}

let cache: KnowledgeDoc[] | null = null;

async function loadAll(): Promise<KnowledgeDoc[]> {
  if (cache) return cache;

  for (const dir of KNOWLEDGE_DIR_CANDIDATES) {
    try {
      const files = await readdir(dir);
      const docs = await Promise.all(
        files
          .filter((f) => f.endsWith('.md'))
          .map(async (f): Promise<KnowledgeDoc> => {
            const content = await readFile(join(dir, f), 'utf8');
            const firstLine = content.split('\n', 1)[0] ?? f;
            const title = firstLine.replace(/^#+\s*/, '').trim() || f.replace(/\.md$/, '');
            return {
              id: f.replace(/\.md$/, ''),
              title,
              content,
              tokens: new Set(tokenise(content)),
            };
          }),
      );
      if (docs.length > 0) {
        cache = docs;
        return docs;
      }
    } catch {
      // Try the next candidate
    }
  }

  // No knowledge found — return empty so the chat route still works
  // (AI will answer from its priors with a slightly degraded system prompt).
  cache = [];
  return cache;
}

/**
 * Score documents against the user's question and return the top N.
 * Score = count of distinct query tokens that appear in the doc.
 */
export async function selectRelevantDocs(
  question: string,
  limit = 3,
): Promise<KnowledgeDoc[]> {
  const docs = await loadAll();
  if (docs.length === 0) return [];

  const qTokens = tokenise(question);
  if (qTokens.length === 0) return docs.slice(0, limit);

  const scored = docs.map((doc) => {
    let score = 0;
    for (const t of qTokens) if (doc.tokens.has(t)) score += 1;
    return { doc, score };
  });

  scored.sort((a, b) => b.score - a.score);

  // Always include at least the navigation overview if nothing scored.
  const top = scored.filter((s) => s.score > 0).slice(0, limit).map((s) => s.doc);
  if (top.length === 0) {
    const nav = docs.find((d) => d.id === 'navigation');
    return nav ? [nav] : docs.slice(0, 1);
  }
  return top;
}

/** Build the system prompt with retrieved context injected. */
export async function buildSystemPrompt(question: string): Promise<string> {
  const docs = await selectRelevantDocs(question);
  const context = docs.map((d) => `## ${d.title}\n${d.content}`).join('\n\n---\n\n');

  return `You are the AI assistant for **OmniHub**, a digital signage management platform. You help users navigate the dashboard and use platform features.

Guidelines:
- Be concise and friendly. Default to 1–3 short paragraphs or a short list.
- When a user asks "how do I X", give the exact navigation path and the click-by-click steps.
- If you don't know the answer, say so and suggest where the user could look or who they could ask.
- Use Markdown formatting (lists, **bold**, \`code\` where useful).
- Never invent menu items, URLs, or features. Stick to what the documentation below describes.
- If the user asks you to perform an action (create a playlist, schedule something), explain that action capabilities are coming soon and offer to walk them through the manual steps for now.

Relevant documentation:

${context}`;
}

/**
 * System prompt for agent (tool-calling) mode — used when the user's message
 * contains action intent.  Instructs the AI to plan first, confirm, then act.
 */
export async function buildAgentSystemPrompt(question: string): Promise<string> {
  const docs = await selectRelevantDocs(question, 2);
  const context = docs.map((d) => `## ${d.title}\n${d.content}`).join('\n\n---\n\n');

  return `You are the AI assistant for **OmniHub**, a digital signage management platform. You can both answer questions AND take actions on behalf of the user.

## Available actions (tools)

### Read / query tools (no confirmation needed)
- **list_devices** — list devices in the workspace; filter by name, online/offline status, or platform
- **list_playlists** — list playlists in the workspace; filter by name
- **list_schedules** — list schedules in the workspace; filter by name
- **list_sync_playlists** — list sync playlists in the workspace; filter by name
- **list_device_groups** — list device groups (sync, videowall, location, tag); filter by name or type
- **search_content** — find content items (images, videos, etc.) by name or type

### Write tools (require confirmation before calling)
- **create_playlist** — create a new playlist
- **add_playlist_items** — add content items to a playlist
- **create_schedule** — create a schedule with time slots

## Rules for taking actions
1. **Read first when helpful.** If the user asks "show me my devices" or "list playlists", call the appropriate list tool immediately — no confirmation needed.
2. **Plan before writing.** Before calling any tool that creates data, write a short plain-English plan (2–4 bullet points) describing exactly what you will do, then ask: "Shall I proceed?"
3. **Only proceed after explicit confirmation.** If the user says yes/proceed/do it/go ahead/confirm — call the tools. If they say no/cancel/stop — don't call any tools.
4. **One step at a time.** After each tool call, briefly report what happened (e.g. "✓ Found 4 devices", "✓ Created playlist 'Morning Welcome'") before moving to the next step.
5. **Be precise.** Use exact IDs returned by earlier tool calls when referencing playlists or content.
6. **Handle errors gracefully.** If a tool returns an error, explain it simply and ask the user what they'd like to do next.

## General guidelines
- Be concise and friendly.
- Use Markdown for structure when helpful.
- Never invent platform features or data that doesn't exist.

## Platform context

${context}`;
}

/** For tests / cache invalidation if knowledge docs are edited at runtime. */
export function clearKnowledgeCache() {
  cache = null;
}
