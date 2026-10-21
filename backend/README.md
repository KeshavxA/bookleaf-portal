# BookLeaf Author Support Portal: Backend

REST API for the author portal and the admin support desk. Express + TypeScript + PostgreSQL (Prisma), with
AI triage and reply drafting on Anthropic's Claude Haiku.

- **API contract (source of truth):** [`../docs/API_CONTRACT.md`](../docs/API_CONTRACT.md). Proposed changes are in [`../docs/CONTRACT_CHANGES.md`](../docs/CONTRACT_CHANGES.md).
- **Interactive docs:** `GET /api/docs` (Swagger UI); raw spec at `GET /api/docs/openapi.json`
- **Health:** `GET /health` returns `{ status, db, ai }`
- **AI design write-up:** [`docs/AI_DESIGN.md`](docs/AI_DESIGN.md) (one page: prompts, cost, failure modes, production changes)

## Quick start

Prerequisites: Node 20+, PostgreSQL 14+.

```bash
cd backend
cp .env.example .env            # then set DATABASE_URL and (optionally) ANTHROPIC_API_KEY
npm install
npx prisma migrate deploy       # create the schema
npm run db:seed                 # 10 authors, 18 books, 2 admins (idempotent)
npm run seed:demo               # optional: 8 pre-classified demo tickets (idempotent, no AI calls)
npm run dev                     # http://localhost:4000
```

With no `ANTHROPIC_API_KEY` the app still runs fully: tickets get keyword triage (`aiStatus: FAILED`), and the
draft endpoint returns `draft: null` with an error so admins write replies by hand. That's the degraded mode
the brief asks for, and it's the same path that runs when the AI provider is down.

### Test logins (password for all: `Passw0rd!`)

| Role | Email | Notes |
|---|---|---|
| Author | `priya.sharma@email.com` | 2 published books |
| Author | `ananya.reddy@email.com` | royalty pending, never paid |
| Author | `kavita.deshmukh@email.com` | 1 book in production, 1 below the ₹1,000 threshold |
| Author | `sneha.kulkarni@email.com` | 3 books, one in cover design |
| Author | any other email in `seed/bookleaf_sample_data.json` | |
| Admin | `admin1@bookleaf.com` (Ritika Sen), `admin2@bookleaf.com` (Karan Verma) | |

### Scripts

| Script | What it does |
|---|---|
| `npm run dev` | Watch mode via tsx |
| `npm run build` / `npm start` | Compile to `dist/` (KB markdown files copied alongside) / run it |
| `npm run start:prod` | `prisma migrate deploy` → seed → server (the deploy start command) |
| `npm run db:seed` | Idempotent seed; re-running never resets changed passwords. Also adds demo tickets when `SEED_DEMO_TICKETS=true` |
| `npm run seed:demo` | 8 demo tickets with preset category/priority and `aiStatus: DONE`, built from real dataset rows. Idempotent (skips a ticket if that author already has one with the same subject). Makes no LLM calls |
| `npm run db:clear-tickets` | Deletes tickets, messages, internal notes and `AiCall` rows only (users, authors, books stay). Refuses when `NODE_ENV=production` unless run with `-- --force` |
| `npm test` | Unit + integration tests (see [Testing](#testing)) |
| `npm run ai:eval` | Runs 12 sample tickets through the real classifier + drafter and prints the results for review (`-- --no-draft`, `-- --only=3`) |
| `npm run typecheck` | `tsc --noEmit` |

### Environment variables

Only `.env.example` is committed. `.env` is git-ignored and docker-ignored.

All variables are validated with zod at boot (`src/config/env.ts`). Invalid config prints the variable names and
reasons (never values) and exits with status 1. At startup the server logs a config summary built from an allowlist:
secrets show only as `set`/`not set`, and the database URL is reduced to host and database name. A unit test checks
that the summary contains no key, secret or password values.

| Variable | Default | Purpose |
|---|---|---|
| `DATABASE_URL` | (required) | PostgreSQL connection string |
| `JWT_SECRET` | dev placeholder outside production | HS256 signing key, ≥32 chars. **In production the server refuses to start** if it is missing, shorter than 32 characters, or equal to the `.env.example` placeholder |
| `JWT_EXPIRES_IN` | `8h` | Token lifetime |
| `PORT` | `4000` | |
| `CORS_ORIGINS` | `http://localhost:5173` | Comma-separated allowed browser origins |
| `LOG_LEVEL` | `info` | pino level |
| `ANTHROPIC_API_KEY` | (empty) | Server-side only. Never logged, returned, or sent to the frontend. Empty does **not** stop startup: the server logs one warning and runs in degraded mode |
| `LLM_MODEL` | `claude-haiku-5-5` | Model for classification and drafting |
| `LLM_TIMEOUT_MS` | `15000` | Per-attempt timeout |
| `LLM_MAX_RETRIES` | `2` | Retries on 429 / 5xx / connection reset |
| `LLM_BREAKER_THRESHOLD` / `LLM_BREAKER_COOLDOWN_MS` | `5` / `30000` | Circuit breaker |
| `RATE_LIMIT_LOGIN_MAX` / `_WINDOW_MS` | `10` / 15 min | Per IP+email |
| `RATE_LIMIT_AI_MAX` / `_WINDOW_MS` | `20` / 1 min | Per admin, on `/draft` and `/classify` |
| `SEED_DEMO_TICKETS` | `false` | `true` makes the deploy-time seed also run `seed:demo` (idempotent) |

---

## Architecture

```
src/
  routes/         URL → middleware chain → controller (one file; reads like the contract)
  controllers/    HTTP only: read validated input, call a service, pick the status code
  services/       business rules (ownership, status transitions, overrides, draft caching)
  repositories/   all Prisma access; the single write path keeps derived columns in sync
  mappers/        DB rows → contract DTOs (author DTOs structurally can't leak AI/notes)
  schemas/        zod request schemas, reused to generate the OpenAPI request bodies
  middleware/     authenticate, requireRole, validate, rate limits, central error handler
  realtime/       EventBus (in-process pub/sub) + SseHub (role-scoped fan-out, heartbeat, cleanup)
  jobs/           ClassificationQueue (in-process, bounded concurrency, restart recovery)
  domain/         pure logic: enums, payout schedule (nextPayoutDate, threshold, review flag)
  ai/             everything LLM: client wrapper, classifier, drafter, per-category KB
  container.ts    composition root: the only file that wires concrete classes together
```

Key decisions:

- **Layered with a composition root.** Services take their dependencies through constructors, and `container.ts` wires
  them. Integration tests build the real app with a fake LLM transport, so they exercise the real HTTP stack, services,
  SQL and retry logic.
- **`src/ai` has no database or Express imports.** It talks to the outside through two ports: `LlmPort` (what services
  call) and `AiCallRecorder` (implemented by `AiCallRepository`). That's why `npm run ai:eval` can run the real AI code
  without a database.
- **Typed errors, one envelope.** Services throw `AppError` subclasses (`ValidationError`, `NotFoundError`, …). The
  central handler also maps zod, body-parser and Prisma errors (P2025→404, P2002→409), and anything unexpected becomes
  a sanitized `INTERNAL`. Clients never get a stack trace or an empty 500.
- **Ownership is enforced in the query.** Author queries filter by `authorId` from the JWT, so another author's ticket
  is a `404` (not `403`) and ids can't be probed. A book that isn't yours is a field-level validation error on `bookId`.
- **Urgency sort in SQL.** The `Priority` enum is declared CRITICAL→LOW (Postgres sorts enums by declaration order), and
  a denormalized `isOpen` column, maintained only in `TicketRepository.update`, puts unresolved tickets first.
  `ORDER BY isOpen DESC, priority ASC, createdAt ASC` is backed by a composite index, with pagination in the database.
- **Triage is never empty.** At creation the keyword classifier sets a provisional category and priority synchronously
  (microseconds, no I/O), so the queue sorts sensibly before the AI result arrives, or if it never does.
- **Dataset kept as-is.** Dataset ids (`AUTH001`, `BK001`) are primary keys, nullable fields stay null, and book status
  stays free text (`"In Production - Cover Design"`). Money is integer INR. Dates without a time are `@db.Date`, returned as `YYYY-MM-DD`.

### Data model

`User(role)` 1–1 `Author` 1–n `Book`. `Ticket` has n `TicketMessage` (author-visible), n `InternalNote` (admin-only)
and n `AiCall` (one row per logical LLM call: kind, model, status, attempts, input/output/cache tokens, latency,
estimated USD cost, error code). Tickets keep the **effective** triage (`category`, `priority`, `*Overridden` flags)
separate from the **raw AI output** (`aiCategory`, `aiPriority`, `aiReasoning`, `aiStatus`, `aiError`), so an admin
always sees what the model said even after overriding it. See `prisma/schema.prisma`.

> **`Author.bankLinked`** is an optional nullable boolean. The dataset has no bank information, so the seed leaves it
> `null` (unknown). The drafter treats `null` as "ask the author to confirm their bank details in the dashboard"
> whenever a ticket involves payments.

---

## AI integration

### Pipeline

```
POST /tickets ──► save ticket (keyword triage, aiStatus=PENDING) ──► 201 to author
                     │                                               ticket.created → admins
                     └─► ClassificationQueue ──► classifier ──► update ticket (respecting overrides)
                                                    │  ok  → aiStatus=DONE
                                                    └─ fail → keyword fallback, aiStatus=FAILED
                                                 ticket.ai_ready → admins

Admin opens ticket ──► POST /draft ──► cached? return it
                                      └─ else: FACTS (code) + KB section + last 6 messages ──► drafter
                                           ok   → cache on ticket, 200 { draft }
                                           fail → 200 { draft: null, error }  (admin writes manually)
```

### 1. LLM client (`src/ai/llm/client.ts`)

- The Anthropic SDK with **SDK-level retries turned off**, so retry policy lives in one place and can be tested.
- **15 s per-attempt timeout.** **2 retries** with exponential backoff and jitter on 429, 5xx and connection resets.
  `retry-after` is honoured (capped at 4 s). Timeouts and 4xx are not retried.
- **Circuit breaker** shared by all calls: 5 consecutive upstream failures open it for 30 s, then one probe call is
  allowed. While it's open, calls fail in microseconds instead of every new ticket waiting through timeouts.
- **Every call is logged to `AiCall`**, including failures, breaker rejections and "AI disabled". Each row has token
  usage, cache reads and writes, latency, attempts and estimated cost. Recorder failures are swallowed so observability
  can't break a request.
- `stop_reason: "refusal"` and `max_tokens` truncation are handled explicitly. A parser hook lets callers reject a
  response as `INVALID_OUTPUT` (recorded, not retried, doesn't trip the breaker).
- The key is read from `ANTHROPIC_API_KEY` only, passed to the SDK constructor, and never logged. pino also redacts
  auth headers and key-like fields as a second safeguard.

### 2. Classifier (`src/ai/classifier/`)

- **One call** returns `{ category, priority, reasoning }` through **structured output** (`output_config.format` with
  a JSON schema whose fields are enums). The model can't return a category that doesn't exist. The response is still
  validated with zod; over-long reasoning is trimmed to 20 words, while a bad enum or invalid JSON triggers the fallback.
- **Inputs are minimal:** subject, description (truncated to 2,000 characters), and the linked book's title and status.
  Author text is wrapped in tags with `<`/`>` neutralised, and the prompt says to ignore instructions inside ticket text
  (prompt-injection case #12 in the eval). The database keeps the raw text; only the prompt copy is escaped
  (`src/ai/promptText.ts`, shared with the drafter).
- **Priority rubric in the prompt.** CRITICAL: long-overdue or missing money, repeated escalation, legal threats.
  HIGH: ISBN errors, wrong royalty, unavailable book. MEDIUM: print quality, production delays. LOW: informational.
  The prompt also says to judge urgency by the situation, not the tone.
- **Deterministic floor in code:** `ISBN_METADATA` is never below HIGH, applied to both AI and fallback results. The
  model's raw answer is stored as `aiSuggestion`; the floored value becomes the effective priority.
- **Determinism without `temperature: 0`.** Claude Haiku 5.5 returns 400 for any non-default sampling parameter, so
  none are sent. Stability comes from the enum schema, thinking disabled, `effort: "low"`, `max_tokens: 256`, and an
  explicit rubric.
- **Fallback** (`keywordFallback.ts`): weighted regexes per category, priority MEDIUM plus the ISBN floor,
  `aiStatus: FAILED`. That status is the "needs manual triage" flag. Admins can retry with `POST /admin/tickets/:id/classify`.

### 3. Drafter (`src/ai/drafter/`)

The prompt is assembled from four parts. The whole KB and the whole dataset are never sent.

| Block | Content | Caching |
|---|---|---|
| `system[0]` | Static instructions: BookLeaf voice (from the KB tone guidelines), grounding rules, format rules | `cache_control`, shared by every draft |
| `system[1]` | **Only the KB section for the ticket's category** (`src/ai/kb/*.md`, extracted from the brief), including its sample query and "how to answer" guidance as a few-shot, plus an illustrative reply that uses `[placeholders]` so no example numbers can leak | `cache_control`, shared per category |
| user: `<facts>` | **FACTS computed in code from the DB:** author first name, bank status, ticket age; book title, ISBN, status, print partner, platforms, copies sold, royalty earned/paid/pending, last payout date, whether pending is under the ₹1,000 threshold (rolls over), **next payout date**, and a payout-review flag | not cached (per ticket) |
| user: `<original_query>`, `<thread>` | Subject and description, plus the **last 6 messages** (each capped at 1,500 characters). All author and staff text is escaped so it can't close these blocks or forge a `<facts>` block. Internal notes are never sent | not cached |

Rules in the prompt:

- Use only FACTS, POLICY and THREAD. Never invent numbers, dates, timelines or policy.
- If information is missing, say the team will check and confirm within 48 hours.
- Acknowledge the concern first. Own BookLeaf's mistakes. Don't blame the author. End with a clear next step.
- Plain text, 120–200 words, sign as "BookLeaf Support Team", no filler or marketing language.
- When `bankLinked` is null, ask the author to confirm their bank details in the dashboard.

**Dates and money are calculated in code, not by the model.** `nextPayoutDate` is the earliest quarter end (Mar 31,
Jun 30, Sep 30, Dec 31) + 45 days that is on or after today. Today (21 Oct 2026) that's 14 Nov 2026, covering Jul–Sep.
`assessRoyalty` adds a *payout review* flag when pending is ≥ ₹1,000, the book was live before the last cycle closed,
and no payout is recorded since that cycle's payout date. The prompt tells the model to present this as "the team is
checking, 48-hour update", never as a confirmed late payment. This covers the brief's "if genuinely overdue, escalate"
case without the model guessing.

**Token discipline beyond KB trimming:**

- Royalty figures go into FACTS only for royalty and general tickets.
- In-production books get "not yet published, no sales or royalties" instead of null fields.
- Account-level tickets get a one-line-per-book list instead of full book records.

**Post-checks:** markdown is stripped and the sign-off enforced, drafts under 40 words or truncated at `max_tokens`
are rejected, and a *grounding tripwire* logs any number in the draft that doesn't appear in the prompt sources (facts,
KB, thread). Admins review every draft before it's sent, so the tripwire alerts rather than blocks.

**Caching:** the draft is stored on the ticket and returned until `regenerate: true` is sent, a new author message
arrives, an admin replies (the draft was used or replaced), or an admin changes the category (the draft was grounded in
the old category's KB). Concurrent requests for the same ticket share one LLM call.

### 4. Cost

Approximate sizes, measured as characters/3.5 (run `npm run ai:eval` for exact usage from the API):

| Call | Input | Output | ≈ Cost on Haiku 5.5 ($0.10 / $0.50 per MTok) |
|---|---|---|---|
| Classify | ~620 system (cached) + ~150 ticket | ~40 | ~$0.0001 |
| Draft | ~900 system + ~350–560 KB (both cached) + ~300–700 facts/thread | ~300 | ~$0.0003 |

That's roughly **$0.0005 per ticket** including one draft, or about $5 per 10,000 tickets. For comparison, sending the
full KB (~2.7k tokens) and the full dataset (~3.8k tokens) on every call would put 3–5× more input tokens in each
request, and the share of irrelevant material would grow with the catalogue. Cache reads bill at 10% of the input
price, and Haiku 5.5's 512-token cache minimum is exceeded by both static prefixes. Other controls:

- Drafts are generated on demand and cached, so tickets that are never opened cost nothing to draft.
- `max_tokens` is 256 for classification and 1,500 for drafts.
- AI endpoints are rate-limited per admin.
- `AiCall.estCost` makes spend queryable per ticket, per kind and per day.

### 5. Failure handling

| Failure | Ticket creation | Classification | Draft |
|---|---|---|---|
| No API key | 201 | keyword fallback, `FAILED` | 200 `draft:null`, `AI_DISABLED` |
| 429 / 5xx | 201 | 2 retries, then fallback | 2 retries, then `draft:null` |
| Timeout (15 s) | 201 | fallback | `draft:null`, `AI_TIMEOUT` |
| Provider down (breaker open) | 201 | instant fallback | instant `draft:null`, `AI_CIRCUIT_OPEN` |
| Invalid JSON / bad enum | 201 | fallback, `INVALID_OUTPUT` logged | `draft:null` (too short / truncated) |
| Model refusal | 201 | fallback | `draft:null` |
| Process restart mid-job | n/a | `PENDING` tickets re-queued on boot | n/a |

Admins can always reply by hand, and an AI outage never prevents an author from submitting a ticket.

### 6. Why Claude Haiku 5.5

- **Fits the task.** Both calls are short, bounded tasks (a 6-way classification, and a ~150-word templated reply
  grounded in supplied facts). They need instruction-following and tone, not deep reasoning. The current Haiku is
  strong at instruction-following, supports structured outputs, and is the cheapest current Claude model
  ($0.10 / $0.50 per MTok).
- **Fast.** Classification runs in the background, but drafts are generated while an admin waits, so latency matters.
- **Easy to upgrade.** If evals showed drafts needed more nuance, `LLM_MODEL=claude-sonnet-5-5` switches the model with
  no code changes, and the pricing table already includes it.

---

## Realtime

`GET /api/v1/events` is an SSE stream authenticated with the `Authorization: Bearer` header. Browser clients need a
fetch-based SSE client, since native `EventSource` can't send headers (see CONTRACT_CHANGES #4).

- **Role scoping:** admins get everything. Authors only get `ticket.updated` / `ticket.message` for their own tickets,
  never `ticket.created` / `ticket.ai_ready`, and never the admin-only updates (notes, drafts, triage overrides).
- A heartbeat comment is sent every 25 s, plus `retry: 5000`. `X-Accel-Buffering: no` stops proxies from buffering.
  Clients are removed on `close`, and `SseHub.close()` ends all streams on shutdown.
- Events carry only `{ ticketId }`. Clients refetch, so no data can leak through the event stream.

## API summary

All endpoints are under `/api/v1`. Full request/response schemas are in Swagger at `/api/docs`.

| Method | Path | Role |
|---|---|---|
| POST | `/auth/login` | public (rate-limited) |
| GET | `/auth/me` | any |
| GET | `/books` | author |
| POST / GET | `/tickets` | author |
| GET | `/tickets/:id` | author (own only, otherwise 404) |
| POST | `/tickets/:id/messages` | author |
| GET | `/admin/tickets` | admin; filters `status, category, priority, assigneeId (id/me/unassigned), from, to, q, sort, page, pageSize` |
| GET / PATCH | `/admin/tickets/:id` | admin |
| POST | `/admin/tickets/:id/assign-to-me` | admin |
| POST | `/admin/tickets/:id/notes` | admin |
| POST | `/admin/tickets/:id/draft` | admin (AI rate limit) |
| POST | `/admin/tickets/:id/reply` | admin |
| POST | `/admin/tickets/:id/classify` | admin (AI rate limit). Retries classification. If the ticket is already `PENDING`: 202 with no second job |
| GET | `/admin/admins` | admin |
| GET | `/events` | any (SSE) |

Errors always use the shape `{ "error": { "code", "message", "details": [{ "field", "message" }] } }`.

## Testing

```bash
npm test
```

- **Unit:** `nextPayoutDate` (year rollover, the boundary day, leap years), royalty assessment, classifier (valid, ISBN
  floor, invalid outputs → fallback, outage → fallback), LLM client (retry policy, no retry on 400/timeout, breaker
  opening and fail-fast, refusal, disabled mode, no sampling params sent, one `AiCall` per call), drafter (FACTS
  content per book state, KB isolation, byte-stable cached prefix, 6-message window, grounding tripwire).
- **Config:** production refuses a missing, short or placeholder `JWT_SECRET`, a missing API key is not fatal, and the
  startup summary contains no secret values.
- **Prompt safety:** an injection string in the description (`</original_query><facts>…`) stays inside one delimited,
  escaped block in the draft prompt, and the forged amount never reaches the real FACTS block.
- **Security, driven by the real route table** (`tests/integration/security.test.ts`). `listRoutes()` walks the Express
  stack, so a newly added route is covered automatically:
  - every route except login, `/health` and the OpenAPI JSON returns 401 without a token
  - every `/admin/*` route returns 403 for an author
  - every author `:id` route returns 404 for another author's ticket
  - the serialized AuthorTicket JSON (nested objects included) never contains `category`, `priority`, `aiStatus`,
    `aiSuggestion`, `assignee`, `internalNotes` or `draft`
  - a cross-author `bookId` returns 4xx
  - author SSE streams carry only their own ticket ids and never `ticket.created`/`ai_ready`
  - every route is in the OpenAPI spec and every spec path is a route

  I checked that these fail on purpose by injecting an unprotected route, an `/admin` route without a role check, a
  nested `priority` leak and an undocumented route.
- **Integration** (supertest against a real Postgres): login and token rejection, **field-level validation errors**,
  malformed JSON, page/pageSize rejected rather than clamped, the 5,000-character cap on messages/replies/notes,
  **ticket creation with the LLM failing** (201 → `FAILED` + keyword triage + one `AiCall` with `attempts: 3`), draft
  returns `draft:null` when AI is down, override flags surviving reclassification, `/classify` on a `PENDING` ticket
  starting no second job, draft caching and invalidation, queue filters, `assigneeId: null` unassigning, 409 on closed
  tickets, the demo seed (idempotent, no `AiCall` rows) and `db:clear-tickets`.

Tests use `TEST_DATABASE_URL`, or your `DATABASE_URL` with `_test` appended to the database name (create it first:
`createdb bookleaf_test`). The test DB is never the dev DB. Setup is non-destructive (`migrate deploy` plus the
idempotent seed), and tests clear their own tickets.

## Deploying

Deploys build natively on the platform (no Docker):

| Step | Command |
|---|---|
| Build | `npm ci --include=dev && npx prisma generate && npm run build` (dev deps are needed for `tsc`) |
| Start | `npm run start:prod` = `prisma migrate deploy && node dist/seed/seed.js && exec node dist/server.js` |
| Health check | `GET /health` → `200 {"status":"ok","db":"ok","ai":"enabled"\|"disabled"}`, or `503` if the DB is unreachable |

The seed is idempotent, so running it on every deploy is safe. With `SEED_DEMO_TICKETS=true` it also creates the 8
demo tickets once. They have preset triage, so the queue looks right even without an API key.

### Production environment variables

| Variable | Required | Value |
|---|---|---|
| `NODE_ENV` | yes | `production` (enables the JWT_SECRET checks) |
| `DATABASE_URL` | yes | from the managed Postgres |
| `JWT_SECRET` | yes | ≥32 random chars, e.g. `openssl rand -base64 48`. The server won't start without it |
| `CORS_ORIGINS` | yes, for a browser frontend | the frontend origin(s), comma-separated, e.g. `https://bookleaf-portal.vercel.app` |
| `SEED_DEMO_TICKETS` | no | `true` for a demo instance |
| `ANTHROPIC_API_KEY` | no | without it, AI runs in degraded mode (keyword triage, manual replies) |
| `PORT` | no | injected by Render and Railway; defaults to 4000 |
| `LLM_MODEL`, `LLM_*`, `RATE_LIMIT_*`, `LOG_LEVEL`, `JWT_EXPIRES_IN` | no | defaults in the [table above](#environment-variables) |

### Render (`render.yaml`)

1. Push the repo to GitHub.
2. In the Render dashboard: **New → Blueprint**, pick the repo, and set the Blueprint path to `backend/render.yaml`.
3. Fill in the prompted values: `CORS_ORIGINS` (the frontend URL) and, optionally, `ANTHROPIC_API_KEY`.
   `JWT_SECRET` is generated by Render. `NODE_ENV=production` and `SEED_DEMO_TICKETS=true` are preset.
4. Apply. Render creates the `bookleaf-db` Postgres and the `bookleaf-api` web service (Node 22, `rootDir: backend`).
5. Check `https://<service>.onrender.com/health`, then log in as `admin1@bookleaf.com` / `Passw0rd!`.

Free-tier caveats (check Render's current terms): free web services sleep when idle, so the first request after a
pause is slow, and free Postgres databases expire after a fixed period.

### Railway (`railway.json`)

1. **New Project → Deploy from GitHub repo**, and pick the repo.
2. In the service's **Settings**, set Root Directory to `/backend` and the config-as-code path to `/backend/railway.json`.
   That file sets the build command, the start command and the `/health` check.
3. **New → Database → PostgreSQL** in the same project.
4. In the service's **Variables**, set `DATABASE_URL=${{Postgres.DATABASE_URL}}`, `NODE_ENV=production`,
   `JWT_SECRET=<openssl rand -base64 48>`, `CORS_ORIGINS=<frontend URL>`, `SEED_DEMO_TICKETS=true`, and optionally
   `ANTHROPIC_API_KEY`.
5. Under **Settings → Networking**, generate a domain and check `/health`.

### Resetting demo data on a live instance

From the platform's shell, in `backend/`: `node dist/seed/clearTickets.js --force`, then `node dist/seed/demoTickets.js`.
The production guard means `--force` is required.

### Docker (unverified)

A multi-stage `Dockerfile` is included (node 22 slim, non-root, healthcheck, same start sequence), but **it has never
been built**, because Docker wasn't available while this was written. Treat it as a starting point. The Render and
Railway configs above don't use it.

The server shuts down gracefully on SIGTERM: SSE streams close, in-flight classifications get up to 10 s, then the DB
disconnects. `trust proxy` is set so rate limiting sees real client IPs.

### Verified vs not verified

| What | Status | How |
|---|---|---|
| Unit + integration tests | ✅ verified | `npm test` against local PostgreSQL 14, Node 22 |
| Production build and start sequence | ✅ verified locally | `npm run build`, then `npm run start:prod` with `NODE_ENV=production` on a fresh empty database: both migrations applied, seed and 8 demo tickets created, `/health` ok, admin login and queue in urgency order. A second start created 0 demo tickets. The placeholder `JWT_SECRET` was refused, and the generated secret did not appear in the logs |
| Real Claude API (classification quality, draft quality, prompt caching, token and cost figures) | ❌ not verified | No API key was available. The AI code has only run against a fake SDK transport in tests. Run `npm run ai:eval` with a key to check it. The cost figures in this README are estimates |
| Docker image build | ❌ not verified | Docker not installed; the `Dockerfile` has never been built |
| Render deploy (`render.yaml`) | ❌ not verified | Blueprint not applied yet |
| Railway deploy (`railway.json`) | ❌ not verified | Not deployed yet; the `RAILPACK` builder value and the config-path setting are from Railway's docs, not tested |
| Deployed instance / live URL | ❌ none yet | |
| SSE through a hosting proxy | ❌ not verified | Works locally; `X-Accel-Buffering: no` and a 25 s heartbeat are set for proxies, but untested on Render or Railway |

## Known limitations and next steps

- **Dates are UTC.** Bare `from`/`to` filter dates mean UTC days (`to=2026-10-21` runs through `23:59:59.999Z`), so for
  IST users a day filter is off by 5.5 hours at each edge. Clients can send full ISO timestamps with an offset
  (URL-encode the `+` as `%2B`). Ticket ages and payout dates are also computed in UTC. Payout dates are calendar
  days, so this only matters within a few hours of midnight.
- **Single instance.** The event bus, classification queue, rate-limit store, breaker state and the in-flight draft
  map are all in-process. To scale out: Redis pub/sub for the bus, a durable queue (BullMQ or pg-boss) with retries and
  a dead-letter queue, and a Redis rate-limit store. The interfaces are already shaped for this.
- **Attachments are metadata only** (`{name, size}`). Real uploads would go to S3 through pre-signed URLs with virus
  scanning. Ticket images could then be passed to the model for print-quality triage.
- **Overdue detection is a heuristic.** The dataset has only cumulative royalty numbers, no per-quarter ledger. With a
  ledger, the payout-review flag could be exact.
- **Bank status is unknown** for every seeded author (see `bankLinked`). Real data would come from the payments system.
- **AI quality is checked by manual review** (`npm run ai:eval`), not by an automated graded eval. Next steps: add
  graded expectations (category accuracy, required phrases, banned claims) and run it in CI on prompt changes. Also
  track admin edit distance between draft and sent reply as a production quality signal.
- **JWTs can't be revoked** (8 h stateless). Production would add refresh tokens and a deny-list, or server sessions.
- **No i18n.** Many authors may prefer Hindi or regional languages. The drafter could reply in the author's language.
- Drafts are on-demand. Pre-generating drafts for CRITICAL/HIGH tickets right after classification would make them
  instant for the most urgent work, at a small cost.
