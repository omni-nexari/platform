/** Shared in-memory state for the player runtime. */

export interface PlayerState {
  deviceId: string | null;
  deviceToken: string | null;
  currentContentId: string | null;
  nextContentId: string | null;
  nextStartsAt: Date | null;
  emergencyActive: boolean;
  wsConnected: boolean;
}

export const state: PlayerState = {
  deviceId: null,
  deviceToken: null,
  currentContentId: null,
  nextContentId: null,
  nextStartsAt: null,
  emergencyActive: false,
  wsConnected: false,
};
