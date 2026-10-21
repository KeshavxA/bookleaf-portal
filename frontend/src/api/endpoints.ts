import { api } from './client';
import type {
  AdminSummary,
  AdminTicket,
  AdminTicketQuery,
  AuthorTicket,
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
  me: () => api<User>('/auth/me'),
};

export const authorApi = {
  books: () => api<Book[]>('/books'),
  tickets: () => api<AuthorTicket[]>('/tickets'),
  ticket: (id: string) => api<AuthorTicket>(`/tickets/${encodeURIComponent(id)}`),
  createTicket: (input: CreateTicketInput) => api<AuthorTicket>('/tickets', { method: 'POST', body: input }),
  addMessage: (id: string, body: string) =>
    api<Message>(`/tickets/${encodeURIComponent(id)}/messages`, { method: 'POST', body: { body } }),
};

const t = (id: string) => `/admin/tickets/${encodeURIComponent(id)}`;

export const adminApi = {
  tickets: (query: AdminTicketQuery) =>
    api<Paginated<AdminTicket>>('/admin/tickets', { query: query as Record<string, unknown> }),
  ticket: (id: string) => api<AdminTicket>(t(id)),
  update: (id: string, input: UpdateTicketInput) => api<AdminTicket>(t(id), { method: 'PATCH', body: input }),
  assignToMe: (id: string) => api<AdminTicket>(`${t(id)}/assign-to-me`, { method: 'POST' }),
  addNote: (id: string, body: string) => api<InternalNote>(`${t(id)}/notes`, { method: 'POST', body: { body } }),
  draft: (id: string, regenerate = false) =>
    api<DraftResponse>(`${t(id)}/draft`, { method: 'POST', body: regenerate ? { regenerate: true } : {} }),
  reply: (id: string, input: ReplyInput) => api<Message>(`${t(id)}/reply`, { method: 'POST', body: input }),
  admins: () => api<AdminSummary[]>('/admin/admins'),
};
