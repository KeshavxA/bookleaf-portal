import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { setupServer } from 'msw/node';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { App } from '@/App';
import { handlers } from '@/mocks/handlers';
import { router } from '@/router';

const server = setupServer(...handlers);
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterAll(() => server.close());

const SLOW = { timeout: 5000 };

describe('admin flow (mock API)', () => {
  it('triages from the queue: urgency order, live new tickets, AI draft, override, reply and internal note', async () => {
    const user = userEvent.setup();
    await router.navigate('/login');
    render(<App />);

    await user.type(await screen.findByLabelText('Email'), 'admin1@bookleaf.com');
    await user.type(screen.getByLabelText('Password'), 'Passw0rd!');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));

    // Queue: default urgency sort puts the oldest Critical ticket first.
    const table = await screen.findByRole('table');
    const rows = await within(table).findAllByRole('row');
    expect(within(rows[1]).getByText('Critical')).toBeInTheDocument();
    expect(within(rows[1]).getByText("Haven't received any royalty for over 6 months")).toBeInTheDocument();
    // The 5- and 6-day-old open tickets are flagged as stale.
    expect(screen.getAllByText(/open longer than 3 days/).length).toBeGreaterThanOrEqual(2);

    // ticket.created arrives over SSE and the queue refreshes without a reload.
    await waitFor(() => expect(screen.getByText('Live')).toBeInTheDocument());
    const created = await fetch('http://localhost/api/v1/tickets', {
      method: 'POST',
      headers: { Authorization: 'Bearer mock.AUTH001', 'Content-Type': 'application/json' },
      body: JSON.stringify({ bookId: 'BK001', subject: 'Brand new live ticket', description: 'Appears in the queue live.' }),
    });
    expect(created.status).toBe(201);
    expect(await screen.findByText('Brand new live ticket')).toBeInTheDocument();
    expect(screen.getByText(/Queue updated just now/)).toBeInTheDocument();

    // Filters narrow the list.
    await user.selectOptions(screen.getByLabelText('Priority'), 'Critical');
    await waitFor(() => expect(screen.queryByText('Brand new live ticket')).not.toBeInTheDocument());
    expect(window.location.search).toContain('priority=CRITICAL');

    // Open the ISBN ticket; the AI draft is requested automatically.
    await user.click(screen.getByRole('link', { name: 'Amazon shows a different ISBN than my printed copy' }));
    expect(await screen.findByRole('heading', { name: 'Amazon shows a different ISBN than my printed copy' })).toBeInTheDocument();
    const reply = await screen.findByRole('textbox', { name: 'Reply' }, SLOW);
    await waitFor(() => expect((reply as HTMLTextAreaElement).value).toContain('Hi Rohit'), SLOW);
    expect(screen.getAllByText('✨ AI suggested')).toHaveLength(2);

    // Overriding the AI category shows the override marker.
    await user.selectOptions(screen.getByLabelText('Category'), 'DISTRIBUTION_AVAILABILITY');
    expect(await screen.findByText('Overridden')).toBeInTheDocument();
    expect(screen.getByText('AI suggested: ISBN & Metadata')).toBeInTheDocument();
    expect(await screen.findByText(/category changed\. Regenerate/)).toBeInTheDocument();

    // Take ownership, then edit the draft and send with a status change.
    await user.click(screen.getByRole('button', { name: 'Assign to me' }));
    expect(await screen.findByRole('button', { name: 'Assigned to you' })).toBeDisabled();
    await user.clear(reply);
    await user.type(reply, 'Hi Rohit, escalated to production. Update within 48 hours.');
    await user.selectOptions(screen.getByLabelText('Set status on send'), 'In Progress');
    await user.click(screen.getByRole('button', { name: 'Send reply' }));
    const thread = screen.getByRole('list', { name: 'Conversation' });
    expect(await within(thread).findByText('Hi Rohit, escalated to production. Update within 48 hours.')).toBeInTheDocument();
    expect(await screen.findByText(/Reply sent/)).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Reply' })).toHaveValue('');
    await waitFor(() => expect(screen.getByLabelText('Status')).toHaveValue('IN_PROGRESS'));

    // Add an internal note.
    await user.type(screen.getByRole('textbox', { name: 'Add an internal note' }), 'Checked with Amazon seller central.');
    await user.click(screen.getByRole('button', { name: 'Add internal note' }));
    expect(await screen.findByText('Checked with Amazon seller central.')).toBeInTheDocument();
    expect(screen.getByText('Internal only, not visible to the author.')).toBeInTheDocument();

    // Back keeps the filters.
    await user.click(screen.getByRole('link', { name: '← Back to queue' }));
    expect(window.location.search).toContain('priority=CRITICAL');
  }, 30_000);

  it('degrades gracefully on a ticket whose AI classification failed', async () => {
    localStorage.setItem('bookleaf.token', 'mock.ADM001');
    await router.navigate('/admin/tickets/t-1007');
    render(<App />);
    expect(await screen.findByRole('heading', { name: 'Cover design approval' })).toBeInTheDocument();
    expect(screen.getByText('Needs manual triage')).toBeInTheDocument();
    expect(await screen.findByText('AI drafting is unavailable, write your reply manually.', {}, SLOW)).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Reply' })).toBeEnabled();
  }, 15_000);
});
