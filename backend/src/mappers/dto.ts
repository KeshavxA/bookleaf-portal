/**
 * Response DTOs exactly as defined in docs/API_CONTRACT.md.
 * Author-facing mappers never touch AI, triage, assignee or note fields.
 */
import type { Book, InternalNote, TicketMessage } from "@prisma/client";
import { toIsoDate } from "../lib/dates";
import type {
  AdminTicketDetailRow,
  AdminTicketRow,
  AuthorTicketDetailRow,
  AuthorTicketRow,
} from "../repositories/ticketRepository";

type Attachment = { name: string; size: number };

export function toBookDto(b: Book) {
  return {
    id: b.id,
    title: b.title,
    isbn: b.isbn,
    genre: b.genre,
    publicationDate: toIsoDate(b.publicationDate),
    status: b.status,
    mrp: b.mrp,
    totalCopiesSold: b.totalCopiesSold,
    totalRoyaltyEarned: b.totalRoyaltyEarned,
    royaltyPaid: b.royaltyPaid,
    royaltyPending: b.royaltyPending,
    lastRoyaltyPayoutDate: toIsoDate(b.lastRoyaltyPayoutDate),
    printPartner: b.printPartner,
    availableOn: b.availableOn,
  };
}

export function toMessageDto(m: TicketMessage & { sender: { name: string } }) {
  return {
    id: m.id,
    senderType: m.senderType,
    senderName: m.sender.name,
    body: m.body,
    createdAt: m.createdAt.toISOString(),
  };
}

export function toNoteDto(n: InternalNote & { admin: { name: string } }) {
  return { id: n.id, adminName: n.admin.name, body: n.body, createdAt: n.createdAt.toISOString() };
}

function baseTicket(t: AuthorTicketRow | AdminTicketRow) {
  return {
    id: t.id,
    ticketNumber: t.ticketNumber,
    subject: t.subject,
    description: t.description,
    status: t.status,
    book: t.book ? { id: t.book.id, title: t.book.title } : null,
    attachments: (t.attachments as Attachment[] | null) ?? [],
    createdAt: t.createdAt.toISOString(),
    updatedAt: t.updatedAt.toISOString(),
  };
}

/** List variant: messages omitted (contract). */
export function toAuthorTicketSummary(t: AuthorTicketRow) {
  return baseTicket(t);
}

export function toAuthorTicket(t: AuthorTicketDetailRow) {
  return { ...baseTicket(t), messages: t.messages.map(toMessageDto) };
}

function adminFields(t: AdminTicketRow) {
  return {
    category: t.category,
    priority: t.priority,
    aiStatus: t.aiStatus,
    aiSuggestion:
      t.aiCategory && t.aiPriority
        ? { category: t.aiCategory, priority: t.aiPriority, reasoning: t.aiReasoning ?? "" }
        : null,
    categoryOverridden: t.categoryOverridden,
    priorityOverridden: t.priorityOverridden,
    author: { id: t.author.id, name: t.author.user.name, email: t.author.user.email },
    assignee: t.assignee ? { id: t.assignee.id, name: t.assignee.name } : null,
    internalNotes: t.internalNotes.map(toNoteDto),
    draft:
      t.draftBody && t.draftSource && t.draftGeneratedAt
        ? { body: t.draftBody, source: t.draftSource, generatedAt: t.draftGeneratedAt.toISOString() }
        : null,
  };
}

/** List variant: messages omitted (contract). */
export function toAdminTicketSummary(t: AdminTicketRow) {
  return { ...baseTicket(t), ...adminFields(t) };
}

export function toAdminTicket(t: AdminTicketDetailRow) {
  return { ...baseTicket(t), messages: t.messages.map(toMessageDto), ...adminFields(t) };
}

export type AdminTicketDto = ReturnType<typeof toAdminTicket>;
