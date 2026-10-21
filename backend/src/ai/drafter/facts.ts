import { assessRoyalty, MIN_PAYOUT_THRESHOLD_INR } from "../../domain/payout";
import { daysBetween, formatHumanDate } from "../../lib/dates";
import type { Category } from "../../domain/enums";
import type { DraftBookInput, DraftContext } from "./types";

const inr = (n: number) => `₹${n.toLocaleString("en-IN")}`;

/** Royalty numbers only help on money-related tickets; elsewhere they are noise (and tokens). */
const ROYALTY_CATEGORIES: ReadonlySet<Category> = new Set(["ROYALTY_PAYMENTS", "GENERAL_INQUIRY"]);

export function isInProduction(status: string): boolean {
  return /in production/i.test(status);
}

/**
 * Builds the FACTS block: a compact, human-readable summary computed in code
 * from DB records. All derived values (next payout date, threshold roll-over,
 * payout review flag) are calculated here so the model never does date or money maths.
 */
export function buildFacts(ctx: DraftContext): string {
  const today = ctx.today ?? new Date();
  const lines: string[] = [];
  const firstName = ctx.author.name.split(/\s+/)[0] ?? ctx.author.name;

  lines.push(`Today: ${formatHumanDate(today)}`);
  lines.push(`Author: ${ctx.author.name} (address them as ${firstName})`);
  lines.push(`Bank details linked in dashboard: ${bankLine(ctx.author.bankLinked)}`);
  const age = daysBetween(ctx.ticket.createdAt, today);
  lines.push(
    `Ticket: #${ctx.ticket.ticketNumber}, opened ${formatHumanDate(ctx.ticket.createdAt)} (${age} day${age === 1 ? "" : "s"} ago), status ${ctx.ticket.status}`,
  );

  if (ctx.book) {
    lines.push(...bookLines(ctx.book, ROYALTY_CATEGORIES.has(ctx.ticket.category), today));
  } else {
    lines.push("Book: none selected (general / account-level query)");
    if (ctx.author.books.length > 0) {
      lines.push("Author's books on record:");
      for (const b of ctx.author.books) lines.push(`  - "${b.title}" (${b.status})`);
    }
  }
  return lines.join("\n");
}

function bankLine(bankLinked: boolean | null): string {
  if (bankLinked === true) return "yes";
  if (bankLinked === false) return "NO - ask the author to link their bank account in the dashboard";
  return "unknown - if payments are involved, ask the author to confirm their bank details in the dashboard";
}

function bookLines(book: DraftBookInput, includeRoyalty: boolean, today: Date): string[] {
  const out: string[] = [`Book: "${book.title}"`, `  ISBN on record: ${book.isbn}`];

  if (isInProduction(book.status)) {
    out.push(`  Status: ${book.status} - not yet published, so there are no sales or royalties yet`);
    out.push("  Exact completion date: not in our records (team must confirm)");
    return out;
  }

  const published = book.publicationDate ? `published ${formatHumanDate(book.publicationDate)}` : "publication date not on record";
  out.push(`  Status: ${book.status} (${published})`);
  out.push(`  Print partner: ${book.printPartner ?? "not on record"}`);
  out.push(`  Available on: ${book.availableOn.length ? book.availableOn.join(", ") : "no platforms on record"}`);
  if (!includeRoyalty) {
    out.push(`  Copies sold: ${book.totalCopiesSold.toLocaleString("en-IN")}`);
    return out;
  }

  out.push(
    `  MRP: ${book.mrp !== null ? inr(book.mrp) : "not set"}; author royalty per copy: ${
      book.authorRoyaltyPerCopy !== null ? inr(book.authorRoyaltyPerCopy) : "not set"
    }`,
  );
  out.push(`  Copies sold: ${book.totalCopiesSold.toLocaleString("en-IN")}`);
  out.push(
    `  Royalty earned: ${inr(book.totalRoyaltyEarned)}; paid: ${inr(book.royaltyPaid)}; pending: ${inr(book.royaltyPending)}`,
  );
  out.push(
    `  Last royalty payout: ${book.lastRoyaltyPayoutDate ? formatHumanDate(book.lastRoyaltyPayoutDate) : "none recorded yet"}`,
  );

  const r = assessRoyalty(book, today);
  if (book.royaltyPending === 0) {
    out.push("  Pending royalty: nothing pending - all earned royalty has been paid");
  } else if (r.belowThreshold) {
    out.push(
      `  Payout threshold: pending ${inr(book.royaltyPending)} is below the ${inr(MIN_PAYOUT_THRESHOLD_INR)} minimum, so it rolls over to the next quarter`,
    );
  } else {
    out.push(`  Payout threshold: pending amount is above the ${inr(MIN_PAYOUT_THRESHOLD_INR)} minimum`);
  }
  out.push(`  Next scheduled payout date: ${formatHumanDate(r.next.payoutDate)} (for ${r.next.covers} royalties)`);
  if (r.payoutReviewNeeded) {
    out.push(
      `  Payout review: NEEDED - ${r.reviewReason}. Tell the author the team is checking this payment and will update them within 48 hours.`,
    );
  }
  return out;
}
