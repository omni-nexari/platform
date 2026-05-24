/**
 * Ollama client — local LLM running on the Orange Pi (or any reachable host).
 *
 * Configuration:
 *   OLLAMA_HOST   — full base URL, e.g. http://192.168.1.17:11434
 *   OLLAMA_MODEL  — model tag, default 'llama3.1:8b'
 *
 * The streaming variant yields token deltas (the assistant message content)
 * as soon as Ollama emits them. Used by the SSE chat endpoint.
 */

const OLLAMA_HOST = process.env['OLLAMA_HOST'] ?? 'http://192.168.1.17:11434';
const OLLAMA_MODEL = process.env['OLLAMA_MODEL'] ?? 'llama3.1:8b';
const REQUEST_TIMEOUT_MS = Number(process.env['OLLAMA_TIMEOUT_MS'] ?? 60_000);

export interface OllamaMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
}

export interface OllamaChatOptions {
  /** Override default model */
  model?: string;
  /** Generation temperature (0.0–1.0). Lower = more deterministic. */
  temperature?: number;
  /** Optional response format hint. 'json' forces JSON-only output (used by tool-calling). */
  format?: 'json';
  /** Abort signal to cancel in-flight requests */
  signal?: AbortSignal;
}

interface OllamaChatStreamChunk {
  model: string;
  created_at: string;
  message?: { role: string; content: string };
  done: boolean;
}

/**
 * Health probe — returns true if Ollama responds within 2s.
 * Used by the chat route to surface a graceful "AI unavailable" error.
 */
export async function isOllamaAvailable(): Promise<boolean> {
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 2000);
    const res = await fetch(`${OLLAMA_HOST}/api/tags`, { signal: ctrl.signal });
    clearTimeout(timer);
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * Non-streaming chat completion. Returns the full assistant message content.
 */
export async function chatComplete(
  messages: OllamaMessage[],
  options: OllamaChatOptions = {},
): Promise<string> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), REQUEST_TIMEOUT_MS);
  const signal = options.signal ?? ctrl.signal;

  try {
    const res = await fetch(`${OLLAMA_HOST}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: options.model ?? OLLAMA_MODEL,
        messages,
        stream: false,
        ...(options.format ? { format: options.format } : {}),
        options: {
          temperature: options.temperature ?? 0.4,
        },
      }),
      signal,
    });

    if (!res.ok) {
      throw new Error(`Ollama returned ${res.status}: ${await res.text()}`);
    }

    const data = await res.json() as { message?: { content?: string } };
    return data.message?.content ?? '';
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Streaming chat completion. Yields content deltas as they arrive.
 *
 * Usage:
 *   for await (const chunk of chatStream(messages)) {
 *     reply.raw.write(`data: ${JSON.stringify({ delta: chunk })}\n\n`);
 *   }
 */
export async function* chatStream(
  messages: OllamaMessage[],
  options: OllamaChatOptions = {},
): AsyncGenerator<string, void, unknown> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), REQUEST_TIMEOUT_MS);
  const signal = options.signal ?? ctrl.signal;

  try {
    const res = await fetch(`${OLLAMA_HOST}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: options.model ?? OLLAMA_MODEL,
        messages,
        stream: true,
        ...(options.format ? { format: options.format } : {}),
        options: {
          temperature: options.temperature ?? 0.4,
        },
      }),
      signal,
    });

    if (!res.ok || !res.body) {
      throw new Error(`Ollama returned ${res.status}: ${await res.text().catch(() => '')}`);
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      // Ollama returns NDJSON: one JSON object per line.
      let nlIdx: number;
      while ((nlIdx = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, nlIdx).trim();
        buffer = buffer.slice(nlIdx + 1);
        if (!line) continue;

        try {
          const chunk = JSON.parse(line) as OllamaChatStreamChunk;
          const delta = chunk.message?.content;
          if (delta) yield delta;
          if (chunk.done) return;
        } catch {
          // Ignore malformed lines; the stream may legitimately split mid-frame
          // and the remainder will be picked up on the next read.
        }
      }
    }
  } finally {
    clearTimeout(timer);
  }
}

export function getOllamaConfig() {
  return { host: OLLAMA_HOST, model: OLLAMA_MODEL };
}
