import { delay, http, HttpResponse } from 'msw';
import {
  CATEGORIES,
  PRIORITIES,
  TICKET_STATUSES,
  type Category,
  type ErrorCode,
  type Priority,
  type Role,
  type TicketEventType,
  type TicketStatus,
} from '@/api/types';
import { config } from '@/lib/config';
import { classify, generateDraft } from './ai';
import {
  canReceive,
  db,
  emit,
  findBook,
  findUser,
  nextId,
  nowIso,
  persist,
  subscribe,
  toAdminTicket,
  toAuthorTicket,
  touch,
  type MockTicket,
  type MockUser,
} from './db';

const base = config.apiUrl;
const PASSWORD = 'Passw0rd!';
const AI_DELAY_MS = 2500;
const AUTO_REPLY_DELAY_MS = 15_000;

const fail = (status: number, code: ErrorCode, message: string, details: unknown[] = []) =>
  HttpResponse.json({ error: { code, message, details } }, { status });

const tokenFor = (u: MockUser) => `mock.${u.id}`;

function currentUser(request: Request): MockUser | null {
  const header = request.headers.get('Authorization') ?? '';
  const m = /^Bearer mock\.(.+)$/.exec(header);
  return m ? (findUser(m[1]) ?? null) : null;
}

/** Returns the user, or an error Response if unauthenticated or the role doesn't match. */
function guard(request: Request, role?: Role): MockUser | Response {
  const user = currentUser(request);
  if (!user) return fail(401, 'UNAUTHORIZED', 'Missing or invalid token');
  if (role && user.role !== role) return fail(403, 'FORBIDDEN', 'You do not have access to this resource');
  return user;
}

async function readJson(request: Request): Promise<Record<string, unknown>> {
  try {
    const body = await request.json();
    return body && typeof body === 'object' ? (body as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '');

function setAndEmit(t: MockTicket, type: TicketEventType) {
  touch(t);
  emit(type, t);
}

/** Simulates the backend's async classification job finishing a few seconds after creation. */
function scheduleClassification(t: MockTicket) {
  setTimeout(() => {
    const ticket = db.tickets.find((x) => x.id === t.id);
    if (!ticket || ticket.aiStatus !== 'PENDING') return;
    const result = classify(ticket);
    ticket.aiSuggestion = result;
    ticket.aiStatus = 'DONE';
    if (!ticket.categoryOverridden) ticket.category = result.category;
    if (!ticket.priorityOverridden) ticket.priority = result.priority;
    setAndEmit(ticket, 'ticket.ai_ready');
  }, AI_DELAY_MS);
}

/**
 * Mock-only: a scripted acknowledgement from "support" so the author's live-update path can be
 * demoed without a second browser. Skipped if a real admin reply already landed.
 */
function scheduleAutoReply(t: MockTicket) {
  setTimeout(() => {
    const ticket = db.tickets.find((x) => x.id === t.id);
    if (!ticket || ticket.messages.some((m) => m.senderType === 'ADMIN')) return;
    const first = findUser(ticket.authorId)?.name.split(' ')[0] ?? 'there';
    ticket.messages.push({
      id: nextId('m'),
      senderType: 'ADMIN',
      senderName: 'BookLeaf Support (demo auto-reply)',
      body: `Hi ${first}, thanks for reaching out. We've received your query "${ticket.subject}" and a member of our team is looking into it. We'll update this ticket within 48 hours.`,
      createdAt: nowIso(),
    });
    if (ticket.status === 'OPEN') ticket.status = 'IN_PROGRESS';
    setAndEmit(ticket, 'ticket.message');
  }, AUTO_REPLY_DELAY_MS);
}

// Finish any classification left pending from a previous session.
db.tickets.filter((t) => t.aiStatus === 'PENDING').forEach(scheduleClassification);

const PRIORITY_WEIGHT: Record<Priority, number> = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3 };
const unresolved = (s: TicketStatus) => s === 'OPEN' || s === 'IN_PROGRESS';
const time = (iso: string) => new Date(iso).getTime();

function compareUrgency(a: MockTicket, b: MockTicket) {
  const ua = unresolved(a.status);
  const ub = unresolved(b.status);
  if (ua !== ub) return ua ? -1 : 1;
  if (!ua) return time(b.updatedAt) - time(a.updatedAt);
  return PRIORITY_WEIGHT[a.priority] - PRIORITY_WEIGHT[b.priority] || time(a.createdAt) - time(b.createdAt);
}

function findTicketFor(user: MockUser, id: string) {
  const t = db.tickets.find((x) => x.id === id);
  if (!t) return null;
  if (user.role === 'AUTHOR' && t.authorId !== user.id) return null; // don't leak existence
  return t;
}

export const handlers = [
  // --- Auth -------------------------------------------------------------------------------
  http.post(`${base}/auth/login`, async ({ request }) => {
    await delay(300);
    const body = await readJson(request);
    const email = str(body.email).toLowerCase();
    const user = db.users.find((u) => u.email.toLowerCase() === email);
    if (!email || !body.password) {
      return fail(400, 'VALIDATION_ERROR', 'Email and password are required', [
        ...(!email ? [{ field: 'email', message: 'Email is required' }] : []),
        ...(!body.password ? [{ field: 'password', message: 'Password is required' }] : []),
      ]);
    }
    if (!user || body.password !== PASSWORD) return fail(401, 'UNAUTHORIZED', 'Invalid email or password');
    return HttpResponse.json({ token: tokenFor(user), user });
  }),

  http.get(`${base}/auth/me`, ({ request }) => {
    const user = guard(request);
    return user instanceof Response ? user : HttpResponse.json(user);
  }),

  // --- Author -----------------------------------------------------------------------------
  http.get(`${base}/books`, async ({ request }) => {
    const user = guard(request, 'AUTHOR');
    if (user instanceof Response) return user;
    await delay(400);
    return HttpResponse.json(db.books[user.id] ?? []);
  }),

  http.get(`${base}/tickets`, async ({ request }) => {
    const user = guard(request, 'AUTHOR');
    if (user instanceof Response) return user;
    await delay(250);
    const mine = db.tickets
      .filter((t) => t.authorId === user.id)
      .sort((a, b) => time(b.createdAt) - time(a.createdAt))
      .map((t) => toAuthorTicket(t, false));
    return HttpResponse.json(mine);
  }),

  http.post(`${base}/tickets`, async ({ request }) => {
    const user = guard(request, 'AUTHOR');
    if (user instanceof Response) return user;
    await delay(500);
    const body = await readJson(request);
    const subject = str(body.subject);
    const description = str(body.description);
    const bookId = body.bookId == null ? null : String(body.bookId);
    const details: { field: string; message: string }[] = [];
    if (subject.length < 3 || subject.length > 120) details.push({ field: 'subject', message: 'Subject must be 3-120 characters' });
    if (description.length < 10 || description.length > 5000)
      details.push({ field: 'description', message: 'Description must be 10-5000 characters' });
    if (bookId && !(db.books[user.id] ?? []).some((b) => b.id === bookId))
      details.push({ field: 'bookId', message: 'Book not found on your account' });
    if (details.length) return fail(400, 'VALIDATION_ERROR', 'Please fix the highlighted fields', details);

    const attachments = Array.isArray(body.attachments)
      ? (body.attachments as { name?: unknown; size?: unknown }[])
          .filter((a) => typeof a?.name === 'string' && typeof a?.size === 'number')
          .map((a) => ({ name: a.name as string, size: a.size as number }))
      : [];
    const createdAt = nowIso();
    const n = 1001 + db.tickets.length;
    const ticket: MockTicket = {
      id: nextId('t'),
      ticketNumber: n,
      authorId: user.id,
      bookId,
      subject,
      description,
      status: 'OPEN',
      attachments,
      messages: [],
      createdAt,
      updatedAt: createdAt,
      category: 'GENERAL_INQUIRY',
      priority: 'MEDIUM',
      aiStatus: 'PENDING',
      aiSuggestion: null,
      categoryOverridden: false,
      priorityOverridden: false,
      assigneeId: null,
      internalNotes: [],
      draft: null,
    };
    db.tickets.push(ticket);
    persist();
    emit('ticket.created', ticket);
    scheduleClassification(ticket);
    scheduleAutoReply(ticket);
    return HttpResponse.json(toAuthorTicket(ticket, true), { status: 201 });
  }),

  http.get(`${base}/tickets/:id`, async ({ request, params }) => {
    const user = guard(request, 'AUTHOR');
    if (user instanceof Response) return user;
    await delay(250);
    const t = findTicketFor(user, String(params.id));
    return t ? HttpResponse.json(toAuthorTicket(t, true)) : fail(404, 'NOT_FOUND', 'Ticket not found');
  }),

  http.post(`${base}/tickets/:id/messages`, async ({ request, params }) => {
    const user = guard(request, 'AUTHOR');
    if (user instanceof Response) return user;
    const t = findTicketFor(user, String(params.id));
    if (!t) return fail(404, 'NOT_FOUND', 'Ticket not found');
    if (t.status === 'CLOSED') return fail(409, 'CONFLICT', 'This ticket is closed');
    const text = str((await readJson(request)).body);
    if (!text) return fail(400, 'VALIDATION_ERROR', 'Message cannot be empty', [{ field: 'body', message: 'Required' }]);
    const message = { id: nextId('m'), senderType: 'AUTHOR' as const, senderName: user.name, body: text, createdAt: nowIso() };
    t.messages.push(message);
    if (t.status === 'RESOLVED') t.status = 'OPEN';
    setAndEmit(t, 'ticket.message');
    return HttpResponse.json(message, { status: 201 });
  }),

  // --- Admin ------------------------------------------------------------------------------
  http.get(`${base}/admin/tickets`, async ({ request }) => {
    const user = guard(request, 'ADMIN');
    if (user instanceof Response) return user;
    await delay(300);
    const p = new URL(request.url).searchParams;
    const q = (p.get('q') ?? '').trim().toLowerCase();
    const from = p.get('from');
    const to = p.get('to');
    let list = db.tickets.filter((t) => {
      if (p.get('status') && t.status !== p.get('status')) return false;
      if (p.get('category') && t.category !== p.get('category')) return false;
      if (p.get('priority') && t.priority !== p.get('priority')) return false;
      if (p.get('assigneeId') && t.assigneeId !== p.get('assigneeId')) return false;
      if (from && time(t.createdAt) < time(from)) return false;
      if (to && time(t.createdAt) > time(to)) return false;
      if (q) {
        const author = findUser(t.authorId);
        const hay = [`#${t.ticketNumber}`, t.subject, t.description, author?.name, author?.email, findBook(t.bookId)?.title]
          .join(' ')
          .toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
    const sort = p.get('sort') ?? 'urgency';
    list = [...list].sort(
      sort === 'oldest'
        ? (a, b) => time(a.createdAt) - time(b.createdAt)
        : sort === 'newest'
          ? (a, b) => time(b.createdAt) - time(a.createdAt)
          : compareUrgency,
    );
    const page = Math.max(1, Number(p.get('page')) || 1);
    const pageSize = Math.min(100, Math.max(1, Number(p.get('pageSize')) || 20));
    return HttpResponse.json({
      items: list.slice((page - 1) * pageSize, page * pageSize).map((t) => toAdminTicket(t, false)),
      total: list.length,
      page,
      pageSize,
    });
  }),

  http.get(`${base}/admin/tickets/:id`, async ({ request, params }) => {
    const user = guard(request, 'ADMIN');
    if (user instanceof Response) return user;
    await delay(250);
    const t = findTicketFor(user, String(params.id));
    return t ? HttpResponse.json(toAdminTicket(t, true)) : fail(404, 'NOT_FOUND', 'Ticket not found');
  }),

  http.patch(`${base}/admin/tickets/:id`, async ({ request, params }) => {
    const user = guard(request, 'ADMIN');
    if (user instanceof Response) return user;
    await delay(250);
    const t = findTicketFor(user, String(params.id));
    if (!t) return fail(404, 'NOT_FOUND', 'Ticket not found');
    const body = await readJson(request);
    const details: { field: string; message: string }[] = [];
    if (body.status !== undefined && !TICKET_STATUSES.includes(body.status as TicketStatus))
      details.push({ field: 'status', message: 'Invalid status' });
    if (body.category !== undefined && !CATEGORIES.includes(body.category as Category))
      details.push({ field: 'category', message: 'Invalid category' });
    if (body.priority !== undefined && !PRIORITIES.includes(body.priority as Priority))
      details.push({ field: 'priority', message: 'Invalid priority' });
    if (body.assigneeId != null && findUser(String(body.assigneeId))?.role !== 'ADMIN')
      details.push({ field: 'assigneeId', message: 'Unknown admin' });
    if (details.length) return fail(400, 'VALIDATION_ERROR', 'Invalid update', details);

    if (body.status !== undefined) t.status = body.status as TicketStatus;
    // Same rules as the backend (docs/CONTRACT_CHANGES.md #8): setting the current value is a no-op,
    // and a category change drops the cached draft.
    if (body.category !== undefined && body.category !== t.category) {
      t.category = body.category as Category;
      t.categoryOverridden = true;
      t.draft = null;
    }
    if (body.priority !== undefined && body.priority !== t.priority) {
      t.priority = body.priority as Priority;
      t.priorityOverridden = true;
    }
    if (body.assigneeId !== undefined) t.assigneeId = body.assigneeId == null ? null : String(body.assigneeId);
    setAndEmit(t, 'ticket.updated');
    return HttpResponse.json(toAdminTicket(t, true));
  }),

  http.post(`${base}/admin/tickets/:id/assign-to-me`, async ({ request, params }) => {
    const user = guard(request, 'ADMIN');
    if (user instanceof Response) return user;
    await delay(250);
    const t = findTicketFor(user, String(params.id));
    if (!t) return fail(404, 'NOT_FOUND', 'Ticket not found');
    t.assigneeId = user.id;
    setAndEmit(t, 'ticket.updated');
    return HttpResponse.json(toAdminTicket(t, true));
  }),

  http.post(`${base}/admin/tickets/:id/notes`, async ({ request, params }) => {
    const user = guard(request, 'ADMIN');
    if (user instanceof Response) return user;
    await delay(250);
    const t = findTicketFor(user, String(params.id));
    if (!t) return fail(404, 'NOT_FOUND', 'Ticket not found');
    const text = str((await readJson(request)).body);
    if (!text) return fail(400, 'VALIDATION_ERROR', 'Note cannot be empty', [{ field: 'body', message: 'Required' }]);
    const note = { id: nextId('n'), adminName: user.name, body: text, createdAt: nowIso() };
    t.internalNotes.push(note);
    persist();
    return HttpResponse.json(note, { status: 201 });
  }),

  http.post(`${base}/admin/tickets/:id/draft`, async ({ request, params }) => {
    const user = guard(request, 'ADMIN');
    if (user instanceof Response) return user;
    const t = findTicketFor(user, String(params.id));
    if (!t) return fail(404, 'NOT_FOUND', 'Ticket not found');
    const { regenerate } = await readJson(request);
    if (t.draft && !regenerate) {
      await delay(150);
      return HttpResponse.json({ draft: t.draft });
    }
    await delay(1200);
    // Simulated outage: forced by env, or for tickets whose classification already failed.
    if (config.mockAiDown || t.aiStatus === 'FAILED') {
      return HttpResponse.json({
        draft: null,
        error: { code: 'AI_UNAVAILABLE', message: 'The AI provider did not respond in time.' },
      });
    }
    t.draft = generateDraft(t);
    persist();
    return HttpResponse.json({ draft: t.draft });
  }),

  http.post(`${base}/admin/tickets/:id/reply`, async ({ request, params }) => {
    const user = guard(request, 'ADMIN');
    if (user instanceof Response) return user;
    await delay(400);
    const t = findTicketFor(user, String(params.id));
    if (!t) return fail(404, 'NOT_FOUND', 'Ticket not found');
    const body = await readJson(request);
    const text = str(body.body);
    if (!text) return fail(400, 'VALIDATION_ERROR', 'Reply cannot be empty', [{ field: 'body', message: 'Required' }]);
    if (body.status !== undefined && !TICKET_STATUSES.includes(body.status as TicketStatus))
      return fail(400, 'VALIDATION_ERROR', 'Invalid status', [{ field: 'status', message: 'Invalid status' }]);
    const message = { id: nextId('m'), senderType: 'ADMIN' as const, senderName: user.name, body: text, createdAt: nowIso() };
    t.messages.push(message);
    // Backend behaviour: with no explicit status, OPEN moves to IN_PROGRESS and an unassigned ticket goes to the replier.
    if (body.status) t.status = body.status as TicketStatus;
    else if (t.status === 'OPEN') t.status = 'IN_PROGRESS';
    if (!t.assigneeId) t.assigneeId = user.id;
    t.draft = null; // the draft has been used; the next open generates a fresh one
    setAndEmit(t, 'ticket.message');
    return HttpResponse.json(message, { status: 201 });
  }),

  http.get(`${base}/admin/admins`, ({ request }) => {
    const user = guard(request, 'ADMIN');
    if (user instanceof Response) return user;
    return HttpResponse.json(db.users.filter((u) => u.role === 'ADMIN').map(({ id, name }) => ({ id, name })));
  }),

  // --- Realtime ---------------------------------------------------------------------------
  http.get(`${base}/events`, ({ request }) => {
    const user = guard(request);
    if (user instanceof Response) return user;
    const encoder = new TextEncoder();
    let cleanup = () => {};
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        const send = (chunk: string) => {
          try {
            controller.enqueue(encoder.encode(chunk));
          } catch {
            cleanup(); // consumer went away
          }
        };
        send(': connected\n\n');
        const unsubscribe = subscribe((type, ticket) => {
          if (canReceive(user, type, ticket)) send(`event: ${type}\ndata: ${JSON.stringify({ ticketId: ticket.id })}\n\n`);
        });
        const heartbeat = setInterval(() => send(': heartbeat\n\n'), 25_000);
        cleanup = () => {
          unsubscribe();
          clearInterval(heartbeat);
        };
        request.signal.addEventListener('abort', () => {
          cleanup();
          try {
            controller.close();
          } catch {
            /* already closed */
          }
        });
      },
      cancel() {
        cleanup();
      },
    });
    return new HttpResponse(stream, {
      headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' },
    });
  }),
];
