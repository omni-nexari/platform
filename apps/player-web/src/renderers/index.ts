/**
 * Content renderers — pluggable per content type.
 *
 * The full Tizen player supports VIDEO, IMAGE, HTML, CANVAS, plus widgets
 * (calendar, RSS, weather, POS, ticker, DataSync). The skeletons here cover
 * the four primitives; widgets are TODO and are tracked in the package
 * README's porting table.
 */

import { logger } from '../logger.js';

export type ContentType = 'VIDEO' | 'IMAGE' | 'HTML' | 'CANVAS';

export interface ContentItem {
  id: string;
  type: ContentType;
  url?: string;
  metadata?: Record<string, unknown>;
}

export interface ContentRenderer {
  /** Type tag used by the dispatcher. */
  type: ContentType;
  /** Mount the content into the container. Resolves when first frame visible. */
  mount(container: HTMLElement, item: ContentItem): Promise<void>;
  /** Pause and release resources but keep DOM (for fast resume). */
  pause(): void;
  /** Tear down DOM + listeners. */
  destroy(): void;
}

// ── VIDEO — single-element fallback (sync engine handles A/B for syncplay) ────
class VideoRenderer implements ContentRenderer {
  readonly type: ContentType = 'VIDEO';
  private el: HTMLVideoElement | null = null;

  async mount(container: HTMLElement, item: ContentItem): Promise<void> {
    if (!item.url) throw new Error('VideoRenderer: item.url required');
    const v = document.createElement('video');
    v.src = item.url;
    v.autoplay = true;
    v.loop = true;
    v.muted = false;
    v.playsInline = true;
    v.style.cssText =
      'position:absolute;inset:0;width:100%;height:100%;object-fit:contain;background:#000;';
    container.appendChild(v);
    this.el = v;
    await new Promise<void>((resolve, reject) => {
      v.addEventListener('canplay', () => resolve(), { once: true });
      v.addEventListener('error', () => reject(new Error('video load error')), {
        once: true,
      });
    });
    try {
      await v.play();
    } catch (e) {
      logger.warn(`[VideoRenderer] autoplay blocked: ${(e as Error).message}`);
    }
  }
  pause(): void {
    this.el?.pause();
  }
  destroy(): void {
    if (this.el) {
      try {
        this.el.pause();
      } catch {}
      this.el.remove();
      this.el = null;
    }
  }
}

// ── IMAGE ─────────────────────────────────────────────────────────────────────
class ImageRenderer implements ContentRenderer {
  readonly type: ContentType = 'IMAGE';
  private el: HTMLImageElement | null = null;
  async mount(container: HTMLElement, item: ContentItem): Promise<void> {
    if (!item.url) throw new Error('ImageRenderer: item.url required');
    const img = document.createElement('img');
    img.src = item.url;
    img.style.cssText =
      'position:absolute;inset:0;width:100%;height:100%;object-fit:contain;background:#000;';
    container.appendChild(img);
    this.el = img;
    await new Promise<void>((resolve, reject) => {
      img.addEventListener('load', () => resolve(), { once: true });
      img.addEventListener('error', () => reject(new Error('image load error')), {
        once: true,
      });
    });
  }
  pause(): void {
    /* no-op for images */
  }
  destroy(): void {
    this.el?.remove();
    this.el = null;
  }
}

// ── HTML — sandboxed iframe ───────────────────────────────────────────────────
class HtmlRenderer implements ContentRenderer {
  readonly type: ContentType = 'HTML';
  private el: HTMLIFrameElement | null = null;
  async mount(container: HTMLElement, item: ContentItem): Promise<void> {
    if (!item.url) throw new Error('HtmlRenderer: item.url required');
    const f = document.createElement('iframe');
    f.src = item.url;
    f.setAttribute(
      'sandbox',
      'allow-scripts allow-same-origin allow-forms allow-popups',
    );
    f.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;border:0;background:#000;';
    container.appendChild(f);
    this.el = f;
    await new Promise<void>((resolve) => {
      f.addEventListener('load', () => resolve(), { once: true });
      // Do not reject on iframe errors — many widget hosts emit benign errors
      // before content paints. The watchdog at the player level handles stalls.
    });
  }
  pause(): void {
    /* no-op for iframes */
  }
  destroy(): void {
    this.el?.remove();
    this.el = null;
  }
}

// ── CANVAS — placeholder until ported from Tizen player ───────────────────────
class CanvasRenderer implements ContentRenderer {
  readonly type: ContentType = 'CANVAS';
  async mount(container: HTMLElement, _item: ContentItem): Promise<void> {
    logger.warn('[CanvasRenderer] not yet ported — see player-web/README.md');
    const div = document.createElement('div');
    div.textContent = 'CANVAS renderer not yet ported';
    div.style.cssText =
      'position:absolute;inset:0;display:flex;align-items:center;justify-content:center;color:#888;font:14px monospace;';
    container.appendChild(div);
  }
  pause(): void {}
  destroy(): void {}
}

export const contentRenderers: Record<ContentType, () => ContentRenderer> = {
  VIDEO: () => new VideoRenderer(),
  IMAGE: () => new ImageRenderer(),
  HTML: () => new HtmlRenderer(),
  CANVAS: () => new CanvasRenderer(),
};
