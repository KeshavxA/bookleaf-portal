import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderWithProviders } from '@/test/utils';
import { QueuePage } from './QueuePage';

vi.mock('@/features/auth/AuthContext', () => ({
  useAuth: () => ({ user: { id: 'ADM001', name: 'Neha', email: 'admin1@bookleaf.com', role: 'ADMIN' } }),
}));

function captureRequests() {
  return vi
    .spyOn(globalThis, 'fetch')
    .mockImplementation(async () => new Response(JSON.stringify({ items: [], total: 0, page: 1, pageSize: 20 }), { status: 200 }));
}

/** The sort param of the most recent GET /admin/tickets request. */
const lastSort = (spy: ReturnType<typeof captureRequests>) => {
  const urls = spy.mock.calls.map((c) => new URL(String(c[0]))).filter((u) => u.pathname.endsWith('/admin/tickets'));
  return urls.at(-1)?.searchParams.get('sort');
};

const sortSelect = () => screen.getByLabelText('Sort') as HTMLSelectElement;

describe('QueuePage sort', () => {
  afterEach(() => vi.restoreAllMocks());

  it('requests sort=urgency by default and shows "Urgency" with Urgency / Oldest / Newest options', async () => {
    const spy = captureRequests();
    renderWithProviders(<QueuePage />, { route: '/admin' });

    await waitFor(() => expect(lastSort(spy)).toBe('urgency'));
    expect(sortSelect()).toHaveDisplayValue('Urgency');
    expect(within(sortSelect()).getAllByRole('option').map((o) => o.textContent)).toEqual(['Urgency', 'Oldest', 'Newest']);
    expect(screen.queryByRole('button', { name: 'Clear filters' })).not.toBeInTheDocument();
  });

  it('sends the chosen sort, and Clear filters returns to urgency', async () => {
    const user = userEvent.setup();
    const spy = captureRequests();
    renderWithProviders(<QueuePage />, { route: '/admin' });
    await waitFor(() => expect(lastSort(spy)).toBe('urgency'));

    await user.selectOptions(sortSelect(), 'newest');
    await waitFor(() => expect(lastSort(spy)).toBe('newest'));

    await user.click(screen.getByRole('button', { name: 'Clear filters' }));
    await waitFor(() => expect(lastSort(spy)).toBe('urgency'));
    expect(sortSelect()).toHaveDisplayValue('Urgency');
  });

  it('a stale ?sort=newest in the URL is visible and can be cleared, even with no other filters', async () => {
    const user = userEvent.setup();
    const spy = captureRequests();
    renderWithProviders(<QueuePage />, { route: '/admin?sort=newest' });

    await waitFor(() => expect(lastSort(spy)).toBe('newest'));
    expect(sortSelect()).toHaveDisplayValue('Newest');
    await user.click(screen.getByRole('button', { name: 'Clear filters' }));
    await waitFor(() => expect(lastSort(spy)).toBe('urgency'));
  });

  it('falls back to urgency for an unknown sort value', async () => {
    const spy = captureRequests();
    renderWithProviders(<QueuePage />, { route: '/admin?sort=createdAt' });
    await waitFor(() => expect(lastSort(spy)).toBe('urgency'));
    expect(sortSelect()).toHaveDisplayValue('Urgency');
  });
});
