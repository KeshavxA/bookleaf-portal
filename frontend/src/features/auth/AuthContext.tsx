import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { ApiError, setForbiddenHandler, setUnauthorizedHandler } from '@/api/client';
import { authApi } from '@/api/endpoints';
import type { Role, User } from '@/api/types';
import { TOKEN_KEY, tokenStorage } from '@/lib/tokenStorage';

type LogoutReason = 'manual' | 'expired' | 'elsewhere';

interface AuthValue {
  user: User | null;
  token: string | null;
  /** True while the session is being validated: on startup, or after another tab changed the token. */
  initializing: boolean;
  logoutReason: LogoutReason | null;
  login: (email: string, password: string) => Promise<User>;
  logout: (reason?: LogoutReason) => void;
}

const AuthContext = createContext<AuthValue | null>(null);

export const homeFor = (role: Role) => (role === 'ADMIN' ? '/admin' : '/books');

const sameIdentity = (a: User | null, b: User | null) => !!a && !!b && a.id === b.id && a.role === b.role;

export function AuthProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const [token, setToken] = useState<string | null>(() => tokenStorage.get());
  const [user, setUser] = useState<User | null>(null);
  const [initializing, setInitializing] = useState(() => !!tokenStorage.get());
  const [logoutReason, setLogoutReason] = useState<LogoutReason | null>(null);

  // Refs mirror state for the event listeners and the API client's callbacks, which outlive renders.
  const tokenRef = useRef(token);
  const userRef = useRef(user);
  const inflight = useRef<Promise<void> | null>(null);

  const applyUser = useCallback(
    (next: User | null) => {
      // Cached data belongs to one user; never let the next user see (or refetch into) it.
      if (userRef.current && !sameIdentity(userRef.current, next)) qc.clear();
      userRef.current = next;
      setUser(next);
    },
    [qc],
  );

  /** Ends the session in this tab. `clearStorage` is false when another tab already removed the token. */
  const endSession = useCallback(
    (reason: LogoutReason, clearStorage = true) => {
      if (clearStorage) tokenStorage.clear();
      tokenRef.current = null;
      setToken(null);
      userRef.current = null;
      setUser(null);
      setLogoutReason(reason);
      qc.clear();
    },
    [qc],
  );

  const logout = useCallback((reason: LogoutReason = 'manual') => endSession(reason), [endSession]);

  /**
   * Re-reads the shared token and asks the server who it belongs to. Used on startup, when another
   * tab changes the token, and after a 403. Concurrent calls share one request.
   */
  const revalidate = useCallback((): Promise<void> => {
    if (inflight.current) return inflight.current;
    const run = async () => {
      const stored = tokenStorage.get();
      if (!stored) {
        if (tokenRef.current) endSession('elsewhere', false);
        return;
      }
      tokenRef.current = stored;
      setToken(stored);
      try {
        applyUser(await authApi.me());
        setLogoutReason(null);
      } catch (e) {
        // A 401 has already ended the session via the unauthorized handler. Without a user we can't
        // route anywhere, so any other failure ends it too.
        if (!(e instanceof ApiError && e.status === 401)) endSession('manual');
      }
    };
    inflight.current = run().finally(() => {
      inflight.current = null;
    });
    return inflight.current;
  }, [applyUser, endSession]);

  useEffect(() => {
    setUnauthorizedHandler(() => logout('expired'));
    setForbiddenHandler(revalidate);
    return () => {
      setUnauthorizedHandler(null);
      setForbiddenHandler(null);
    };
  }, [logout, revalidate]);

  // Validate a stored token once on startup.
  useEffect(() => {
    if (!tokenStorage.get()) return;
    revalidate().finally(() => setInitializing(false));
  }, [revalidate]);

  // localStorage is shared across tabs. When another tab logs in, switches user or logs out, follow it
  // instead of showing one user while sending another user's token. (The event never fires in the
  // tab that made the change.)
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key !== TOKEN_KEY && e.key !== null) return; // null = storage.clear()
      if (e.storageArea && e.storageArea !== window.localStorage) return;
      if (tokenStorage.get() === tokenRef.current) return;
      setInitializing(true);
      revalidate().finally(() => setInitializing(false));
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, [revalidate]);

  const login = useCallback(
    async (email: string, password: string) => {
      const res = await authApi.login(email, password);
      qc.clear();
      tokenStorage.set(res.token);
      tokenRef.current = res.token;
      setToken(res.token);
      userRef.current = res.user;
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
