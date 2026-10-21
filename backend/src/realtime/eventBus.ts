import { EventEmitter } from "node:events";

export type TicketEventType = "ticket.created" | "ticket.updated" | "ticket.message" | "ticket.ai_ready";

export interface TicketEvent {
  type: TicketEventType;
  ticketId: string;
  /** Owner of the ticket; used for role scoping, never sent to clients. */
  authorId: string;
  /** Set for changes authors can't see (internal notes, drafts, triage overrides). */
  adminOnly?: boolean;
}

/** Events only admins may see (contract): authors never learn about triage/AI activity. */
export const ADMIN_ONLY_EVENTS: ReadonlySet<TicketEventType> = new Set(["ticket.created", "ticket.ai_ready"]);

/**
 * In-process pub/sub. Services publish domain events; the SSE hub fans them out.
 * Swapping this for Redis pub/sub is the only change needed to run multiple instances.
 */
export class EventBus {
  private readonly emitter = new EventEmitter();

  constructor() {
    this.emitter.setMaxListeners(0);
  }

  publish(event: TicketEvent): void {
    this.emitter.emit("ticket", event);
  }

  subscribe(listener: (event: TicketEvent) => void): () => void {
    this.emitter.on("ticket", listener);
    return () => this.emitter.off("ticket", listener);
  }
}
