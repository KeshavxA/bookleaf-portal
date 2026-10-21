import { Navigate, Outlet, useLocation } from 'react-router';
import type { Role } from '@/api/types';
import { FullPageSpinner } from '@/components/Spinner';
import { homeFor, useAuth } from './AuthContext';

export function RequireRole({ role }: { role: Role }) {
  const { user, initializing } = useAuth();
  const location = useLocation();
  if (initializing) return <FullPageSpinner label="Checking your session" />;
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />;
  if (user.role !== role) return <Navigate to={homeFor(user.role)} replace />;
  return <Outlet />;
}

export function HomeRedirect() {
  const { user, initializing } = useAuth();
  if (initializing) return <FullPageSpinner />;
  return <Navigate to={user ? homeFor(user.role) : '/login'} replace />;
}
