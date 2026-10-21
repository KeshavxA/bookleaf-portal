import { useEffect, useRef } from 'react';
import { Outlet, useNavigate } from 'react-router';
import { homeFor, useAuth } from './AuthContext';

/**
 * Root layout: when the signed-in identity changes under an open page (another tab logged in as
 * someone else, or a 403 re-check found a different user), go to that user's home. Logging out is
 * handled by RequireRole, which sends a tab with no user to /login.
 */
export function SessionWatcher() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const previous = useRef(user);

  useEffect(() => {
    const before = previous.current;
    previous.current = user;
    if (before && user && (before.id !== user.id || before.role !== user.role)) {
      navigate(homeFor(user.role), { replace: true });
    }
  }, [user, navigate]);

  return <Outlet />;
}
