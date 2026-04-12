import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export interface AuthOrg {
  id: string;
  name: string;
  slug: string;
  plan: string;
  settings: string; // JSON string — e.g. '{"modules":"both"}'
}

interface AuthState {
  user: {
    id: string;
    name: string;
    email: string;
    orgRole: string;
    impersonatedBy?: string | null;
  } | null;
  org: AuthOrg | null;
  bootstrapped: boolean;
  pendingBootstrap: boolean;
  beginBootstrap: () => void;
  setUser: (user: AuthState['user'], org?: AuthOrg | null) => void;
  markBootstrapped: () => void;
  clearAuth: () => void;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      user: null,
      org: null,
      bootstrapped: false,
      pendingBootstrap: false,
      beginBootstrap: () => set({ user: null, org: null, bootstrapped: false, pendingBootstrap: true }),
      setUser: (user, org = null) => set({ user, org: org ?? null, bootstrapped: true, pendingBootstrap: false }),
      markBootstrapped: () => set({ bootstrapped: true, pendingBootstrap: false }),
      clearAuth: () => set({ user: null, org: null, bootstrapped: true, pendingBootstrap: false }),
    }),
    { name: 'signage-auth', partialize: (s) => ({ user: s.user, org: s.org }) },
  ),
);
