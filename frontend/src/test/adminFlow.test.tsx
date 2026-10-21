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

const SLOW = { timeout: 6000 };
const replyBox = () => screen.getByRole('textbox', { name: 'Reply' }) as HTMLTextAreaElement;

async function asUser(path: string, token: string, body: unknown) {
  return fetch(`http://localhost/api/v1${path}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('admin flow (mock API)', () => {
  it('triages from the queue: live tickets, multi-value filters, AI draft lifecycle, reply defaults and notes', async () => {
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
    expect(screen.getAllByText(/open longer than 3 days/).length).toBeGreaterThanOrEqual(2);
    // The seeded FAILED ticket carries the derived badge.
    const failedRow = screen.getByRole('link', { name: 'Cover design approval' }).closest('tr')!;
    expect(within(failedRow).getByText('Needs manual triage')).toBeInTheDocument();

    // ticket.created arrives over SSE; the new ticket is provisional until ticket.ai_ready.
    await waitFor(() => expect(screen.getByText('Live')).toBeInTheDocument());
    const created = await asUser('/tickets', 'mock.AUTH001', {
      bookId: 'BK001',
      subject: 'Brand new live ticket',
      description: 'Appears in the queue live.',
    });
    expect(created.status).toBe(201);
    const newRow = (await screen.findByRole('link', { name: 'Brand new live ticket' })).closest('tr')!;
    expect(within(newRow).getByText('Classifying...')).toBeInTheDocument();
    expect(screen.getByText(/Queue updated just now/)).toBeInTheDocument();
    await waitFor(
      () => expect(within(screen.getByRole('link', { name: 'Brand new live ticket' }).closest('tr')!).queryByText('Classifying...')).toBeNull(),
      SLOW,
    );

    // Multi-value priority filter, sent comma-separated.
    await user.click(screen.getByRole('button', { name: /Priority/ }));
    await user.click(screen.getByRole('checkbox', { name: 'Critical' }));
    await user.click(screen.getByRole('checkbox', { name: 'High' }));
    await user.keyboard('{Escape}');
    expect(window.location.search).toContain('priority=CRITICAL%2CHIGH');
    await waitFor(() => expect(screen.queryByText('Brand new live ticket')).not.toBeInTheDocument());
    expect(screen.getByText('No royalty received since publication')).toBeInTheDocument(); // HIGH stays

    // Unassigned (assigneeId=unassigned) hides the assigned Critical ticket.
    await user.selectOptions(screen.getByLabelText('Assignee'), 'unassigned');
    await waitFor(() => expect(screen.queryByText("Haven't received any royalty for over 6 months")).not.toBeInTheDocument());
    expect(window.location.search).toContain('assignee=unassigned');

    // Search by "#number".
    await user.type(screen.getByLabelText('Search'), '#1002');
    await waitFor(() => expect(screen.queryByText('No royalty received since publication')).not.toBeInTheDocument());
    await user.click(screen.getByRole('link', { name: 'Amazon shows a different ISBN than my printed copy' }));

    // The AI draft is requested automatically.
    expect(await screen.findByRole('heading', { name: 'Amazon shows a different ISBN than my printed copy' })).toBeInTheDocument();
    await screen.findByRole('textbox', { name: 'Reply' }, SLOW);
    await waitFor(() => expect(replyBox().value).toContain('Hi Rohit'), SLOW);
    expect(replyBox().value).toContain('ISBN mismatch');
    expect(screen.getAllByText('✨ AI suggested')).toHaveLength(2);

    // Overriding the category marks it and re-requests the draft (the server cleared its cache).
    await user.selectOptions(screen.getByLabelText('Category'), 'DISTRIBUTION_AVAILABILITY');
    expect(await screen.findByText('Overridden')).toBeInTheDocument();
    expect(screen.getByText('AI suggested: ISBN & Metadata')).toBeInTheDocument();
    await waitFor(() => expect(replyBox().value).toContain('re-sync'), SLOW);

    // Reply without picking a status: the server moves OPEN → IN_PROGRESS and assigns the replier.
    expect(screen.getByLabelText('Set status on send')).toHaveDisplayValue('Default (moves to In Progress)');
    await user.clear(replyBox());
    await user.type(replyBox(), 'Hi Rohit, escalated to production. Update within 48 hours.');
    await user.click(screen.getByRole('button', { name: 'Send reply' }));
    const thread = screen.getByRole('list', { name: 'Conversation' });
    expect(await within(thread).findByText('Hi Rohit, escalated to production. Update within 48 hours.')).toBeInTheDocument();
    expect(await screen.findByText(/Reply sent\..*Status: In Progress · Assigned to Neha Gupta/)).toBeInTheDocument();
    expect(screen.getByLabelText('Status')).toHaveValue('IN_PROGRESS');
    expect(screen.getByRole('button', { name: 'Assigned to you' })).toBeDisabled();
    expect(replyBox()).toHaveValue('');

    // A new author message (via SSE) re-requests the draft, which fills the now-empty editor.
    const followUp = await asUser('/tickets/t-1002/messages', 'mock.AUTH002', { body: 'Thanks! Should I pause promotions meanwhile?' });
    expect(followUp.status).toBe(201);
    expect(await within(thread).findByText('Thanks! Should I pause promotions meanwhile?')).toBeInTheDocument();
    await waitFor(() => expect(replyBox().value).toContain('Hi Rohit'), SLOW);

    // Internal note.
    await user.type(screen.getByRole('textbox', { name: 'Add an internal note' }), 'Checked with Amazon seller central.');
    await user.click(screen.getByRole('button', { name: 'Add internal note' }));
    expect(await screen.findByText('Checked with Amazon seller central.')).toBeInTheDocument();
    expect(screen.getByText('Internal only, not visible to the author.')).toBeInTheDocument();

    // Back keeps the filters.
    await user.click(screen.getByRole('link', { name: '← Back to queue' }));
    expect(window.location.search).toContain('priority=CRITICAL%2CHIGH');
    expect(window.location.search).toContain('assignee=unassigned');
  }, 40_000);

  it('handles a failed-AI ticket: manual triage badge, manual reply, Retry AI triage', async () => {
    const user = userEvent.setup();
    localStorage.setItem('bookleaf.token', 'mock.ADM001');
    await router.navigate('/admin/tickets/t-1007');
    render(<App />);

    expect(await screen.findByRole('heading', { name: 'Cover design approval' })).toBeInTheDocument();
    expect(screen.getAllByText('Needs manual triage')).toHaveLength(2); // header badge + AI panel
    expect(await screen.findByText('AI drafting is unavailable, write your reply manually.', {}, SLOW)).toBeInTheDocument();
    expect(replyBox()).toBeEnabled();

    await user.click(screen.getByRole('button', { name: 'Retry AI triage' }));
    expect(await screen.findAllByText('Classifying...')).not.toHaveLength(0);
    expect(screen.queryByRole('button', { name: 'Retry AI triage' })).not.toBeInTheDocument();

    // While PENDING it's no longer "needs manual triage"; ticket.ai_ready then refetches the result.
    expect(screen.queryByText('Needs manual triage')).not.toBeInTheDocument();
    await waitFor(() => expect(screen.queryAllByText('Classifying...')).toHaveLength(0), SLOW);
    expect(screen.getAllByText('✨ AI suggested')).toHaveLength(2);
    expect(screen.queryByText('Needs manual triage')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Assign to me' }));
    expect(await screen.findByRole('button', { name: 'Assigned to you' })).toBeDisabled();
  }, 20_000);
});
