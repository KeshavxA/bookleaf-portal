export type AiCallKind = "CLASSIFY" | "DRAFT";

export type AiCallStatus =
  | "SUCCESS"
  | "ERROR"
  | "TIMEOUT"
  | "RATE_LIMITED"
  | "INVALID_OUTPUT"
  | "REFUSED"
  | "CIRCUIT_OPEN"
  | "DISABLED";

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
}

export const ZERO_USAGE: TokenUsage = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 };

export type LlmProviderName = "anthropic" | "gemini";

/** What gets persisted for every logical LLM call (see AiCall model). */
export interface AiCallRecord extends TokenUsage {
  ticketId: string | null;
  kind: AiCallKind;
  provider: LlmProviderName;
  model: string;
  status: AiCallStatus;
  attempts: number;
  latencyMs: number;
  estCost: number;
  errorCode: string | null;
  errorMessage: string | null;
}

/** Persistence port, implemented by the AiCall repository. Keeps src/ai free of Prisma. */
export interface AiCallRecorder {
  record(call: AiCallRecord): Promise<void>;
}

/** A block of system prompt. Order matters: static blocks first so prefixes can be cached. */
export interface SystemBlock {
  text: string;
  /**
   * Ask for an explicit cache breakpoint after this block. Anthropic honours it
   * (cache_control); providers without explicit prompt caching ignore it.
   */
  cache?: boolean;
}

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

/** Provider-neutral request built by the classifier and drafter. */
export interface LlmRequest {
  kind: AiCallKind;
  ticketId?: string | null;
  system: SystemBlock[];
  messages: ChatMessage[];
  maxTokens: number;
  effort?: "low" | "medium" | "high";
  /** "disabled" = as little thinking as the model allows (off on Anthropic Haiku, a minimal level on Gemini). */
  thinking?: "adaptive" | "disabled";
  /** Structured output: constrains the response to this JSON schema. */
  jsonSchema?: Record<string, unknown>;
}

/** Normalised across providers. Parsers check "max_tokens"; the client handles "refusal". */
export type StopReason = "end" | "max_tokens" | "refusal" | "other";

export interface LlmResponse {
  text: string;
  model: string;
  stopReason: StopReason;
  usage: TokenUsage;
  latencyMs: number;
  attempts: number;
}

/**
 * Parses/validates the raw response. Throw LlmOutputError to mark the call
 * INVALID_OUTPUT (recorded, not retried, does not trip the circuit breaker).
 */
export type ResponseParser<T> = (response: LlmResponse) => T;

/** One attempt against a provider; LlmClient owns retries, the breaker and AiCall logging. */
export interface ProviderRequest extends Omit<LlmRequest, "kind" | "ticketId"> {
  timeoutMs: number;
}

export interface ProviderResult {
  text: string;
  model: string;
  stopReason: StopReason;
  usage: TokenUsage;
  latencyMs: number;
}

/** How a failed attempt should be handled. Produced by the provider that knows its SDK's errors. */
export interface ClassifiedError {
  code: LlmErrorCode;
  status: AiCallStatus;
  message: string;
  retryable: boolean;
  /** Says something about upstream availability (feeds the circuit breaker). */
  upstreamFailure: boolean;
  /** Server-requested wait before retrying. */
  retryAfterMs?: number;
  /** Quota used up (not a momentary rate limit): open the breaker now instead of retrying. */
  quotaExhausted?: boolean;
}

/**
 * The provider seam: everything the classifier and drafter need from a model.
 * Implementations: AnthropicProvider, GeminiProvider (src/ai/llm/providers/).
 */
export interface LlmProvider {
  readonly name: LlmProviderName;
  readonly model: string;
  /** False when the provider's API key is not configured. */
  readonly enabled: boolean;
  generate(request: ProviderRequest): Promise<ProviderResult>;
  classifyError(err: unknown): ClassifiedError;
  /** USD estimate for the AiCall.estCost column. */
  estimateCost(usage: TokenUsage): number;
}

/** The only surface the classifier/drafter depend on - trivially mockable in tests. */
export interface LlmPort {
  readonly model: string;
  /** False when no API key is configured (every call fails fast with DISABLED). */
  readonly enabled?: boolean;
  complete<T>(request: LlmRequest, parse: ResponseParser<T>): Promise<{ value: T; response: LlmResponse }>;
}

export type LlmErrorCode =
  | "DISABLED"
  | "CIRCUIT_OPEN"
  | "TIMEOUT"
  | "RATE_LIMITED"
  | "UPSTREAM_ERROR"
  | "BAD_REQUEST"
  | "AUTH_ERROR"
  | "REFUSED"
  | "INVALID_OUTPUT";

export class LlmError extends Error {
  constructor(
    readonly code: LlmErrorCode,
    message: string,
    /** True when the failure says something about upstream availability (feeds the breaker). */
    readonly upstreamFailure = false,
  ) {
    super(message);
    this.name = "LlmError";
  }
}

export class LlmOutputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LlmOutputError";
  }
}
