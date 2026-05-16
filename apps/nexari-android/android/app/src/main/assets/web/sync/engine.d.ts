type Role = 'leader' | 'follower';
export declare function setRole(r: Role): void;
export declare function setOnLoop(cb: () => void): void;
export declare function setPlaylist(urls: string[]): void;
export declare function getPlaylistUrls(): string[];
export declare function setWallCrop(srcX: number, srcY: number, srcW: number, srcH: number, dstW: number, dstH: number): void;
export declare function isPlaying(): boolean;
export declare function getCurrentPosMs(): number;
export declare function getDuration(): number;
/**
 * measurePlayLatencyMs — measure the time from video.play() to the first
 * rendered frame on this hardware. The relay distributes all latencies via
 * PEERS so each device auto-computes selfLatency = max(group) - own.
 * Result is cached; repeated calls return immediately.
 */
export declare function measurePlayLatencyMs(url?: string): Promise<number>;
/** Returns the cached play-latency, or 100 ms if not yet measured. */
export declare function getPlayLatencyMs(): number;
export declare function initEngine(container: HTMLElement): Promise<void>;
export declare function prepare(url: string): Promise<void>;
export declare function schedulePlayAt(epochMs: number): void;
export declare function playFromPrebuffer(): void;
export declare function destroyEngine(): void;
export {};
//# sourceMappingURL=engine.d.ts.map