/**
 * Knowledge base loader with semantic search via pgvector + nomic-embed-text.
 *
 * Phase 2 (semantic) with keyword fallback:
 *   - At startup: generates embeddings for all .md docs, stores in ai_knowledge_embeddings
 *   - Per query: embeds the question, does cosine similarity search via pgvector
 *   - Falls back to keyword scoring if embeddings unavailable
 */

import { readFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createHash } from 'node:crypto';
import { db } from '@signage/db';
import { sql } from 'drizzle-orm';

const __dirname = dirname(fileURLToPath(import.meta.url));
// Try dev (src/) first, then prod build (dist/ → ../../src/) — knowledge
// markdown files are kept in source and not copied into dist by tsc.
const KNOWLEDGE_DIR_CANDIDATES = [
  join(__dirname, '..', 'ai', 'knowledge'),
  join(__dirname, '..', '..', 'src', 'ai', 'knowledge'),
];

const OLLAMA_HOST = process.env['OLLAMA_HOST'] ?? 'http://127.0.0.1:11434';
const EMBED_MODEL = 'nomic-embed-text';
const EMBED_DIM = 768;

export interface KnowledgeDoc {
  /** filename without extension */
  id: string;
  title: string;
  content: string;
  /** Lowercased token set for fast keyword scoring (fallback) */
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
  cache = [];
  return cache;
}

// ── Embedding utilities ───────────────────────────────────────────────────────

// Truncate to ~6 000 chars so large docs stay within nomic-embed-text's token window.
const MAX_EMBED_CHARS = 6_000;

async function generateEmbedding(text: string): Promise<number[] | null> {
  const input = text.length > MAX_EMBED_CHARS ? text.slice(0, MAX_EMBED_CHARS) : text;
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 60_000);
    const res = await fetch(`${OLLAMA_HOST}/api/embed`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: EMBED_MODEL, input }),
      signal: ctrl.signal,
    });
    clearTimeout(timer);
    if (!res.ok) return null;
    const data = await res.json() as { embeddings?: number[][] };
    return data.embeddings?.[0] ?? null;
  } catch {
    return null;
  }
}

async function ensureEmbeddingsTable(): Promise<void> {
  await db.execute(sql.raw(`
    CREATE TABLE IF NOT EXISTS ai_knowledge_embeddings (
      id         text PRIMARY KEY,
      content    text NOT NULL,
      checksum   text NOT NULL,
      embedding  vector(${EMBED_DIM}) NOT NULL,
      updated_at timestamptz NOT NULL DEFAULT now()
    )
  `));
  await db.execute(sql.raw(`
    CREATE INDEX IF NOT EXISTS idx_knowledge_embedding_hnsw
    ON ai_knowledge_embeddings
    USING hnsw (embedding vector_cosine_ops)
  `));
}

/**
 * Seed / refresh embeddings for all docs.
 * Skips docs whose content hasn't changed (checksum match).
 * Called once at API startup — fire-and-forget, no await needed.
 */
export async function seedKnowledgeEmbeddings(): Promise<void> {
  try {
    await ensureEmbeddingsTable();
    const docs = await loadAll();
    if (docs.length === 0) return;

    for (const doc of docs) {
      const checksum = createHash('md5').update(doc.content).digest('hex');

      const existing = await db.execute(
        sql`SELECT checksum FROM ai_knowledge_embeddings WHERE id = ${doc.id}`,
      ) as unknown as Array<{ checksum: string }>;

      if (existing[0]?.checksum === checksum) continue;

      const embedding = await generateEmbedding(doc.content);
      if (!embedding) {
        console.warn('[ai-knowledge] failed to embed doc:', doc.id);
        continue;
      }

      const vecStr = `[${embedding.join(',')}]`;
      await db.execute(sql`
        INSERT INTO ai_knowledge_embeddings (id, content, checksum, embedding, updated_at)
        VALUES (${doc.id}, ${doc.content}, ${checksum}, ${vecStr}::vector, now())
        ON CONFLICT (id) DO UPDATE
          SET content    = EXCLUDED.content,
              checksum   = EXCLUDED.checksum,
              embedding  = EXCLUDED.embedding,
              updated_at = now()
      `);
    }
    console.info('[ai-knowledge] embeddings seeded for', docs.length, 'docs');
  } catch (err) {
    // Non-fatal — keyword fallback will handle queries
    console.warn('[ai-knowledge] embedding seed failed:', err);
  }
}

// ── Retrieval ─────────────────────────────────────────────────────────────────

async function selectRelevantDocsSemantic(
  question: string,
  limit: number,
): Promise<KnowledgeDoc[] | null> {
  try {
    const qEmbedding = await generateEmbedding(question);
    if (!qEmbedding) return null;

    const vecStr = `[${qEmbedding.join(',')}]`;
    const rows = await db.execute(sql`
      SELECT id
      FROM   ai_knowledge_embeddings
      ORDER  BY embedding <=> ${vecStr}::vector
      LIMIT  ${limit}
    `) as unknown as Array<{ id: string }>;

    if (!rows.length) return null;

    const docs = await loadAll();
    const docMap = new Map(docs.map((d) => [d.id, d]));
    return rows.map((r) => docMap.get(r.id)).filter((d): d is KnowledgeDoc => d !== undefined);
  } catch {
    return null;
  }
}

/**
 * Score documents against the user's question and return the top N.
 * Tries pgvector semantic search first; falls back to keyword scoring.
 */
export async function selectRelevantDocs(
  question: string,
  limit = 3,
): Promise<KnowledgeDoc[]> {
  // Try semantic search first
  const semantic = await selectRelevantDocsSemantic(question, limit);
  if (semantic && semantic.length > 0) return semantic;

  // Keyword fallback
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
 * contains action intent. Instructs the AI to plan first, confirm, then act.
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
4. **One step at a time.** After each tool call, briefly report what happened before moving to the next step.
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
