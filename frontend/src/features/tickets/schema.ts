import { z } from 'zod';

/** Sentinel select value for "General / Account Level"; sent to the API as bookId: null. */
export const GENERAL_BOOK = 'general';

export const MAX_ATTACHMENTS = 5;
export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;

// Limits match the contract: subject 3-120, description 10-5000.
export const ticketSchema = z.object({
  bookId: z.string().min(1, 'Choose a book or "General / Account Level"'),
  subject: z
    .string()
    .trim()
    .min(3, 'Subject must be at least 3 characters')
    .max(120, 'Subject must be 120 characters or fewer'),
  description: z
    .string()
    .trim()
    .min(10, 'Please describe your query in at least 10 characters')
    .max(5000, 'Description must be 5,000 characters or fewer'),
});

export type TicketFormValues = z.infer<typeof ticketSchema>;
