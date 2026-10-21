# BookLeaf Portal API Contract (v1.1)

Base path: /api/v1   JSON only.
Auth: Authorization: Bearer <jwt>. Roles: AUTHOR, ADMIN.
Errors always: { "error": { "code": "VALIDATION_ERROR|UNAUTHORIZED|FORBIDDEN|NOT_FOUND|CONFLICT|RATE_LIMITED|INTERNAL", "message": "...", "details": [] } }
  details is { field: string, message: string }[]. field is a dotted path (e.g. attachments.0.size) or "(root)" for whole-body errors.
Dates: ISO 8601 strings. Money: integers in INR.
Rate limiting: login and AI endpoints (draft, classify) can return 429 RATE_LIMITED.

## Enums
- TicketStatus: OPEN | IN_PROGRESS | RESOLVED | CLOSED
- Category: ROYALTY_PAYMENTS | ISBN_METADATA | PRINTING_QUALITY | DISTRIBUTION_AVAILABILITY | BOOK_STATUS_PRODUCTION | GENERAL_INQUIRY
- Priority: CRITICAL | HIGH | MEDIUM | LOW
- AiStatus: PENDING | DONE | FAILED   (classification + priority run)

## Shapes
Book: { id, title, isbn, genre, publicationDate|null, status, mrp|null, totalCopiesSold, totalRoyaltyEarned, royaltyPaid, royaltyPending, lastRoyaltyPayoutDate|null, printPartner|null, availableOn: string[] }
Message: { id, senderType: "AUTHOR"|"ADMIN", senderName, body, createdAt }
AuthorTicket: { id, ticketNumber (integer, auto-increment from 1; client formats e.g. "#42"), subject, description, status, book: {id,title}|null, attachments: {name,size}[], messages: Message[], createdAt, updatedAt }
   (authors never see category, priority, AI fields, assignee or internal notes)
AdminTicket: AuthorTicket + {
   category, priority, aiStatus,
   aiSuggestion: { category, priority, reasoning }|null,
   categoryOverridden: boolean, priorityOverridden: boolean,
   author: { id, name, email }, assignee: { id, name }|null,
   internalNotes: { id, adminName, body, createdAt }[],
   draft: { body, source: "AI", generatedAt }|null
}
List endpoints (GET /tickets, GET /admin/tickets) omit the "messages" key entirely. Only the single-ticket GET returns it.

Derived client rules (no extra API fields):
- While aiStatus is PENDING, category and priority are provisional (keyword-based). Show them as "classifying...".
- needsManualTriage = aiStatus === "FAILED" && !(categoryOverridden && priorityOverridden)

## Auth
POST /auth/login            { email, password } -> { token, user: { id, name, email, role } }
GET  /auth/me               -> user

## Author endpoints (role AUTHOR)
GET  /books                 -> Book[]   (all of the author's books, including in-production)
POST /tickets               { bookId: string|null, subject (3-120), description (10-5000), attachments?: {name,size}[] } -> 201 AuthorTicket
                            bookId of another author's book -> 4xx
GET  /tickets               -> AuthorTicket[] (newest first, messages key omitted)
GET  /tickets/:id           -> AuthorTicket (with messages). Another author's ticket -> 404.
POST /tickets/:id/messages  { body } -> 201 Message   (author follow-up)
                            RESOLVED ticket: the message reopens it (status OPEN).
                            CLOSED ticket: 409 CONFLICT.

## Admin endpoints (role ADMIN)
GET   /admin/tickets        query:
                              status, category, priority: one value or comma-separated list (?status=OPEN,IN_PROGRESS)
                              assigneeId: a user id, or "me", or "unassigned"
                              from, to: ISO dates. A bare date for "to" (2026-10-21) includes that whole day.
                              q: searches subject, description, author name and email, book title, and #ticketNumber
                              sort=urgency|oldest|newest (default urgency), page, pageSize
                            -> { items: AdminTicket[] (no messages key), total, page, pageSize }
                            urgency = priority weight first, then oldest first among unresolved
GET   /admin/tickets/:id    -> AdminTicket (with messages, notes; draft may be null)
PATCH /admin/tickets/:id    { status?, category?, priority?, assigneeId? } -> AdminTicket
                            Changing category/priority to a different value sets the *Overridden flag.
                            Same value as current = no-op (flag not set).
                            Changing category clears the cached draft (it was grounded in the old category).
POST  /admin/tickets/:id/assign-to-me -> AdminTicket
POST  /admin/tickets/:id/notes        { body } -> 201 note
POST  /admin/tickets/:id/classify     (no body) -> 202 AdminTicket with aiStatus PENDING
                            Retries AI classification. Fields the admin has overridden are never overwritten.
                            ticket.ai_ready fires when done. Rate limited.
POST  /admin/tickets/:id/draft        { regenerate?: boolean } -> 200 { draft: {...}|null, error?: { code, message } }
                            Returns the cached draft unless regenerate=true.
                            Cache is cleared when the category changes or a new author message arrives.
                            If AI is down: draft=null and error set, still HTTP 200. Rate limited.
POST  /admin/tickets/:id/reply        { body, status?: TicketStatus } -> 201 Message  (visible to author)
                            No status given: an OPEN ticket moves to IN_PROGRESS, and an unassigned ticket is
                            assigned to the admin who replied.
GET   /admin/admins         -> { id, name }[]

## Realtime
GET /events   (SSE, Bearer auth in the Authorization header, text/event-stream).
  Browsers' native EventSource cannot send headers, so clients must use a fetch-based SSE client
  (@microsoft/fetch-event-source).
  Scoped by role: authors only get their own tickets' events.
  event: ticket.created   data: { ticketId }          (admins only)
  event: ticket.updated   data: { ticketId }
  event: ticket.message   data: { ticketId }
  event: ticket.ai_ready  data: { ticketId }          (admins only)
Clients refetch the affected ticket on any event. Heartbeat comment every 25s.

## Seed logins (password for all: Passw0rd!)
Authors: use each email in bookleaf_sample_data.json (e.g. priya.sharma@email.com)
Admins: admin1@bookleaf.com, admin2@bookleaf.com
