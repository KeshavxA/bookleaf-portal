import type { Prisma, TicketStatus } from "@prisma/client";
import { NotFoundError, ValidationError } from "../lib/errors";
import { toAdminTicket, toAdminTicketSummary, toMessageDto, toNoteDto } from "../mappers/dto";
import type { AdminTicketFilters, TicketRepository } from "../repositories/ticketRepository";
import type { UserRepository } from "../repositories/userRepository";
import type { EventBus } from "../realtime/eventBus";
import type { UpdateTicketInput } from "../schemas/adminSchemas";
import type { Classifier } from "./ticketService";
import { CLEAR_DRAFT, type TriageService } from "./triageService";

export class AdminTicketService {
  constructor(
    private readonly tickets: TicketRepository,
    private readonly users: UserRepository,
    private readonly triage: TriageService,
    private readonly queue: Classifier,
    private readonly bus: EventBus,
  ) {}

  async list(filters: AdminTicketFilters) {
    const { items, total } = await this.tickets.listForAdmin(filters);
    return { items: items.map(toAdminTicketSummary), total, page: filters.page, pageSize: filters.pageSize };
  }

  async get(ticketId: string) {
    const ticket = await this.tickets.findAdminDetail(ticketId);
    if (!ticket) throw new NotFoundError("Ticket");
    return toAdminTicket(ticket);
  }

  async update(ticketId: string, patch: UpdateTicketInput) {
    const ticket = await this.requireTicket(ticketId);
    const data: Prisma.TicketUncheckedUpdateInput = {};
    let authorVisible = false;

    if (patch.status && patch.status !== ticket.status) {
      data.status = patch.status;
      authorVisible = true;
    }
    if (patch.category && patch.category !== ticket.category) {
      Object.assign(data, { category: patch.category, categoryOverridden: true, ...CLEAR_DRAFT });
    }
    if (patch.priority && patch.priority !== ticket.priority) {
      Object.assign(data, { priority: patch.priority, priorityOverridden: true });
    }
    if (patch.assigneeId !== undefined && patch.assigneeId !== ticket.assigneeId) {
      if (patch.assigneeId !== null && !(await this.users.isAdmin(patch.assigneeId))) {
        throw new ValidationError("Request validation failed", [
          { field: "assigneeId", message: "Assignee must be an admin user" },
        ]);
      }
      data.assigneeId = patch.assigneeId;
    }

    if (Object.keys(data).length > 0) {
      await this.tickets.update(ticketId, data);
      this.bus.publish({ type: "ticket.updated", ticketId, authorId: ticket.authorId, adminOnly: !authorVisible });
    }
    return this.get(ticketId);
  }

  async assignToMe(ticketId: string, adminId: string) {
    return this.update(ticketId, { assigneeId: adminId });
  }

  async addNote(ticketId: string, adminId: string, body: string) {
    const ticket = await this.requireTicket(ticketId);
    const note = await this.tickets.addNote({ ticketId, adminId, body });
    this.bus.publish({ type: "ticket.updated", ticketId, authorId: ticket.authorId, adminOnly: true });
    return toNoteDto(note);
  }

  /**
   * Sends a reply the author can see. Sensible defaults for a support desk:
   * an OPEN ticket moves to IN_PROGRESS unless a status is given, and an
   * unassigned ticket is assigned to the replying admin.
   */
  async reply(ticketId: string, adminId: string, body: string, status?: TicketStatus) {
    const ticket = await this.requireTicket(ticketId);
    const message = await this.tickets.addMessage({ ticketId, senderType: "ADMIN", senderUserId: adminId, body });

    const nextStatus = status ?? (ticket.status === "OPEN" ? "IN_PROGRESS" : ticket.status);
    await this.tickets.update(ticketId, {
      ...CLEAR_DRAFT, // the draft has been used (or superseded)
      ...(nextStatus !== ticket.status ? { status: nextStatus } : {}),
      ...(ticket.assigneeId ? {} : { assigneeId: adminId }),
    });

    this.bus.publish({ type: "ticket.message", ticketId, authorId: ticket.authorId });
    if (nextStatus !== ticket.status) this.bus.publish({ type: "ticket.updated", ticketId, authorId: ticket.authorId });
    return toMessageDto(message);
  }

  listAdmins() {
    return this.users.listAdmins();
  }

  /** Admin retry after an AI failure (or to re-run after editing context). */
  async reclassify(ticketId: string) {
    await this.triage.markForReclassification(ticketId);
    this.queue.enqueue(ticketId);
    return this.get(ticketId);
  }

  private async requireTicket(ticketId: string) {
    const ticket = await this.tickets.findById(ticketId);
    if (!ticket) throw new NotFoundError("Ticket");
    return ticket;
  }
}
