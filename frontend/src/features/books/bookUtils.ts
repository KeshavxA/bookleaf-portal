import type { Book } from '@/api/types';

/** Minimum payout threshold from the BookLeaf royalty policy. */
export const PAYOUT_THRESHOLD_INR = 1000;

/**
 * Returns the production stage for books that aren't live yet, e.g. "Cover Design"
 * for "In Production - Cover Design". Returns null for published books.
 */
export function productionStage(status: string): string | null {
  if (!/^in production/i.test(status.trim())) return null;
  const stage = status.split(/\s[-–—]\s/)[1]?.trim();
  return stage || 'In production';
}

export const isInProduction = (book: Book) => productionStage(book.status) !== null;

export const hasNoPayouts = (book: Book) => !isInProduction(book) && book.royaltyPaid === 0;

/** Pending royalty below the threshold rolls over to the next quarter instead of being paid. */
export const isBelowPayoutThreshold = (book: Book) =>
  book.royaltyPending > 0 && book.royaltyPending < PAYOUT_THRESHOLD_INR;

export function royaltyTotals(books: Book[]) {
  return books.reduce(
    (acc, b) => ({
      earned: acc.earned + b.totalRoyaltyEarned,
      paid: acc.paid + b.royaltyPaid,
      pending: acc.pending + b.royaltyPending,
    }),
    { earned: 0, paid: 0, pending: 0 },
  );
}
