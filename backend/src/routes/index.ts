import { Router } from "express";
import type { Controllers } from "../container";
import { authenticate, requireRole } from "../middleware/auth";
import { validate } from "../middleware/validate";
import { aiRateLimit, loginRateLimit } from "../middleware/rateLimit";
import { mountRouter } from "../lib/routeTable";
import { LoginSchema } from "../schemas/authSchemas";
import { CreateTicketSchema, MessageBodySchema } from "../schemas/ticketSchemas";
import {
  AdminTicketQuerySchema,
  DraftRequestSchema,
  NoteSchema,
  ReplySchema,
  UpdateTicketSchema,
} from "../schemas/adminSchemas";

/** Mounted at /api/v1. Everything except POST /auth/login sits behind authenticate(). */
export function buildApiRouter(c: Controllers): Router {
  const api = Router();

  // --- public
  api.post("/auth/login", loginRateLimit, validate("body", LoginSchema), c.auth.login);

  // --- authenticated
  api.use(authenticate);
  api.get("/auth/me", c.auth.me);
  api.get("/events", c.events.stream);

  // --- author (role checked per route so it never shadows /admin/*)
  const asAuthor = requireRole("AUTHOR");
  api.get("/books", asAuthor, c.author.listBooks);
  api.post("/tickets", asAuthor, validate("body", CreateTicketSchema), c.author.createTicket);
  api.get("/tickets", asAuthor, c.author.listTickets);
  api.get("/tickets/:id", asAuthor, c.author.getTicket);
  api.post("/tickets/:id/messages", asAuthor, validate("body", MessageBodySchema), c.author.addMessage);

  // --- admin
  const admin = Router();
  admin.use(requireRole("ADMIN"));
  admin.get("/tickets", validate("query", AdminTicketQuerySchema), c.admin.listTickets);
  admin.get("/tickets/:id", c.admin.getTicket);
  admin.patch("/tickets/:id", validate("body", UpdateTicketSchema), c.admin.updateTicket);
  admin.post("/tickets/:id/assign-to-me", c.admin.assignToMe);
  admin.post("/tickets/:id/notes", validate("body", NoteSchema), c.admin.addNote);
  admin.post("/tickets/:id/draft", aiRateLimit, validate("body", DraftRequestSchema), c.admin.draft);
  admin.post("/tickets/:id/reply", validate("body", ReplySchema), c.admin.reply);
  admin.post("/tickets/:id/classify", aiRateLimit, c.admin.reclassify);
  admin.get("/admins", c.admin.listAdmins);
  mountRouter(api, "/admin", admin);

  return api;
}
