import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/api/client';
import { adminApi } from '@/api/endpoints';
import type { AdminTicket } from '@/api/types';
import { renderWithProviders } from '@/test/utils';
import { DraftReplyPanel } from './DraftReplyPanel';

vi.mock('@/api/endpoints', () => ({
  adminApi: { draft: vi.fn(), reply: vi.fn() },
}));
const draftMock = vi.mocked(adminApi.draft);
const replyMock = vi.mocked(adminApi.reply);

const ticket: AdminTicket = {
  id: 't-1',
  ticketNumber: 42,
  subject: 'Royalty missing',
  description: 'No royalty for two quarters.',
  status: 'OPEN',
  book: { id: 'BK010', title: 'Turban Tales' },
  attachments: [],
  messages: [],
  createdAt: '2026-10-01T10:00:00Z',
  updatedAt: '2026-10-01T10:00:00Z',
  category: 'ROYALTY_PAYMENTS',
  priority: 'CRITICAL',
  aiStatus: 'DONE',
  aiSuggestion: { category: 'ROYALTY_PAYMENTS', priority: 'CRITICAL', reasoning: 'Missed payouts.' },
  categoryOverridden: false,
  priorityOverridden: false,
  author: { id: 'AUTH006', name: 'Arjun Malhotra', email: 'arjun.malhotra@email.com' },
  assignee: null,
  internalNotes: [],
  draft: null,
};

const replyBox = () => screen.getByRole('textbox', { name: 'Reply' });

describe('DraftReplyPanel', () => {
  beforeEach(() => {
    draftMock.mockReset();
    replyMock.mockReset();
  });

  it('shows a skeleton, then puts the AI draft in an editable textarea', async () => {
    draftMock.mockResolvedValue({ draft: { body: 'Hi Arjun, sorry for the delay.', source: 'AI', generatedAt: new Date().toISOString() } });
    renderWithProviders(<DraftReplyPanel ticket={ticket} />);

    expect(screen.getByRole('status', { name: 'Generating AI draft' })).toBeInTheDocument();
    await waitFor(() => expect(replyBox()).toHaveValue('Hi Arjun, sorry for the delay.'));
    expect(draftMock).toHaveBeenCalledWith('t-1');
    expect(screen.getByText(/AI draft ·/)).toBeInTheDocument();
    expect(screen.queryByText(/template/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/AI drafting is unavailable/)).not.toBeInTheDocument();
  });

  it('falls back calmly when the AI returns no draft, and still lets the admin write and send', async () => {
    const user = userEvent.setup();
    draftMock.mockResolvedValue({ draft: null, error: { code: 'AI_UNAVAILABLE', message: 'The AI provider did not respond in time.' } });
    replyMock.mockResolvedValue({ id: 'm-1', senderType: 'ADMIN', senderName: 'Neha', body: 'x', createdAt: new Date().toISOString() });
    renderWithProviders(<DraftReplyPanel ticket={ticket} />);

    expect(await screen.findByText('AI drafting is unavailable, write your reply manually.')).toBeInTheDocument();
    expect(screen.getByText(/did not respond in time/)).toBeInTheDocument();
    expect(replyBox()).toBeEnabled();
    expect(replyBox()).toHaveValue('');
    expect(screen.getByRole('button', { name: 'Send reply' })).toBeDisabled();

    await user.type(replyBox(), 'Hi Arjun, I am looking into this personally.');
    expect(screen.getByLabelText('Set status on send')).toHaveDisplayValue('Default (moves to In Progress)');
    await user.click(screen.getByRole('button', { name: 'Send reply' }));

    // No status picked: none is sent, so the server applies its OPEN → IN_PROGRESS default.
    await waitFor(() => expect(replyMock).toHaveBeenCalledWith('t-1', { body: 'Hi Arjun, I am looking into this personally.' }));
    expect(await screen.findByText(/Reply sent/)).toBeInTheDocument();
    expect(replyBox()).toHaveValue('');
  });

  it('treats a failed draft request the same way', async () => {
    draftMock.mockRejectedValue(new ApiError(503, 'INTERNAL', 'Service unavailable'));
    renderWithProviders(<DraftReplyPanel ticket={ticket} />);

    expect(await screen.findByText('AI drafting is unavailable, write your reply manually.')).toBeInTheDocument();
    expect(replyBox()).toBeEnabled();
  });

  it('flags needsManualTriage tickets, but not once both fields were overridden', async () => {
    draftMock.mockResolvedValue({ draft: null, error: { code: 'AI_UNAVAILABLE', message: 'down' } });
    const failed = { ...ticket, aiStatus: 'FAILED' as const, aiSuggestion: null };
    const { unmount } = renderWithProviders(<DraftReplyPanel ticket={failed} />);
    expect(screen.getByText(/needs manual triage/)).toBeInTheDocument();
    unmount();

    renderWithProviders(<DraftReplyPanel ticket={{ ...failed, categoryOverridden: true, priorityOverridden: true }} />);
    expect(screen.queryByText(/needs manual triage/)).not.toBeInTheDocument();
  });

  it('re-requests the draft when a new author message arrives, and fills an untouched editor', async () => {
    draftMock
      .mockResolvedValueOnce({ draft: { body: 'First draft', source: 'AI', generatedAt: '2026-10-21T10:00:00Z' } })
      .mockResolvedValueOnce({ draft: { body: 'Draft answering the follow-up', source: 'AI', generatedAt: '2026-10-21T10:05:00Z' } });
    const { rerender } = renderWithProviders(<DraftReplyPanel ticket={ticket} />);
    await waitFor(() => expect(replyBox()).toHaveValue('First draft'));

    const followUp = { id: 'm-9', senderType: 'AUTHOR' as const, senderName: 'Arjun', body: 'Any update?', createdAt: '2026-10-21T10:04:00Z' };
    rerender(<DraftReplyPanel ticket={{ ...ticket, messages: [followUp] }} />);

    await waitFor(() => expect(replyBox()).toHaveValue('Draft answering the follow-up'));
    expect(draftMock).toHaveBeenCalledTimes(2);
    expect(draftMock).toHaveBeenLastCalledWith('t-1'); // a normal request: the server already cleared its cache
  });

  it('offers a newer draft instead of overwriting text the admin has written', async () => {
    const user = userEvent.setup();
    draftMock
      .mockResolvedValueOnce({ draft: { body: 'First draft', source: 'AI', generatedAt: '2026-10-21T10:00:00Z' } })
      .mockResolvedValueOnce({ draft: { body: 'Newer draft', source: 'AI', generatedAt: '2026-10-21T10:05:00Z' } });
    const { rerender } = renderWithProviders(<DraftReplyPanel ticket={ticket} />);
    await waitFor(() => expect(replyBox()).toHaveValue('First draft'));
    await user.type(replyBox(), ' with my edits');

    rerender(<DraftReplyPanel ticket={{ ...ticket, messages: [{ id: 'm-9', senderType: 'AUTHOR', senderName: 'Arjun', body: '?', createdAt: '2026-10-21T10:04:00Z' }] }} />);
    expect(await screen.findByText(/A new AI draft is available/)).toBeInTheDocument();
    expect(replyBox()).toHaveValue('First draft with my edits');

    await user.click(screen.getByRole('button', { name: 'Replace my text with it' }));
    expect(replyBox()).toHaveValue('Newer draft');
  });

  it('shows the friendly message when Regenerate is rate limited', async () => {
    const user = userEvent.setup();
    draftMock
      .mockResolvedValueOnce({ draft: { body: 'Draft', source: 'AI', generatedAt: '2026-10-21T10:00:00Z' } })
      .mockRejectedValueOnce(new ApiError(429, 'RATE_LIMITED', 'Too many AI requests. Please wait a moment.'));
    renderWithProviders(<DraftReplyPanel ticket={ticket} />);
    await waitFor(() => expect(replyBox()).toHaveValue('Draft'));

    await user.click(screen.getByRole('button', { name: 'Regenerate' }));
    expect(await screen.findByText('Too many requests, try again shortly.')).toBeInTheDocument();
    expect(replyBox()).toHaveValue('Draft');
  });

  it('does not overwrite edits on Regenerate unless the admin confirms', async () => {
    const user = userEvent.setup();
    draftMock.mockResolvedValue({ draft: { body: 'Draft one', source: 'AI', generatedAt: '2026-10-21T10:00:00Z' } });
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    renderWithProviders(<DraftReplyPanel ticket={ticket} />);

    await waitFor(() => expect(replyBox()).toHaveValue('Draft one'));
    await user.type(replyBox(), ' plus my edits');
    await user.click(screen.getByRole('button', { name: 'Regenerate' }));

    expect(confirm).toHaveBeenCalled();
    expect(draftMock).toHaveBeenCalledTimes(1); // no regenerate request
    expect(replyBox()).toHaveValue('Draft one plus my edits');
    confirm.mockRestore();
  });
});
