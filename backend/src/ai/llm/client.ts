import { CircuitBreaker } from "./circuitBreaker";
import { apiKeyVarFor } from "./providers";
import {
  LlmError,
  LlmOutputError,
  ZERO_USAGE,
  type AiCallRecorder,
  type AiCallStatus,
  type LlmPort,
  type LlmProvider,
  type LlmRequest,
  type LlmResponse,
  type ResponseParser,
  type TokenUsage,
} from "./types";

export interface LlmClientOptions {
  /** Anthropic or Gemini; see providers/index.ts. A provider without an API key runs disabled. */
  provider: LlmProvider;
  timeoutMs: number;
  maxRetries: number;
  breaker: CircuitBreaker;
  recorder: AiCallRecorder;
  sleep?: (ms: number) => Promise<void>;
  onWarn?: (msg: string, ctx: Record<string, unknown>) => void;
}

const BASE_BACKOFF_MS = 500;
const MAX_BACKOFF_MS = 4_000;
const MAX_ERROR_MESSAGE_LEN = 300;

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * Provider-agnostic policy around one LlmProvider:
 *  - per-attempt timeout; SDK-level retries disabled so retry policy lives here
 *  - retries with exponential backoff + jitter on 429 / 5xx / connection resets
 *  - honours a server-requested retry delay, but never waits past timeoutMs in total to do so
 *  - circuit breaker shared by every caller; an exhausted quota (or a retry delay longer than
 *    that budget) opens it immediately so we stop calling and degrade until it cools down
 *  - exactly one AiCall row per logical call, including failures, with token usage and cost
 *
 * API keys live inside the providers; nothing here logs or stores them.
 */
export class LlmClient implements LlmPort {
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(private readonly opts: LlmClientOptions) {
    this.sleep = opts.sleep ?? defaultSleep;
  }

  get model(): string {
    return this.opts.provider.model;
  }

  get provider(): LlmProvider["name"] {
    return this.opts.provider.name;
  }

  get enabled(): boolean {
    return this.opts.provider.enabled;
  }

  async complete<T>(request: LlmRequest, parse: ResponseParser<T>): Promise<{ value: T; response: LlmResponse }> {
    const { provider, breaker } = this.opts;
    const started = Date.now();
    let attempts = 0;
    let usage: TokenUsage = ZERO_USAGE;

    const finish = async (status: AiCallStatus, error?: { code: string; message: string }) => {
      await this.record(request, status, attempts, Date.now() - started, usage, error);
    };

    if (!provider.enabled) {
      await finish("DISABLED", { code: "DISABLED", message: `${apiKeyVarFor(provider.name)} is not configured` });
      throw new LlmError("DISABLED", "AI is not configured on this server");
    }
    if (!breaker.tryAcquire()) {
      await finish("CIRCUIT_OPEN", { code: "CIRCUIT_OPEN", message: "Circuit breaker open" });
      throw new LlmError("CIRCUIT_OPEN", "AI service is temporarily unavailable");
    }

    const { kind: _kind, ticketId: _ticketId, ...body } = request;
    let waitedMs = 0;
    for (;;) {
      attempts += 1;
      try {
        const result = await provider.generate({ ...body, timeoutMs: this.opts.timeoutMs });
        usage = result.usage;
        const response: LlmResponse = { ...result, latencyMs: Date.now() - started, attempts };

        if (result.stopReason === "refusal") {
          breaker.onNeutral();
          await finish("REFUSED", { code: "REFUSED", message: "Model declined the request" });
          throw new LlmError("REFUSED", "The AI model declined to respond");
        }

        let value: T;
        try {
          value = parse(response);
        } catch (err) {
          breaker.onNeutral();
          const msg = err instanceof Error ? err.message : String(err);
          await finish("INVALID_OUTPUT", { code: "INVALID_OUTPUT", message: msg });
          throw new LlmError("INVALID_OUTPUT", `AI returned unusable output: ${msg}`);
        }

        breaker.onSuccess();
        await finish("SUCCESS");
        return { value, response };
      } catch (err) {
        if (err instanceof LlmError) throw err;
        if (err instanceof LlmOutputError) throw err; // defensive; handled above

        const classified = provider.classifyError(err);
        const delay = backoffMs(attempts, classified.retryAfterMs);
        // Computed backoff is already bounded (<= 4s per retry). A server-requested delay can be long
        // (Gemini free tier often says ~30-60s), so it must fit in the remaining wait budget.
        const withinBudget = classified.retryAfterMs === undefined || waitedMs + delay <= this.opts.timeoutMs;
        if (classified.retryable && attempts <= this.opts.maxRetries && withinBudget) {
          this.opts.onWarn?.("LLM call failed, retrying", {
            provider: provider.name,
            kind: request.kind,
            ticketId: request.ticketId,
            attempt: attempts,
            code: classified.code,
            delayMs: delay,
          });
          waitedMs += delay;
          await this.sleep(delay);
          continue;
        }

        // Quota gone, or the API wants a longer pause than we will wait: stop calling it at all
        // until the breaker cools down. Callers degrade (keyword triage, draft=null) meanwhile.
        const backOff = classified.quotaExhausted || (classified.code === "RATE_LIMITED" && !withinBudget);
        if (backOff) {
          breaker.tripOpen();
          this.opts.onWarn?.("LLM rate limit/quota hit; circuit opened", {
            provider: provider.name,
            code: classified.code,
            retryAfterMs: classified.retryAfterMs,
          });
        } else if (classified.upstreamFailure) breaker.onFailure();
        else breaker.onNeutral();
        await finish(classified.status, { code: classified.code, message: classified.message });
        throw new LlmError(classified.code, classified.message, classified.upstreamFailure);
      }
    }
  }

  private async record(
    request: LlmRequest,
    status: AiCallStatus,
    attempts: number,
    latencyMs: number,
    usage: TokenUsage,
    error?: { code: string; message: string },
  ): Promise<void> {
    try {
      await this.opts.recorder.record({
        ticketId: request.ticketId ?? null,
        kind: request.kind,
        provider: this.opts.provider.name,
        model: this.model,
        status,
        attempts,
        latencyMs,
        ...usage,
        estCost: this.opts.provider.estimateCost(usage),
        errorCode: error?.code ?? null,
        errorMessage: error ? error.message.slice(0, MAX_ERROR_MESSAGE_LEN) : null,
      });
    } catch (err) {
      // Observability must never break the user-facing flow.
      this.opts.onWarn?.("Failed to record AiCall", { error: err instanceof Error ? err.message : String(err) });
    }
  }
}

/** Server-requested delays are taken as given (providers may cap them); the client enforces the total budget. */
export function backoffMs(attempt: number, retryAfterMs?: number): number {
  if (retryAfterMs !== undefined) return retryAfterMs;
  const exp = BASE_BACKOFF_MS * 2 ** (attempt - 1);
  const jitter = Math.random() * BASE_BACKOFF_MS;
  return Math.min(exp + jitter, MAX_BACKOFF_MS);
}
