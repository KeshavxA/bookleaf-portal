/**
 * Contract enums as plain const tuples. They mirror the Prisma enums 1:1 but
 * let pure modules (zod schemas, src/ai) stay free of database imports.
 */
export const TICKET_STATUSES = ["OPEN", "IN_PROGRESS", "RESOLVED", "CLOSED"] as const;
export type TicketStatus = (typeof TICKET_STATUSES)[number];

export const CATEGORIES = [
  "ROYALTY_PAYMENTS",
  "ISBN_METADATA",
  "PRINTING_QUALITY",
  "DISTRIBUTION_AVAILABILITY",
  "BOOK_STATUS_PRODUCTION",
  "GENERAL_INQUIRY",
] as const;
export type Category = (typeof CATEGORIES)[number];

/** Ordered most to least urgent. */
export const PRIORITIES = ["CRITICAL", "HIGH", "MEDIUM", "LOW"] as const;
export type Priority = (typeof PRIORITIES)[number];

export const OPEN_STATUSES: readonly TicketStatus[] = ["OPEN", "IN_PROGRESS"];

export function isOpenStatus(status: TicketStatus): boolean {
  return OPEN_STATUSES.includes(status);
}

/** Lower rank = more urgent. */
export function priorityRank(p: Priority): number {
  return PRIORITIES.indexOf(p);
}

/** Returns the more urgent of two priorities. */
export function maxPriority(a: Priority, b: Priority): Priority {
  return priorityRank(a) <= priorityRank(b) ? a : b;
}
