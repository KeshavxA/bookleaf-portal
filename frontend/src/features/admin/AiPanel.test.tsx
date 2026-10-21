import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/api/client';
import { adminApi } from '@/api/endpoints';
import { qk } from '@/api/queryKeys';
import type { AdminTicket } from '@/api/types';
import { renderWithProviders } from '@/test/utils';
import { AiPanel } from './AiPanel';

vi.mock('@/api/endpoints', () => ({ adminApi: { classify: vi.fn(), update: vi.fn() } }));
const classifyMock = vi.mocked(adminApi.classify);

const base: AdminTicket = {
  id: 't-7',
  ticketNumber: 7,
  subject: 'Cover design approval',
  description: 'Has the designer seen my feedback?',
  status: 'OPEN',
  book: null,
  attachments: [],
  messages: [],
  createdAt: '2026-10-20T10:00:00Z',
  updatedAt: '2026-10-20T10:00:00Z',
  category: 'GENERAL_INQUIRY',
  priority: 'MEDIUM',
  aiStatus: 'FAILED',
  aiSuggestion: null,
  categoryOverridden: false,
  priorityOverridden: false,
  author: { id: 'AUTH007', name: 'Sneha Kulkarni', email: 'sneha@example.com' },
  assignee: null,
  internalNotes: [],
  draft: null,
};

describe('AiPanel', () => {
  beforeEach(() => {
    classifyMock.mockReset();
  });

  it('marks category and priority as provisional while classifying', () => {
    renderWithProviders(<AiPanel ticket={{ ...base, aiStatus: 'PENDING' }} />);
    expect(screen.getByText('Classifying...')).toBeInTheDocument();
    expect(screen.getAllByText(/Provisional \(keyword-based\)/)).toHaveLength(2);
    expect(screen.queryByText('Needs manual triage')).not.toBeInTheDocument();
  });

  it('retries AI triage: disabled while the request is in flight, then shows the PENDING state', async () => {
    const user = userEvent.setup();
    let resolve!: (t: AdminTicket) => void;
    classifyMock.mockReturnValue(new Promise((r) => (resolve = r)));
    const { client } = renderWithProviders(<AiPanel ticket={base} />);
    client.setQueryData(qk.admin.ticket(base.id), base);

    expect(screen.getByText('Needs manual triage')).toBeInTheDocument();
    const retry = screen.getByRole('button', { name: 'Retry AI triage' });
    await user.click(retry);
    expect(classifyMock).toHaveBeenCalledWith('t-7');
    expect(retry).toBeDisabled();

    resolve({ ...base, aiStatus: 'PENDING' });
    await waitFor(() => expect(client.getQueryData<AdminTicket>(qk.admin.ticket(base.id))?.aiStatus).toBe('PENDING'));
  });

  it('shows the friendly message when retry is rate limited', async () => {
    const user = userEvent.setup();
    classifyMock.mockRejectedValue(new ApiError(429, 'RATE_LIMITED', 'Too many AI requests.'));
    renderWithProviders(<AiPanel ticket={base} />);
    await user.click(screen.getByRole('button', { name: 'Retry AI triage' }));
    expect(await screen.findByText('Too many requests, try again shortly.')).toBeInTheDocument();
  });

  it('drops the manual triage prompt once an admin has overridden both fields', () => {
    renderWithProviders(<AiPanel ticket={{ ...base, categoryOverridden: true, priorityOverridden: true }} />);
    expect(screen.queryByText('Needs manual triage')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Retry AI triage' })).not.toBeInTheDocument();
    expect(screen.getAllByText('Set manually')).toHaveLength(2);
  });
});
