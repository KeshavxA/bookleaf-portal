import type { Logger } from "pino";
import type { Prisma } from "@prisma/client";
import type { TicketClassifier } from "../ai/classifier/classifier";
import type { TicketRepository } from "../repositories/ticketRepository";
import type { EventBus } from "../realtime/eventBus";
import { NotFoundError } from "../lib/errors";

/** Draft fields to clear whenever the context a draft was written for changes. */
export const CLEAR_DRAFT = { draftBody: null, draftSource: null, draftGeneratedAt: null } as const;

/**
 * Runs AI classification for a ticket (called from the background queue) and
 * applies the result without ever clobbering an admin override.
 */
export class TriageService {
  constructor(
    private readonly tickets: TicketRepository,
    private readonly classifier: TicketClassifier,
    private readonly bus: EventBus,
    private readonly log: Logger,
  ) {}

  async classifyTicket(ticketId: string): Promise<void> {
    const t = await this.tickets.findForClassification(ticketId);
    if (!t) return; // deleted meanwhile

    const outcome = await this.classifier.classify(
      { subject: t.subject, description: t.description, book: t.book },
      ticketId,
    );

    const data: Prisma.TicketUncheckedUpdateInput = { aiClassifiedAt: new Date() };
    if (outcome.source === "AI") {
      Object.assign(data, {
        aiStatus: "DONE",
        aiCategory: outcome.suggestion.category,
        aiPriority: outcome.suggestion.priority,
        aiReasoning: outcome.suggestion.reasoning,
        aiError: null,
      });
    } else {
      // Ticket keeps working with keyword triage; aiStatus FAILED flags it for manual triage.
      Object.assign(data, {
        aiStatus: "FAILED",
        aiCategory: null,
        aiPriority: null,
        aiReasoning: null,
        aiError: `${outcome.errorCode}: ${outcome.errorMessage}`.slice(0, 500),
      });
      this.log.warn({ ticketId, code: outcome.errorCode }, "AI classification failed; using keyword fallback");
    }
    if (!t.categoryOverridden) {
      data.category = outcome.category;
      if (outcome.category !== t.category) Object.assign(data, CLEAR_DRAFT);
    }
    if (!t.priorityOverridden) data.priority = outcome.priority;

    const updated = await this.tickets.update(ticketId, data);
    this.bus.publish({ type: "ticket.ai_ready", ticketId, authorId: updated.authorId });
  }

  /** Admin "retry AI": mark PENDING and hand back to the queue. */
  async markForReclassification(ticketId: string): Promise<void> {
    const t = await this.tickets.findById(ticketId);
    if (!t) throw new NotFoundError("Ticket");
    await this.tickets.update(ticketId, { aiStatus: "PENDING", aiError: null });
    this.bus.publish({ type: "ticket.updated", ticketId, authorId: t.authorId, adminOnly: true });
  }
}
