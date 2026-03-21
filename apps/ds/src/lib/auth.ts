import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface AuthState {
  user: {
    id: string;
    name: string;
    email: string;
    orgRole: string;
    impersonatedBy?: string | null;
  } | null;
  bootstrapped: boolean;
  pendingBootstrap: boolean;
  beginBootstrap: () => void;
  setUser: (user: AuthState['user']) => void;
  markBootstrapped: () => void;
  clearAuth: () => void;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      user: null,
      bootstrapped: false,
      pendingBootstrap: false,
      beginBootstrap: () => set({ user: null, bootstrapped: false, pendingBootstrap: true }),
      setUser: (user) => set({ user, bootstrapped: true, pendingBootstrap: false }),
      markBootstrapped: () => set({ bootstrapped: true, pendingBootstrap: false }),
      clearAuth: () => set({ user: null, bootstrapped: true, pendingBootstrap: false }),
    }),
    { name: 'signage-auth', partialize: (s) => ({ user: s.user }) },
  ),
);
