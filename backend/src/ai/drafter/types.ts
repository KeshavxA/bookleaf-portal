import type { Category, TicketStatus } from "../../domain/enums";

export interface DraftBookInput {
  title: string;
  isbn: string;
  status: string;
  publicationDate: Date | null;
  mrp: number | null;
  authorRoyaltyPerCopy: number | null;
  printPartner: string | null;
  availableOn: string[];
  totalCopiesSold: number;
  totalRoyaltyEarned: number;
  royaltyPaid: number;
  royaltyPending: number;
  lastRoyaltyPayoutDate: Date | null;
}

export interface DraftThreadMessage {
  senderType: "AUTHOR" | "ADMIN";
  senderName: string;
  body: string;
  createdAt: Date;
}

/** Everything the drafter needs, assembled by the service layer from the DB. */
export interface DraftContext {
  ticket: {
    id: string;
    ticketNumber: number;
    subject: string;
    description: string;
    status: TicketStatus;
    category: Category;
    createdAt: Date;
  };
  author: {
    name: string;
    bankLinked: boolean | null;
    /** Only used for account-level tickets with no linked book. */
    books: Array<{ title: string; status: string }>;
  };
  book: DraftBookInput | null;
  /** Full thread, oldest first; the prompt builder keeps only the most recent messages. */
  thread: DraftThreadMessage[];
  today?: Date;
}
