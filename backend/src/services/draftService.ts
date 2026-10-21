import type { Logger } from "pino";
import type { TicketDrafter } from "../ai/drafter/drafter";
import type { DraftContext } from "../ai/drafter/types";
import { LlmError } from "../ai/llm/types";
import { NotFoundError } from "../lib/errors";
import type { TicketRepository } from "../repositories/ticketRepository";
import type { EventBus } from "../realtime/eventBus";

export interface DraftDto {
  body: string;
  source: "AI";
  generatedAt: string;
}

export interface DraftResponse {
  draft: DraftDto | null;
  error?: { code: string; message: string };
}

const FRIENDLY_ERRORS: Partial<Record<LlmError["code"], string>> = {
  DISABLED: "AI drafting is not configured on this server. Please write the reply manually.",
  CIRCUIT_OPEN: "The AI service is temporarily unavailable. Please write the reply manually or retry in a minute.",
  TIMEOUT: "The AI service took too long to respond. Please retry or write the reply manually.",
  RATE_LIMITED: "The AI service is busy right now. Please retry shortly or write the reply manually.",
};

export class DraftService {
  /** Concurrent requests for the same ticket share one LLM call. */
  private readonly inFlight = new Map<string, Promise<DraftResponse>>();

  constructor(
    private readonly tickets: TicketRepository,
    private readonly drafter: TicketDrafter,
    private readonly bus: EventBus,
    private readonly log: Logger,
  ) {}

  async getDraft(ticketId: string, regenerate: boolean): Promise<DraftResponse> {
    const ticket = await this.tickets.findById(ticketId);
    if (!ticket) throw new NotFoundError("Ticket");

    // Cache hit: the draft is cleared whenever a new author message arrives or the category changes.
    if (!regenerate && ticket.draftBody && ticket.draftSource && ticket.draftGeneratedAt) {
      return {
        draft: { body: ticket.draftBody, source: ticket.draftSource, generatedAt: ticket.draftGeneratedAt.toISOString() },
      };
    }

    const existing = this.inFlight.get(ticketId);
    if (existing) return existing;
    const job = this.generate(ticketId).finally(() => this.inFlight.delete(ticketId));
    this.inFlight.set(ticketId, job);
    return job;
  }

  private async generate(ticketId: string): Promise<DraftResponse> {
    const row = await this.tickets.findForDraft(ticketId);
    if (!row) throw new NotFoundError("Ticket");

    const ctx: DraftContext = {
      ticket: {
        id: row.id,
        ticketNumber: row.ticketNumber,
        subject: row.subject,
        description: row.description,
        status: row.status,
        category: row.category,
        createdAt: row.createdAt,
      },
      author: { name: row.author.user.name, bankLinked: row.author.bankLinked, books: row.author.books },
      book: row.book,
      thread: row.messages.map((m) => ({
        senderType: m.senderType,
        senderName: m.sender.name,
        body: m.body,
        createdAt: m.createdAt,
      })),
    };

    try {
      const result = await this.drafter.draft(ctx);
      if (result.ungroundedNumbers.length > 0) {
        this.log.warn({ ticketId, numbers: result.ungroundedNumbers }, "Draft contains numbers not present in its sources");
      }
      const generatedAt = new Date();
      await this.tickets.update(ticketId, { draftBody: result.body, draftSource: "AI", draftGeneratedAt: generatedAt });
      this.bus.publish({ type: "ticket.updated", ticketId, authorId: row.authorId, adminOnly: true });
      return { draft: { body: result.body, source: "AI", generatedAt: generatedAt.toISOString() } };
    } catch (err) {
      if (!(err instanceof LlmError)) throw err;
      this.log.warn({ ticketId, code: err.code }, "AI draft failed; admin will reply manually");
      return {
        draft: null,
        error: {
          code: `AI_${err.code}`,
          message: FRIENDLY_ERRORS[err.code] ?? "The AI draft could not be generated. Please write the reply manually.",
        },
      };
    }
  }
}
