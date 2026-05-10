/**
 * Content renderers — pluggable per content type.
 *
 * The full Tizen player supports VIDEO, IMAGE, HTML, CANVAS, plus widgets
 * (calendar, RSS, weather, POS, ticker, DataSync). The skeletons here cover
 * the four primitives; widgets are TODO and are tracked in the package
 * README's porting table.
 */
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
export declare const contentRenderers: Record<ContentType, () => ContentRenderer>;
//# sourceMappingURL=index.d.ts.map