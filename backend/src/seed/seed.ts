/**
 * Idempotent seed: loads backend/seed/bookleaf_sample_data.json as-is.
 * - one User (role AUTHOR, password Passw0rd!) + Author per dataset author
 * - every book, with nulls preserved for in-production books
 * - two admins
 * - optional demo tickets (from the KB sample queries) on an empty ticket table;
 *   they are created aiStatus=PENDING so the server classifies them on boot
 *
 * Safe to run on every deploy (used by `npm run start:prod`).
 */
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import bcrypt from "bcryptjs";
import { PrismaClient } from "@prisma/client";
import { z } from "zod";
import { classifyByKeywords } from "../ai/classifier/keywordFallback";

const DEFAULT_PASSWORD = "Passw0rd!";

const dateOrNull = z
  .string()
  .nullable()
  .transform((s) => (s ? new Date(`${s}T00:00:00.000Z`) : null));

const BookJson = z.object({
  book_id: z.string(),
  title: z.string(),
  isbn: z.string(),
  genre: z.string(),
  publication_date: dateOrNull,
  status: z.string(),
  mrp: z.number().int().nullable(),
  author_royalty_per_copy: z.number().int().nullable(),
  total_copies_sold: z.number().int(),
  total_royalty_earned: z.number().int(),
  royalty_paid: z.number().int(),
  royalty_pending: z.number().int(),
  last_royalty_payout_date: dateOrNull,
  print_partner: z.string().nullable(),
  available_on: z.array(z.string()),
});

const DatasetJson = z.object({
  authors: z.array(
    z.object({
      author_id: z.string(),
      name: z.string(),
      email: z.email(),
      phone: z.string().nullable().optional(),
      city: z.string().nullable().optional(),
      joined_date: dateOrNull.optional(),
      books: z.array(BookJson),
    }),
  ),
});

const ADMINS = [
  { email: "admin1@bookleaf.com", name: "Ritika Sen" },
  { email: "admin2@bookleaf.com", name: "Karan Verma" },
];

/** Demo tickets built from the KB's sample queries, attached to real dataset records. */
const DEMO_TICKETS: Array<{ email: string; bookId: string | null; subject: string; description: string; daysAgo: number }> = [
  {
    email: "ananya.reddy@email.com",
    bookId: "BK005",
    subject: "No royalty received yet",
    description:
      "I published my book over a year ago and still haven't received any royalty. My dashboard shows a pending amount but nothing has come to my account. What's going on?",
    daysAgo: 3,
  },
  {
    email: "rohit.kapoor@email.com",
    bookId: "BK003",
    subject: "ISBN on Amazon doesn't match my printed copy",
    description:
      "My book is showing a different ISBN on Amazon than what's printed on the physical copy. Readers are getting confused and I'm worried about sales being tracked wrongly.",
    daysAgo: 2,
  },
  {
    email: "priya.sharma@email.com",
    bookId: "BK001",
    subject: "Author copies have blurry images",
    description:
      "I received my author copies and the print quality is terrible. The images are blurry and several pages are misaligned. I can't give these to anyone.",
    daysAgo: 1,
  },
  {
    email: "kavita.deshmukh@email.com",
    bookId: "BK015",
    subject: "Still in typesetting after 3 weeks",
    description: "It's been 3 weeks and my book Raising Roots is still in typesetting. When will it be done?",
    daysAgo: 1,
  },
  {
    email: "meera.nair@email.com",
    bookId: "BK008",
    subject: "Can I update my book description?",
    description: "Can I update the description of my book on Amazon after it's already live? I'd like to add a couple of review quotes.",
    daysAgo: 0,
  },
];

async function main() {
  const prisma = new PrismaClient();
  try {
    const dataPath = [join(__dirname, "../../seed/bookleaf_sample_data.json"), join(process.cwd(), "seed/bookleaf_sample_data.json")].find(
      existsSync,
    );
    if (!dataPath) throw new Error("bookleaf_sample_data.json not found");
    const data = DatasetJson.parse(JSON.parse(readFileSync(dataPath, "utf8")));

    let books = 0;
    for (const a of data.authors) {
      const email = a.email.toLowerCase();
      // Only hash for new users so re-seeding never resets a changed password.
      const existing = await prisma.user.findUnique({ where: { email } });
      const user =
        existing ??
        (await prisma.user.create({
          data: { email, name: a.name, role: "AUTHOR", passwordHash: await bcrypt.hash(DEFAULT_PASSWORD, 10) },
        }));

      const authorData = { phone: a.phone ?? null, city: a.city ?? null, joinedDate: a.joined_date ?? null };
      await prisma.author.upsert({
        where: { id: a.author_id },
        // bankLinked intentionally left null: the dataset has no bank information.
        create: { id: a.author_id, userId: user.id, ...authorData },
        update: authorData,
      });

      for (const b of a.books) {
        const bookData = {
          authorId: a.author_id,
          title: b.title,
          isbn: b.isbn,
          genre: b.genre,
          publicationDate: b.publication_date,
          status: b.status,
          mrp: b.mrp,
          authorRoyaltyPerCopy: b.author_royalty_per_copy,
          totalCopiesSold: b.total_copies_sold,
          totalRoyaltyEarned: b.total_royalty_earned,
          royaltyPaid: b.royalty_paid,
          royaltyPending: b.royalty_pending,
          lastRoyaltyPayoutDate: b.last_royalty_payout_date,
          printPartner: b.print_partner,
          availableOn: b.available_on,
        };
        await prisma.book.upsert({ where: { id: b.book_id }, create: { id: b.book_id, ...bookData }, update: bookData });
        books++;
      }
    }

    for (const admin of ADMINS) {
      await prisma.user.upsert({
        where: { email: admin.email },
        create: { ...admin, role: "ADMIN", passwordHash: await bcrypt.hash(DEFAULT_PASSWORD, 10) },
        update: { name: admin.name, role: "ADMIN" },
      });
    }

    let demo = 0;
    const seedDemo = (process.env.SEED_DEMO_TICKETS ?? "true") !== "false";
    if (seedDemo && (await prisma.ticket.count()) === 0) {
      for (const t of DEMO_TICKETS) {
        const user = await prisma.user.findUnique({ where: { email: t.email }, include: { author: true } });
        if (!user?.author) continue;
        const createdAt = new Date(Date.now() - t.daysAgo * 86_400_000);
        const provisional = classifyByKeywords(t);
        await prisma.ticket.create({
          data: {
            authorId: user.author.id,
            bookId: t.bookId,
            subject: t.subject,
            description: t.description,
            category: provisional.category,
            priority: provisional.priority,
            aiStatus: "PENDING",
            createdAt,
          },
        });
        demo++;
      }
    }

    console.log(
      `Seed complete: ${data.authors.length} authors, ${books} books, ${ADMINS.length} admins, ${demo} demo tickets (password: ${DEFAULT_PASSWORD})`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
