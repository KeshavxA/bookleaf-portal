import { assessRoyalty, MIN_PAYOUT_THRESHOLD_INR } from "../../domain/payout";
import { daysBetween, formatHumanDate } from "../../lib/dates";
import type { Category } from "../../domain/enums";
import type { DraftBookInput, DraftContext } from "./types";
import { earlierContact, isPaymentRelated, shouldAskBankDetails, titlesNamedByAuthor } from "./relevance";

const inr = (n: number) => `₹${n.toLocaleString("en-IN")}`;

export function isInProduction(status: string): boolean {
  return /in production/i.test(status);
}

/** "In Production - Cover Design" -> "Cover Design" */
export function productionStage(status: string): string | null {
  const m = /in production\s*[-–:]\s*(.+)$/i.exec(status);
  return m ? m[1]!.trim() : null;
}

/**
 * Builds the FACTS block: a compact, human-readable summary computed in code
 * from DB records. All derived values (next payout date, threshold roll-over,
 * payout review flag) are calculated here so the model never does date or money maths.
 *
 * Only facts relevant to the ticket are included, because the model tends to use
 * whatever it is given (the first Gemini eval put royalties and bank details into
 * a reply about editing a book description):
 *   - payment-related tickets (ROYALTY_PAYMENTS, or the author wrote about payment):
 *     bank status, royalty figures, threshold roll-over, next payout date, review flag
 *   - ISBN_METADATA: the ISBN on record
 *   - PRINTING_QUALITY: the print partner
 *   - DISTRIBUTION_AVAILABILITY: the platforms the book is on
 *   - BOOK_STATUS_PRODUCTION: status and production stage (no money wording unless the author asked about money)
 *   - GENERAL_INQUIRY: book title and status only
 */
export function buildFacts(ctx: DraftContext): string {
  const today = ctx.today ?? new Date();
  const payment = isPaymentRelated(ctx);
  const lines: string[] = [];
  const firstName = ctx.author.name.split(/\s+/)[0] ?? ctx.author.name;

  lines.push(`Today: ${formatHumanDate(today)}`);
  lines.push(`Author: ${ctx.author.name} (address them as ${firstName})`);
  if (payment) lines.push(`Bank details: ${bankLine(ctx)}`);
  const age = daysBetween(ctx.ticket.createdAt, today);
  lines.push(
    `Ticket: #${ctx.ticket.ticketNumber}, opened ${formatHumanDate(ctx.ticket.createdAt)} (${age} day${age === 1 ? "" : "s"} ago), status ${ctx.ticket.status}`,
  );
  lines.push(`Earlier contact: ${earlierContactLine(ctx)}`);

  if (ctx.book) {
    lines.push(...bookLines(ctx.book, ctx.ticket.category, payment, today));
  } else {
    // Account-level ticket: do not hand the model titles to name. A book appears only if the
    // author's own text names it (run 1 named "Turban Tales" on a bio question that never mentioned it).
    lines.push("Book: none selected (account-level query). Do not name a specific book unless the author named it.");
    const named = new Set(titlesNamedByAuthor(ctx));
    if (ctx.author.books.length > 0) {
      lines.push(`Books on file: ${ctx.author.books.length}`);
      for (const b of ctx.author.books.filter((x) => named.has(x.title))) {
        lines.push(`  - named by the author: "${b.title}" (${b.status})`);
      }
    }
  }
  return lines.join("\n");
}

function earlierContactLine(ctx: DraftContext): string {
  const c = earlierContact(ctx);
  switch (c.reason) {
    case "author-says":
      return "the author says they have written before or not had a reply - acknowledging that is fine";
    case "unanswered-follow-up":
      return "the author has already followed up on this ticket without a reply from BookLeaf - acknowledging that is fine";
    case "no-reply-for-days":
      return `no reply from BookLeaf in ${c.days} days - acknowledging the slow reply is fine`;
    case "already-replied":
      return "BookLeaf has already replied on this ticket - do not apologise for a lack of replies";
    case "fresh":
      return "none - this is the author's first message on a new ticket; do not mention earlier replies or not getting back sooner";
  }
}

function bankLine(ctx: DraftContext): string {
  if (ctx.author.bankLinked === true) return "linked - do not ask about them";
  if (ctx.author.bankLinked === false) return "NOT linked - ask the author once to link their bank account in the dashboard";
  if (shouldAskBankDetails(ctx)) {
    return "unknown, and no royalty has ever been paid for this book - ask the author once to confirm their bank details in the dashboard";
  }
  return ctx.book
    ? "a royalty payout has already reached this author for this book - do not ask about bank details"
    : "not relevant without a selected book - do not ask about bank details";
}

function bookLines(book: DraftBookInput, category: Category, payment: boolean, today: Date): string[] {
  const out: string[] = [`Book: "${book.title}"`];

  if (isInProduction(book.status)) {
    // Status and stage only. A "no sales or royalties yet" line here made the model talk about
    // money on production tickets (Gemini eval run 1), so money appears only if the author asked.
    out.push(`  Status: ${book.status}`);
    const stage = productionStage(book.status);
    if (stage) out.push(`  Current production stage: ${stage}`);
    out.push("  Exact completion date: not in our records (team must confirm)");
    if (category === "ISBN_METADATA") out.push(`  ISBN on record: ${book.isbn}`);
    if (payment) out.push("  Sales and royalties: none yet, because the book is not published");
    return out;
  }

  const published = book.publicationDate ? `published ${formatHumanDate(book.publicationDate)}` : "publication date not on record";
  out.push(`  Status: ${book.status} (${published})`);
  if (category === "ISBN_METADATA") out.push(`  ISBN on record: ${book.isbn}`);
  if (category === "PRINTING_QUALITY") out.push(`  Print partner: ${book.printPartner ?? "not on record"}`);
  if (category === "DISTRIBUTION_AVAILABILITY") {
    out.push(`  Available on: ${book.availableOn.length ? book.availableOn.join(", ") : "no platforms on record"}`);
  }
  if (payment) out.push(...royaltyLines(book, today));
  return out;
}

function royaltyLines(book: DraftBookInput, today: Date): string[] {
  const out: string[] = [];
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
  if (r.belowThreshold) {
    // No payout date for this balance: it is not paid on the next cycle unless it reaches the
    // threshold by then, which we cannot know (run 3 promised "14 Nov 2026" for ₹850).
    out.push(
      `  Payout threshold: pending ${inr(book.royaltyPending)} is below the ${inr(MIN_PAYOUT_THRESHOLD_INR)} minimum. ` +
        `It carries forward and is paid in the first quarterly payout cycle after accumulated royalty reaches ${inr(MIN_PAYOUT_THRESHOLD_INR)}.`,
    );
    out.push("  Payout date for this balance: none yet (do not give one); nothing is wrong, so no investigation is needed");
    return out;
  }
  if (book.royaltyPending === 0) {
    out.push("  Pending royalty: nothing pending - all earned royalty has been paid");
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
