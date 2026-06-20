import { useAuthStore } from './auth.js';

export type OrgModules = 'signage' | 'pos' | 'both';

function parseModules(settingsJson: string | null | undefined): OrgModules {
  try {
    const s = JSON.parse(settingsJson ?? '{}') as { modules?: string };
    if (s.modules === 'pos' || s.modules === 'both') return s.modules;
  } catch { /* ignore */ }
  return 'signage';
}

/** Returns the active module set for the authenticated org. Defaults to 'signage'. */
export function useOrgModules(): OrgModules {
  const settings = useAuthStore((s) => s.org?.settings);
  return parseModules(settings);
}

/** True when the org has the CMS/signage module active (signage | both). */
export function useCmsEnabled(): boolean {
  const modules = useOrgModules();
  return modules === 'signage' || modules === 'both';
}

/** True when the org has the POS module active (pos | both). */
export function usePosEnabled(): boolean {
  const modules = useOrgModules();
  return modules === 'pos' || modules === 'both';
}

export type OrgPlan = 'basic' | 'pro';

/** Returns the plan for the authenticated org. Defaults to 'basic'. */
export function useOrgPlan(): OrgPlan {
  const plan = useAuthStore((s) => s.org?.plan);
  // 'enterprise' is a legacy value; 'signage-pro' and 'bundle-pro' are license planType values
  if (plan === 'pro' || plan === 'enterprise' || plan === 'signage-pro' || plan === 'bundle-pro' || plan === 'bundle-basic') return 'pro';
  return 'basic';
}

/** True when the org is on the Pro plan (SyncPlay, Video Walls, Smart Playlists). */
export function useIsProPlan(): boolean {
  return useOrgPlan() === 'pro';
}
