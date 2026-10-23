import type { DraftContext } from "./types";
import { daysBetween } from "../../lib/dates";

/**
 * Words that make a ticket "about money" even outside the ROYALTY_PAYMENTS category.
 * Deliberately excludes "₹": an amount alone (e.g. a prompt-injection "₹50,000 bonus")
 * should not pull royalty figures into the prompt.
 */
const PAYMENT_TEXT_RE = /\b(royalt\w*|payouts?|payments?|paid|unpaid|bank|earnings?|earned)\b/i;

/**
 * Royalty figures, payout dates, the ₹1,000 roll-over and the bank-details request
 * belong in a draft only when the ticket is about payment: its category, or what
 * the author actually wrote (subject, description, their messages).
 */
export function isPaymentRelated(ctx: Pick<DraftContext, "ticket" | "thread">): boolean {
  if (ctx.ticket.category === "ROYALTY_PAYMENTS") return true;
  return PAYMENT_TEXT_RE.test(authorText(ctx));
}

/** Text that only belongs in payment-related drafts (used by checks and the eval). */
export const OFF_TOPIC_MONEY_RE = /\b(royalt\w*|payouts?|bank (details|account))\b/i;

/** Everything the author wrote on this ticket: subject, description and their thread messages. */
export function authorText(ctx: Pick<DraftContext, "ticket" | "thread">): string {
  return [
    ctx.ticket.subject,
    ctx.ticket.description,
    ...ctx.thread.filter((m) => m.senderType === "AUTHOR").map((m) => m.body),
  ].join("\n");
}

/**
 * Ask for bank details only when nothing has ever been paid out for the book: a payout that
 * reached the author proves the account works. `bankLinked === false` (explicitly not linked)
 * always asks. With no book selected we cannot tell what was paid, so we do not ask.
 */
export function shouldAskBankDetails(ctx: Pick<DraftContext, "author" | "book">): boolean {
  if (ctx.author.bankLinked === true) return false;
  if (ctx.author.bankLinked === false) return true;
  return ctx.book !== null && ctx.book.royaltyPaid === 0;
}

/**
 * The author disputes an amount: "too low", "different from what I expected", or a money
 * amount / copy count tied to what they received, were paid, earned or sold
 * ("I sold 200 copies but only received ₹3,000"). Restating a pending figure
 * ("₹5,280 is still pending") is not a dispute.
 */
const DISPUTE_WORDS =
  /\b(too low|too little|lower than|less than (i )?expected|not what i expected|different from|doesn'?t match|does not match|doesn'?t add up|wrong amount|incorrect amount|miscalculat\w*|should (be|have been) (more|higher))\b/i;
const AMOUNT = String.raw`(?:₹\s?|rs\.?\s?|inr\s?)\d[\d,]*|\d[\d,]*\s*(?:copies|books|units)`;
const AMOUNT_NEAR_RECEIPT = new RegExp(
  String.raw`\b(received|got|paid|earned|sold|credited)\b[^.?!\n]{0,30}(${AMOUNT})|(${AMOUNT})[^.?!\n]{0,30}\b(received|got|paid|earned|sold|credited)\b`,
  "i",
);

export function isRoyaltyDispute(ctx: Pick<DraftContext, "ticket" | "thread">): boolean {
  if (!isPaymentRelated(ctx)) return false;
  const text = authorText(ctx);
  return DISPUTE_WORDS.test(text) || AMOUNT_NEAR_RECEIPT.test(text);
}

/** The author says they have written before, or that nobody answered. */
const REPEATED_CONTACT =
  /\b(third time|second time|\d+(st|nd|rd|th)? time|again|(several|multiple|many|\d+) times|(written|wrote|emailed|messaged|asked|contacted|followed up)( to you| you)? (before|earlier|already|previously|twice|again)|no ?(one|body) (replies|replied|responds|responded|answers|answered)|no (response|reply|answer)|ignored|following up|follow(ing)?-up)\b/i;

export function saysIgnoredOrRepeated(ctx: Pick<DraftContext, "ticket" | "thread">): boolean {
  const earlierAuthorMessages = ctx.thread.filter((m) => m.senderType === "AUTHOR").length;
  return REPEATED_CONTACT.test(authorText(ctx)) || earlierAuthorMessages > 0;
}

/** Book titles the author named in their own text. */
export function titlesNamedByAuthor(ctx: Pick<DraftContext, "ticket" | "thread" | "author">): string[] {
  const text = authorText(ctx).toLowerCase();
  return ctx.author.books.map((b) => b.title).filter((t) => text.includes(t.toLowerCase()));
}

/** Days with no BookLeaf reply after which "not getting back to you sooner" is a fair thing to say. */
export const NO_REPLY_DAYS_FOR_APOLOGY = 2;

export type EarlierContact =
  | { allowed: true; reason: "author-says" | "unanswered-follow-up" | "no-reply-for-days"; days: number }
  | { allowed: false; reason: "fresh" | "already-replied"; days: number };

/**
 * May the draft mention earlier contact ("the lack of earlier replies", "not getting back to you
 * sooner")? Only when it is true: the author says they wrote before or were ignored, the author
 * has already followed up on this ticket without a BookLeaf reply, or the ticket is at least
 * NO_REPLY_DAYS_FOR_APOLOGY days old with no BookLeaf reply. A 7-minute-old first message is none
 * of these (live test, ticket #24).
 */
export function earlierContact(ctx: Pick<DraftContext, "ticket" | "thread" | "today">): EarlierContact {
  const days = daysBetween(ctx.ticket.createdAt, ctx.today ?? new Date());
  const adminReplied = ctx.thread.some((m) => m.senderType === "ADMIN");
  const authorFollowUps = ctx.thread.filter((m) => m.senderType === "AUTHOR").length;
  if (REPEATED_CONTACT.test(authorText(ctx))) return { allowed: true, reason: "author-says", days };
  if (!adminReplied && authorFollowUps > 0) return { allowed: true, reason: "unanswered-follow-up", days };
  if (!adminReplied && days >= NO_REPLY_DAYS_FOR_APOLOGY) return { allowed: true, reason: "no-reply-for-days", days };
  return { allowed: false, reason: adminReplied ? "already-replied" : "fresh", days };
}

/** Phrases that claim earlier contact or a slow reply. Only allowed when earlierContact() says so. */
export const EARLIER_CONTACT_CLAIM =
  /\b(earlier|previous|prior) (repl(y|ies)|responses?|messages?|emails?|contact)\b|\b(lack|absence) of (a |any )?(earlier )?(repl(y|ies)|responses?)\b|\b(getting|get|got|gotten) back to you (sooner|earlier)\b|\bnot (getting|got|gotten) back to you\b|\bnot (replying|responding|answering) (sooner|earlier)\b|\b(repl(y|ied)|respond(ed)?|answer(ed)?) (sooner|earlier)\b|\bdelay in (replying|responding|getting back)\b|\bhear(ing)? back (from us )?(sooner|earlier)\b|\bkept you waiting for a (reply|response)\b/i;
