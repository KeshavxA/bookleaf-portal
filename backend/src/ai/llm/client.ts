import Anthropic from "@anthropic-ai/sdk";
import { CircuitBreaker } from "./circuitBreaker";
import { estimateCostUsd } from "./pricing";
import {
  LlmError,
  LlmOutputError,
  ZERO_USAGE,
  type AiCallRecorder,
  type AiCallStatus,
  type LlmPort,
  type LlmRequest,
  type LlmResponse,
  type ResponseParser,
  type TokenUsage,
} from "./types";

export interface LlmClientOptions {
  /** Read from ANTHROPIC_API_KEY by the caller. Undefined => client runs disabled. */
  apiKey: string | undefined;
  model: string;
  timeoutMs: number;
  maxRetries: number;
  breaker: CircuitBreaker;
  recorder: AiCallRecorder;
  /** Injected for tests; defaults to a real SDK client. */
  sdk?: Pick<Anthropic, "messages">;
  sleep?: (ms: number) => Promise<void>;
  onWarn?: (msg: string, ctx: Record<string, unknown>) => void;
}

const BASE_BACKOFF_MS = 500;
const MAX_BACKOFF_MS = 4_000;
const MAX_ERROR_MESSAGE_LEN = 300;

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * Thin, opinionated wrapper around the Anthropic SDK:
 *  - per-attempt timeout; SDK-level retries disabled so retry policy lives here
 *  - retries with exponential backoff + jitter on 429 / 5xx / connection resets (honours retry-after)
 *  - circuit breaker shared by every caller
 *  - exactly one AiCall row per logical call, including failures, with token usage and cost
 *
 * The API key is only ever handed to the SDK constructor; it is never logged,
 * stored, or included in any error message we create.
 */
export class LlmClient implements LlmPort {
  readonly model: string;
  private readonly sdk: Pick<Anthropic, "messages"> | null;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(private readonly opts: LlmClientOptions) {
    this.model = opts.model;
    this.sleep = opts.sleep ?? defaultSleep;
    this.sdk =
      opts.sdk ??
      (opts.apiKey ? new Anthropic({ apiKey: opts.apiKey, timeout: opts.timeoutMs, maxRetries: 0 }) : null);
  }

  get enabled(): boolean {
    return this.sdk !== null;
  }

  async complete<T>(request: LlmRequest, parse: ResponseParser<T>): Promise<{ value: T; response: LlmResponse }> {
    const started = Date.now();
    let attempts = 0;
    let usage: TokenUsage = ZERO_USAGE;

    const finish = async (status: AiCallStatus, error?: { code: string; message: string }) => {
      await this.record(request, status, attempts, Date.now() - started, usage, error);
    };

    if (!this.sdk) {
      await finish("DISABLED", { code: "DISABLED", message: "ANTHROPIC_API_KEY is not configured" });
      throw new LlmError("DISABLED", "AI is not configured on this server");
    }
    if (!this.opts.breaker.tryAcquire()) {
      await finish("CIRCUIT_OPEN", { code: "CIRCUIT_OPEN", message: "Circuit breaker open" });
      throw new LlmError("CIRCUIT_OPEN", "AI service is temporarily unavailable");
    }

    for (;;) {
      attempts += 1;
      try {
        const message = await this.sdk.messages.create(this.buildParams(request), { timeout: this.opts.timeoutMs });
        usage = toUsage(message.usage);
        const response: LlmResponse = {
          text: message.content
            .filter((b): b is Anthropic.TextBlock => b.type === "text")
            .map((b) => b.text)
            .join(""),
          model: message.model,
          stopReason: message.stop_reason,
          usage,
          latencyMs: Date.now() - started,
          attempts,
        };

        if (message.stop_reason === "refusal") {
          this.opts.breaker.onNeutral();
          await finish("REFUSED", { code: "REFUSED", message: "Model declined the request" });
          throw new LlmError("REFUSED", "The AI model declined to respond");
        }

        let value: T;
        try {
          value = parse(response);
        } catch (err) {
          this.opts.breaker.onNeutral();
          const msg = err instanceof Error ? err.message : String(err);
          await finish("INVALID_OUTPUT", { code: "INVALID_OUTPUT", message: msg });
          throw new LlmError("INVALID_OUTPUT", `AI returned unusable output: ${msg}`);
        }

        this.opts.breaker.onSuccess();
        await finish("SUCCESS");
        return { value, response };
      } catch (err) {
        if (err instanceof LlmError) throw err;
        if (err instanceof LlmOutputError) throw err; // defensive; handled above

        const classified = classifySdkError(err);
        const canRetry = classified.retryable && attempts <= this.opts.maxRetries;
        if (canRetry) {
          const delay = backoffMs(attempts, classified.retryAfterMs);
          this.opts.onWarn?.("LLM call failed, retrying", {
            kind: request.kind,
            ticketId: request.ticketId,
            attempt: attempts,
            code: classified.code,
            delayMs: delay,
          });
          await this.sleep(delay);
          continue;
        }

        if (classified.upstreamFailure) this.opts.breaker.onFailure();
        else this.opts.breaker.onNeutral();
        await finish(classified.status, { code: classified.code, message: classified.message });
        throw new LlmError(classified.code, classified.message, classified.upstreamFailure);
      }
    }
  }

  private buildParams(request: LlmRequest): Anthropic.MessageCreateParamsNonStreaming {
    // No temperature/top_p/top_k: current Haiku rejects non-default sampling params.
    // Determinism for classification comes from the JSON schema + prompt instead.
    const outputConfig: Anthropic.OutputConfig = {};
    if (request.effort) outputConfig.effort = request.effort;
    if (request.jsonSchema) outputConfig.format = { type: "json_schema", schema: request.jsonSchema };

    return {
      model: this.model,
      max_tokens: request.maxTokens,
      system: request.system,
      messages: request.messages,
      ...(request.thinking ? { thinking: { type: request.thinking } } : {}),
      ...(Object.keys(outputConfig).length > 0 ? { output_config: outputConfig } : {}),
    };
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
        model: this.model,
        status,
        attempts,
        latencyMs,
        ...usage,
        estCost: estimateCostUsd(this.model, usage),
        errorCode: error?.code ?? null,
        errorMessage: error ? error.message.slice(0, MAX_ERROR_MESSAGE_LEN) : null,
      });
    } catch (err) {
      // Observability must never break the user-facing flow.
      this.opts.onWarn?.("Failed to record AiCall", { error: err instanceof Error ? err.message : String(err) });
    }
  }
}

function toUsage(u: Anthropic.Usage): TokenUsage {
  return {
    inputTokens: u.input_tokens ?? 0,
    outputTokens: u.output_tokens ?? 0,
    cacheReadTokens: u.cache_read_input_tokens ?? 0,
    cacheWriteTokens: u.cache_creation_input_tokens ?? 0,
  };
}

interface ClassifiedError {
  code: LlmError["code"];
  status: AiCallStatus;
  message: string;
  retryable: boolean;
  upstreamFailure: boolean;
  retryAfterMs?: number;
}

/** Most-specific first: the SDK's timeout error subclasses its connection error, which subclasses APIError. */
export function classifySdkError(err: unknown): ClassifiedError {
  if (err instanceof Anthropic.APIConnectionTimeoutError) {
    return { code: "TIMEOUT", status: "TIMEOUT", message: "AI request timed out", retryable: false, upstreamFailure: true };
  }
  if (err instanceof Anthropic.APIConnectionError) {
    return {
      code: "UPSTREAM_ERROR",
      status: "ERROR",
      message: "Could not reach the AI service",
      retryable: true,
      upstreamFailure: true,
    };
  }
  if (err instanceof Anthropic.RateLimitError) {
    return {
      code: "RATE_LIMITED",
      status: "RATE_LIMITED",
      message: "AI service rate limit reached",
      retryable: true,
      upstreamFailure: true,
      retryAfterMs: parseRetryAfter(err.headers),
    };
  }
  if (err instanceof Anthropic.AuthenticationError || err instanceof Anthropic.PermissionDeniedError) {
    // Misconfiguration: retrying won't help, and every call will fail - let the breaker open.
    return { code: "AUTH_ERROR", status: "ERROR", message: "AI credentials were rejected", retryable: false, upstreamFailure: true };
  }
  if (err instanceof Anthropic.APIError && typeof err.status === "number" && err.status >= 500) {
    return {
      code: "UPSTREAM_ERROR",
      status: "ERROR",
      message: `AI service error (${err.status})`,
      retryable: true,
      upstreamFailure: true,
      retryAfterMs: parseRetryAfter(err.headers),
    };
  }
  if (err instanceof Anthropic.APIError) {
    // 400/404/413/422: our request is wrong. Not an availability problem.
    return {
      code: "BAD_REQUEST",
      status: "ERROR",
      message: `AI request rejected (${err.status ?? "unknown"}): ${err.message}`,
      retryable: false,
      upstreamFailure: false,
    };
  }
  return {
    code: "UPSTREAM_ERROR",
    status: "ERROR",
    message: err instanceof Error ? err.message : "Unknown AI error",
    retryable: false,
    upstreamFailure: false,
  };
}

function parseRetryAfter(headers: Headers | undefined): number | undefined {
  const raw = headers?.get?.("retry-after");
  if (!raw) return undefined;
  const seconds = Number(raw);
  return Number.isFinite(seconds) ? seconds * 1000 : undefined;
}

export function backoffMs(attempt: number, retryAfterMs?: number): number {
  if (retryAfterMs !== undefined) return Math.min(retryAfterMs, MAX_BACKOFF_MS);
  const exp = BASE_BACKOFF_MS * 2 ** (attempt - 1);
  const jitter = Math.random() * BASE_BACKOFF_MS;
  return Math.min(exp + jitter, MAX_BACKOFF_MS);
}
