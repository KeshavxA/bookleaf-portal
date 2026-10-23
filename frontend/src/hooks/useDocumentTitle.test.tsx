import { render, renderHook, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClientProvider } from '@tanstack/react-query';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { User } from '@/api/types';
import { AuthProvider } from '@/features/auth/AuthContext';
import { createQueryClient } from '@/lib/queryClient';
import { TOKEN_KEY } from '@/lib/tokenStorage';
import { routes } from '@/router';
import { useDocumentTitle } from './useDocumentTitle';

describe('useDocumentTitle', () => {
  beforeEach(() => {
    document.title = 'BookLeaf';
  });

  it('sets the title while mounted and restores the previous one on unmount', () => {
    const { rerender, unmount } = renderHook(({ title }) => useDocumentTitle(title), { initialProps: { title: 'One' } });
    expect(document.title).toBe('One');
    rerender({ title: 'Two' });
    expect(document.title).toBe('Two');
    unmount();
    expect(document.title).toBe('BookLeaf');
  });
});

const ADMIN: User = { id: 'ADM001', name: 'Neha Gupta', email: 'admin1@bookleaf.com', role: 'ADMIN' };
const AUTHOR: User = { id: 'AUTH001', name: 'Priya Sharma', email: 'priya.sharma@email.com', role: 'AUTHOR' };
const TOKENS: Record<string, User> = { 'tok-admin': ADMIN, 'tok-author': AUTHOR };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

function fakeBackend() {
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const path = new URL(String(input)).pathname.replace('/api/v1', '');
    if (path === '/auth/login') return json({ token: 'tok-admin', user: ADMIN });
    const user = TOKENS[(new Headers(init?.headers).get('Authorization') ?? '').replace('Bearer ', '')];
    if (!user) return json({ error: { code: 'UNAUTHORIZED', message: 'No session', details: [] } }, 401);
    if (path === '/auth/me') return json(user);
    if (path === '/admin/tickets') return json({ items: [], total: 0, page: 1, pageSize: 20 });
    return json([]);
  });
}

function renderAt(path: string, token?: string) {
  if (token) localStorage.setItem(TOKEN_KEY, token);
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  render(
    <QueryClientProvider client={createQueryClient()}>
      <AuthProvider>
        <RouterProvider router={router} />
      </AuthProvider>
    </QueryClientProvider>,
  );
}

describe('tab title per area', () => {
  beforeEach(() => {
    document.title = 'BookLeaf';
    fakeBackend();
  });
  afterEach(() => vi.restoreAllMocks());

  it('login page: "Sign in | BookLeaf"', async () => {
    renderAt('/login');
    await screen.findByRole('heading', { name: 'Sign in to your portal' });
    expect(document.title).toBe('Sign in | BookLeaf');
  });

  it('admin routes: "BookLeaf Support Admin"', async () => {
    renderAt('/admin', 'tok-admin');
    await screen.findByRole('heading', { name: 'Ticket queue' });
    expect(document.title).toBe('BookLeaf Support Admin');
  });

  it('author routes: "BookLeaf Author Portal"', async () => {
    renderAt('/books', 'tok-author');
    await screen.findByRole('heading', { name: 'My Books' });
    expect(document.title).toBe('BookLeaf Author Portal');
  });

  it('switches from the login title to the area title after signing in', async () => {
    const user = userEvent.setup();
    renderAt('/login');
    await user.type(await screen.findByLabelText('Email'), 'admin1@bookleaf.com');
    await user.type(screen.getByLabelText('Password'), 'Passw0rd!');
    expect(document.title).toBe('Sign in | BookLeaf');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));
    await waitFor(() => expect(document.title).toBe('BookLeaf Support Admin'));
  });
});
