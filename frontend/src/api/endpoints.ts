import { api } from './client';
import type {
  AdminSummary,
  AdminTicket,
  AdminTicketQuery,
  AdminTicketSummary,
  AuthorTicket,
  AuthorTicketSummary,
  Book,
  CreateTicketInput,
  DraftResponse,
  InternalNote,
  LoginResponse,
  Message,
  Paginated,
  ReplyInput,
  UpdateTicketInput,
  User,
} from './types';

export const authApi = {
  login: (email: string, password: string) =>
    api<LoginResponse>('/auth/login', { method: 'POST', body: { email, password } }),
  /** Pass a token to check who it belongs to without making it the tab's token. */
  me: (token?: string) => api<User>('/auth/me', { token }),
};

export const authorApi = {
  books: () => api<Book[]>('/books'),
  tickets: () => api<AuthorTicketSummary[]>('/tickets'),
  ticket: (id: string) => api<AuthorTicket>(`/tickets/${encodeURIComponent(id)}`),
  createTicket: (input: CreateTicketInput) => api<AuthorTicket>('/tickets', { method: 'POST', body: input }),
  addMessage: (id: string, body: string) =>
    api<Message>(`/tickets/${encodeURIComponent(id)}/messages`, { method: 'POST', body: { body } }),
};

const t = (id: string) => `/admin/tickets/${encodeURIComponent(id)}`;

/** Multi-value filters go over the wire comma-separated; empty lists are dropped. */
function serializeQuery(q: AdminTicketQuery): Record<string, unknown> {
  const csv = (v?: string[]) => (v && v.length ? v.join(',') : undefined);
  return { ...q, status: csv(q.status), category: csv(q.category), priority: csv(q.priority) };
}

export const adminApi = {
  tickets: (query: AdminTicketQuery) =>
    api<Paginated<AdminTicketSummary>>('/admin/tickets', { query: serializeQuery(query) }),
  ticket: (id: string) => api<AdminTicket>(t(id)),
  update: (id: string, input: UpdateTicketInput) => api<AdminTicket>(t(id), { method: 'PATCH', body: input }),
  assignToMe: (id: string) => api<AdminTicket>(`${t(id)}/assign-to-me`, { method: 'POST' }),
  /** Retries AI classification: 202 with aiStatus PENDING; ticket.ai_ready fires when done. */
  classify: (id: string) => api<AdminTicket>(`${t(id)}/classify`, { method: 'POST' }),
  addNote: (id: string, body: string) => api<InternalNote>(`${t(id)}/notes`, { method: 'POST', body: { body } }),
  draft: (id: string, regenerate = false) =>
    api<DraftResponse>(`${t(id)}/draft`, { method: 'POST', body: regenerate ? { regenerate: true } : {} }),
  reply: (id: string, input: ReplyInput) => api<Message>(`${t(id)}/reply`, { method: 'POST', body: input }),
  admins: () => api<AdminSummary[]>('/admin/admins'),
};
