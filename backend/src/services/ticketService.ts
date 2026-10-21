import { classifyByKeywords } from "../ai/classifier/keywordFallback";
import { ConflictError, NotFoundError, ValidationError } from "../lib/errors";
import { toAuthorTicket, toAuthorTicketSummary, toMessageDto } from "../mappers/dto";
import type { BookRepository } from "../repositories/bookRepository";
import type { TicketRepository } from "../repositories/ticketRepository";
import type { EventBus } from "../realtime/eventBus";
import type { CreateTicketInput } from "../schemas/ticketSchemas";
import { CLEAR_DRAFT } from "./triageService";

export interface Classifier {
  enqueue(ticketId: string): void;
}

/** Author-facing ticket operations. Every query is scoped by authorId. */
export class TicketService {
  constructor(
    private readonly tickets: TicketRepository,
    private readonly books: BookRepository,
    private readonly queue: Classifier,
    private readonly bus: EventBus,
  ) {}

  async create(authorId: string, input: CreateTicketInput) {
    if (input.bookId) {
      const book = await this.books.findOwned(input.bookId, authorId);
      if (!book) throw new ValidationError("Request validation failed", [{ field: "bookId", message: "Book not found" }]);
    }

    // Provisional, instant triage so the admin queue is sorted sensibly even
    // before (or without) the AI. The async job refines it.
    const provisional = classifyByKeywords(input);
    const ticket = await this.tickets.create({
      authorId,
      bookId: input.bookId,
      subject: input.subject,
      description: input.description,
      attachments: input.attachments,
      category: provisional.category,
      priority: provisional.priority,
    });

    this.bus.publish({ type: "ticket.created", ticketId: ticket.id, authorId });
    this.queue.enqueue(ticket.id); // fire-and-forget: AI failure can never fail ticket creation
    return toAuthorTicket(ticket);
  }

  async list(authorId: string) {
    return (await this.tickets.listForAuthor(authorId)).map(toAuthorTicketSummary);
  }

  async get(ticketId: string, authorId: string) {
    const ticket = await this.tickets.findForAuthor(ticketId, authorId);
    // 404 (not 403) so authors can't probe which ticket ids exist.
    if (!ticket) throw new NotFoundError("Ticket");
    return toAuthorTicket(ticket);
  }

  async addMessage(ticketId: string, author: { authorId: string; userId: string }, body: string) {
    const ticket = await this.tickets.findForAuthor(ticketId, author.authorId);
    if (!ticket) throw new NotFoundError("Ticket");
    if (ticket.status === "CLOSED") {
      throw new ConflictError("This ticket is closed. Please raise a new ticket if you still need help.");
    }

    const message = await this.tickets.addMessage({ ticketId, senderType: "AUTHOR", senderUserId: author.userId, body });
    const reopen = ticket.status === "RESOLVED";
    // A new author message invalidates the cached draft (it no longer answers the latest message).
    await this.tickets.update(ticketId, { ...CLEAR_DRAFT, ...(reopen ? { status: "OPEN" } : {}) });

    this.bus.publish({ type: "ticket.message", ticketId, authorId: author.authorId });
    if (reopen) this.bus.publish({ type: "ticket.updated", ticketId, authorId: author.authorId });
    return toMessageDto(message);
  }
}
