import { NavLink, Outlet } from 'react-router';
import { useAuth } from '@/features/auth/AuthContext';
import { USE_MOCKS } from '@/lib/config';
import { cn } from '@/lib/cn';
import { Button } from './Button';
import { LiveIndicator } from './LiveIndicator';

export interface NavItem {
  to: string;
  label: string;
  end?: boolean;
}

export function AppShell({ nav, area }: { nav: NavItem[]; area: string }) {
  const { user, logout } = useAuth();
  return (
    <div className="min-h-screen">
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:rounded focus:bg-white focus:px-3 focus:py-2">
        Skip to content
      </a>
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3">
          <div className="flex items-baseline gap-2">
            <span className="text-lg font-bold text-brand-700">BookLeaf</span>
            <span className="text-sm text-slate-500">{area}</span>
          </div>
          <nav aria-label="Main" className="flex gap-1">
            {nav.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                className={({ isActive }) =>
                  cn(
                    'rounded-md px-3 py-1.5 text-sm font-medium',
                    isActive ? 'bg-brand-50 text-brand-700' : 'text-slate-600 hover:bg-slate-100',
                  )
                }
              >
                {item.label}
              </NavLink>
            ))}
          </nav>
          <div className="ml-auto flex items-center gap-4">
            {USE_MOCKS && <MockBadge />}
            <LiveIndicator />
            <span className="hidden text-sm text-slate-700 sm:inline">{user?.name}</span>
            <Button variant="secondary" size="sm" onClick={() => logout()}>
              Log out
            </Button>
          </div>
        </div>
      </header>
      <main id="main" className="mx-auto max-w-7xl px-4 py-6">
        <Outlet />
      </main>
    </div>
  );
}

function MockBadge() {
  const reset = async () => {
    const { resetMockDb } = await import('@/mocks/db');
    resetMockDb();
    window.location.reload();
  };
  return (
    <span className="inline-flex items-center gap-2 rounded-full bg-violet-50 px-2 py-0.5 text-xs text-violet-800 ring-1 ring-violet-200">
      Mock API
      <button type="button" onClick={reset} className="underline hover:no-underline">
        reset data
      </button>
    </span>
  );
}

export function PageHeader({ title, description, actions }: { title: string; description?: React.ReactNode; actions?: React.ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="text-2xl font-semibold text-slate-900">{title}</h1>
        {description && <div className="mt-1 text-sm text-slate-600">{description}</div>}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  );
}
