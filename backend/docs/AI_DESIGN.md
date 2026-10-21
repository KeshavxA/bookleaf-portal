# AI design

The AI does two jobs. When a ticket is created, it classifies the ticket (category, priority, one-line reason) in the
background. When an admin asks for a draft, it writes a reply the admin reviews before sending. Both run on
`claude-haiku-5-5` through one wrapper (`src/ai/llm/client.ts`). Nothing the model produces reaches an author without
an admin choosing to send it.

> **Status:** everything below has been tested only against a fake SDK transport. No real API key was available, so
> real classification accuracy, draft quality, cache hits and token counts are **unverified**. `npm run ai:eval`
> runs 12 cases against the real API and prints usage and cost.

## Prompt strategy

**Classifier:** one call returns category, priority and a reason of at most 20 words, using structured output (a JSON
schema with enum fields), so it can't invent a category. The system prompt holds the category definitions (from the
KB sections), an explicit priority rubric (CRITICAL = money long overdue, repeated escalation, legal threats; HIGH =
ISBN errors, wrong royalty, unavailable book; and so on), and a rule to judge the situation rather than the tone. Code
then applies one hard rule: ISBN tickets are never below HIGH. Haiku 5.5 rejects `temperature`, so there's no
`temperature: 0`. Consistency comes instead from the enum schema, thinking disabled, `effort: low` and a 256-token cap.

**Drafter:** the prompt runs from stable content to per-ticket content, so the stable part can be cached:

1. Static instructions: BookLeaf's tone rules, grounding rules and format (120–200 words, plain text, fixed sign-off).
   Cached; identical bytes for every draft.
2. The KB section for this ticket's category only, with its sample query as a few-shot example. Cached per category.
3. `<facts>`, computed in code: first name, book status, royalty figures, the next payout date (quarter end + 45 days,
   on or after today), whether the pending amount is under the ₹1,000 threshold, a payout-review flag, and whether
   bank details are known.
4. `<original_query>` and the last 6 messages in `<thread>`.

The model doesn't do any arithmetic or date logic. If a fact isn't in the prompt, the instructions say to promise a
48-hour follow-up instead of guessing. After generation, code strips markdown, enforces the sign-off, rejects drafts
that were truncated or are under 40 words, and logs any number in the draft that doesn't appear in its sources.

**Untrusted text:** the database stores subject, description, messages and notes raw. When they're copied into a
prompt, `<` and `>` are replaced and each field is length-capped (`src/ai/promptText.ts`). That way author text can't
close `<original_query>` or forge a `<facts>` block. Both system prompts say ticket text is data, not instructions.
Internal notes are never sent to the model.

## KB trimming

The full KB is about 2,500 tokens, and the full dataset about 3,800. Neither is ever sent. A draft gets one KB section
(350–560 tokens) and the facts for one author and book (about 270 tokens). Royalty figures appear only for royalty and
general tickets. A book in production gets "not published yet, no sales or royalties" instead of a row of nulls. An
account-level ticket gets a one-line list of the author's books.

## Tokens and cost

These are estimates at 3.5 characters per token, measured on the current prompts. Prices are Haiku 5.5's $0.10 input
and $0.50 output per million tokens, with cache reads at 10% of the input price.

| Call | Input | Output | Cost, cold | Cost, prefix cached |
|---|---|---|---|---|
| Classify | ~620 system + ~85 ticket | ~40 | ~$0.00009 | ~$0.00004 |
| Draft | ~940 system + ~350–560 KB + ~420–700 facts/thread | ~300 | ~$0.00035 | ~$0.0002 |

That's about $0.0003–0.0004 per ticket with one draft, or $3–4 per 10,000 tickets. Output tokens are most of the
draft cost. Sending the full KB and dataset instead would add about 6,300 input tokens per draft, roughly 4× the
input. `AiCall` stores tokens, cache reads and writes, latency and estimated cost for every call, failures included.

**Caching risk:** Haiku 5.5 only caches prefixes of at least 512 tokens, and the classifier's system prompt is
estimated at about 620. If the real count is under 512, caching is skipped without an error. `cache_creation_input_tokens`
in the eval output will show whether that happened.

## Failure modes and fallbacks

| Failure | What happens |
|---|---|
| No API key | The server starts and logs one warning. Classification uses the keyword fallback, and the draft endpoint returns `200 { draft: null, error }` |
| 429 / 5xx / connection reset | 2 retries with backoff (respecting `retry-after`, capped at 4 s), then the fallback |
| Timeout (15 s per attempt) | No retry; fallback |
| 5 consecutive upstream failures | Circuit breaker opens for 30 s, so calls fail instantly and then a single probe is allowed |
| Invalid JSON or bad enum, refusal, truncated draft | Recorded as `INVALID_OUTPUT`/`REFUSED`, then the fallback. Doesn't count against the breaker |
| Restart mid-job | `PENDING` tickets are re-queued on boot |

Keyword fallback: weighted regexes choose the category, priority is MEDIUM (plus the ISBN floor), and the ticket gets
`aiStatus: FAILED`, which the UI shows as "needs manual triage". An admin can retry with `POST /admin/tickets/:id/classify`
(a no-op if a job is already pending). Ticket creation never waits for the AI, and admin overrides are never
overwritten by a later classification.

## Why Haiku

Both jobs are short and tightly bounded: a six-way label, and a templated reply of about 150 words built from facts
that are supplied. They need instruction-following and the right tone, not deep reasoning. Haiku 5.5 is the cheapest
current Claude model, supports structured outputs, and is fast enough for a draft an admin is waiting on. If the eval
showed drafts needed more nuance, changing `LLM_MODEL` to a Sonnet model needs no code change, at about 20× the cost.

## What I would change in production

- **A durable queue instead of in-process jobs.** Classification uses an in-memory queue with re-queueing on boot.
  pg-boss or BullMQ would add retries with backoff, a dead-letter queue and multiple workers, and the event bus would
  move to Redis pub/sub so more than one API instance can run.
- **Prompt versioning.** Store a prompt version (a hash of the system prompt, KB section and schema) on every `AiCall`
  and on the stored draft, so a quality change can be traced to the prompt change that caused it, and a rollback is a
  config change.
- **A scored eval set.** `ai:eval` currently prints results for a person to read. It should grade them: exact match on
  category, an allowed set of priorities, required phrases (the next payout date, the threshold explanation), banned
  claims (amounts not in FACTS, "your payment is late"), and a word count. It should run in CI whenever a prompt or KB
  file changes, and be extended with real tickets. Edit distance between the draft and the reply the admin actually
  sent would be the signal in production.
- **PII handling.** Authors type phone numbers, bank details and addresses into tickets. Mask obvious patterns
  (account numbers, IFSC, phone, email) before text goes to the model, use a provider agreement with zero data
  retention, and keep prompt text out of logs. `AiCall` already stores no prompt or response content.
- **Send only the fields the model needs.** Category-specific facts are done for royalties. The same allowlist should
  cover ISBN, print partner and platforms (each only for the categories that use it), and the classifier doesn't need
  the book title.
- **A template draft when the AI is down.** Instead of `draft: null`, return a deterministic draft: acknowledgement,
  the computed facts and "we'll update you within 48 hours". Mark it clearly and return it with the error, so the
  admin still has a starting point (proposal #6 in `docs/CONTRACT_CHANGES.md`).
- **Single-use SSE tokens.** Browsers' `EventSource` can't send an `Authorization` header, so the frontend uses a
  fetch-based client. A short-lived, single-use stream token (`POST /events/ticket`) would allow the native client
  without putting the long-lived JWT in URLs or access logs (proposal #4).
