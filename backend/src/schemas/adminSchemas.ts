import { z } from "zod";
import { CATEGORIES, PRIORITIES, TICKET_STATUSES } from "../domain/enums";
import { MessageBodySchema } from "./ticketSchemas";

/** Accepts a single value or a comma-separated list: ?status=OPEN,IN_PROGRESS */
const csvEnum = <T extends readonly [string, ...string[]]>(values: T) =>
  z.preprocess(
    (v) => (typeof v === "string" ? v.split(",").map((s) => s.trim()).filter(Boolean) : v),
    z.array(z.enum(values)).min(1),
  );

const dateParam = (endOfDay: boolean) =>
  z
    .string()
    .trim()
    .refine((s) => !Number.isNaN(Date.parse(s)), "Must be an ISO 8601 date")
    .transform((s) => {
      const d = new Date(s);
      // A bare date for `to` means "through the end of that day".
      if (endOfDay && /^\d{4}-\d{2}-\d{2}$/.test(s)) d.setUTCHours(23, 59, 59, 999);
      return d;
    });

export const AdminTicketQuerySchema = z
  .object({
    status: csvEnum(TICKET_STATUSES).optional(),
    category: csvEnum(CATEGORIES).optional(),
    priority: csvEnum(PRIORITIES).optional(),
    /** An admin user id, "me", or "unassigned". */
    assigneeId: z.string().trim().min(1).max(64).optional(),
    from: dateParam(false).optional(),
    to: dateParam(true).optional(),
    q: z.string().trim().min(1).max(200).optional(),
    sort: z.enum(["urgency", "oldest", "newest"]).default("urgency"),
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(20),
  })
  .refine((q) => !q.from || !q.to || q.from <= q.to, { message: "`from` must be before `to`", path: ["from"] });
export type AdminTicketQuery = z.infer<typeof AdminTicketQuerySchema>;

export const UpdateTicketSchema = z
  .object({
    status: z.enum(TICKET_STATUSES).optional(),
    category: z.enum(CATEGORIES).optional(),
    priority: z.enum(PRIORITIES).optional(),
    assigneeId: z.string().trim().min(1).max(64).nullable().optional(),
  })
  .strict()
  .refine((v) => Object.keys(v).length > 0, { message: "Provide at least one field to update" });
export type UpdateTicketInput = z.infer<typeof UpdateTicketSchema>;

export const NoteSchema = MessageBodySchema;

export const ReplySchema = MessageBodySchema.extend({
  status: z.enum(TICKET_STATUSES).optional(),
});
export type ReplyInput = z.infer<typeof ReplySchema>;

export const DraftRequestSchema = z.object({ regenerate: z.boolean().default(false) }).default({ regenerate: false });
