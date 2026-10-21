import { z } from "zod";

export const MAX_ATTACHMENTS = 5;
export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;

export const AttachmentSchema = z.object({
  name: z.string().trim().min(1, "Attachment name is required").max(255),
  size: z.number().int().positive().max(MAX_ATTACHMENT_BYTES, "Attachments must be 10 MB or smaller"),
});

export const CreateTicketSchema = z.object({
  bookId: z.string().trim().min(1).max(64).nullable(),
  subject: z.string().trim().min(3, "Subject must be at least 3 characters").max(120, "Subject must be at most 120 characters"),
  description: z
    .string()
    .trim()
    .min(10, "Description must be at least 10 characters")
    .max(5000, "Description must be at most 5000 characters"),
  attachments: z.array(AttachmentSchema).max(MAX_ATTACHMENTS, `At most ${MAX_ATTACHMENTS} attachments`).default([]),
});
export type CreateTicketInput = z.infer<typeof CreateTicketSchema>;

export const MessageBodySchema = z.object({
  body: z.string().trim().min(1, "Message cannot be empty").max(5000, "Message must be at most 5000 characters"),
});
export type MessageBodyInput = z.infer<typeof MessageBodySchema>;
