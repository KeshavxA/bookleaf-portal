import { Prisma, type Category, type Priority, type TicketStatus } from "@prisma/client";
import type { Db } from "../lib/prisma";
import { isOpenStatus } from "../domain/enums";

const messagesInclude = {
  orderBy: { createdAt: "asc" },
  include: { sender: { select: { name: true } } },
} satisfies Prisma.Ticket$messagesArgs;

const authorTicketBase = {
  book: { select: { id: true, title: true } },
} satisfies Prisma.TicketInclude;

export const authorTicketDetailInclude = {
  ...authorTicketBase,
  messages: messagesInclude,
} satisfies Prisma.TicketInclude;

const adminTicketBase = {
  book: { select: { id: true, title: true } },
  author: { select: { id: true, user: { select: { name: true, email: true } } } },
  assignee: { select: { id: true, name: true } },
  internalNotes: { orderBy: { createdAt: "asc" }, include: { admin: { select: { name: true } } } },
} satisfies Prisma.TicketInclude;

export const adminTicketDetailInclude = {
  ...adminTicketBase,
  messages: messagesInclude,
} satisfies Prisma.TicketInclude;

export type AuthorTicketRow = Prisma.TicketGetPayload<{ include: typeof authorTicketBase }>;
export type AuthorTicketDetailRow = Prisma.TicketGetPayload<{ include: typeof authorTicketDetailInclude }>;
export type AdminTicketRow = Prisma.TicketGetPayload<{ include: typeof adminTicketBase }>;
export type AdminTicketDetailRow = Prisma.TicketGetPayload<{ include: typeof adminTicketDetailInclude }>;

export interface AdminTicketFilters {
  status?: TicketStatus[];
  category?: Category[];
  priority?: Priority[];
  /** A user id, or null for "unassigned". */
  assigneeId?: string | null;
  from?: Date;
  to?: Date;
  q?: string;
  sort: "urgency" | "oldest" | "newest";
  page: number;
  pageSize: number;
}

export interface NewTicket {
  authorId: string;
  bookId: string | null;
  subject: string;
  description: string;
  attachments: Array<{ name: string; size: number }>;
  category: Category;
  priority: Priority;
}

export class TicketRepository {
  constructor(private readonly db: Db) {}

  create(data: NewTicket) {
    return this.db.ticket.create({
      data: { ...data, attachments: data.attachments, status: "OPEN", isOpen: true, aiStatus: "PENDING" },
      include: authorTicketDetailInclude,
    });
  }

  findById(id: string) {
    return this.db.ticket.findUnique({ where: { id } });
  }

  findForAuthor(id: string, authorId: string) {
    return this.db.ticket.findFirst({ where: { id, authorId }, include: authorTicketDetailInclude });
  }

  listForAuthor(authorId: string) {
    return this.db.ticket.findMany({
      where: { authorId },
      orderBy: { createdAt: "desc" },
      include: authorTicketBase,
    });
  }

  findAdminDetail(id: string) {
    return this.db.ticket.findUnique({ where: { id }, include: adminTicketDetailInclude });
  }

  async listForAdmin(f: AdminTicketFilters): Promise<{ items: AdminTicketRow[]; total: number }> {
    const where = buildAdminWhere(f);
    const orderBy: Prisma.TicketOrderByWithRelationInput[] =
      f.sort === "oldest"
        ? [{ createdAt: "asc" }]
        : f.sort === "newest"
          ? [{ createdAt: "desc" }]
          : // urgency: unresolved first, then CRITICAL..LOW (enum order), then oldest first
            [{ isOpen: "desc" }, { priority: "asc" }, { createdAt: "asc" }];

    const [items, total] = await this.db.$transaction([
      this.db.ticket.findMany({
        where,
        orderBy,
        skip: (f.page - 1) * f.pageSize,
        take: f.pageSize,
        include: adminTicketBase,
      }),
      this.db.ticket.count({ where }),
    ]);
    return { items, total };
  }

  /** The single write path for tickets: keeps the denormalized isOpen flag in sync with status. */
  update(id: string, data: Prisma.TicketUncheckedUpdateInput) {
    const patch = { ...data };
    if (typeof data.status === "string") patch.isOpen = isOpenStatus(data.status);
    return this.db.ticket.update({ where: { id }, data: patch });
  }

  /**
   * Atomically moves a ticket to aiStatus PENDING unless it already is.
   * Returns false when a classification is already queued or running.
   */
  async markClassificationPending(id: string): Promise<boolean> {
    const { count } = await this.db.ticket.updateMany({
      where: { id, aiStatus: { not: "PENDING" } },
      data: { aiStatus: "PENDING", aiError: null },
    });
    return count === 1;
  }

  addMessage(data: { ticketId: string; senderType: "AUTHOR" | "ADMIN"; senderUserId: string; body: string }) {
    return this.db.ticketMessage.create({ data, include: { sender: { select: { name: true } } } });
  }

  addNote(data: { ticketId: string; adminId: string; body: string }) {
    return this.db.internalNote.create({ data, include: { admin: { select: { name: true } } } });
  }

  findPendingClassificationIds() {
    return this.db.ticket
      .findMany({ where: { aiStatus: "PENDING" }, select: { id: true }, orderBy: { createdAt: "asc" } })
      .then((rows) => rows.map((r) => r.id));
  }

  /** Everything the classifier needs - deliberately minimal. */
  findForClassification(id: string) {
    return this.db.ticket.findUnique({
      where: { id },
      select: {
        id: true,
        subject: true,
        description: true,
        category: true,
        categoryOverridden: true,
        priorityOverridden: true,
        book: { select: { title: true, status: true } },
      },
    });
  }

  /** Everything the drafter needs: the ticket, its book, the author's book list and the thread. */
  findForDraft(id: string) {
    return this.db.ticket.findUnique({
      where: { id },
      include: {
        book: true,
        author: {
          select: {
            bankLinked: true,
            user: { select: { name: true } },
            books: { select: { title: true, status: true }, orderBy: { title: "asc" } },
          },
        },
        messages: messagesInclude,
      },
    });
  }
}

function buildAdminWhere(f: AdminTicketFilters): Prisma.TicketWhereInput {
  const and: Prisma.TicketWhereInput[] = [];
  if (f.status?.length) and.push({ status: { in: f.status } });
  if (f.category?.length) and.push({ category: { in: f.category } });
  if (f.priority?.length) and.push({ priority: { in: f.priority } });
  if (f.assigneeId !== undefined) and.push({ assigneeId: f.assigneeId });
  if (f.from || f.to) and.push({ createdAt: { ...(f.from ? { gte: f.from } : {}), ...(f.to ? { lte: f.to } : {}) } });
  if (f.q) {
    const q = f.q.trim();
    const or: Prisma.TicketWhereInput[] = [
      { subject: { contains: q, mode: "insensitive" } },
      { description: { contains: q, mode: "insensitive" } },
      { author: { user: { name: { contains: q, mode: "insensitive" } } } },
      { author: { user: { email: { contains: q, mode: "insensitive" } } } },
      { book: { title: { contains: q, mode: "insensitive" } } },
    ];
    const num = Number(q.replace(/^#/, ""));
    if (Number.isInteger(num) && num > 0 && num < 2 ** 31) or.push({ ticketNumber: num });
    and.push({ OR: or });
  }
  return and.length ? { AND: and } : {};
}
