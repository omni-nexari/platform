import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface AuthState {
  accessToken: string | null;
  user: { id: string; name: string; email: string; orgRole: string } | null;
  bootstrapped: boolean;
  setAuth: (token: string, user: AuthState['user']) => void;
  setUser: (user: AuthState['user']) => void;
  markBootstrapped: () => void;
  clearAuth: () => void;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      accessToken: null,
      user: null,
      bootstrapped: false,
      setAuth: (accessToken, user) => set({ accessToken, user, bootstrapped: true }),
      setUser: (user) => set({ user, bootstrapped: true }),
      markBootstrapped: () => set({ bootstrapped: true }),
      clearAuth: () => set({ accessToken: null, user: null, bootstrapped: true }),
    }),
    { name: 'signage-auth', partialize: (s) => ({ user: s.user }) },
  ),
);
