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
  setUser: (user: AuthState['user']) => void;
  markBootstrapped: () => void;
  clearAuth: () => void;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      user: null,
      bootstrapped: false,
      setUser: (user) => set({ user, bootstrapped: true }),
      markBootstrapped: () => set({ bootstrapped: true }),
      clearAuth: () => set({ user: null, bootstrapped: true }),
    }),
    { name: 'signage-auth', partialize: (s) => ({ user: s.user }) },
  ),
);
