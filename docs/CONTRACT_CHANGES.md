# Proposed API contract changes

Proposals from the backend implementation. The backend implements `docs/API_CONTRACT.md` (v1) as written;
items marked **additive** are already live but don't change any existing shape, so current clients are unaffected.

## 1. Retry AI classification — `POST /admin/tickets/:id/classify` (additive, implemented)
**Why:** when classification fails, the ticket falls back to keyword triage with `aiStatus: FAILED` ("needs manual triage").
Admins need a way to retry once the AI is healthy again, and the contract has no endpoint for it.
**Shape:** no body → `202 AdminTicket` with `aiStatus: PENDING`. When the job finishes, `ticket.ai_ready` fires as usual.
Fields the admin has overridden are never overwritten. Rate-limited like `/draft`.

## 2. `ticketNumber` type (clarification)
The contract doesn't say what type this is. The backend returns an **integer** (auto-increment, starting at 1).
Display formatting, e.g. `#42` or `BL-0042`, is left to the client.

## 3. Admin queue filter extensions (additive, implemented)
- `status`, `category` and `priority` take one value or a **comma-separated list** (`?status=OPEN,IN_PROGRESS`).
- `assigneeId` also takes `me` and `unassigned`.
- `q` searches subject, description, author name and email, book title, and `#ticketNumber`.
- `to` given as a bare date (`2026-10-21`) includes that whole day.

## 4. SSE auth from browsers
The contract puts the Bearer token in the `Authorization` header, which the native `EventSource` can't send.
Clients need a fetch-based SSE client such as `@microsoft/fetch-event-source`.
**Proposal:** add `POST /events/ticket` that returns a single-use token valid for 60 seconds, and accept
`GET /events?ticket=...`. This works with the native `EventSource` and keeps long-lived JWTs out of URLs and logs.

## 5. Explicit `needsManualTriage` on AdminTicket
Today it's derived: `aiStatus === "FAILED"`. **Proposal:** add `needsManualTriage: boolean`, which is true when AI failed and
the admin hasn't overridden both category and priority. Then the queue can show a badge that clears once a human has triaged.

## 6. `draft.source: "FALLBACK"`
Per the contract, an AI failure returns `draft: null` plus `error`, so `FALLBACK` is never produced right now.
**Proposal:** either remove it, or use it for a deterministic template draft (acknowledgement + facts + "we'll update you
within 48 hours") returned *with* `error` when the AI is down, so admins still get a head start.

## 7. Error `details` item shape (clarification)
The backend always returns `details: { field: string, message: string }[]`. `field` is a dotted path
(`attachments.0.size`), or `(root)` for whole-body errors.

## 8. Behaviour the contract doesn't specify (clarification)
- `POST /admin/tickets/:id/reply` with no `status`: an `OPEN` ticket moves to `IN_PROGRESS`, and an unassigned ticket is
  assigned to the admin who replied.
- `POST /tickets/:id/messages` on a `RESOLVED` ticket reopens it (`OPEN`). On a `CLOSED` ticket it returns `409 CONFLICT`.
- `PATCH /admin/tickets/:id` with a category/priority equal to the current value is a no-op and doesn't set the
  `*Overridden` flag. Changing the category clears the cached draft, because the draft was grounded in the old category's KB.
- List endpoints leave out the `messages` key entirely, rather than returning `[]`.

---

# Clarifications from backend pass 2 (contract v1.1)

These describe how the backend already behaves where v1.1 is silent. None of them change a shape, and each one is
covered by a test.

## C1. The draft cache is also cleared when an admin replies
v1.1 lists two triggers: a category change and a new author message. `POST /admin/tickets/:id/reply` clears it too,
because the draft was either sent or replaced by what the admin wrote. The next `POST /draft` generates a fresh one.

## C2. `PATCH /admin/tickets/:id { "assigneeId": null }` unassigns
`null` clears the assignee. Omitting the key leaves it unchanged. A non-null value must be an admin's user id,
otherwise `400 VALIDATION_ERROR` with `field: "assigneeId"`.

## C3. Bare `from`/`to` dates are UTC
`from=2026-10-21` means `2026-10-21T00:00:00.000Z`, and `to=2026-10-21` means through `2026-10-21T23:59:59.999Z`.
For IST (UTC+5:30) users, a day filter is therefore off by 5.5 hours at each edge. Clients that need local days should
send full ISO timestamps with an offset, which the backend accepts as given. The `+` must be URL-encoded
(`from=2026-10-21T00:00:00%2B05:30`). An unencoded `+` decodes to a space, and the backend rejects that with
`400 VALIDATION_ERROR`.

## C4. Message length cap
`POST /tickets/:id/messages`, `POST /admin/tickets/:id/reply` and `POST /admin/tickets/:id/notes` accept a `body`
of 1 to 5000 characters after trimming, the same cap as a ticket `description`. Over the limit returns
`400 VALIDATION_ERROR` with `field: "body"`.

## C5. `POST /admin/tickets/:id/classify` on a ticket that is already `PENDING`
Returns `202` with the current ticket and starts no second job. No event fires, because nothing changed.
`ticket.ai_ready` arrives when the job that's already running finishes. The check-and-set is a single conditional
update, so two concurrent clicks can't both start a job.

## C6. `page` and `pageSize` are validated, not clamped
`page` must be an integer ≥ 1 and `pageSize` an integer from 1 to 100. Anything else returns `400 VALIDATION_ERROR`
with the field name, and is never silently corrected.

---

# Proposals from the frontend

The frontend implements v1 as written and was smoke-tested against the backend. Nothing below blocks it.

## F1. Endorse #1 (classify retry) and #6 (`FALLBACK` template draft)
- **#6:** the draft panel already handles `draft` and `error` arriving together. It shows the template draft with a
  "personalise before sending" note, so the backend can start returning it with no frontend change.
- **#1:** once `POST /admin/tickets/:id/classify` is in the contract, the AI panel's "needs manual triage" banner gets
  a "Retry AI" button. It isn't built yet, because it isn't in v1.

## F2. `lastMessageAt` and `lastMessageFrom` on ticket list items (additive)
**Why:** `GET /tickets` omits messages, so the author's list can't show "New reply from BookLeaf", and the admin queue
can't show "author replied, awaiting us". `updatedAt` also changes on status and assignee edits, so it's too noisy for this.
**Shape:** `lastMessageAt: string|null, lastMessageFrom: "AUTHOR"|"ADMIN"|null` on `AuthorTicket` and `AdminTicket`
list items.

## F3. Document #8 in the contract (clarification)
The frontend relies on two of these behaviours: the reply form's default status option reads "moves to In Progress"
for `OPEN` tickets, and the draft panel prompts a regenerate after a category change. Putting them in the contract
would let both sides test against the same rules.

## F4. `updatedAt` in SSE payloads (additive, optional)
`data: { ticketId, updatedAt }` would let clients skip a refetch when their cached copy is already that fresh. This
matters when several events for one ticket arrive together (`ticket.message` then `ticket.updated` on every reply).
