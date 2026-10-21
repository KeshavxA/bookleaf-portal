import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { ApiError, setUnauthorizedHandler } from '@/api/client';
import { authApi } from '@/api/endpoints';
import type { Role, User } from '@/api/types';
import { tokenStorage } from '@/lib/tokenStorage';

type LogoutReason = 'manual' | 'expired';

interface AuthValue {
  user: User | null;
  token: string | null;
  /** True while an existing token is being validated on startup. */
  initializing: boolean;
  logoutReason: LogoutReason | null;
  login: (email: string, password: string) => Promise<User>;
  logout: (reason?: LogoutReason) => void;
}

const AuthContext = createContext<AuthValue | null>(null);

export const homeFor = (role: Role) => (role === 'ADMIN' ? '/admin' : '/books');

export function AuthProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const [token, setToken] = useState<string | null>(() => tokenStorage.get());
  const [user, setUser] = useState<User | null>(null);
  const [initializing, setInitializing] = useState(() => !!tokenStorage.get());
  const [logoutReason, setLogoutReason] = useState<LogoutReason | null>(null);

  const logout = useCallback(
    (reason: LogoutReason = 'manual') => {
      tokenStorage.clear();
      setToken(null);
      setUser(null);
      setLogoutReason(reason);
      qc.clear();
    },
    [qc],
  );

  useEffect(() => {
    setUnauthorizedHandler(() => logout('expired'));
    return () => setUnauthorizedHandler(null);
  }, [logout]);

  // Validate a stored token once on startup.
  useEffect(() => {
    if (!initializing) return;
    let cancelled = false;
    authApi
      .me()
      .then((u) => !cancelled && setUser(u))
      .catch((e) => {
        if (cancelled) return;
        // Without a user we can't route anywhere, so any failure ends the session. Only a real
        // auth failure is reported to the user as an expired session.
        logout(e instanceof ApiError && e.status === 401 ? 'expired' : 'manual');
      })
      .finally(() => !cancelled && setInitializing(false));
    return () => {
      cancelled = true;
    };
  }, [initializing, logout]);

  const login = useCallback(
    async (email: string, password: string) => {
      const res = await authApi.login(email, password);
      qc.clear();
      tokenStorage.set(res.token);
      setToken(res.token);
      setUser(res.user);
      setLogoutReason(null);
      return res.user;
    },
    [qc],
  );

  const value = useMemo<AuthValue>(
    () => ({ user, token, initializing, logoutReason, login, logout }),
    [user, token, initializing, logoutReason, login, logout],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}
