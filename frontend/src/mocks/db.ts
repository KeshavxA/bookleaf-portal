import type {
  AdminTicket,
  AiStatus,
  Attachment,
  AuthorTicket,
  Book,
  Category,
  Draft,
  InternalNote,
  Message,
  Priority,
  TicketEventType,
  TicketStatus,
  User,
} from '@/api/types';
import { buildSeedDb } from './seed';

// In-browser stand-in for the backend database. Persisted to localStorage so the demo survives
// reloads and switching between author and admin accounts in the same tab.

export type MockUser = User;

export interface MockTicket {
  id: string;
  ticketNumber: number;
  authorId: string;
  bookId: string | null;
  subject: string;
  description: string;
  status: TicketStatus;
  attachments: Attachment[];
  messages: Message[];
  createdAt: string;
  updatedAt: string;
  category: Category;
  priority: Priority;
  aiStatus: AiStatus;
  aiSuggestion: { category: Category; priority: Priority; reasoning: string } | null;
  categoryOverridden: boolean;
  priorityOverridden: boolean;
  assigneeId: string | null;
  internalNotes: InternalNote[];
  draft: Draft | null;
}

export interface MockDb {
  version: 2;
  users: MockUser[];
  books: Record<string, Book[]>;
  tickets: MockTicket[];
  seq: number;
}

const STORAGE_KEY = 'bookleaf.mockdb.v2';

function load(): MockDb {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as MockDb;
      if (parsed.version === 2) return parsed;
    }
  } catch {
    /* fall through to a fresh seed */
  }
  return buildSeedDb();
}

export const db: MockDb = load();

export function persist() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(db));
  } catch {
    /* storage full or blocked: the demo still works in memory */
  }
}

export function resetMockDb() {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
}

export const nextId = (prefix: string) => `${prefix}-${++db.seq}`;
export const nowIso = () => new Date().toISOString();

export const findUser = (id: string) => db.users.find((u) => u.id === id);
export const findBook = (bookId: string | null) => {
  if (!bookId) return null;
  for (const list of Object.values(db.books)) {
    const b = list.find((x) => x.id === bookId);
    if (b) return b;
  }
  return null;
};

export function toAuthorTicket(t: MockTicket, withMessages: boolean): AuthorTicket {
  const book = findBook(t.bookId);
  const base: AuthorTicket = {
    id: t.id,
    ticketNumber: t.ticketNumber,
    subject: t.subject,
    description: t.description,
    status: t.status,
    book: book ? { id: book.id, title: book.title } : null,
    attachments: t.attachments,
    createdAt: t.createdAt,
    updatedAt: t.updatedAt,
  };
  return withMessages ? { ...base, messages: t.messages } : base;
}

export function toAdminTicket(t: MockTicket, detail: boolean): AdminTicket {
  const author = findUser(t.authorId)!;
  const assignee = t.assigneeId ? findUser(t.assigneeId) : null;
  const ticket: AdminTicket = {
    ...toAuthorTicket(t, detail),
    category: t.category,
    priority: t.priority,
    aiStatus: t.aiStatus,
    aiSuggestion: t.aiSuggestion,
    categoryOverridden: t.categoryOverridden,
    priorityOverridden: t.priorityOverridden,
    author: { id: author.id, name: author.name, email: author.email },
    assignee: assignee ? { id: assignee.id, name: assignee.name } : null,
  };
  return detail ? { ...ticket, internalNotes: t.internalNotes, draft: t.draft } : ticket;
}

// --- Event bus feeding the mock SSE stream -------------------------------------------------

type Listener = (type: TicketEventType, ticket: MockTicket) => void;
const listeners = new Set<Listener>();

export function subscribe(listener: Listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function emit(type: TicketEventType, ticket: MockTicket) {
  for (const l of [...listeners]) l(type, ticket);
}

/** Mirrors the contract's scoping: authors only hear about their own tickets, never admin-only events. */
export function canReceive(user: MockUser, type: TicketEventType, ticket: MockTicket) {
  if (user.role === 'ADMIN') return true;
  if (type === 'ticket.created' || type === 'ticket.ai_ready') return false;
  return ticket.authorId === user.id;
}

export function touch(t: MockTicket) {
  t.updatedAt = nowIso();
  persist();
}
