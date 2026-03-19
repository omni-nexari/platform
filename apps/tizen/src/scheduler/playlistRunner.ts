import { renderer } from '../renderer/index.js';
import { state } from '../state.js';
import { logPlay } from './index.js';

export interface PlaylistData {
  id: string;
  loop: boolean;
  items: Array<{
    id: string;
    position: number;
    contentId?: string | null;
    duration?: number | null;
    content?: {
      id: string;
      type: string;
      name: string;
      filePath?: string | null;
      webUrl?: string | null;
      duration?: number | null;
    } | null;
  }>;
}

type PlaySource = 'schedule' | 'playlist' | 'default' | 'emergency';

export class PlaylistRunner {
  readonly playlistId: string;
  private data: PlaylistData;
  private source: PlaySource;
  private index = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private running = false;
  private itemStartedAt = new Date();

  constructor(playlistId: string, data: unknown, source: PlaySource) {
    this.playlistId = playlistId;
    this.data = data as PlaylistData;
    this.source = source;
  }

  start(): void {
    this.running = true;
    this.index = 0;
    void this.playCurrentItem();
  }

  stop(): void {
    this.running = false;
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
    this.logCurrentItem(false);
  }

  private logCurrentItem(completedFull: boolean): void {
    const items = this.sortedItems();
    const item = items[this.index];
    if (!item) return;
    const endedAt = new Date();
    logPlay({
      contentId: item.contentId ?? null,
      startedAt: this.itemStartedAt.toISOString(),
      endedAt: endedAt.toISOString(),
      durationMs: endedAt.getTime() - this.itemStartedAt.getTime(),
      completedFull,
      source: this.source,
    });
  }

  private sortedItems() {
    return [...this.data.items].sort((a, b) => a.position - b.position);
  }

  private async playCurrentItem(): Promise<void> {
    if (!this.running) return;
    const items = this.sortedItems();
    if (items.length === 0) { import('../ui/idle.js').then(({ showIdle }) => showIdle()); return; }

    if (this.index >= items.length) {
      if (!this.data.loop) { this.running = false; return; }
      this.index = 0;
    }

    const item = items[this.index]!;
    const content = item.content;
    if (!content) { this.advance(); return; }

    this.itemStartedAt = new Date();
    state.currentContentId = content.id;

    // Look ahead for next item
    const nextItem = items[this.index + 1] ?? (this.data.loop ? items[0] : null);
    state.nextContentId = nextItem?.content?.id ?? null;

    await renderer.play(content);

    const durationSec = item.duration ?? content.duration ?? 10;
    this.timer = setTimeout(() => {
      this.logCurrentItem(true);
      this.advance();
    }, durationSec * 1000);
  }

  private advance(): void {
    this.index++;
    void this.playCurrentItem();
  }
}
