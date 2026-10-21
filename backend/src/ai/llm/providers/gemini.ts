import {
  ApiError,
  FinishReason,
  GoogleGenAI,
  ThinkingLevel,
  Type,
  type GenerateContentParameters,
  type GenerateContentResponse,
  type Schema,
  type ThinkingConfig,
} from "@google/genai";
import type {
  ClassifiedError,
  LlmProvider,
  ProviderRequest,
  ProviderResult,
  StopReason,
  TokenUsage,
} from "../types";
import type { PriceOverride } from "../pricing";

/** Thinking for requests that ask for as little as possible (the classifier). "off" = thinkingBudget 0 (2.5-family models). */
export const GEMINI_THINKING_SETTINGS = ["off", "minimal", "low", "medium", "high"] as const;
export type GeminiThinking = (typeof GEMINI_THINKING_SETTINGS)[number];

export interface GeminiProviderOptions {
  /** From GEMINI_API_KEY. Undefined => provider disabled (SDK never constructed). */
  apiKey: string | undefined;
  /** From LLM_MODEL; there is deliberately no default because Gemini model ids change often. */
  model: string;
  classifierThinking: GeminiThinking;
  /** USD per million tokens. Defaults to 0 (free tier) in config. */
  price: PriceOverride;
  /** Injected for tests; defaults to a real SDK client. */
  sdk?: Pick<GoogleGenAI, "models">;
}

/** Thrown when our own per-attempt deadline aborts the request. */
export class GeminiTimeoutError extends Error {
  constructor(ms: number) {
    super(`Gemini request exceeded ${ms}ms`);
    this.name = "GeminiTimeoutError";
  }
}

const REFUSAL_REASONS = new Set<string>([
  FinishReason.SAFETY,
  FinishReason.RECITATION,
  FinishReason.BLOCKLIST,
  FinishReason.PROHIBITED_CONTENT,
  FinishReason.SPII,
]);

const THINKING_LEVELS: Record<Exclude<GeminiThinking, "off">, ThinkingLevel> = {
  minimal: ThinkingLevel.MINIMAL,
  low: ThinkingLevel.LOW,
  medium: ThinkingLevel.MEDIUM,
  high: ThinkingLevel.HIGH,
};

/**
 * Gemini via the official @google/genai SDK (generateContent).
 * - System blocks are joined, static first, into systemInstruction. No explicit cache
 *   breakpoints exist on this API; implicit prefix caching may or may not apply.
 * - Structured output: responseMimeType application/json + responseSchema (enums kept).
 * - The SDK does not retry unless asked; LlmClient owns retries and the breaker.
 * - The API key goes only to the SDK constructor and is scrubbed from any error text.
 */
export class GeminiProvider implements LlmProvider {
  readonly name = "gemini" as const;
  readonly model: string;
  private readonly sdk: Pick<GoogleGenAI, "models"> | null;

  constructor(private readonly opts: GeminiProviderOptions) {
    this.model = opts.model;
    this.sdk = opts.sdk ?? (opts.apiKey ? new GoogleGenAI({ apiKey: opts.apiKey, vertexai: false }) : null);
  }

  get enabled(): boolean {
    return this.sdk !== null;
  }

  async generate(request: ProviderRequest): Promise<ProviderResult> {
    if (!this.sdk) throw new Error("Gemini provider is not configured");
    const started = Date.now();
    const controller = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, request.timeoutMs);

    let res: GenerateContentResponse;
    try {
      res = await this.sdk.models.generateContent(this.buildParams(request, controller.signal));
    } catch (err) {
      if (timedOut) throw new GeminiTimeoutError(request.timeoutMs);
      throw err;
    } finally {
      clearTimeout(timer);
    }

    const candidate = res.candidates?.[0];
    const text = (candidate?.content?.parts ?? [])
      .filter((p) => typeof p.text === "string" && !p.thought)
      .map((p) => p.text)
      .join("");
    return {
      text,
      model: res.modelVersion ?? this.model,
      stopReason: toStopReason(res),
      usage: toUsage(res),
      latencyMs: Date.now() - started,
    };
  }

  buildParams(request: ProviderRequest, abortSignal?: AbortSignal): GenerateContentParameters {
    return {
      model: this.model,
      contents: request.messages.map((m) => ({ role: m.role === "assistant" ? "model" : "user", parts: [{ text: m.content }] })),
      config: {
        // Static blocks come first in every request (classifier prompt; drafter rules, then KB section).
        systemInstruction: request.system.map((b) => b.text).join("\n\n"),
        maxOutputTokens: request.maxTokens,
        ...(request.jsonSchema
          ? { responseMimeType: "application/json", responseSchema: toGeminiSchema(request.jsonSchema) }
          : {}),
        ...(request.thinking === "disabled" ? { thinkingConfig: thinkingConfigFor(this.opts.classifierThinking) } : {}),
        ...(abortSignal ? { abortSignal } : {}),
      },
    };
  }

  classifyError(err: unknown): ClassifiedError {
    const c = classifyGeminiError(err, { model: this.model, classifierThinking: this.opts.classifierThinking });
    return { ...c, message: scrub(c.message, this.opts.apiKey) };
  }

  /** Flat per-token estimate. Cached tokens are priced as normal input (an upper bound). */
  estimateCost(u: TokenUsage): number {
    const { inputPerMTok, outputPerMTok } = this.opts.price;
    return ((u.inputTokens + u.cacheReadTokens + u.cacheWriteTokens) * inputPerMTok + u.outputTokens * outputPerMTok) / 1_000_000;
  }
}

export function thinkingConfigFor(setting: GeminiThinking): ThinkingConfig {
  return setting === "off" ? { thinkingBudget: 0 } : { thinkingLevel: THINKING_LEVELS[setting] };
}

function toStopReason(res: GenerateContentResponse): StopReason {
  if (res.promptFeedback?.blockReason) return "refusal";
  const reason = res.candidates?.[0]?.finishReason;
  if (!reason) return res.candidates?.length ? "other" : "refusal";
  if (reason === FinishReason.STOP) return "end";
  if (reason === FinishReason.MAX_TOKENS) return "max_tokens";
  if (REFUSAL_REASONS.has(reason)) return "refusal";
  return "other";
}

function toUsage(res: GenerateContentResponse): TokenUsage {
  const u = res.usageMetadata ?? {};
  const cached = u.cachedContentTokenCount ?? 0;
  return {
    inputTokens: Math.max(0, (u.promptTokenCount ?? 0) - cached),
    // Thinking tokens are billed as output on Gemini.
    outputTokens: (u.candidatesTokenCount ?? 0) + (u.thoughtsTokenCount ?? 0),
    cacheReadTokens: cached,
    cacheWriteTokens: 0,
  };
}

const TYPES: Record<string, Type> = {
  object: Type.OBJECT,
  string: Type.STRING,
  number: Type.NUMBER,
  integer: Type.INTEGER,
  boolean: Type.BOOLEAN,
  array: Type.ARRAY,
};

/**
 * Converts the small JSON Schema subset we use into Gemini's OpenAPI-style Schema.
 * Enums are preserved (format "enum"), so the classifier can only answer with valid
 * categories and priorities. additionalProperties has no equivalent and is dropped;
 * zod validation still rejects extra or missing fields.
 */
export function toGeminiSchema(json: Record<string, unknown>): Schema {
  const type = TYPES[String(json.type)];
  if (!type) throw new Error(`Unsupported JSON Schema type for Gemini: ${String(json.type)}`);
  const out: Schema = { type };
  if (typeof json.description === "string") out.description = json.description;
  if (Array.isArray(json.enum)) {
    out.format = "enum";
    out.enum = json.enum.map(String);
  }
  if (json.properties && typeof json.properties === "object") {
    const props = json.properties as Record<string, Record<string, unknown>>;
    out.properties = Object.fromEntries(Object.entries(props).map(([k, v]) => [k, toGeminiSchema(v)]));
    out.propertyOrdering = Object.keys(props);
  }
  if (Array.isArray(json.required)) out.required = json.required.map(String);
  if (json.items && typeof json.items === "object") out.items = toGeminiSchema(json.items as Record<string, unknown>);
  return out;
}

interface GoogleErrorBody {
  code?: number;
  status?: string;
  message?: string;
  details?: Array<{ "@type"?: string; retryDelay?: string; reason?: string; violations?: Array<{ quotaId?: string }> }>;
}

function parseErrorBody(message: string): GoogleErrorBody {
  try {
    const parsed = JSON.parse(message) as { error?: GoogleErrorBody };
    return parsed.error ?? {};
  } catch {
    return { message };
  }
}

/** "37s" / "1.5s" -> ms */
function parseRetryDelay(body: GoogleErrorBody): number | undefined {
  const raw = body.details?.find((d) => d["@type"]?.endsWith("RetryInfo"))?.retryDelay;
  const m = raw ? /^(\d+(?:\.\d+)?)s$/.exec(raw) : null;
  return m ? Math.round(Number(m[1]) * 1000) : undefined;
}

/**
 * A 429 can be a short per-minute rate limit (retry after the given delay) or an
 * exhausted quota (per-day, or "limit: 0" when the model has no free-tier quota).
 * The latter should stop all calls until the breaker cools down.
 */
function isQuotaExhausted(body: GoogleErrorBody): boolean {
  const quotaIds = (body.details ?? []).flatMap((d) => d.violations ?? []).map((v) => v.quotaId ?? "");
  return quotaIds.some((id) => /PerDay/i.test(id)) || /\blimit: 0\b/.test(body.message ?? "");
}

function isInvalidKey(body: GoogleErrorBody): boolean {
  return (
    (body.details ?? []).some((d) => d.reason === "API_KEY_INVALID") ||
    /API key not valid|API_KEY_INVALID/i.test(body.message ?? "")
  );
}

const NETWORK_CODES = new Set(["ECONNRESET", "ECONNREFUSED", "ETIMEDOUT", "ENOTFOUND", "EAI_AGAIN", "UND_ERR_SOCKET"]);

export function classifyGeminiError(
  err: unknown,
  ctx: { model: string; classifierThinking: GeminiThinking },
): ClassifiedError {
  if (err instanceof GeminiTimeoutError || (err instanceof Error && err.name === "AbortError")) {
    return { code: "TIMEOUT", status: "TIMEOUT", message: "AI request timed out", retryable: false, upstreamFailure: true };
  }

  if (err instanceof ApiError) {
    const body = parseErrorBody(err.message);
    const apiMessage = (body.message ?? "").slice(0, 200);

    if (err.status === 429 || body.status === "RESOURCE_EXHAUSTED") {
      const exhausted = isQuotaExhausted(body);
      return {
        code: "RATE_LIMITED",
        status: "RATE_LIMITED",
        message: exhausted
          ? `Gemini quota exhausted; AI paused until the circuit breaker cools down. ${apiMessage}`
          : "Gemini rate limit reached",
        retryable: !exhausted,
        upstreamFailure: true,
        retryAfterMs: parseRetryDelay(body),
        quotaExhausted: exhausted,
      };
    }
    if (err.status === 401 || err.status === 403 || isInvalidKey(body)) {
      return {
        code: "AUTH_ERROR",
        status: "ERROR",
        message: "Gemini rejected the API key; check GEMINI_API_KEY",
        retryable: false,
        upstreamFailure: true,
      };
    }
    if (err.status >= 500) {
      return {
        code: "UPSTREAM_ERROR",
        status: "ERROR",
        message: `AI service error (${err.status})`,
        retryable: true,
        upstreamFailure: true,
        retryAfterMs: parseRetryDelay(body),
      };
    }
    if (err.status === 404) {
      return {
        code: "BAD_REQUEST",
        status: "ERROR",
        message: `Gemini model "${ctx.model}" was not found for this key; check LLM_MODEL. ${apiMessage}`,
        retryable: false,
        upstreamFailure: false,
      };
    }
    if (/thinking/i.test(apiMessage)) {
      // Not silently dropped: the admin-visible aiError and AiCall row say exactly what to change.
      return {
        code: "BAD_REQUEST",
        status: "ERROR",
        message: `Gemini rejected GEMINI_CLASSIFIER_THINKING=${ctx.classifierThinking} for ${ctx.model}: ${apiMessage}`,
        retryable: false,
        upstreamFailure: false,
      };
    }
    return {
      code: "BAD_REQUEST",
      status: "ERROR",
      message: `AI request rejected (${err.status}): ${apiMessage}`,
      retryable: false,
      upstreamFailure: false,
    };
  }

  const code = (err as { code?: string; cause?: { code?: string } } | null)?.cause?.code ?? (err as { code?: string } | null)?.code;
  if ((err instanceof TypeError && /fetch failed/i.test(err.message)) || (code && NETWORK_CODES.has(code))) {
    return {
      code: "UPSTREAM_ERROR",
      status: "ERROR",
      message: "Could not reach the AI service",
      retryable: true,
      upstreamFailure: true,
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

function scrub(message: string, apiKey: string | undefined): string {
  return apiKey ? message.split(apiKey).join("[redacted]") : message;
}
