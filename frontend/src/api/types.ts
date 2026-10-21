// Types mirror docs/API_CONTRACT.md (v1). Keep this file in lockstep with the contract.

export const TICKET_STATUSES = ['OPEN', 'IN_PROGRESS', 'RESOLVED', 'CLOSED'] as const;
export type TicketStatus = (typeof TICKET_STATUSES)[number];

export const CATEGORIES = [
  'ROYALTY_PAYMENTS',
  'ISBN_METADATA',
  'PRINTING_QUALITY',
  'DISTRIBUTION_AVAILABILITY',
  'BOOK_STATUS_PRODUCTION',
  'GENERAL_INQUIRY',
] as const;
export type Category = (typeof CATEGORIES)[number];

export const PRIORITIES = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'] as const;
export type Priority = (typeof PRIORITIES)[number];

export type AiStatus = 'PENDING' | 'DONE' | 'FAILED';
export type Role = 'AUTHOR' | 'ADMIN';

export type ErrorCode =
  | 'VALIDATION_ERROR'
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'RATE_LIMITED'
  | 'INTERNAL';

export interface ApiErrorBody {
  error: { code: ErrorCode; message: string; details?: unknown[] };
}

export interface User {
  id: string;
  name: string;
  email: string;
  role: Role;
}

export interface LoginResponse {
  token: string;
  user: User;
}

export interface Book {
  id: string;
  title: string;
  isbn: string;
  genre: string;
  publicationDate: string | null;
  status: string;
  mrp: number | null;
  totalCopiesSold: number;
  totalRoyaltyEarned: number;
  royaltyPaid: number;
  royaltyPending: number;
  lastRoyaltyPayoutDate: string | null;
  printPartner: string | null;
  availableOn: string[];
}

export interface Message {
  id: string;
  senderType: 'AUTHOR' | 'ADMIN';
  senderName: string;
  body: string;
  createdAt: string;
}

export interface Attachment {
  name: string;
  size: number;
}

export interface AuthorTicket {
  id: string;
  /** The contract leaves the type open; the backend sends an integer. Display via formatTicketNumber. */
  ticketNumber: number | string;
  subject: string;
  description: string;
  status: TicketStatus;
  book: { id: string; title: string } | null;
  attachments: Attachment[];
  /** Omitted on list endpoints. */
  messages?: Message[];
  createdAt: string;
  updatedAt: string;
}

export interface InternalNote {
  id: string;
  adminName: string;
  body: string;
  createdAt: string;
}

export interface Draft {
  body: string;
  source: 'AI' | 'FALLBACK';
  generatedAt: string;
}

export interface AdminTicket extends AuthorTicket {
  category: Category;
  priority: Priority;
  aiStatus: AiStatus;
  aiSuggestion: { category: Category; priority: Priority; reasoning: string } | null;
  categoryOverridden: boolean;
  priorityOverridden: boolean;
  author: { id: string; name: string; email: string };
  assignee: { id: string; name: string } | null;
  internalNotes?: InternalNote[];
  draft?: Draft | null;
}

export interface Paginated<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

export interface CreateTicketInput {
  bookId: string | null;
  subject: string;
  description: string;
  attachments?: Attachment[];
}

export type QueueSort = 'urgency' | 'oldest' | 'newest';

export interface AdminTicketQuery {
  status?: TicketStatus;
  category?: Category;
  priority?: Priority;
  assigneeId?: string;
  from?: string;
  to?: string;
  q?: string;
  sort?: QueueSort;
  page?: number;
  pageSize?: number;
}

export interface UpdateTicketInput {
  status?: TicketStatus;
  category?: Category;
  priority?: Priority;
  assigneeId?: string | null;
}

export interface DraftResponse {
  draft: Draft | null;
  error?: { code: string; message: string };
}

export interface ReplyInput {
  body: string;
  status?: TicketStatus;
}

export interface AdminSummary {
  id: string;
  name: string;
}

export const TICKET_EVENTS = [
  'ticket.created',
  'ticket.updated',
  'ticket.message',
  'ticket.ai_ready',
] as const;
export type TicketEventType = (typeof TICKET_EVENTS)[number];
export interface TicketEvent {
  type: TicketEventType;
  ticketId: string;
}
