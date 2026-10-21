# BookLeaf Portal: Frontend

React + Vite + TypeScript SPA for the BookLeaf Author Support & Communication Portal. It covers both
interfaces: the **author portal** (books, queries, live ticket threads) and the **admin portal**
(triage queue, AI-assisted replies, ticket management).

It's built against [`docs/API_CONTRACT.md`](../docs/API_CONTRACT.md) and runs either on an in-browser
mock of that contract (MSW) or on the real backend.

## Quick start

```bash
cd frontend
npm install
npm run dev          # http://localhost:5173, mock mode by default
npm test             # vitest + Testing Library
npm run build        # type-check + production build to dist/
```

Demo logins (password `Passw0rd!` for all):

| Role   | Email                                                    | Good for                                |
| ------ | -------------------------------------------------------- | --------------------------------------- |
| Author | `priya.sharma@email.com`                                 | Live books, a resolved and an open ticket |
| Author | `kavita.deshmukh@email.com` / `sneha.kulkarni@email.com` | Books still in production               |
| Author | `ananya.reddy@email.com`                                 | Zero payouts so far                     |
| Admin  | `admin1@bookleaf.com`, `admin2@bookleaf.com`             | Queue and ticket workspace              |

Every author in `backend/seed/bookleaf_sample_data.json` can log in. In mock or dev mode, the login page
lists clickable demo accounts.

## Mock mode vs real API

Configuration lives in `.env.development`, with documented defaults in `.env.example`:

| Variable           | Default            | Purpose                                                                                 |
| ------------------ | ------------------ | --------------------------------------------------------------------------------------- |
| `VITE_USE_MOCKS`   | `true`             | Serve every API call, including SSE, from MSW in the browser.                           |
| `VITE_API_URL`     | `/api/v1`          | API base including `/api/v1`. A relative URL goes through the Vite dev proxy (no CORS). |
| `DEV_PROXY_TARGET` | `http://localhost:4000` | Dev server only: where `/api` is proxied.                                          |
| `VITE_MOCK_AI_DOWN`| `false`            | Mock only: every draft request fails, to show the manual-reply fallback.               |

**Switching to the real backend is one line:** set `VITE_USE_MOCKS=false`. The default
`VITE_API_URL=/api/v1` then proxies to the backend on `:4000`. For a deployed build, set
`VITE_API_URL=https://your-api.example.com/api/v1` and add the frontend origin to the backend's
`CORS_ORIGINS`.

This switch was smoke-tested against the real backend (AI disabled). Every endpoint's response shape
matched `src/api/types.ts`, and SSE `ticket.message` and `ticket.updated` events reached the author through
the dev proxy.

### What the mock does

- **Data:** imported directly from `backend/seed/bookleaf_sample_data.json`, so the source of truth is
  shared, plus 12 scripted tickets covering every status, priority and category. These include overdue
  tickets, an AI override, and a ticket whose AI classification **failed**.
- **Persistence:** the mock DB is saved to `localStorage`, so it survives reloads and switching between
  author and admin accounts in the same tab. Use **reset data** in the header to reseed.
- **AI stand-ins:** classification finishes about 2.5s after a ticket is created and emits
  `ticket.ai_ready`. Drafts take about 1.2s and are templated from the knowledge base, using the book's
  real royalty figures and the next payout date. Draft requests fail for `aiStatus: FAILED` tickets, or
  for all tickets when `VITE_MOCK_AI_DOWN=true`.
- **Live demo helper:** 15 seconds after an author submits a ticket, a scripted
  *"BookLeaf Support (demo auto-reply)"* message arrives over SSE. This lets you see live updates
  without a second browser. It's skipped if an admin has already replied. **This exists only in mock
  mode.**
- **Server rules:** the mock follows the backend behaviour documented in `docs/CONTRACT_CHANGES.md` #8. A reply
  with no status moves `OPEN` to `IN_PROGRESS` and assigns the ticket to the replier if it's unassigned. Setting
  the current category or priority again is a no-op. A category change drops the cached draft.
- **Realtime:** `GET /events` returns a streaming `text/event-stream` response fed by an in-memory event
  bus. It uses the same role scoping as the contract: authors only get events for their own tickets, and
  never `ticket.created` or `ticket.ai_ready`.

The mock is dynamically imported only when `VITE_USE_MOCKS=true`. Production builds contain no MSW,
seed data or demo credentials (checked by grepping `dist/`).

## Structure

```
src/
  api/            Typed client: types.ts mirrors the contract; client.ts is the single fetch wrapper;
                  endpoints.ts (one function per endpoint); queryKeys.ts
  features/
    auth/         AuthContext (token in localStorage, /auth/me on boot), RequireRole guards, LoginPage
    books/        BooksPage, BookCard, bookUtils (production stage, payout threshold)
    tickets/      Author: NewTicketPage (+AttachmentPicker), TicketsPage, TicketDetailPage, hooks
    admin/        QueuePage (+QueueFilters, QueueTable, URL-synced queueParams), AdminTicketPage,
                  AiPanel, DraftReplyPanel, ManagementPanel (status, assignee, internal notes), hooks
  components/     Shared UI: Badge, Button, Field (label/hint/error wiring), Skeleton, States
                  (Empty/Error/Banner), MessageThread, UpdatedCue, LiveIndicator, AppShell, Panel
  hooks/          useEventStream (SSE), useRealtime (provider + polling fallback), useChangeCue,
                  useNow, useDebouncedValue
  lib/            config, format (INR, dates, ages), labels (enum to label and colour), tokenStorage
  mocks/          MSW handlers, in-browser DB, seed builder, AI stand-ins
  test/           Test utilities and end-to-end author and admin flows against the MSW handlers
```

### Routes

| Path                 | Role   | Page                         |
| -------------------- | ------ | ---------------------------- |
| `/login`             | public | Login                        |
| `/`                  | any    | Redirects by role            |
| `/books`             | AUTHOR | My Books                     |
| `/tickets`           | AUTHOR | My Tickets                   |
| `/tickets/new`       | AUTHOR | Submit Query (`?bookId=` preselects a book) |
| `/tickets/:id`       | AUTHOR | Ticket thread                |
| `/admin`             | ADMIN  | Queue (filters live in the URL) |
| `/admin/tickets/:id` | ADMIN  | Ticket workspace             |

Signing in with the wrong role for a URL redirects you to your own home page.

## Key decisions

- **One fetch wrapper** (`api/client.ts`) attaches the bearer token, parses the contract's
  `{ error: { code, message, details } }` shape into an `ApiError`, and calls the registered logout
  handler on any 401 from an authenticated request. A 401 on login is just "wrong password".
  `fieldErrors()` maps `details[{ field, message }]` onto form fields.
- **Server state lives in TanStack Query.** Queries don't retry on 4xx. Mutations disable their buttons
  while pending.
- **Realtime: invalidate, don't patch.** A single SSE connection per session (`RealtimeProvider`)
  invalidates the affected queries on each event, and the data is always refetched. That keeps role
  scoping and data shapes on the server. While the stream is anything other than `open`, every live query
  polls every 10s, and the header shows *"Reconnecting · polling every 10s"*. Reconnects back off
  exponentially (1s to 30s). A 401 on the stream logs out instead of retrying.
- **SSE via `@microsoft/fetch-event-source`**, because native `EventSource` can't send an `Authorization`
  header.
- **"Updated just now" cue.** `useChangeCue` compares a signature of the visible data with the previous
  one, so it works for both SSE and polling and never fires on first load. Newly arrived messages are
  highlighted and marked *New*. On the queue, the cue is scoped to the current filters, so changing a
  filter isn't reported as a live update.
- **Optimistic updates only where safe:** status, category and priority PATCHes are applied immediately
  and rolled back on error. Replies, notes and assignment wait for the server, because the server owns the
  message id, timestamp and assignee name.
- **AI draft UX.** The draft is requested automatically when a ticket opens, and modelled as a query
  because the endpoint returns the cached draft unless `regenerate: true`. The admin's edits are never
  overwritten: Regenerate asks first if the text was changed. If `draft` is null or the request fails, a
  calm banner says *"AI drafting is unavailable, write your reply manually"* and the textarea stays fully
  usable. A `FALLBACK` draft returned together with `error` is shown with a "template" note, which
  supports proposal 6 in `docs/CONTRACT_CHANGES.md`. After a send, the cached draft is marked stale so
  the next visit gets a fresh one.
- **Product touches:** queue filters are in the URL (shareable, and kept when you go back from a ticket).
  Critical and High rows get a coloured edge. Open tickets older than 3 days show ⚠ with screen-reader
  text. Book cards explain the in-production stage and the ₹1,000 payout rollover. Each book links to a
  prefilled query.
- **Accessibility:** every control has a label (`Field` wires label, hint and error through
  `aria-describedby`). Loading regions are `role="status"` with names. The live cue is `aria-live`.
  There's a skip link and visible focus rings.
- **No secrets.** The frontend never talks to an LLM. All AI goes through the backend.

## Tests

`npm test` runs 21 tests:

- `hooks/useEventStream.test.ts`: auth header, open, event filtering, drops and backoff, 401 stops
  retrying, abort on unmount (`fetch-event-source` is mocked).
- `features/admin/DraftReplyPanel.test.tsx`: skeleton then draft, `draft: null` banner with manual send,
  request failure, needs-manual-triage note, Regenerate not clobbering edits.
- `features/books/BookCard.test.tsx`: INR formatting, "No payouts yet", in-production dashes and stage,
  payout threshold note.
- `test/authorFlow.test.tsx` and `test/adminFlow.test.tsx`: full journeys through the real router and the
  MSW handlers (`msw/node`), including **SSE-driven** live updates (an admin reply appearing on the author's
  open ticket, a new ticket appearing in the queue), the AI override marker, reply with status change,
  assign-to-me, internal notes, and the failed-AI ticket.

## Known limitations

- **Browser SSE in mock mode wasn't checked by hand.** The SSE path is covered end to end in Node
  (`msw/node`) and was smoke-tested against the real backend, but MSW streaming through a browser service
  worker wasn't exercised in a real browser during development. If a browser kills the long-lived worker
  response, the hook reconnects and the 10s polling fallback keeps the UI current.
- **Half-open connections:** `fetch-event-source` ignores comment lines, so the 25s heartbeat can't be
  used as a watchdog. A silently stalled connection is only noticed when the socket errors.
- **The token is stored in `localStorage`**, as the brief asks. An httpOnly cookie would be safer against
  XSS.
- **Attachments are metadata only** (name and size), with a 5-file and 10 MB limit enforced client-side.
  No upload.
- **Mock admin names** (Neha Gupta, Rahul Verma) differ from the backend seed. Only the emails match.
- There's no "Retry AI classification" button: `POST /admin/tickets/:id/classify` exists in the backend
  but isn't in contract v1 yet.
- No route-level code splitting (the JS bundle is about 148 KB gzipped). There are no toasts or desktop
  notifications for new tickets, and Regenerate uses the native `confirm()` dialog.
