import Anthropic from "@anthropic-ai/sdk";
import { estimateCostUsd, type PriceOverride } from "../pricing";
import type {
  ClassifiedError,
  LlmProvider,
  ProviderRequest,
  ProviderResult,
  StopReason,
  TokenUsage,
} from "../types";

export interface AnthropicProviderOptions {
  /** From ANTHROPIC_API_KEY. Undefined => provider disabled (SDK never constructed). */
  apiKey: string | undefined;
  model: string;
  /** Overrides the built-in rate card (USD per million tokens). */
  price?: PriceOverride;
  /** Injected for tests; defaults to a real SDK client. */
  sdk?: Pick<Anthropic, "messages">;
}

/** Anthropic's retry-after is honoured up to this cap (unchanged from the single-provider client). */
const MAX_RETRY_AFTER_MS = 4_000;

/**
 * Claude via the Anthropic SDK. SDK-level retries are off: LlmClient owns the retry policy.
 * The API key is only handed to the SDK constructor and never logged or put in an error.
 */
export class AnthropicProvider implements LlmProvider {
  readonly name = "anthropic" as const;
  readonly model: string;
  private readonly sdk: Pick<Anthropic, "messages"> | null;

  constructor(private readonly opts: AnthropicProviderOptions) {
    this.model = opts.model;
    this.sdk = opts.sdk ?? (opts.apiKey ? new Anthropic({ apiKey: opts.apiKey, maxRetries: 0 }) : null);
  }

  get enabled(): boolean {
    return this.sdk !== null;
  }

  async generate(request: ProviderRequest): Promise<ProviderResult> {
    if (!this.sdk) throw new Error("Anthropic provider is not configured");
    const started = Date.now();
    const message = await this.sdk.messages.create(this.buildParams(request), { timeout: request.timeoutMs });
    return {
      text: message.content
        .filter((b): b is Anthropic.TextBlock => b.type === "text")
        .map((b) => b.text)
        .join(""),
      model: message.model,
      stopReason: toStopReason(message.stop_reason),
      usage: toUsage(message.usage),
      latencyMs: Date.now() - started,
    };
  }

  buildParams(request: ProviderRequest): Anthropic.MessageCreateParamsNonStreaming {
    // No temperature/top_p/top_k: current Haiku rejects non-default sampling params.
    // Determinism for classification comes from the JSON schema + prompt instead.
    const outputConfig: Anthropic.OutputConfig = {};
    if (request.effort) outputConfig.effort = request.effort;
    if (request.jsonSchema) outputConfig.format = { type: "json_schema", schema: request.jsonSchema };

    return {
      model: this.model,
      max_tokens: request.maxTokens,
      system: request.system.map(
        (b): Anthropic.TextBlockParam => ({
          type: "text",
          text: b.text,
          ...(b.cache ? { cache_control: { type: "ephemeral" } } : {}),
        }),
      ),
      messages: request.messages.map((m) => ({ role: m.role, content: m.content })),
      ...(request.thinking ? { thinking: { type: request.thinking } } : {}),
      ...(Object.keys(outputConfig).length > 0 ? { output_config: outputConfig } : {}),
    };
  }

  classifyError(err: unknown): ClassifiedError {
    return classifyAnthropicError(err);
  }

  estimateCost(usage: TokenUsage): number {
    return estimateCostUsd(this.model, usage, this.opts.price);
  }
}

function toStopReason(r: Anthropic.StopReason | null): StopReason {
  if (r === "end_turn" || r === "stop_sequence") return "end";
  if (r === "max_tokens") return "max_tokens";
  if (r === "refusal") return "refusal";
  return "other";
}

function toUsage(u: Anthropic.Usage): TokenUsage {
  return {
    inputTokens: u.input_tokens ?? 0,
    outputTokens: u.output_tokens ?? 0,
    cacheReadTokens: u.cache_read_input_tokens ?? 0,
    cacheWriteTokens: u.cache_creation_input_tokens ?? 0,
  };
}

/** Most-specific first: the SDK's timeout error subclasses its connection error, which subclasses APIError. */
export function classifyAnthropicError(err: unknown): ClassifiedError {
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
  return Number.isFinite(seconds) ? Math.min(seconds * 1000, MAX_RETRY_AFTER_MS) : undefined;
}
