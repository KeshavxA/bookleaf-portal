import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/api/client';
import { authorApi } from '@/api/endpoints';
import type { AuthorTicket } from '@/api/types';
import { AuthProvider } from '@/features/auth/AuthContext';
import { renderWithProviders } from '@/test/utils';
import { NewTicketPage } from './NewTicketPage';
import { TicketDetailPage } from './TicketDetailPage';

vi.mock('@/api/endpoints', () => ({
  authApi: { me: vi.fn() },
  authorApi: { ticket: vi.fn(), addMessage: vi.fn(), books: vi.fn(), createTicket: vi.fn() },
}));
const api = vi.mocked(authorApi);

const ticket: AuthorTicket = {
  id: 't-1',
  ticketNumber: 42,
  subject: 'Royalty question',
  description: 'When is my next payout?',
  status: 'OPEN',
  book: null,
  attachments: [],
  messages: [{ id: 'm-1', senderType: 'ADMIN', senderName: 'Neha', body: 'By 14 Nov.', createdAt: '2026-10-20T10:00:00Z' }],
  createdAt: '2026-10-19T10:00:00Z',
  updatedAt: '2026-10-20T10:00:00Z',
};

const renderDetail = () =>
  renderWithProviders(
    <AuthProvider>
      <Routes>
        <Route path="/tickets/:id" element={<TicketDetailPage />} />
      </Routes>
    </AuthProvider>,
    { route: '/tickets/t-1' },
  );

describe('author ticket detail: follow-ups', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('shows the ticket number as #42 and warns that replying reopens a RESOLVED ticket', async () => {
    api.ticket.mockResolvedValue({ ...ticket, status: 'RESOLVED' });
    renderDetail();
    expect(await screen.findByText('#42')).toBeInTheDocument();
    expect(screen.getByText('Replying will reopen this ticket.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Send and reopen' })).toBeInTheDocument();
  });

  it('hides the reply box on a CLOSED ticket', async () => {
    api.ticket.mockResolvedValue({ ...ticket, status: 'CLOSED' });
    renderDetail();
    expect(await screen.findByText('This ticket is closed')).toBeInTheDocument();
    expect(screen.queryByRole('textbox', { name: 'Add a follow-up' })).not.toBeInTheDocument();
  });

  it('handles 409 CONFLICT: refetches, shows the closed state and keeps the unsent text', async () => {
    const user = userEvent.setup();
    api.ticket.mockResolvedValueOnce(ticket).mockResolvedValue({ ...ticket, status: 'CLOSED' });
    api.addMessage.mockRejectedValue(new ApiError(409, 'CONFLICT', 'This ticket is closed'));
    renderDetail();

    await user.type(await screen.findByRole('textbox', { name: 'Add a follow-up' }), 'One more thing about my payout.');
    await user.click(screen.getByRole('button', { name: 'Send' }));

    expect(await screen.findByText('This ticket is closed')).toBeInTheDocument();
    expect(screen.getByText('One more thing about my payout.')).toBeInTheDocument();
    expect(api.ticket).toHaveBeenCalledTimes(2);
  });

  it('maps a server field error onto the message field', async () => {
    const user = userEvent.setup();
    api.ticket.mockResolvedValue(ticket);
    api.addMessage.mockRejectedValue(
      new ApiError(400, 'VALIDATION_ERROR', 'Request validation failed', [{ field: 'body', message: 'Message contains a blocked link' }]),
    );
    renderDetail();

    await user.type(await screen.findByRole('textbox', { name: 'Add a follow-up' }), 'see http://spam');
    await user.click(screen.getByRole('button', { name: 'Send' }));
    expect(await screen.findByText('Message contains a blocked link')).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Add a follow-up' })).toHaveAttribute('aria-invalid', 'true');
  });
});

describe('new ticket form: server errors', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('puts field details on their inputs and (root)/attachment details in the form banner', async () => {
    const user = userEvent.setup();
    api.books.mockResolvedValue([]);
    api.createTicket.mockRejectedValue(
      new ApiError(400, 'VALIDATION_ERROR', 'Request validation failed', [
        { field: 'subject', message: 'Subject is already used by an open ticket' },
        { field: 'attachments.0.size', message: 'Must be at most 10 MB' },
        { field: '(root)', message: 'Please check the highlighted fields.' },
      ]),
    );
    renderWithProviders(<NewTicketPage />);

    await waitFor(() => expect(screen.getByLabelText('Which book is this about?')).toBeEnabled());
    await user.selectOptions(screen.getByLabelText('Which book is this about?'), 'general');
    await user.type(screen.getByLabelText('Subject'), 'Royalty question');
    await user.type(screen.getByLabelText('Describe your query'), 'When will my next payout arrive?');
    await user.click(screen.getByRole('button', { name: 'Submit query' }));

    expect(await screen.findByText('Subject is already used by an open ticket')).toBeInTheDocument();
    expect(screen.getByLabelText('Subject')).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByRole('alert')).toHaveTextContent('Attachment 1 size: Must be at most 10 MB Please check the highlighted fields.');
  });

  it('shows the friendly message on 429', async () => {
    const user = userEvent.setup();
    api.books.mockResolvedValue([]);
    api.createTicket.mockRejectedValue(new ApiError(429, 'RATE_LIMITED', 'Slow down'));
    renderWithProviders(<NewTicketPage />);

    await waitFor(() => expect(screen.getByLabelText('Which book is this about?')).toBeEnabled());
    await user.selectOptions(screen.getByLabelText('Which book is this about?'), 'general');
    await user.type(screen.getByLabelText('Subject'), 'Royalty question');
    await user.type(screen.getByLabelText('Describe your query'), 'When will my next payout arrive?');
    await user.click(screen.getByRole('button', { name: 'Submit query' }));
    expect(await screen.findByText('Too many requests, try again shortly.')).toBeInTheDocument();
  });
});
