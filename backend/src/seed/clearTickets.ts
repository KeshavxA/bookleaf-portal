/**
 * `npm run db:clear-tickets [-- --force]`
 *
 * Deletes tickets, their messages and internal notes, and AiCall rows. Users,
 * authors and books are left alone, so `npm run seed:demo` can repopulate.
 * Refuses to run when NODE_ENV=production unless --force is passed.
 */
import { PrismaClient } from "@prisma/client";

export function assertMayClear(nodeEnv: string | undefined, argv: readonly string[]): void {
  if (nodeEnv === "production" && !argv.includes("--force")) {
    throw new Error("Refusing to delete tickets with NODE_ENV=production. Re-run with --force if you really mean it.");
  }
}

export async function clearTickets(prisma: PrismaClient) {
  const [aiCalls, notes, messages, tickets] = await prisma.$transaction([
    prisma.aiCall.deleteMany(),
    prisma.internalNote.deleteMany(),
    prisma.ticketMessage.deleteMany(),
    prisma.ticket.deleteMany(),
  ]);
  return { tickets: tickets.count, messages: messages.count, notes: notes.count, aiCalls: aiCalls.count };
}

if (require.main === module) {
  require("dotenv/config");
  try {
    assertMayClear(process.env.NODE_ENV, process.argv.slice(2));
  } catch (err) {
    console.error((err as Error).message);
    process.exit(1);
  }
  const prisma = new PrismaClient();
  clearTickets(prisma)
    .then((n) =>
      console.log(`Deleted ${n.tickets} tickets, ${n.messages} messages, ${n.notes} internal notes, ${n.aiCalls} AI call logs`),
    )
    .catch((err) => {
      console.error(err instanceof Error ? err.message : err);
      process.exitCode = 1;
    })
    .finally(() => prisma.$disconnect());
}
