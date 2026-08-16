// Standalone stub — no heartbeat, no admin.nexari.ca, all features always enabled.
export type LicenseStatus = 'ok' | 'trial' | 'grace' | 'overlimit' | 'suspended' | 'revoked';

export interface LicenseState {
  status: LicenseStatus;
  allowedModules: string;
  signageTier: string | null;
  maxScreens: number | null;
  maxLocations: number | null;
  posScreensPerLocation: number;
  gracePct: number;
  trialDays: number;
  trialMaxScreens: number;
  expiresAt: string | null;
  billingPeriod: string | null;
  planType: string | null;
  billingCurrency: string | null;
  wholesaleCentsPerSignageScreen: number | null;
  wholesaleCentsPerPosScreen: number | null;
  billingAnchorDay: number | null;
  source: 'heartbeat' | 'offline-cert' | 'cache' | 'trial';
  checkedAt: string;
}

const STANDALONE_STATE: LicenseState = {
  status: 'ok',
  allowedModules: 'both',
  signageTier: 'pro',
  maxScreens: null,
  maxLocations: null,
  posScreensPerLocation: 99,
  gracePct: 0,
  trialDays: 0,
  trialMaxScreens: 0,
  expiresAt: null,
  billingPeriod: null,
  planType: 'standalone',
  billingCurrency: null,
  wholesaleCentsPerSignageScreen: null,
  wholesaleCentsPerPosScreen: null,
  billingAnchorDay: null,
  source: 'offline-cert',
  checkedAt: new Date().toISOString(),
};

export function getLicenseState(): LicenseState {
  return STANDALONE_STATE;
}

// Used by OAuth proxy state-token signing; returns env secret if set.
export async function getLicenseHmacSecret(): Promise<{ licenseKey: string; hmacSecret: string; serverUrl: string } | null> {
  const licenseKey = process.env['LICENSE_KEY'];
  const hmacSecret = process.env['LICENSE_SECRET'];
  if (licenseKey && hmacSecret) {
    return { licenseKey, hmacSecret, serverUrl: '' };
  }
  return null;
}

export function isPairingBlocked(): boolean { return false; }
export function isInstanceLocked(): boolean { return false; }
export function canUseSignage(): boolean { return true; }
export function canUseSyncPlay(): boolean { return true; }
export function canUseVideoWalls(): boolean { return true; }
export function canUseMultiTenant(): boolean { return true; }
export function canUsePOS(): boolean { return true; }
export function isOverScreenLimit(_currentScreens: number): boolean { return false; }
export function isOverLocationLimit(_currentLocations: number): boolean { return false; }
export function isOverExtraPosScreenLimit(_totalScreensAtLocation: number): boolean { return false; }
export function getLicenseTierLabel(): string { return 'Standalone'; }

// No-op stubs kept for call-site compatibility.
export function verifyOfflineCert(_jwt: string): LicenseState { return STANDALONE_STATE; }
export function startLicenseHeartbeat(_log?: unknown): void { /* standalone — no heartbeat */ }
export async function triggerHeartbeat(): Promise<void> { /* standalone — no heartbeat */ }
