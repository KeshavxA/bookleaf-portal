# BookLeaf Portal: Frontend

React + Vite + TypeScript SPA for the BookLeaf Author Support & Communication Portal. It covers both
interfaces: the **author portal** (books, queries, live ticket threads) and the **admin portal**
(triage queue, AI-assisted replies, ticket management).

It's built against [`docs/API_CONTRACT.md`](../docs/API_CONTRACT.md) (**v1.1**) and runs either on an
in-browser mock of that contract (MSW) or on the real backend.

## Quick start

```bash
cd frontend
npm install
npm run dev          # http://localhost:5173, mock mode by default
npm test             # vitest + Testing Library
VITE_API_URL=https://your-api.example.com/api/v1 npm run build:verify   # production build + bundle check
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
| `VITE_USE_MOCKS`   | `true`             | Dev only: serve every API call, including SSE, from MSW. Production builds refuse `true`. |
| `VITE_API_URL`     | `/api/v1`          | API base including `/api/v1`. A relative URL goes through the Vite dev proxy (no CORS). |
| `DEV_PROXY_TARGET` | `http://localhost:4000` | Dev server only: where `/api` is proxied.                                          |
| `VITE_MOCK_AI_DOWN`| `false`            | Mock only: drafts and classification fail, to show the manual fallbacks.               |

**Switching to the real backend is one line:** set `VITE_USE_MOCKS=false`. The default
`VITE_API_URL=/api/v1` then proxies to the backend on `:4000`. For a deployed build, set
`VITE_API_URL=https://your-api.example.com/api/v1` and add the frontend origin to the backend's
`CORS_ORIGINS`.

This switch was smoke-tested against the real backend (AI disabled) before the v1.1 update. Every endpoint's
response shape matched the types, and SSE events reached the author through the dev proxy. The v1.1 additions
(`/classify`, comma-separated filters, `me`/`unassigned`) are checked against the mock contract suite
(`src/mocks/handlers.test.ts`), not yet against the live backend.

### What the mock does

- **Data:** imported directly from `backend/seed/bookleaf_sample_data.json`, so the source of truth is
  shared, plus 12 scripted tickets covering every status, priority and category. These include overdue
  tickets, an AI override, and a ticket whose AI classification **failed**.
- **Persistence:** the mock DB is saved to `localStorage`, so it survives reloads and switching between
  author and admin accounts in the same tab. Use **reset data** in the header to reseed.
- **AI stand-ins:** a new ticket starts `PENDING` with provisional keyword-based category and priority.
  Classification finishes about 2.5s later and emits `ticket.ai_ready`. `POST /classify` retries it the same
  way (202, `PENDING`) and never overwrites fields the admin has overridden. Drafts take about 1.2s and are
  templated from the knowledge base, using the book's real royalty figures and the next payout date. Draft
  requests fail for `aiStatus: FAILED` tickets until triage is retried, or for everything when
  `VITE_MOCK_AI_DOWN=true`. Draft and classify are rate limited like the backend (20 per minute per admin,
  then 429).
- **Live demo helper:** 15 seconds after an author submits a ticket, a scripted
  *"BookLeaf Support (demo auto-reply)"* message arrives over SSE. This lets you see live updates
  without a second browser. It's skipped if an admin has already replied. **This exists only in mock
  mode.**
- **Server rules (v1.1):** list endpoints omit the `messages` key. Queue filters take comma-separated
  values, `assigneeId=me|unassigned`, `#number` search, and bare dates read in UTC (a bare `to` runs to
  23:59:59.999 UTC, matching the backend). A reply with no status moves `OPEN` to `IN_PROGRESS` and assigns
  an unassigned ticket to the replier. Setting the current category or priority again is a no-op. The cached
  draft is cleared on a category change and on a new author message, and also on an admin reply, which the
  backend does too. Follow-ups reopen `RESOLVED` tickets; `CLOSED` returns 409. Validation errors use
  `{ field, message }` with dotted paths and `(root)`.
- **Realtime:** `GET /events` returns a streaming `text/event-stream` response fed by an in-memory event
  bus. It uses the same role scoping as the contract: authors only get events for their own tickets, and
  never `ticket.created` or `ticket.ai_ready`.

Mocks can't run in a production build. `USE_MOCKS` is gated on `!import.meta.env.PROD`, so `vite build`
folds it to `false` and drops the MSW import. The worker file is served by a dev-server-only plugin
rather than from `public/`, and `vite build` fails if `VITE_USE_MOCKS=true`. `npm run build:verify` and
`scripts/prodBuild.test.mjs` check the output for MSW, mock data and demo credentials.

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
  components/     Shared UI: Badge, Button, Field (label/hint/error wiring), MultiSelect, Skeleton, States
                  (Empty/Error/Banner), MessageThread, UpdatedCue, LiveIndicator, AppShell, Panel
  hooks/          useEventStream (SSE), useRealtime (provider + polling fallback), useChangeCue,
                  useNow, useDebouncedValue
  lib/            config, format (INR, dates, ages, formatTicketNumber), labels, aiState (isClassifying,
                  needsManualTriage), serverErrors (contract errors → react-hook-form), tokenStorage
  mocks/          MSW handlers, in-browser DB, seed builder, AI stand-ins
  test/           Test utilities and end-to-end author and admin flows against the MSW handlers
scripts/          verify-prod-build.mjs (bundle check) and prodBuild.test.mjs (real build in a test)
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
  `applyServerErrors()` (in `lib/serverErrors.ts`) maps each `details[].field` dotted path onto the matching
  react-hook-form field with `setError`. `(root)` and paths with no input of their own (like
  `attachments.0.size`, shown as "Attachment 1 size") become one form-level message. Any 429
  `RATE_LIMITED` reads *"Too many requests, try again shortly."*
- **List and detail types are separate** (`AuthorTicketSummary` / `AuthorTicket`, `AdminTicketSummary` /
  `AdminTicket`). List items have no `messages` field, so the compiler stops list views from reading it.
  `ticketNumber` is a number and is only ever rendered through `formatTicketNumber` (`#42`).
- **Server state lives in TanStack Query.** Queries don't retry on 4xx. Mutations disable their buttons
  while pending.
- **Realtime: invalidate, don't patch.** A single SSE connection per session (`RealtimeProvider`)
  invalidates the affected queries on each event, and the data is always refetched. That keeps role
  scoping and data shapes on the server. While the stream is anything other than `open`, every live query
  polls every 10s, and the header shows *"Reconnecting · polling every 10s"*. Reconnects back off
  exponentially (1s to 30s). A 401 on the stream logs out instead of retrying.
- **SSE via `@microsoft/fetch-event-source`**, as the contract requires, because native `EventSource`
  can't send an `Authorization` header. The token never goes in the URL.
- **"Updated just now" cue.** `useChangeCue` compares a signature of the visible data with the previous
  one, so it works for both SSE and polling and never fires on first load. Newly arrived messages are
  highlighted and marked *New*. On the queue, the cue is scoped to the current filters, so changing a
  filter isn't reported as a live update.
- **Optimistic updates only where safe:** status, category and priority PATCHes are applied immediately
  and rolled back on error. Replies, notes and assignment wait for the server, because the server owns the
  message id, timestamp and assignee name.
- **AI states.** While `aiStatus` is `PENDING`, category and priority are shown dimmed as provisional,
  with a *"Classifying..."* label in the queue, the ticket header and the AI panel. `ticket.ai_ready`
  refetches the ticket. `needsManualTriage` is derived exactly as the contract states and drives a badge in
  the queue and on the ticket, plus a **Retry AI triage** button (`POST /classify`), disabled while in flight.
- **AI draft UX.** The draft is requested automatically when a ticket opens, and modelled as a query
  because the endpoint returns the cached draft unless `regenerate: true`. It's requested again after a
  category change and when a new author message appears in the thread (via SSE or polling), since the
  server clears its cache in both cases. The admin's edits are never overwritten. A background refresh shows
  *"Updating draft…"* without hiding the text, and a newer draft is offered with a "Replace my text with it"
  link. Regenerate asks first if the text was changed. If `draft` is null or the request fails (including
  429), a calm banner says *"AI drafting is unavailable, write your reply manually"* and the textarea stays
  fully usable.
- **Reply defaults.** "Set status on send" is optional. Its default option says what the server will do
  (*"Default (moves to In Progress)"* on `OPEN` tickets). After sending, the ticket is refetched before the
  mutation settles, and the banner shows the resulting status and assignee.
- **Author follow-ups.** The reply box warns *"Replying will reopen this ticket"* on `RESOLVED` tickets and
  is replaced by *"This ticket is closed"* on `CLOSED` ones. If a follow-up hits 409 because the ticket
  closed meanwhile, the ticket is refetched and the unsent text is shown so it isn't lost.
- **Product touches:** queue filters are in the URL (shareable, and kept when you go back from a ticket).
  Critical and High rows get a coloured edge. Open tickets older than 3 days show ⚠ with screen-reader
  text. Book cards explain the in-production stage and the ₹1,000 payout rollover. Each book links to a
  prefilled query.
- **Accessibility:** every control has a label (`Field` wires label, hint and error through
  `aria-describedby`). Loading regions are `role="status"` with names. The live cue is `aria-live`.
  There's a skip link and visible focus rings.
- **No secrets.** The frontend never talks to an LLM. All AI goes through the backend.
- **Multi-tab sessions.** The token in `localStorage` is shared by every tab. `AuthProvider` listens for
  `storage` events on the token key and re-checks `/auth/me`. The `SessionWatcher` root layout then
  redirects the tab to the new user's home, or to `/login` (*"You were signed out in another tab"*) if
  the token was removed. Cached queries are cleared whenever the identity changes. As a backstop, the
  fetch wrapper re-checks the session on any 403 before showing it. A 403 that survives the re-check
  shows *"You don't have access to this"*. 4xx responses are never retried.

## Tests

`npm test` runs 89 tests:

- `hooks/useEventStream.test.ts`: auth header, open, event filtering, drops and backoff, 401 stops
  retrying, abort on unmount (`fetch-event-source` is mocked).
- `features/admin/DraftReplyPanel.test.tsx`: skeleton then draft, `draft: null` banner with manual send (no
  status sent by default), request failure, needs-manual-triage note, re-draft on a new author message, a
  newer draft offered instead of overwriting edits, a 429 on Regenerate, Regenerate not clobbering edits.
- `features/admin/AiPanel.test.tsx`: provisional `PENDING` state, Retry AI triage (disabled in flight, 202
  → `PENDING`), 429 message, no prompt once both fields are overridden.
- `features/admin/queueParams.test.ts`: multi-value URL parsing and round-trip, `me`/`unassigned`, bare
  dates, comma-separated query string, `formatTicketNumber`, the `needsManualTriage` truth table.
- `features/tickets/authorTickets.test.tsx`: `#42`, the reopen hint, the closed state, the 409 path, server
  field errors on the follow-up and new-ticket forms (dotted paths, `(root)`, 429).
- `lib/serverErrors.test.ts`: field/root mapping and rate-limit wording.
- `features/auth/multiTab.test.tsx`: `storage` events (admin→author goes to `/books`, author→admin goes to
  `/admin`, sign-out goes to `/login`, same user stays and adopts the new token, other keys ignored), the
  403 re-check (swapped token redirects; a genuine 403 shows the access message and isn't retried) and the
  retry rule.
- `features/admin/QueuePage.test.tsx`: the default request sends `sort=urgency`, clearing returns to it.
- `lib/config.test.ts`: `USE_MOCKS` is false in production even if `VITE_USE_MOCKS=true`.
- `scripts/prodBuild.test.mjs`: runs a real production build. Checks no MSW, mock data or demo password,
  no worker file, an absolute API URL and no relative `/api/v1`, and that unsafe env is refused.
- `mocks/handlers.test.ts`: the mock layer against contract v1.1 (no `messages` on lists, filters, PATCH
  no-op, `/classify`, reply defaults, follow-up rules, error details, 429).
- `features/books/BookCard.test.tsx`: INR formatting, "No payouts yet", in-production dashes and stage,
  payout threshold note.
- `test/authorFlow.test.tsx` and `test/adminFlow.test.tsx`: full journeys through the real router and the
  MSW handlers (`msw/node`), including **SSE-driven** live updates (an admin reply appearing on the author's
  open ticket, a new ticket appearing in the queue as "Classifying..." until `ai_ready`), multi-value
  filters, `#number` search, a draft re-requested after an override and after an author follow-up, reply
  defaults, internal notes, and Retry AI triage on the failed-AI ticket.

## Deploying

The frontend is a static site (`dist/`) that talks to a separately hosted backend. `VITE_*` variables are
**inlined at build time**, so changing `VITE_API_URL` means rebuilding and redeploying.

Production env (see `.env.production.example`):

| Variable         | Value                                            |
| ---------------- | ------------------------------------------------ |
| `VITE_API_URL`   | Absolute backend URL with `/api/v1`, e.g. `https://bookleaf-api.onrender.com/api/v1` |
| `VITE_USE_MOCKS` | `false` (the build refuses `true`)               |

The build fails if `VITE_API_URL` is missing, and warns if it's relative, because nothing proxies `/api` on
a static host. Every deep link (`/tickets/:id`, `/admin/tickets/:id`) needs an SPA rewrite to `/index.html`.

### Render (static site)

1. Either use the Blueprint: **New → Blueprint**, pick this repo, and set the Blueprint path to
   `frontend/render.yaml` (or copy its service into a repo-root `render.yaml`). Or create it by hand:
   **New → Static Site** with Root Directory `frontend`, Build Command `npm ci && npm run build` and
   Publish Directory `dist`.
2. Set `VITE_API_URL` under Environment. The Blueprint leaves it `sync: false` so you're prompted for it.
3. By hand only: under **Redirects/Rewrites**, add Source `/*`, Destination `/index.html`, Action
   **Rewrite**. The Blueprint already includes this.
4. Deploy, then add the site's origin (e.g. `https://bookleaf-portal-web.onrender.com`) to the backend's
   `CORS_ORIGINS` and restart the backend.

### Vercel

1. Import the repo and set **Root Directory** to `frontend`. `vercel.json` sets the Vite framework, the
   build command, `dist` as output and the SPA rewrite.
2. Add `VITE_API_URL` (and `VITE_USE_MOCKS=false`) under Settings → Environment Variables for Production
   (and Preview, if you use preview deploys).
3. Deploy, then add the Vercel origin to the backend's `CORS_ORIGINS`. Preview deploys get a new URL each
   time, so either allow them explicitly or test against Production only.

### Railway

Railway has no static-site rewrite config like the two above. Set Root Directory `frontend`, Build
Command `npm ci && npm run build`, and Start Command `npx serve@14 -s dist -l $PORT` (`-s` gives the SPA
fallback). Set `VITE_API_URL` as a service variable; it must be present at build time. This route wasn't
tested.

### Backend CORS (required)

The browser calls the API cross-origin and sends `Authorization: Bearer …` on every authenticated
request, including the SSE stream (`@microsoft/fetch-event-source` is a `fetch`). That triggers a
preflight, so the backend must answer `OPTIONS` with:

| Header                         | Value                                                          |
| ------------------------------ | -------------------------------------------------------------- |
| `Access-Control-Allow-Origin`  | The exact frontend origin, e.g. `https://bookleaf-portal-web.onrender.com` (no path, no trailing slash) |
| `Access-Control-Allow-Methods` | `GET, POST, PATCH, OPTIONS`                                    |
| `Access-Control-Allow-Headers` | `Authorization, Content-Type`                                  |
| `Vary`                         | `Origin`                                                       |

`Accept: text/event-stream` is a CORS-safelisted header, so it needn't be listed. No cookies are used, so
`Access-Control-Allow-Credentials` isn't needed. The real responses, including the long-lived
`GET /events` stream, must carry `Access-Control-Allow-Origin` too. The backend already does all of this
for whatever is listed in `CORS_ORIGINS` (comma-separated), so a deploy only needs the frontend origin
added there.

### Checking a production build locally

```bash
VITE_API_URL=http://localhost:4000/api/v1 npm run build:verify
npx vite preview            # http://localhost:4173, no dev proxy
```

Add `http://localhost:4173` to the backend's `CORS_ORIGINS` (the default only allows `:5173` and `:3000`),
or the browser will block login.

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
- **Date filters are UTC days.** The contract says bare dates but not their time zone; the backend reads
  them in UTC. For an admin in India (UTC+5:30), tickets created between 00:00 and 05:30 IST count towards
  the previous day.
- **Multi-select keyboard support is basic:** Tab through the checkboxes and press Escape to close. It has
  no arrow-key roving focus.
- No route-level code splitting (the JS bundle is about 148 KB gzipped). There are no toasts or desktop
  notifications for new tickets, and Regenerate uses the native `confirm()` dialog.
