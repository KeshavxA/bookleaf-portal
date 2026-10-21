# BookLeaf Portal API Contract (v1)

Base path: /api/v1   JSON only.
Auth: Authorization: Bearer <jwt>. Roles: AUTHOR, ADMIN.
Errors always: { "error": { "code": "VALIDATION_ERROR|UNAUTHORIZED|FORBIDDEN|NOT_FOUND|CONFLICT|RATE_LIMITED|INTERNAL", "message": "...", "details": [] } }
Dates: ISO 8601 strings. Money: integers in INR.

Enums
- TicketStatus: OPEN | IN_PROGRESS | RESOLVED | CLOSED
- Category: ROYALTY_PAYMENTS | ISBN_METADATA | PRINTING_QUALITY | DISTRIBUTION_AVAILABILITY | BOOK_STATUS_PRODUCTION | GENERAL_INQUIRY
- Priority: CRITICAL | HIGH | MEDIUM | LOW
- AiStatus: PENDING | DONE | FAILED   (classification + priority run)

Shapes
Book: { id, title, isbn, genre, publicationDate|null, status, mrp|null, totalCopiesSold, totalRoyaltyEarned, royaltyPaid, royaltyPending, lastRoyaltyPayoutDate|null, printPartner|null, availableOn: string[] }
Message: { id, senderType: "AUTHOR"|"ADMIN", senderName, body, createdAt }
AuthorTicket: { id, ticketNumber, subject, description, status, book: {id,title}|null, attachments: {name,size}[], messages: Message[], createdAt, updatedAt }
   (authors never see category, priority, AI fields, assignee or internal notes)
AdminTicket: AuthorTicket + {
   category, priority, aiStatus,
   aiSuggestion: { category, priority, reasoning }|null,
   categoryOverridden: boolean, priorityOverridden: boolean,
   author: { id, name, email }, assignee: { id, name }|null,
   internalNotes: { id, adminName, body, createdAt }[],
   draft: { body, source: "AI"|"FALLBACK", generatedAt }|null
}

Auth
POST /auth/login            { email, password } -> { token, user: { id, name, email, role } }
GET  /auth/me               -> user

Author endpoints (role AUTHOR)
GET  /books                 -> Book[]   (all of the author's books, including in-production)
POST /tickets               { bookId: string|null, subject (3-120), description (10-5000), attachments?: {name,size}[] } -> 201 AuthorTicket
GET  /tickets               -> AuthorTicket[] (newest first, messages omitted)
GET  /tickets/:id           -> AuthorTicket (with messages)
POST /tickets/:id/messages  { body } -> 201 Message   (optional P1: author follow-up)

Admin endpoints (role ADMIN)
GET   /admin/tickets        query: status, category, priority, assigneeId, from, to, q, sort=urgency|oldest|newest (default urgency), page, pageSize
                            -> { items: AdminTicket[] (no messages), total, page, pageSize }
                            urgency = priority weight first, then oldest first among unresolved
GET   /admin/tickets/:id    -> AdminTicket (with messages, notes; draft may be null)
PATCH /admin/tickets/:id    { status?, category?, priority?, assigneeId? } -> AdminTicket
                            (changing category/priority sets the *Overridden flag)
POST  /admin/tickets/:id/assign-to-me -> AdminTicket
POST  /admin/tickets/:id/notes        { body } -> 201 note
POST  /admin/tickets/:id/draft        { regenerate?: boolean } -> 200 { draft: {...}|null, error?: { code, message } }
                            Returns the cached draft unless regenerate=true. If AI is down: draft=null and error set, still HTTP 200.
POST  /admin/tickets/:id/reply        { body, status?: TicketStatus } -> 201 Message  (visible to author)
GET   /admin/admins         -> { id, name }[]

Realtime
GET /events   (SSE, Bearer auth, text/event-stream). Scoped by role: authors only get their own tickets' events.
  event: ticket.created   data: { ticketId }          (admins only)
  event: ticket.updated   data: { ticketId }
  event: ticket.message   data: { ticketId }
  event: ticket.ai_ready  data: { ticketId }          (admins only)
Clients refetch the affected ticket on any event. Heartbeat comment every 25s.

Seed logins (password for all: Passw0rd!)
Authors: use each email in bookleaf_sample_data.json (e.g. priya.sharma@email.com)
Admins: admin1@bookleaf.com, admin2@bookleaf.com