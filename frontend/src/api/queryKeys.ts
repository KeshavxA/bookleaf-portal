import type { AdminTicketQuery } from './types';

export const qk = {
  me: ['me'] as const,
  books: ['books'] as const,
  tickets: ['tickets'] as const,
  ticket: (id: string) => ['tickets', id] as const,
  admin: {
    all: ['admin'] as const,
    lists: ['admin', 'tickets', 'list'] as const,
    list: (q: AdminTicketQuery) => ['admin', 'tickets', 'list', q] as const,
    ticket: (id: string) => ['admin', 'tickets', 'detail', id] as const,
    draft: (id: string) => ['admin', 'tickets', 'draft', id] as const,
    admins: ['admin', 'admins'] as const,
  },
};
