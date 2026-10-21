/**
 * Demo tickets for a live deployment: `npm run seed:demo`, or automatically from
 * the deploy-time seed when SEED_DEMO_TICKETS=true.
 *
 * - Pre-classified (aiStatus DONE, preset category/priority/reasoning): no LLM
 *   calls, so it works without ANTHROPIC_API_KEY.
 * - Every ticket is grounded in a real dataset row (amounts and statuses below
 *   match bookleaf_sample_data.json).
 * - Idempotent: a ticket is skipped if that author already has one with the same subject.
 * - Back-dated so the urgency sort and the "open > 3 days" flag have something to show.
 *
 * Requires the base seed (authors, books, admins) to have run first.
 */
import { PrismaClient, type Category, type Priority, type TicketStatus } from "@prisma/client";
import { isOpenStatus } from "../domain/enums";

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

interface DemoMessage {
  from: "AUTHOR" | "ADMIN";
  body: string;
  /** Age relative to seeding time. */
  ago: number;
}

export interface DemoTicket {
  email: string;
  bookId: string | null;
  subject: string;
  description: string;
  category: Category;
  priority: Priority;
  reasoning: string;
  status: TicketStatus;
  assignToAdminEmail?: string;
  ago: number;
  messages?: DemoMessage[];
  notes?: Array<{ adminEmail: string; body: string; ago: number }>;
}

export const DEMO_ADMIN = "admin1@bookleaf.com";

export const DEMO_TICKETS: DemoTicket[] = [
  {
    // BK005: 67 copies sold, ₹2,546 earned, ₹0 paid, never paid out.
    email: "ananya.reddy@email.com",
    bookId: "BK005",
    subject: "Over a year and not a single royalty payment",
    description:
      "Between Two Temples has sold 67 copies according to my dashboard, but I have never received any royalty payment. I have written to support twice before about this and nobody has given me an answer. Please tell me when I will actually be paid.",
    category: "ROYALTY_PAYMENTS",
    priority: "CRITICAL",
    reasoning: "No royalty ever paid on a selling book; author reports repeated unanswered follow-ups.",
    status: "OPEN",
    ago: 5 * DAY,
    messages: [
      {
        from: "AUTHOR",
        body: "Following up again. It has been five days and I still have no reply on this.",
        ago: 1 * DAY,
      },
    ],
  },
  {
    // BK010: 88 copies, ₹2,464 pending, never paid out.
    email: "arjun.malhotra@email.com",
    bookId: "BK010",
    subject: "Royalty for Turban Tales never paid",
    description:
      "My dashboard shows ₹2,464 pending for Turban Tales but I have never received a payout. Is something wrong with my account or my bank details?",
    category: "ROYALTY_PAYMENTS",
    priority: "HIGH",
    reasoning: "Pending royalty above threshold with no payout ever recorded.",
    status: "IN_PROGRESS",
    assignToAdminEmail: DEMO_ADMIN,
    ago: 4 * DAY,
    messages: [
      {
        from: "ADMIN",
        body:
          "Hi Arjun,\n\nThank you for flagging this. You are right that Turban Tales shows ₹2,464 pending and no payout has gone out yet. I have asked our finance team to check why it was not included in the last payout run, and I will update you within 48 hours. In the meantime, please confirm your bank details in your BookLeaf dashboard so nothing holds up the transfer.\n\nWarm regards,\nBookLeaf Support Team",
        ago: 3 * DAY,
      },
    ],
  },
  {
    // BK001: ₹3,570 pending, last payout 15 Oct 2025.
    email: "priya.sharma@email.com",
    bookId: "BK001",
    subject: "When will my pending ₹3,570 be paid?",
    description:
      "Whispers of the Ganges shows ₹3,570 in pending royalty. My last payment was in October last year. When is the next payout and will this amount be included?",
    category: "ROYALTY_PAYMENTS",
    priority: "HIGH",
    reasoning: "Pending balance above threshold with no payout in the last year.",
    status: "OPEN",
    ago: 6 * DAY,
    notes: [
      {
        adminEmail: "admin2@bookleaf.com",
        body: "Last payout on BK001 was 15 Oct 2025 even though the balance is over ₹1,000. Asked finance whether it was skipped in the last two runs. Hold the reply until they confirm.",
        ago: 5 * DAY,
      },
    ],
  },
  {
    // BK003: ISBN mismatch, one of the KB sample queries.
    email: "rohit.kapoor@email.com",
    bookId: "BK003",
    subject: "ISBN on Amazon doesn't match my printed copy",
    description:
      "Code & Karma is showing a different ISBN on Amazon than the one printed on the physical copy. Readers are confused and I'm worried sales are being tracked against the wrong edition.",
    category: "ISBN_METADATA",
    priority: "HIGH",
    reasoning: "ISBN mismatch between listing and print; ISBN errors are always high priority.",
    status: "OPEN",
    ago: 4 * DAY + 3 * HOUR,
  },
  {
    // BK013: In Production - Cover Design, no sales.
    email: "sneha.kulkarni@email.com",
    bookId: "BK013",
    subject: "When will Midnight in Mysore be published?",
    description:
      "My dashboard says Midnight in Mysore is in cover design. How long does that usually take, and when can I expect the book on Amazon?",
    category: "BOOK_STATUS_PRODUCTION",
    priority: "MEDIUM",
    reasoning: "Production timeline question for a book in cover design.",
    status: "OPEN",
    ago: 2 * DAY,
  },
  {
    // BK016: ₹850 pending, below the ₹1,000 payout threshold.
    email: "kavita.deshmukh@email.com",
    bookId: "BK016",
    subject: "Royalty for The Nagpur Notebooks",
    description:
      "The Nagpur Notebooks shows ₹850 pending but I have never been paid anything for it. Is there a problem with this book?",
    category: "ROYALTY_PAYMENTS",
    priority: "MEDIUM",
    reasoning: "Pending amount is below the payout threshold; timing question, nothing overdue.",
    status: "RESOLVED",
    assignToAdminEmail: DEMO_ADMIN,
    ago: 9 * DAY,
    messages: [
      {
        from: "ADMIN",
        body:
          "Hi Kavita,\n\nThank you for checking on this, and I understand it is frustrating to see a balance that has not been paid. Nothing is wrong with The Nagpur Notebooks: it has earned ₹850 so far, and BookLeaf pays royalties once the pending balance reaches ₹1,000. Until then, the amount rolls over to the next quarter and keeps growing with every sale. As soon as it crosses ₹1,000, it will go out in the next quarterly payout.\n\nIf you have any other questions about your royalties, just reply here.\n\nWarm regards,\nBookLeaf Support Team",
        ago: 8 * DAY,
      },
    ],
  },
  {
    // Account-level question, no book.
    email: "meera.nair@email.com",
    bookId: null,
    subject: "Updating my author bio and photo",
    description:
      "Hi, I'd like to update the author bio and photo that appear on my BookLeaf profile and on my book pages. What's the process for this?",
    category: "GENERAL_INQUIRY",
    priority: "LOW",
    reasoning: "Profile update request, informational.",
    status: "OPEN",
    ago: 1 * DAY,
  },
  {
    // BK007: listed on Amazon India and BookLeaf Store only.
    email: "vikram.joshi@email.com",
    bookId: "BK007",
    subject: "The Last Monsoon is not on Flipkart",
    description:
      "My other book is on Flipkart but The Last Monsoon is only on Amazon India and the BookLeaf Store. Can it be listed on Flipkart too?",
    category: "DISTRIBUTION_AVAILABILITY",
    priority: "MEDIUM",
    reasoning: "Request to add a platform; book is live elsewhere, nothing broken.",
    status: "OPEN",
    ago: 3 * HOUR,
  },
];

export interface DemoSeedResult {
  created: number;
  skipped: number;
}

export async function seedDemoTickets(prisma: PrismaClient, now: Date = new Date()): Promise<DemoSeedResult> {
  const at = (ago: number) => new Date(now.getTime() - ago);
  const adminIds = new Map<string, string>();
  const adminId = async (email: string) => {
    if (!adminIds.has(email)) {
      const admin = await prisma.user.findUnique({ where: { email } });
      if (!admin || admin.role !== "ADMIN") throw new Error(`Admin ${email} not found. Run the base seed first (npm run db:seed).`);
      adminIds.set(email, admin.id);
    }
    return adminIds.get(email)!;
  };

  let created = 0;
  let skipped = 0;
  for (const t of DEMO_TICKETS) {
    const user = await prisma.user.findUnique({ where: { email: t.email }, include: { author: true } });
    if (!user?.author) throw new Error(`Author ${t.email} not found. Run the base seed first (npm run db:seed).`);

    const exists = await prisma.ticket.findFirst({ where: { authorId: user.author.id, subject: t.subject }, select: { id: true } });
    if (exists) {
      skipped++;
      continue;
    }

    const createdAt = at(t.ago);
    const lastActivity = [t.ago, ...(t.messages ?? []).map((m) => m.ago)].reduce((a, b) => Math.min(a, b));
    const messages = await Promise.all(
      (t.messages ?? []).map(async (m) => ({
        senderType: m.from,
        senderUserId: m.from === "AUTHOR" ? user.id : await adminId(DEMO_ADMIN),
        body: m.body,
        createdAt: at(m.ago),
      })),
    );
    const notes = await Promise.all(
      (t.notes ?? []).map(async (n) => ({ adminId: await adminId(n.adminEmail), body: n.body, createdAt: at(n.ago) })),
    );

    await prisma.ticket.create({
      data: {
        authorId: user.author.id,
        bookId: t.bookId,
        subject: t.subject,
        description: t.description,
        status: t.status,
        isOpen: isOpenStatus(t.status),
        category: t.category,
        priority: t.priority,
        aiStatus: "DONE",
        aiCategory: t.category,
        aiPriority: t.priority,
        aiReasoning: t.reasoning,
        aiClassifiedAt: new Date(createdAt.getTime() + 5_000),
        assigneeId: t.assignToAdminEmail ? await adminId(t.assignToAdminEmail) : null,
        createdAt,
        updatedAt: at(lastActivity),
        messages: { create: messages },
        internalNotes: { create: notes },
      },
    });
    created++;
  }
  return { created, skipped };
}

if (require.main === module) {
  require("dotenv/config");
  const prisma = new PrismaClient();
  seedDemoTickets(prisma)
    .then((r) => console.log(`Demo tickets: ${r.created} created, ${r.skipped} already present`))
    .catch((err) => {
      console.error(err instanceof Error ? err.message : err);
      process.exitCode = 1;
    })
    .finally(() => prisma.$disconnect());
}
