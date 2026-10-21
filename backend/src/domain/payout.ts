/**
 * Royalty payout schedule, from the BookLeaf KB:
 *   - royalties are calculated quarterly and paid within 45 days of quarter end
 *   - minimum payout threshold is ₹1,000; smaller balances roll over
 *
 * These are computed in code (never by the LLM) and handed to the drafter as facts.
 */
import { addDays, startOfUtcDay } from "../lib/dates";

export const PAYOUT_DAYS_AFTER_QUARTER_END = 45;
export const MIN_PAYOUT_THRESHOLD_INR = 1000;

const QUARTER_END_MONTHS = [2, 5, 8, 11]; // Mar, Jun, Sep, Dec (0-based)
const QUARTER_LABELS = ["Jan–Mar", "Apr–Jun", "Jul–Sep", "Oct–Dec"];

export interface PayoutSlot {
  quarterEnd: Date;
  payoutDate: Date;
  /** e.g. "Jul–Sep 2026" */
  covers: string;
}

function quarterEnd(year: number, quarterIndex: number): Date {
  const month = QUARTER_END_MONTHS[quarterIndex]!;
  return new Date(Date.UTC(year, month + 1, 0)); // day 0 of next month = last day of this month
}

function slotsAround(year: number): PayoutSlot[] {
  const slots: PayoutSlot[] = [];
  for (const y of [year - 1, year, year + 1]) {
    for (let q = 0; q < 4; q++) {
      const end = quarterEnd(y, q);
      slots.push({
        quarterEnd: end,
        payoutDate: addDays(end, PAYOUT_DAYS_AFTER_QUARTER_END),
        covers: `${QUARTER_LABELS[q]} ${y}`,
      });
    }
  }
  return slots;
}

/** Earliest scheduled payout (quarter end + 45 days) on or after `today`. */
export function nextPayout(today: Date = new Date()): PayoutSlot {
  const day = startOfUtcDay(today);
  const next = slotsAround(day.getUTCFullYear()).find((s) => s.payoutDate.getTime() >= day.getTime());
  // slotsAround spans next year as well, so a slot always exists.
  return next!;
}

export function nextPayoutDate(today: Date = new Date()): Date {
  return nextPayout(today).payoutDate;
}

/** Most recent scheduled payout strictly before `today`. */
export function previousPayout(today: Date = new Date()): PayoutSlot {
  const day = startOfUtcDay(today);
  const past = slotsAround(day.getUTCFullYear()).filter((s) => s.payoutDate.getTime() < day.getTime());
  return past[past.length - 1]!;
}

export interface RoyaltyInput {
  royaltyPending: number;
  lastRoyaltyPayoutDate: Date | null;
  publicationDate: Date | null;
}

export interface RoyaltyAssessment {
  pending: number;
  belowThreshold: boolean;
  next: PayoutSlot;
  previous: PayoutSlot;
  /**
   * Heuristic: pending >= threshold, the book was live before the last payout
   * cycle closed, yet no payout is recorded since that cycle's payout date.
   * The drafter treats this as "team must verify, 48h timeline" - never as a confirmed fact.
   */
  payoutReviewNeeded: boolean;
  reviewReason: string | null;
}

export function assessRoyalty(book: RoyaltyInput, today: Date = new Date()): RoyaltyAssessment {
  const next = nextPayout(today);
  const previous = previousPayout(today);
  const belowThreshold = book.royaltyPending > 0 && book.royaltyPending < MIN_PAYOUT_THRESHOLD_INR;

  let payoutReviewNeeded = false;
  let reviewReason: string | null = null;
  const liveBeforeLastCycle =
    book.publicationDate !== null && book.publicationDate.getTime() <= previous.quarterEnd.getTime();
  const paidSinceLastCycle =
    book.lastRoyaltyPayoutDate !== null && book.lastRoyaltyPayoutDate.getTime() >= previous.payoutDate.getTime();

  if (book.royaltyPending >= MIN_PAYOUT_THRESHOLD_INR && liveBeforeLastCycle && !paidSinceLastCycle) {
    payoutReviewNeeded = true;
    reviewReason = book.lastRoyaltyPayoutDate
      ? "pending balance is above the payout threshold but no payout is recorded since the last scheduled payout date"
      : "pending balance is above the payout threshold and no payout has ever been recorded for this book";
  }

  return { pending: book.royaltyPending, belowThreshold, next, previous, payoutReviewNeeded, reviewReason };
}
