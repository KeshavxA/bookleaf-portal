import type Anthropic from "@anthropic-ai/sdk";

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

/** What gets persisted for every logical LLM call (see AiCall model). */
export interface AiCallRecord extends TokenUsage {
  ticketId: string | null;
  kind: AiCallKind;
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

export interface LlmRequest {
  kind: AiCallKind;
  ticketId?: string | null;
  system: Anthropic.TextBlockParam[];
  messages: Anthropic.MessageParam[];
  maxTokens: number;
  effort?: "low" | "medium" | "high";
  /** "disabled" is only valid at effort <= high on current Haiku; fine for short structured calls. */
  thinking?: "adaptive" | "disabled";
  /** Structured output: constrains the response to this JSON schema. */
  jsonSchema?: Record<string, unknown>;
}

export interface LlmResponse {
  text: string;
  model: string;
  stopReason: string | null;
  usage: TokenUsage;
  latencyMs: number;
  attempts: number;
}

/**
 * Parses/validates the raw response. Throw LlmOutputError to mark the call
 * INVALID_OUTPUT (recorded, not retried, does not trip the circuit breaker).
 */
export type ResponseParser<T> = (response: LlmResponse) => T;

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
