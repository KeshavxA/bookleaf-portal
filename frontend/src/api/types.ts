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

/** field is a dotted path (e.g. "attachments.0.size") or "(root)" for whole-body errors. */
export interface ErrorDetail {
  field: string;
  message: string;
}

export interface ApiErrorBody {
  error: { code: ErrorCode; message: string; details?: ErrorDetail[] };
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

/** List shape (GET /tickets): the contract omits the "messages" key entirely. */
export interface AuthorTicketSummary {
  id: string;
  /** Integer, auto-increment from 1. Display with formatTicketNumber ("#42"). */
  ticketNumber: number;
  subject: string;
  description: string;
  status: TicketStatus;
  book: { id: string; title: string } | null;
  attachments: Attachment[];
  createdAt: string;
  updatedAt: string;
}

/** Single-ticket shape (GET /tickets/:id, POST /tickets). */
export interface AuthorTicket extends AuthorTicketSummary {
  messages: Message[];
}

export interface InternalNote {
  id: string;
  adminName: string;
  body: string;
  createdAt: string;
}

export interface Draft {
  body: string;
  source: 'AI';
  generatedAt: string;
}

export interface AiSuggestion {
  category: Category;
  priority: Priority;
  reasoning: string;
}

/** List shape (GET /admin/tickets items): everything except the "messages" key. */
export interface AdminTicketSummary extends AuthorTicketSummary {
  category: Category;
  priority: Priority;
  aiStatus: AiStatus;
  aiSuggestion: AiSuggestion | null;
  categoryOverridden: boolean;
  priorityOverridden: boolean;
  author: { id: string; name: string; email: string };
  assignee: { id: string; name: string } | null;
  internalNotes: InternalNote[];
  draft: Draft | null;
}

/** Single-ticket shape (GET/PATCH /admin/tickets/:id and the action endpoints). */
export interface AdminTicket extends AdminTicketSummary {
  messages: Message[];
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

/** "me" and "unassigned" are special assigneeId values; anything else is a user id. */
export type AssigneeFilter = 'me' | 'unassigned' | (string & {});

export interface AdminTicketQuery {
  /** Multi-value filters are sent comma-separated (?status=OPEN,IN_PROGRESS). */
  status?: TicketStatus[];
  category?: Category[];
  priority?: Priority[];
  assigneeId?: AssigneeFilter;
  /** Bare dates (yyyy-mm-dd). The server reads them in UTC; a bare "to" covers that whole day. */
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
