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
    await user.selectOptions(screen.getByLabelText('Set status on send'), 'In Progress');
    await user.click(screen.getByRole('button', { name: 'Send reply' }));

    await waitFor(() =>
      expect(replyMock).toHaveBeenCalledWith('t-1', { body: 'Hi Arjun, I am looking into this personally.', status: 'IN_PROGRESS' }),
    );
    expect(await screen.findByText(/Reply sent/)).toBeInTheDocument();
    expect(replyBox()).toHaveValue('');
  });

  it('treats a failed draft request the same way', async () => {
    draftMock.mockRejectedValue(new ApiError(503, 'INTERNAL', 'Service unavailable'));
    renderWithProviders(<DraftReplyPanel ticket={ticket} />);

    expect(await screen.findByText('AI drafting is unavailable, write your reply manually.')).toBeInTheDocument();
    expect(replyBox()).toBeEnabled();
  });

  it('flags tickets whose AI classification failed as needing manual triage', async () => {
    draftMock.mockResolvedValue({ draft: null, error: { code: 'AI_UNAVAILABLE', message: 'down' } });
    renderWithProviders(<DraftReplyPanel ticket={{ ...ticket, aiStatus: 'FAILED', aiSuggestion: null }} />);
    expect(screen.getByText(/needs manual triage/)).toBeInTheDocument();
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
