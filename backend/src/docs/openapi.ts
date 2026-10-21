/**
 * OpenAPI 3.1 description of /api/v1, served at /api/docs.
 * Request bodies are generated from the same zod schemas used for validation,
 * so docs and behaviour can't drift; response shapes mirror docs/API_CONTRACT.md.
 */
import { z } from "zod";
import { CATEGORIES, PRIORITIES, TICKET_STATUSES } from "../domain/enums";
import { LoginSchema } from "../schemas/authSchemas";
import { CreateTicketSchema, MessageBodySchema } from "../schemas/ticketSchemas";
import { NoteSchema, ReplySchema, UpdateTicketSchema } from "../schemas/adminSchemas";

const fromZod = (schema: z.ZodType) => {
  const { $schema: _ignored, ...json } = z.toJSONSchema(schema, { io: "input", unrepresentable: "any" }) as Record<
    string,
    unknown
  >;
  return json;
};

const ref = (name: string) => ({ $ref: `#/components/schemas/${name}` });
const json = (schema: unknown) => ({ "application/json": { schema } });
const body = (schema: z.ZodType) => ({ required: true, content: json(fromZod(schema)) });
const ok = (description: string, schema: unknown) => ({ description, content: json(schema) });
const err = (description: string) => ({ description, content: json(ref("Error")) });

const idParam = { name: "id", in: "path", required: true, schema: { type: "string" } };
const authErrors = { "401": err("Missing/invalid token"), "403": err("Wrong role") };
const nullable = (schema: Record<string, unknown>) => ({ anyOf: [schema, { type: "null" }] });

const schemas = {
  Error: {
    type: "object",
    required: ["error"],
    properties: {
      error: {
        type: "object",
        required: ["code", "message", "details"],
        properties: {
          code: {
            type: "string",
            enum: ["VALIDATION_ERROR", "UNAUTHORIZED", "FORBIDDEN", "NOT_FOUND", "CONFLICT", "RATE_LIMITED", "INTERNAL"],
          },
          message: { type: "string" },
          details: {
            type: "array",
            items: { type: "object", properties: { field: { type: "string" }, message: { type: "string" } } },
          },
        },
      },
    },
  },
  User: {
    type: "object",
    properties: {
      id: { type: "string" },
      name: { type: "string" },
      email: { type: "string" },
      role: { type: "string", enum: ["AUTHOR", "ADMIN"] },
    },
  },
  Book: {
    type: "object",
    properties: {
      id: { type: "string", example: "BK001" },
      title: { type: "string" },
      isbn: { type: "string" },
      genre: { type: "string" },
      publicationDate: nullable({ type: "string", format: "date" }),
      status: { type: "string", example: "Published & Live" },
      mrp: nullable({ type: "integer", description: "INR" }),
      totalCopiesSold: { type: "integer" },
      totalRoyaltyEarned: { type: "integer" },
      royaltyPaid: { type: "integer" },
      royaltyPending: { type: "integer" },
      lastRoyaltyPayoutDate: nullable({ type: "string", format: "date" }),
      printPartner: nullable({ type: "string" }),
      availableOn: { type: "array", items: { type: "string" } },
    },
  },
  Message: {
    type: "object",
    properties: {
      id: { type: "string" },
      senderType: { type: "string", enum: ["AUTHOR", "ADMIN"] },
      senderName: { type: "string" },
      body: { type: "string" },
      createdAt: { type: "string", format: "date-time" },
    },
  },
  InternalNote: {
    type: "object",
    properties: {
      id: { type: "string" },
      adminName: { type: "string" },
      body: { type: "string" },
      createdAt: { type: "string", format: "date-time" },
    },
  },
  Draft: {
    type: "object",
    properties: {
      body: { type: "string" },
      source: { type: "string", enum: ["AI", "FALLBACK"] },
      generatedAt: { type: "string", format: "date-time" },
    },
  },
  AuthorTicket: {
    type: "object",
    description: "Authors never see category, priority, AI fields, assignee or internal notes.",
    properties: {
      id: { type: "string" },
      ticketNumber: { type: "integer" },
      subject: { type: "string" },
      description: { type: "string" },
      status: { type: "string", enum: [...TICKET_STATUSES] },
      book: nullable({ type: "object", properties: { id: { type: "string" }, title: { type: "string" } } }),
      attachments: {
        type: "array",
        items: { type: "object", properties: { name: { type: "string" }, size: { type: "integer" } } },
      },
      messages: { type: "array", items: ref("Message"), description: "Omitted in list responses" },
      createdAt: { type: "string", format: "date-time" },
      updatedAt: { type: "string", format: "date-time" },
    },
  },
  AdminTicket: {
    allOf: [
      ref("AuthorTicket"),
      {
        type: "object",
        properties: {
          category: { type: "string", enum: [...CATEGORIES] },
          priority: { type: "string", enum: [...PRIORITIES] },
          aiStatus: {
            type: "string",
            enum: ["PENDING", "DONE", "FAILED"],
            description: "FAILED = keyword fallback was used; ticket needs manual triage",
          },
          aiSuggestion: nullable({
            type: "object",
            properties: {
              category: { type: "string", enum: [...CATEGORIES] },
              priority: { type: "string", enum: [...PRIORITIES] },
              reasoning: { type: "string" },
            },
          }),
          categoryOverridden: { type: "boolean" },
          priorityOverridden: { type: "boolean" },
          author: {
            type: "object",
            properties: { id: { type: "string" }, name: { type: "string" }, email: { type: "string" } },
          },
          assignee: nullable({ type: "object", properties: { id: { type: "string" }, name: { type: "string" } } }),
          internalNotes: { type: "array", items: ref("InternalNote") },
          draft: nullable(ref("Draft")),
        },
      },
    ],
  },
};

const csvParam = (name: string, values: readonly string[], description: string) => ({
  name,
  in: "query",
  schema: { type: "string" },
  description: `${description} One value or a comma-separated list of: ${values.join(", ")}`,
});

export const openApiSpec = {
  openapi: "3.1.0",
  info: {
    title: "BookLeaf Author Support Portal API",
    version: "1.0.0",
    description:
      "REST API for the BookLeaf author portal and admin support desk. Source of truth: docs/API_CONTRACT.md.\n\n" +
      "Authenticate with `POST /auth/login`, then click **Authorize** and paste the token.\n\n" +
      "Seed logins (password `Passw0rd!`): `priya.sharma@email.com` (author), `admin1@bookleaf.com` (admin).",
  },
  servers: [{ url: "/api/v1" }],
  security: [{ bearerAuth: [] }],
  tags: [{ name: "Auth" }, { name: "Author" }, { name: "Admin" }, { name: "Realtime" }],
  components: {
    securitySchemes: { bearerAuth: { type: "http", scheme: "bearer", bearerFormat: "JWT" } },
    schemas,
  },
  paths: {
    "/auth/login": {
      post: {
        tags: ["Auth"],
        summary: "Log in with email and password",
        security: [],
        requestBody: body(LoginSchema),
        responses: {
          "200": ok("JWT and user", {
            type: "object",
            properties: { token: { type: "string" }, user: ref("User") },
          }),
          "400": err("Validation error"),
          "401": err("Invalid credentials"),
          "429": err("Too many attempts"),
        },
      },
    },
    "/auth/me": {
      get: { tags: ["Auth"], summary: "Current user", responses: { "200": ok("User", ref("User")), "401": err("Unauthorized") } },
    },
    "/books": {
      get: {
        tags: ["Author"],
        summary: "The author's books (including in-production)",
        responses: { "200": ok("Books", { type: "array", items: ref("Book") }), ...authErrors },
      },
    },
    "/tickets": {
      post: {
        tags: ["Author"],
        summary: "Raise a support ticket",
        description:
          "Returns 201 immediately. AI classification runs in the background; admins receive `ticket.ai_ready` when done. " +
          "Ticket creation never fails because of the AI.",
        requestBody: body(CreateTicketSchema),
        responses: {
          "201": ok("Created", ref("AuthorTicket")),
          "400": err("Validation error (incl. bookId not owned by the author)"),
          ...authErrors,
        },
      },
      get: {
        tags: ["Author"],
        summary: "The author's tickets, newest first (messages omitted)",
        responses: { "200": ok("Tickets", { type: "array", items: ref("AuthorTicket") }), ...authErrors },
      },
    },
    "/tickets/{id}": {
      get: {
        tags: ["Author"],
        summary: "One of the author's tickets, with messages",
        parameters: [idParam],
        responses: {
          "200": ok("Ticket", ref("AuthorTicket")),
          "404": err("Not found (also returned for other authors' tickets)"),
          ...authErrors,
        },
      },
    },
    "/tickets/{id}/messages": {
      post: {
        tags: ["Author"],
        summary: "Author follow-up message",
        description: "Reopens a RESOLVED ticket and invalidates the cached AI draft. CLOSED tickets return 409.",
        parameters: [idParam],
        requestBody: body(MessageBodySchema),
        responses: {
          "201": ok("Message", ref("Message")),
          "400": err("Validation error"),
          "404": err("Not found"),
          "409": err("Ticket is closed"),
          ...authErrors,
        },
      },
    },
    "/admin/tickets": {
      get: {
        tags: ["Admin"],
        summary: "Ticket queue",
        description:
          "urgency (default) = unresolved first, then CRITICAL→LOW, then oldest first. `to` given as a bare date is inclusive of that day.",
        parameters: [
          csvParam("status", TICKET_STATUSES, "Filter by status."),
          csvParam("category", CATEGORIES, "Filter by category."),
          csvParam("priority", PRIORITIES, "Filter by priority."),
          {
            name: "assigneeId",
            in: "query",
            schema: { type: "string" },
            description: "An admin user id, `me`, or `unassigned`",
          },
          { name: "from", in: "query", schema: { type: "string", format: "date-time" } },
          { name: "to", in: "query", schema: { type: "string", format: "date-time" } },
          {
            name: "q",
            in: "query",
            schema: { type: "string" },
            description: "Search subject, description, author name/email, book title, or #ticketNumber",
          },
          { name: "sort", in: "query", schema: { type: "string", enum: ["urgency", "oldest", "newest"], default: "urgency" } },
          { name: "page", in: "query", schema: { type: "integer", minimum: 1, default: 1 } },
          { name: "pageSize", in: "query", schema: { type: "integer", minimum: 1, maximum: 100, default: 20 } },
        ],
        responses: {
          "200": ok("Page of tickets (messages omitted)", {
            type: "object",
            properties: {
              items: { type: "array", items: ref("AdminTicket") },
              total: { type: "integer" },
              page: { type: "integer" },
              pageSize: { type: "integer" },
            },
          }),
          "400": err("Invalid filter"),
          ...authErrors,
        },
      },
    },
    "/admin/tickets/{id}": {
      get: {
        tags: ["Admin"],
        summary: "Ticket detail with messages, notes and cached draft",
        parameters: [idParam],
        responses: { "200": ok("Ticket", ref("AdminTicket")), "404": err("Not found"), ...authErrors },
      },
      patch: {
        tags: ["Admin"],
        summary: "Update status / category / priority / assignee",
        description: "Changing category or priority sets the matching *Overridden flag; AI never overwrites an override.",
        parameters: [idParam],
        requestBody: body(UpdateTicketSchema),
        responses: {
          "200": ok("Updated ticket", ref("AdminTicket")),
          "400": err("Validation error (e.g. assignee is not an admin)"),
          "404": err("Not found"),
          ...authErrors,
        },
      },
    },
    "/admin/tickets/{id}/assign-to-me": {
      post: {
        tags: ["Admin"],
        summary: "Assign the ticket to the calling admin",
        parameters: [idParam],
        responses: { "200": ok("Updated ticket", ref("AdminTicket")), "404": err("Not found"), ...authErrors },
      },
    },
    "/admin/tickets/{id}/notes": {
      post: {
        tags: ["Admin"],
        summary: "Add an internal note (never visible to the author)",
        parameters: [idParam],
        requestBody: body(NoteSchema),
        responses: { "201": ok("Note", ref("InternalNote")), "400": err("Validation error"), "404": err("Not found"), ...authErrors },
      },
    },
    "/admin/tickets/{id}/draft": {
      post: {
        tags: ["Admin"],
        summary: "Get (or regenerate) the AI-drafted reply",
        description:
          "Returns the cached draft unless `regenerate=true`. The cache is cleared when the author sends a new message or the category changes. " +
          "If the AI is unavailable the response is still 200 with `draft: null` and `error` set, so the admin can reply manually.",
        parameters: [idParam],
        requestBody: {
          required: false,
          content: json({ type: "object", properties: { regenerate: { type: "boolean", default: false } } }),
        },
        responses: {
          "200": ok("Draft or AI error", {
            type: "object",
            properties: {
              draft: nullable(ref("Draft")),
              error: { type: "object", properties: { code: { type: "string" }, message: { type: "string" } } },
            },
          }),
          "404": err("Not found"),
          "429": err("AI rate limit"),
          ...authErrors,
        },
      },
    },
    "/admin/tickets/{id}/reply": {
      post: {
        tags: ["Admin"],
        summary: "Send a reply to the author",
        description:
          "Visible to the author immediately (SSE `ticket.message`). Defaults: OPEN → IN_PROGRESS if no status is given; unassigned tickets are assigned to the replying admin.",
        parameters: [idParam],
        requestBody: body(ReplySchema),
        responses: { "201": ok("Message", ref("Message")), "400": err("Validation error"), "404": err("Not found"), ...authErrors },
      },
    },
    "/admin/tickets/{id}/classify": {
      post: {
        tags: ["Admin"],
        summary: "Retry AI classification (proposed addition, see docs/CONTRACT_CHANGES.md)",
        description: "Sets aiStatus=PENDING and re-queues the ticket. Overridden fields are preserved.",
        parameters: [idParam],
        responses: { "202": ok("Ticket (aiStatus PENDING)", ref("AdminTicket")), "404": err("Not found"), ...authErrors },
      },
    },
    "/admin/admins": {
      get: {
        tags: ["Admin"],
        summary: "Admins available for assignment",
        responses: {
          "200": ok("Admins", {
            type: "array",
            items: { type: "object", properties: { id: { type: "string" }, name: { type: "string" } } },
          }),
          ...authErrors,
        },
      },
    },
    "/events": {
      get: {
        tags: ["Realtime"],
        summary: "Server-Sent Events stream",
        description:
          "`text/event-stream`, Bearer auth via the Authorization header (use a fetch-based SSE client). " +
          "Events: `ticket.created` (admins), `ticket.updated`, `ticket.message`, `ticket.ai_ready` (admins); data `{ ticketId }`. " +
          "Authors only receive events for their own tickets. Heartbeat comment every 25s.",
        responses: { "200": { description: "Event stream", content: { "text/event-stream": { schema: { type: "string" } } } }, "401": err("Unauthorized") },
      },
    },
  },
};
