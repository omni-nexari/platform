/**
 * datasync.ts — DataSync live transport schedule renderer for player-web.
 *
 * Ported from apps/nexari-tizen/src/modules/datasync-renderer.ts.
 * Namespace removed; now exports standalone functions.
 */
export interface DataSyncHandle {
    destroy(): void;
    handleWsMessage(msg: unknown): void;
}
export declare function renderDataSync(container: HTMLElement, contentId: string, apiBase: string, deviceId: string): DataSyncHandle;
//# sourceMappingURL=datasync.d.ts.map