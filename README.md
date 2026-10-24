# BookLeaf Author Support Portal

A support portal for BookLeaf's authors and support team. Authors see their books and raise tickets, and admins work a
triage queue in which AI sets each ticket's category and priority and drafts a reply for the admin to edit and send.

| Part | Folder | Detail |
|---|---|---|
| REST API, database, AI | [`backend/`](backend/) | [`backend/README.md`](backend/README.md), [`backend/docs/AI_DESIGN.md`](backend/docs/AI_DESIGN.md) |
| React SPA (author and admin portals) | [`frontend/`](frontend/) | [`frontend/README.md`](frontend/README.md) |
| API contract both sides were built against | [`docs/`](docs/) | [`docs/API_CONTRACT.md`](docs/API_CONTRACT.md) (v1.1), [`docs/CONTRACT_CHANGES.md`](docs/CONTRACT_CHANGES.md) |

## Live demo

Verified working on 24 Oct 2026.

| What | URL |
|---|---|
| App | https://bookleaf-portal-web.onrender.com |
| API | https://bookleaf-api-rfcy.onrender.com |
| API docs (Swagger) | https://bookleaf-api-rfcy.onrender.com/api/docs |
| Health | https://bookleaf-api-rfcy.onrender.com/health |

**Test logins.** The password for every account is `Passw0rd!`. Every author email in
[`backend/seed/bookleaf_sample_data.json`](backend/seed/bookleaf_sample_data.json) can log in. These are the most
useful:

| Role | Email | Why use it |
|---|---|---|
| Author | `ananya.reddy@email.com` | Never paid; a Critical royalty case |
| Author | `kavita.deshmukh@email.com` | One book in production, and ₹850 pending, below the ₹1,000 payout threshold |
| Author | `sneha.kulkarni@email.com` | One book in cover design |
| Author | `priya.sharma@email.com` | ₹3,570 pending |
| Admin | `admin1@bookleaf.com`, `admin2@bookleaf.com` | Queue, AI triage and drafts |

**Notes for the reviewer:**
- **Slow first request.** This runs on Render's free plan, so the first request after 15 idle minutes can take about
  a minute.
- **Database expiry.** The free Postgres database was created on 23 Oct 2026 and expires 30 days after creation, about
  22 Nov 2026.
- **Test tickets.** Besides the seeded demo tickets, the data includes a few tickets made during testing.
- **One login per browser.** Use two different browsers (or one normal and one private window) for author and admin.
  Tabs in the same browser share one login.

## Run it locally

You need Node 20+ and PostgreSQL 14+. The test suites were run on Node 22 and PostgreSQL 14.

```bash
createdb bookleaf
createdb bookleaf_test           # used by the backend tests; never the dev database

# Backend: http://localhost:4000
cd backend
cp .env.example .env             # set DATABASE_URL; the AI provider and key are optional
npm install
npx prisma migrate deploy
npm run db:seed                  # 10 authors, 18 books, 2 admins (idempotent)
npm run seed:demo                # optional: 8 pre-classified demo tickets, no AI calls
npm run dev

# Frontend: http://localhost:5173 (in a second terminal)
cd frontend
npm install
npm run dev                      # mock mode by default
```

**Mock mode.** By default the frontend serves every API call, including the event stream, from an in-browser mock of
the contract (MSW), so it runs with no backend. To use the real backend instead, set `VITE_USE_MOCKS=false`, for
example in `frontend/.env.development.local`, which is git-ignored. Requests to `/api/v1` are then proxied to `:4000`.

**Without an AI key** the app still works. Tickets get keyword triage, and the draft endpoint returns `draft: null` so
the admin writes the reply by hand. To turn AI on, set `LLM_PROVIDER`, `LLM_MODEL` and the matching key in
`backend/.env`; see [Switching the LLM provider](backend/README.md#switching-the-llm-provider).

Detail: [backend quick start](backend/README.md#quick-start) and [frontend quick start](frontend/README.md#quick-start).

## Architecture

```
  Browser: React SPA (author portal, admin portal)
     │  REST /api/v1, JSON              ▲  SSE GET /api/v1/events
     │  Authorization: Bearer <JWT>     │  { ticketId } only; the client refetches
     ▼                                  │
  Express API (Node, TypeScript) ───────┘
     │                          │  classify: background job when a ticket is created
     │  Prisma                  │  draft: on demand, when an admin opens a ticket
     ▼                          ▼
  PostgreSQL               LLM provider: Gemini (live) or Anthropic
```

| Layer | Stack |
|---|---|
| Frontend | React 19, Vite 6, TypeScript, React Router 7, TanStack Query, react-hook-form + zod, Tailwind CSS 4, `@microsoft/fetch-event-source` |
| Backend | Node 22, Express 5, TypeScript, Prisma 6, zod 4, jsonwebtoken, bcryptjs, pino, Swagger UI |
| Database | PostgreSQL |
| AI | `@google/genai` (Gemini), `@anthropic-ai/sdk` (Anthropic) |
| Tests | Vitest; supertest against a real Postgres (backend); Testing Library and MSW (frontend) |
| Hosting | Render free plan: static site, web service, Postgres |

**Backend layers** (`backend/src/`):

| Folder | Job |
|---|---|
| `routes/` | URL → middleware chain → controller, in one file that reads like the contract |
| `controllers/` | HTTP only: read validated input, call a service, choose the status code |
| `services/` | Business rules: ownership, status changes, overrides, draft caching |
| `repositories/` | All Prisma access |
| `ai/` | The LLM client, providers, classifier, drafter and knowledge base. No database or Express imports |

Also `mappers/` (rows → contract shapes), `realtime/` (event bus and SSE hub), `jobs/` (classification queue) and
`container.ts`, which wires everything together.

**Main decisions:**

| Decision | Reason |
|---|---|
| JWT plus role middleware (`authenticate`, `requireRole`) | Stateless auth that a static frontend can call cross-origin. Ownership is checked in the query, so another author's ticket is a 404 |
| Server-sent events, with a polling fallback | Updates only flow server → client, so SSE is enough. While the stream is down, live views poll every 10 s |
| Fetch-based SSE client | The browser's `EventSource` cannot send an `Authorization` header, and the token should not go in the URL |
| Events carry only `{ ticketId }` | Clients refetch through the normal role-checked endpoints, so the stream can't leak data |
| Keyword triage on ticket creation | The queue sorts sensibly before the AI answers, or if it never does |
| Shared contract, [`docs/API_CONTRACT.md`](docs/API_CONTRACT.md) v1.1 | Frontend and backend were built in parallel; the frontend ran on a mock of the contract until the API was ready |

## AI integration

Full write-up: [`backend/docs/AI_DESIGN.md`](backend/docs/AI_DESIGN.md).

**What it does:**
- **Classify** every new ticket in the background, giving a category, a priority and a one-line reason.
- **Draft a reply** when an admin opens a ticket. The admin edits it and chooses whether to send it. No draft reaches
  an author automatically.

**Prompt strategy:**
- A **static system prompt** (tone, grounding and format rules) comes first, so it can be cached.
- **Only the knowledge-base section for the ticket's category** is sent, never the whole KB.
- A **FACTS block computed in code** from the database. It is chosen by relevance; for example, royalty figures appear
  only on payment tickets.
- The **last 6 messages** of the thread.
- A **required-points list per category**, taken from the KB: for example, the 45-day payout cycle for royalty tickets,
  or a free reprint for printing problems. The eval checks the same list.

**Safety:**
- **Author text is escaped and delimited.** Ticket text goes into the prompt inside tags, with `<` and `>` neutralised,
  so it can't close a block or forge FACTS. The prompts say ticket text is data, not instructions. Internal notes are
  never sent.
- **ISBN floor.** In code, an ISBN ticket is never below HIGH, whatever the model says.
- **No invented numbers.** The drafter may use only FACTS, the KB section and the thread. Code logs any number in a
  draft that isn't in those sources.
- **Payout dates are computed in code** (quarter end + 45 days), never by the model. So is the ₹1,000 roll-over rule.

**Failure handling:**

| Failure | What happens |
|---|---|
| Slow call | Per-attempt timeout: 15 s for Anthropic, 30 s for Gemini |
| 429, 5xx, connection reset | 2 retries with backoff |
| Repeated failures or an exhausted quota | A circuit breaker opens, and calls fail instantly until the cooldown ends |
| Classification fails | Keyword fallback, and the ticket is marked "needs manual triage". An admin can retry it |
| Draft fails | `draft: null` with an error, still HTTP 200. The admin writes the reply by hand |

Ticket creation never waits for the AI.

**Cost management:**
- **Trimmed prompts:** one KB section, and facts for one author and book. Run 4 averaged about 1,090 input tokens per
  call (26,269 over 24 calls, as counted by Gemini).
- **Fewer calls:** drafts are made only when an admin opens a ticket, then cached. AI endpoints are rate-limited per
  admin.
- **Logging:** every call is recorded in an `AiCall` row with tokens, latency, attempts and estimated cost, failures
  included.

**Model choice:**
- The provider is switchable with `LLM_PROVIDER` and needs no code change.
- The live deployment uses **Gemini (`gemini-3.5-flash-lite`) on the free tier**, because it costs nothing.
- **Anthropic (Claude Haiku) is implemented but has never run against the real API**; only tests with a fake SDK
  exercise it.

## Evaluation

`npm run ai:eval` (in `backend/`) runs 12 fixed sample tickets through the real classifier and drafter. It prints each
result and a table of keyword-based draft checks. All four runs used Gemini `gemini-3.5-flash-lite` on the free tier.
These are **one run each, not a scored eval**.

| Run | Calls succeeded | Categories right | Priorities right | Avg latency, classify / draft | Notes |
|---|---|---|---|---|---|
| 1 | 23/24 | 12/12 | 11/12 | 3.1 s / 5.0 s | 15 s timeout; the one timeout fell back to keyword triage |
| 2 | 16/24 | 10/12 | 8/12 | 11.6 s / 15.1 s | 30 s timeout; 8 timeouts, so two tickets were misfiled by the keyword fallback |
| 3 | 24/24 | 12/12 | 12/12 | about 5.6 s / 5.0 s | After draft quality pass 2 |
| 4 | 24/24 | 12/12 | 12/12 | 3.4 s / 3.2 s | After draft quality pass 3. Required points 11/12, all other draft checks pass |

**Weaknesses found by reading the drafts** (the automated checks miss them):
- **Process claims the KB doesn't make.** Some general-inquiry drafts say the author can reply to the message and the
  team will submit the update; the KB names the dashboard and email.
- **A dispute answered loosely.** A royalty-dispute draft doesn't set the author's 200 copies against our record of
  156, and mentions an upcoming payout although nothing is pending.
- **Unsupported claims and extra detail.** One draft says production "has taken longer than usual", with no KB figure
  behind it. Another adds the publication date unprompted.
- **Promised internal actions.** Drafts say things like "escalated" or "re-sync requested". An admin has to make those
  true before sending.
- **A false earlier-contact claim.** In the first live app test (ticket #24), a 7-minute-old first message got an
  apology for "the lack of earlier replies". That is fixed in unit tests but has not been re-evaluated.
- **Weak checks.** The keyword checks catch a missing point, not a badly made one, and they don't judge tone.

**The design relies on an admin reading and editing every draft before it is sent.** The weaknesses above are what
that review is there to catch.

## API

- **Interactive docs:** `/api/docs` (Swagger UI); the raw spec is at `/api/docs/openapi.json`.
- **Contract:** [`docs/API_CONTRACT.md`](docs/API_CONTRACT.md) (v1.1).

Errors always use `{ "error": { "code", "message", "details": [{ "field", "message" }] } }`.

All paths below are under `/api/v1`.

| Method | Path | Role | Purpose |
|---|---|---|---|
| POST | `/auth/login` | public | Log in, get a JWT (rate-limited) |
| GET | `/auth/me` | any | Current user |
| GET | `/books` | author | The author's books, including in production |
| POST | `/tickets` | author | Create a ticket |
| GET | `/tickets` | author | The author's tickets, newest first |
| GET | `/tickets/:id` | author | One ticket with its messages (another author's ticket returns 404) |
| POST | `/tickets/:id/messages` | author | Follow-up; reopens a resolved ticket, 409 on a closed one |
| GET | `/admin/tickets` | admin | Queue: filters, search, urgency sort, pagination |
| GET | `/admin/tickets/:id` | admin | Ticket with messages, internal notes, AI fields, draft |
| PATCH | `/admin/tickets/:id` | admin | Change status, category, priority or assignee |
| POST | `/admin/tickets/:id/assign-to-me` | admin | Take the ticket |
| POST | `/admin/tickets/:id/notes` | admin | Add an internal note (never shown to the author) |
| POST | `/admin/tickets/:id/classify` | admin | Retry AI classification (rate-limited) |
| POST | `/admin/tickets/:id/draft` | admin | Get or regenerate the AI draft (rate-limited) |
| POST | `/admin/tickets/:id/reply` | admin | Reply to the author |
| GET | `/admin/admins` | admin | Admins, for assignment |
| GET | `/events` | any | SSE stream, scoped by role |

`GET /health` (outside `/api/v1`) returns `{ status, db, ai }`.

## Tests

Both suites were run on 24 Oct 2026. Neither calls a real model.

| Suite | Command | Result | What it covers |
|---|---|---|---|
| Backend | `cd backend && npm test` | **236 passed**, 19 files (14 unit, 5 integration) | See below |
| Frontend | `cd frontend && npm test` | **89 passed**, 15 files | See below |

**Backend.** The integration tests use supertest against a real local Postgres (`bookleaf_test`), and the AI
providers are replaced with fake SDK transports. They cover:
- Auth and validation errors, and ticket flows with the AI failing.
- Draft caching and invalidation, queue filters, and the demo seed.
- A security suite driven by the real route table:
  - every route needs a token
  - every admin route rejects authors
  - another author's ticket returns 404
  - author responses never contain AI or admin fields
  - author event streams carry only their own tickets
- Unit tests: payout dates, the classifier and its fallback, and the LLM client's retries, breaker and timeouts.
- More unit tests: both providers, config validation, prompt injection, the FACTS and required points, and the eval
  checks.

**Frontend.** The tests run against the mock API (MSW). They cover:
- Full author and admin journeys through the real router, including live updates over SSE.
- The SSE hook (auth header, backoff, a 401 stops retries), the AI draft and triage panels, server-error mapping, and
  multi-tab sessions.
- The mock's own conformance to contract v1.1.
- A real production build, checked for no mock code or demo credentials.

## Verified vs not verified

| Item | Status |
|---|---|
| Login as author and as admin (`admin1`) | ✅ Verified on the live site |
| Ticket creation | ✅ Verified on the live site |
| AI classification and AI draft on a real ticket | ✅ Verified on the live site |
| Admin reply reaching the author live, without refresh | ✅ Verified on the live site |
| Author follow-up | ✅ Verified on the live site |
| Refresh on a deep link | ✅ Verified on the live site |
| `/health` | ✅ Verified on the live site |
| Anthropic against the real API | ❌ Not verified; fake SDK only |
| Docker image | ❌ Not verified; the `Dockerfile` has never been built |
| Railway config (`railway.json`) | ❌ Not verified; never deployed |
| Gemini rate-limit and quota handling against the live API | ❌ Not verified; tested with a fake SDK only |
| A scored, multi-run eval | ❌ Not done; four single runs only |
| `admin2` login on the live site | ❌ Not verified |
| The event stream under heavy use | ❌ Not verified |
| Draft prompt changes after run 4 (the ticket #24 earlier-contact fix) | ❌ Not re-evaluated against a model; unit tests only |

## Known limitations and what I'd do next

| Limitation | Next step |
|---|---|
| **Free-tier Gemini:** tight quotas, and timeouts in some runs (8 of 24 calls in run 2) | A paid key, or Anthropic, for predictable latency |
| **Free-tier data use:** Google may use free-tier inputs and outputs. Fine for this sample data, not for real author data | A billed Gemini project, or Anthropic, before any real data |
| **UTC date filters:** bare `from`/`to` dates are UTC days, so for IST users a day filter is off by 5.5 hours at each edge | Send the admin's time zone, or full timestamps with an offset |
| **Attachments are UI only:** name and size are stored; no file is uploaded | Uploads to object storage through pre-signed URLs, with virus scanning |
| **In-process AI jobs:** classification runs in an in-process queue, and the event bus, rate limits and breaker live in one process | A durable queue (BullMQ or pg-boss) and Redis, to run more than one instance |
| **No prompt versioning:** prompts change in code with no version stored on each `AiCall` or draft | Store a prompt version per call, and gate prompt changes on a scored eval |
| **Drafts promise internal actions** ("escalated", "re-sync requested") that an admin must make true | Add actions the admin can tick off when sending, or stop drafts from promising them |

**`npm audit --omit=dev`** (run 24 Oct 2026; no dependencies were changed and `audit fix` was not run):

| Package | Result |
|---|---|
| `backend/` | **4 high.** `body-parser` 2.0.0–2.3.0, used by Express 5 to parse request bodies: a denial of service through trailing bytes after a compressed body (GHSA-27r3-jxmh-p828). A non-breaking fix is available with `npm audit fix`. `deepmerge-ts` < 8, through `@prisma/config` and the `prisma` CLI (3 entries): stack exhaustion when merging recursive objects (GHSA-ggr8-5vv4-36mx). The only fix is Prisma 7, a major upgrade |
| `frontend/` | **1 high.** `zod` < 4.6.6 (3.25.76 installed): memory exhaustion validating oversized constrained collections (GHSA-mrhx-c7xc-m3w5). The fix is zod 4, a major upgrade. Here zod only validates form input in the user's own browser |

Next: apply the non-breaking `body-parser` fix, then plan the Prisma 7 and frontend zod 4 upgrades with the test
suites as the safety net.
