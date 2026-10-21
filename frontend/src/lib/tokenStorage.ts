/** Shared by every tab on this origin; AuthContext listens for changes to it via the storage event. */
export const TOKEN_KEY = 'bookleaf.token';
const KEY = TOKEN_KEY;

// localStorage can throw (private mode, blocked storage); treat that as "no token".
export const tokenStorage = {
  get(): string | null {
    try {
      return localStorage.getItem(KEY);
    } catch {
      return null;
    }
  },
  set(token: string) {
    try {
      localStorage.setItem(KEY, token);
    } catch {
      /* ignore */
    }
  },
  clear() {
    try {
      localStorage.removeItem(KEY);
    } catch {
      /* ignore */
    }
  },
};
