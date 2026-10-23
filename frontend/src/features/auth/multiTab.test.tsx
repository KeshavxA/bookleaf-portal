import { act, render, screen, waitFor } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/api/client';
import type { User } from '@/api/types';
import { createQueryClient, shouldRetryQuery } from '@/lib/queryClient';
import { TOKEN_KEY } from '@/lib/tokenStorage';
import { routes } from '@/router';
import { AuthProvider } from './AuthContext';

const ADMIN: User = { id: 'ADM001', name: 'Neha Gupta', email: 'admin1@bookleaf.com', role: 'ADMIN' };
const AUTHOR: User = { id: 'AUTH001', name: 'Priya Sharma', email: 'priya.sharma@email.com', role: 'AUTHOR' };
const BASE_TOKENS: Record<string, User> = { 'tok-admin': ADMIN, 'tok-admin-2': ADMIN, 'tok-author': AUTHOR };
/** Who each token belongs to on the fake server. Tests can change it, e.g. to model a role change. */
let TOKENS: Record<string, User> = { ...BASE_TOKENS };

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const forbidden = () => json({ error: { code: 'FORBIDDEN', message: 'Forbidden', details: [] } }, 403);

/** A fake backend keyed on the bearer token, so requests made with the "wrong" token really 403. */
function fakeBackend(opts: { adminQueueForbidden?: boolean } = {}) {
  return vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = new URL(String(input));
    const auth = new Headers(init?.headers).get('Authorization') ?? '';
    const user = TOKENS[auth.replace('Bearer ', '')];
    if (!user) return json({ error: { code: 'UNAUTHORIZED', message: 'No session', details: [] } }, 401);
    const path = url.pathname.replace('/api/v1', '');
    if (path === '/auth/me') return json(user);
    if (path === '/admin/tickets') {
      return user.role === 'ADMIN' && !opts.adminQueueForbidden ? json({ items: [], total: 0, page: 1, pageSize: 20 }) : forbidden();
    }
    if (path === '/books' || path === '/tickets') return user.role === 'AUTHOR' ? json([]) : forbidden();
    return json({ error: { code: 'NOT_FOUND', message: 'Not found', details: [] } }, 404);
  });
}

const calls = (spy: ReturnType<typeof fakeBackend>, path: string) =>
  spy.mock.calls.filter(([input]) => new URL(String(input)).pathname.endsWith(path));

function renderApp(path: string, token: string) {
  localStorage.setItem(TOKEN_KEY, token);
  const queryClient = createQueryClient();
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  render(
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <RouterProvider router={router} />
      </AuthProvider>
    </QueryClientProvider>,
  );
  return { router, queryClient };
}

/** What the browser does in *other* tabs when this key changes. */
function otherTabSets(token: string | null) {
  const oldValue = localStorage.getItem(TOKEN_KEY);
  if (token === null) localStorage.removeItem(TOKEN_KEY);
  else localStorage.setItem(TOKEN_KEY, token);
  act(() => {
    window.dispatchEvent(new StorageEvent('storage', { key: TOKEN_KEY, oldValue, newValue: token, storageArea: localStorage }));
  });
}

describe('multi-tab auth: storage events', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    TOKENS = { ...BASE_TOKENS };
  });
  afterEach(() => vi.restoreAllMocks());

  it('an admin tab follows a sign-in as an author in another tab to /books', async () => {
    const spy = fakeBackend();
    const { router } = renderApp('/admin', 'tok-admin');
    expect(await screen.findByRole('heading', { name: 'Ticket queue' })).toBeInTheDocument();

    otherTabSets('tok-author');

    expect(await screen.findByRole('heading', { name: 'My Books' })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/books');
    expect(screen.getByText('Priya Sharma')).toBeInTheDocument();
    // The admin queue was never requested with the author's token.
    expect(calls(spy, '/admin/tickets').every(([, init]) => new Headers(init?.headers).get('Authorization') === 'Bearer tok-admin')).toBe(true);
  });

  it('an author tab follows a sign-in as an admin in another tab to /admin', async () => {
    fakeBackend();
    const { router } = renderApp('/tickets', 'tok-author');
    expect(await screen.findByRole('heading', { name: 'My Tickets' })).toBeInTheDocument();

    otherTabSets('tok-admin');

    expect(await screen.findByRole('heading', { name: 'Ticket queue' })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/admin');
  });

  it('goes to login with a notice when another tab signs out', async () => {
    fakeBackend();
    const { router } = renderApp('/admin', 'tok-admin');
    await screen.findByRole('heading', { name: 'Ticket queue' });

    otherTabSets(null);

    expect(await screen.findByText('You were signed out in another tab.')).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/login');
  });

  it('stays put when another tab signs in again as the same user, and adopts the new token', async () => {
    const spy = fakeBackend();
    const { router, queryClient } = renderApp('/admin', 'tok-admin');
    await screen.findByRole('heading', { name: 'Ticket queue' });

    otherTabSets('tok-admin-2');
    await waitFor(() => expect(calls(spy, '/auth/me')).toHaveLength(2));
    expect(router.state.location.pathname).toBe('/admin');

    await act(() => queryClient.invalidateQueries());
    const last = calls(spy, '/admin/tickets').at(-1)!;
    expect(new Headers(last[1]?.headers).get('Authorization')).toBe('Bearer tok-admin-2');
  });

  it('ignores storage events for other keys', async () => {
    const spy = fakeBackend();
    renderApp('/admin', 'tok-admin');
    await screen.findByRole('heading', { name: 'Ticket queue' });
    act(() => {
      window.dispatchEvent(new StorageEvent('storage', { key: 'bookleaf.mockdb.v2', newValue: '{}', storageArea: localStorage }));
    });
    expect(calls(spy, '/auth/me')).toHaveLength(1); // only the startup check
  });
});

describe('multi-tab auth: own token and 403 re-check', () => {
  beforeEach(() => {
    TOKENS = { ...BASE_TOKENS };
  });
  afterEach(() => vi.restoreAllMocks());

  it("keeps sending this tab's own token when another tab overwrites storage (event not yet handled)", async () => {
    const spy = fakeBackend();
    const { router, queryClient } = renderApp('/admin', 'tok-admin');
    await screen.findByRole('heading', { name: 'Ticket queue' });

    localStorage.setItem(TOKEN_KEY, 'tok-author'); // written by another tab; no storage event yet
    await act(() => queryClient.invalidateQueries());

    const last = calls(spy, '/admin/tickets').at(-1)!;
    expect(new Headers(last[1]?.headers).get('Authorization')).toBe('Bearer tok-admin');
    expect(router.state.location.pathname).toBe('/admin');
    expect(screen.queryByText(/couldn't load|don't have access/i)).not.toBeInTheDocument();
  });

  it('on a 403 from a server-side role change, re-fetches /auth/me and redirects instead of erroring', async () => {
    const spy = fakeBackend();
    const { router, queryClient } = renderApp('/admin', 'tok-admin');
    await screen.findByRole('heading', { name: 'Ticket queue' });

    TOKENS['tok-admin'] = { ...ADMIN, role: 'AUTHOR' }; // the account lost admin rights
    await act(() => queryClient.invalidateQueries());

    expect(await screen.findByRole('heading', { name: 'My Books' })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/books');
    expect(calls(spy, '/auth/me')).toHaveLength(2);
    expect(screen.queryByText(/couldn't load|don't have access/i)).not.toBeInTheDocument();
  });

  it('a genuine 403 (same user after the re-check) shows an access message and is not retried', async () => {
    const spy = fakeBackend({ adminQueueForbidden: true });
    renderApp('/admin', 'tok-admin');

    expect(await screen.findByText("You don't have access to this")).toBeInTheDocument();
    expect(calls(spy, '/admin/tickets')).toHaveLength(1);
    expect(calls(spy, '/auth/me')).toHaveLength(2); // startup + one re-check
  });
});

describe('shouldRetryQuery', () => {
  it.each([401, 403, 404, 409, 429])('never retries %i', (status) => {
    expect(shouldRetryQuery(0, new ApiError(status, 'FORBIDDEN', 'x'))).toBe(false);
  });

  it('retries network errors and 5xx up to twice', () => {
    expect(shouldRetryQuery(0, new ApiError(0, 'NETWORK_ERROR', 'offline'))).toBe(true);
    expect(shouldRetryQuery(1, new ApiError(503, 'INTERNAL', 'down'))).toBe(true);
    expect(shouldRetryQuery(2, new ApiError(503, 'INTERNAL', 'down'))).toBe(false);
  });
});
