import { setupServer } from 'msw/node';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { handlers } from './handlers';

// Contract v1.1 checks against the mock layer itself, so mock mode keeps behaving like the backend.
const server = setupServer(...handlers);
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterAll(() => server.close());

const ADMIN = 'mock.ADM001';
const AUTHOR = 'mock.AUTH002'; // Rohit Kapoor, owns t-1002 and t-1011

async function call(path: string, token: string, init: { method?: string; body?: unknown } = {}) {
  const res = await fetch(`http://localhost/api/v1${path}`, {
    method: init.method ?? 'GET',
    headers: { Authorization: `Bearer ${token}`, ...(init.body !== undefined && { 'Content-Type': 'application/json' }) },
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
  });
  return { status: res.status, data: await res.json() };
}

const numbers = (data: { items: { ticketNumber: number }[] }) => data.items.map((t) => t.ticketNumber);

describe('mock API: contract v1.1', () => {
  it('list endpoints omit the messages key; single GETs include it; ticketNumber is an integer', async () => {
    const authorList = await call('/tickets', AUTHOR);
    expect(authorList.data.every((t: object) => !('messages' in t))).toBe(true);
    const adminList = await call('/admin/tickets', ADMIN);
    expect(adminList.data.items.every((t: object) => !('messages' in t))).toBe(true);
    expect(adminList.data.items[0]).toHaveProperty('internalNotes');

    const one = await call('/tickets/t-1002', AUTHOR);
    expect(Array.isArray(one.data.messages)).toBe(true);
    expect(Number.isInteger(one.data.ticketNumber)).toBe(true);
  });

  it('filters: comma-separated values, assigneeId me/unassigned, #number search, bare "to" date', async () => {
    const multi = await call('/admin/tickets?priority=CRITICAL,HIGH&status=OPEN,IN_PROGRESS', ADMIN);
    expect(multi.data.items.every((t: { priority: string }) => ['CRITICAL', 'HIGH'].includes(t.priority))).toBe(true);
    expect(multi.data.total).toBeGreaterThan(1);

    const unassigned = await call('/admin/tickets?assigneeId=unassigned', ADMIN);
    expect(unassigned.data.items.every((t: { assignee: unknown }) => t.assignee === null)).toBe(true);
    const mine = await call('/admin/tickets?assigneeId=me', ADMIN);
    expect(mine.data.items.every((t: { assignee: { id: string } }) => t.assignee?.id === 'ADM001')).toBe(true);

    expect(numbers((await call('/admin/tickets?q=%231002', ADMIN)).data)).toEqual([1002]);

    const today = new Date().toISOString().slice(0, 10);
    const toToday = await call(`/admin/tickets?to=${today}`, ADMIN);
    const all = await call('/admin/tickets?pageSize=100', ADMIN);
    expect(toToday.data.total).toBe(all.data.total); // a bare "to" covers the whole (UTC) day
  });

  it('orders by urgency by default, like the backend: unresolved first, priority weight, then oldest', async () => {
    const WEIGHT: Record<string, number> = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3 };
    type Item = { priority: string; status: string; createdAt: string };
    const isOpen = (t: Item) => t.status === 'OPEN' || t.status === 'IN_PROGRESS';

    for (const query of ['?pageSize=100', '?sort=urgency&page=1&pageSize=100']) {
      const items: Item[] = (await call(`/admin/tickets${query}`, ADMIN)).data.items;
      const firstResolved = items.findIndex((t) => !isOpen(t));
      expect(items.slice(firstResolved).every((t) => !isOpen(t))).toBe(true); // resolved/closed last
      const open = items.slice(0, firstResolved);
      for (let i = 1; i < open.length; i++) {
        const [a, b] = [open[i - 1], open[i]];
        const byWeight = WEIGHT[a.priority] - WEIGHT[b.priority];
        expect(byWeight < 0 || (byWeight === 0 && a.createdAt <= b.createdAt)).toBe(true);
      }
      expect(open[0].priority).toBe('CRITICAL');
    }
  });

  it('PATCH: same value is a no-op; a category change sets the flag and clears the cached draft', async () => {
    // t-1006: Vikram's MEDIUM ticket whose priority matches the AI suggestion.
    const draft = await call('/admin/tickets/t-1006/draft', ADMIN, { method: 'POST', body: {} });
    expect(draft.data.draft.source).toBe('AI');

    const same = await call('/admin/tickets/t-1006', ADMIN, { method: 'PATCH', body: { priority: 'MEDIUM' } });
    expect(same.data.priorityOverridden).toBe(false);

    const changed = await call('/admin/tickets/t-1006', ADMIN, { method: 'PATCH', body: { category: 'PRINTING_QUALITY' } });
    expect(changed.data.categoryOverridden).toBe(true);
    expect(changed.data.draft).toBeNull();
  });

  it('classify retries a FAILED ticket: 202 with aiStatus PENDING', async () => {
    const res = await call('/admin/tickets/t-1007/classify', ADMIN, { method: 'POST' });
    expect(res.status).toBe(202);
    expect(res.data.aiStatus).toBe('PENDING');
  });

  it('reply without status moves OPEN to IN_PROGRESS and assigns the replier', async () => {
    // t-1003: Ananya's OPEN, unassigned ticket.
    const reply = await call('/admin/tickets/t-1003/reply', 'mock.ADM002', { method: 'POST', body: { body: 'On it.' } });
    expect(reply.status).toBe(201);
    const t = await call('/admin/tickets/t-1003', ADMIN);
    expect(t.data.status).toBe('IN_PROGRESS');
    expect(t.data.assignee).toEqual({ id: 'ADM002', name: 'Rahul Verma' });
  });

  it('author follow-ups: clear the draft, reopen RESOLVED, 409 on CLOSED, 404 for other authors', async () => {
    await call('/admin/tickets/t-1002/draft', ADMIN, { method: 'POST', body: {} });
    await call('/tickets/t-1002/messages', AUTHOR, { method: 'POST', body: { body: 'Any news?' } });
    expect((await call('/admin/tickets/t-1002', ADMIN)).data.draft).toBeNull();

    await call('/admin/tickets/t-1011', ADMIN, { method: 'PATCH', body: { status: 'RESOLVED' } });
    await call('/tickets/t-1011/messages', AUTHOR, { method: 'POST', body: { body: 'Actually, one more thing.' } });
    expect((await call('/tickets/t-1011', AUTHOR)).data.status).toBe('OPEN');

    await call('/admin/tickets/t-1011', ADMIN, { method: 'PATCH', body: { status: 'CLOSED' } });
    const closed = await call('/tickets/t-1011/messages', AUTHOR, { method: 'POST', body: { body: 'Hello?' } });
    expect(closed.status).toBe(409);
    expect(closed.data.error.code).toBe('CONFLICT');

    expect((await call('/tickets/t-1001', AUTHOR)).status).toBe(404); // Arjun's ticket
  });

  it('validation details use { field, message } with dotted paths and "(root)"', async () => {
    const bad = await call('/tickets', AUTHOR, {
      method: 'POST',
      body: { bookId: null, subject: 'ok subject', description: 'long enough text', attachments: [{ name: 'a.pdf', size: -1 }] },
    });
    expect(bad.status).toBe(400);
    expect(bad.data.error.details).toEqual([{ field: 'attachments.0.size', message: expect.any(String) }]);

    const root = await call('/tickets', AUTHOR, { method: 'POST', body: {} });
    expect(root.data.error.details[0].field).toBe('(root)');
  });

  it('rate limits AI endpoints with 429 RATE_LIMITED', async () => {
    let last = 0;
    for (let i = 0; i < 25 && last !== 429; i++) {
      last = (await call('/admin/tickets/t-1007/classify', 'mock.ADM002', { method: 'POST' })).status;
    }
    expect(last).toBe(429);
  }, 15_000);
});
