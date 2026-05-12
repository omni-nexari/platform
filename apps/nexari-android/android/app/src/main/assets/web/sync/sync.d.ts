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
}
export declare function init(cfg: SyncConfig): Promise<void>;
export declare function stop(): void;
//# sourceMappingURL=sync.d.ts.map