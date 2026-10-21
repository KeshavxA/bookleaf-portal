/**
 * Idempotent seed: loads backend/seed/bookleaf_sample_data.json as-is.
 * - one User (role AUTHOR, password Passw0rd!) + Author per dataset author
 * - every book, with nulls preserved for in-production books
 * - two admins
 * - demo tickets when SEED_DEMO_TICKETS=true (see demoTickets.ts; idempotent, no LLM calls)
 *
 * Safe to run on every deploy (used by `npm run start:prod`).
 */
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import bcrypt from "bcryptjs";
import { PrismaClient } from "@prisma/client";
import { z } from "zod";
import { seedDemoTickets } from "./demoTickets";

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

    // Opt-in: deploys set SEED_DEMO_TICKETS=true; locally use `npm run seed:demo`.
    const demo = ["true", "1"].includes(process.env.SEED_DEMO_TICKETS ?? "") ? (await seedDemoTickets(prisma)).created : 0;

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
