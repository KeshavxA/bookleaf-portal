import type { DraftContext } from "./types";

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
  const authorText = [
    ctx.ticket.subject,
    ctx.ticket.description,
    ...ctx.thread.filter((m) => m.senderType === "AUTHOR").map((m) => m.body),
  ].join("\n");
  return PAYMENT_TEXT_RE.test(authorText);
}

/** Text that only belongs in payment-related drafts (used by checks and the eval). */
export const OFF_TOPIC_MONEY_RE = /\b(royalt\w*|payouts?|bank (details|account))\b/i;
