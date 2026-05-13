export interface SyncConfig {
    wsUrl: string;
    groupId: string;
    deviceId: string;
    selfIp: string;
    expectedPeers: number;
    onStatus: (msg: string) => void;
    prepareEngine: (url: string) => Promise<void>;
    schedulePlay: (epochMs: number) => void;
    getEngineDuration: () => number;
    restartEngine?: () => void;
    /** When this device is elected leader, call this to get its own local URL. */
    fetchVideoUrl?: () => Promise<string>;
    /**
     * Pre-elected leader deviceId from the manifest's leaderPriority[0].
     * When set, role is determined immediately (no lexicographic election needed).
     * Followers skip peer-wait entirely; the leader still waits for peers.
     */
    pinnedLeaderId?: string;
}
export declare function init(cfg: SyncConfig): Promise<void>;
export declare function stop(): void;
//# sourceMappingURL=sync.d.ts.map