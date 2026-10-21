import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { setupServer } from 'msw/node';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { App } from '@/App';
import { handlers } from '@/mocks/handlers';

// End-to-end author journey against the same MSW handlers the dev mock mode uses.
const server = setupServer(...handlers);
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterAll(() => server.close());

describe('author flow (mock API)', () => {
  it('logs in, sees books with edge cases, submits a query, and receives an admin reply live', async () => {
    const user = userEvent.setup();
    window.history.pushState({}, '', '/login');
    render(<App />);

    await user.type(await screen.findByLabelText('Email'), 'sneha.kulkarni@email.com');
    await user.type(screen.getByLabelText('Password'), 'Passw0rd!');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));

    // My Books: three books including one in production.
    expect(await screen.findByRole('heading', { name: 'My Books' })).toBeInTheDocument();
    expect(await screen.findByText('The Algorithm of Love')).toBeInTheDocument();
    expect(screen.getByText('In production · Cover Design')).toBeInTheDocument();
    expect(window.location.pathname).toBe('/books');

    // Submit Query: validation first, then a valid submission.
    await user.click(screen.getByRole('link', { name: 'Submit Query' }));
    await user.click(await screen.findByRole('button', { name: 'Submit query' }));
    expect(await screen.findByText('Choose a book or "General / Account Level"')).toBeInTheDocument();
    expect(screen.getByText('Subject must be at least 3 characters')).toBeInTheDocument();

    const bookSelect = screen.getByLabelText('Which book is this about?');
    await waitFor(() => expect(within(bookSelect).getByRole('option', { name: 'Midnight in Mysore' })).toBeInTheDocument());
    await user.selectOptions(bookSelect, 'Midnight in Mysore');
    await user.type(screen.getByLabelText('Subject'), 'Cover proof timeline');
    await user.type(screen.getByLabelText('Describe your query'), 'When will I receive the next cover proof for review?');
    const file = new File(['x'.repeat(2048)], 'cover-notes.pdf', { type: 'application/pdf' });
    await user.upload(screen.getByLabelText(/Add files/), file);
    expect(screen.getByText('cover-notes.pdf')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Submit query' }));

    expect(await screen.findByRole('heading', { name: /Query submitted: BL-\d+/ })).toBeInTheDocument();
    await user.click(screen.getByRole('link', { name: 'View ticket' }));

    expect(await screen.findByRole('heading', { name: 'Cover proof timeline' })).toBeInTheDocument();
    expect(screen.getByText('Midnight in Mysore', { exact: false })).toBeInTheDocument();
    expect(screen.getByText(/cover-notes\.pdf/)).toBeInTheDocument();
    expect(screen.getByText(/Our support team will reply here/)).toBeInTheDocument();

    // An admin replies elsewhere; the SSE event should pull it into the open page with no refresh.
    await waitFor(() => expect(screen.getByText('Live')).toBeInTheDocument());
    const ticketId = window.location.pathname.split('/').pop()!;
    const res = await fetch(`http://localhost/api/v1/admin/tickets/${ticketId}/reply`, {
      method: 'POST',
      headers: { Authorization: 'Bearer mock.ADM001', 'Content-Type': 'application/json' },
      body: JSON.stringify({ body: 'Your next proof arrives on Friday.', status: 'IN_PROGRESS' }),
    });
    expect(res.status).toBe(201);
    expect(await screen.findByText('Your next proof arrives on Friday.')).toBeInTheDocument();
    expect(screen.getByText('In Progress')).toBeInTheDocument();
    expect(screen.getByText(/Updated just now/)).toBeInTheDocument();

    // My Tickets lists it with an Open badge.
    await user.click(screen.getByRole('link', { name: 'My Tickets' }));
    const row = (await screen.findByText('Cover proof timeline')).closest('a')!;
    expect(within(row).getByText('In Progress')).toBeInTheDocument();
  });
});
