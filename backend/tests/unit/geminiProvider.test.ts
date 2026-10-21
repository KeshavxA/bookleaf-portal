import { describe, expect, it, vi } from "vitest";
import { ApiError, ThinkingLevel, Type, type GenerateContentParameters } from "@google/genai";
import { LlmClient } from "../../src/ai/llm/client";
import { CircuitBreaker } from "../../src/ai/llm/circuitBreaker";
import { GeminiProvider, toGeminiSchema, type GeminiThinking } from "../../src/ai/llm/providers/gemini";
import { LlmError, type AiCallRecord } from "../../src/ai/llm/types";
import { TicketClassifier } from "../../src/ai/classifier/classifier";
import { CLASSIFICATION_JSON_SCHEMA } from "../../src/ai/classifier/schema";
import { CLASSIFIER_SYSTEM_PROMPT } from "../../src/ai/classifier/prompt";
import { CATEGORIES, PRIORITIES } from "../../src/domain/enums";
import { fakeGeminiResponse, geminiApiError } from "../helpers";

const API_KEY = "AIzaFAKE-gemini-key-0123456789";
const TICKET = {
  subject: "Wrong ISBN on Amazon",
  description: "Amazon shows a different ISBN from the one printed in my book.",
  book: { title: "Code & Karma", status: "Published & Live" },
};
const VALID = JSON.stringify({ category: "ISBN_METADATA", priority: "HIGH", reasoning: "ISBN mismatch between listing and print" });

type Generate = (params: GenerateContentParameters) => Promise<unknown>;

function setup(
  generate: Generate,
  opts: { apiKey?: string | undefined; threshold?: number; timeoutMs?: number; thinking?: GeminiThinking } = {},
) {
  const records: AiCallRecord[] = [];
  const sleeps: number[] = [];
  const sdkGenerate = vi.fn(generate);
  const breaker = new CircuitBreaker({ threshold: opts.threshold ?? 5, cooldownMs: 60_000 });
  const apiKey = "apiKey" in opts ? opts.apiKey : API_KEY;
  const provider = new GeminiProvider({
    apiKey,
    model: "gemini-3.5-flash-lite",
    classifierThinking: opts.thinking ?? "minimal",
    price: { inputPerMTok: 0, outputPerMTok: 0 },
    sdk: apiKey ? ({ models: { generateContent: sdkGenerate } } as never) : undefined,
  });
  const llm = new LlmClient({
    provider,
    timeoutMs: opts.timeoutMs ?? 15_000,
    maxRetries: 2,
    breaker,
    recorder: { record: async (r) => void records.push(r) },
    sleep: async (ms) => void sleeps.push(ms),
  });
  return { llm, provider, breaker, records, sleeps, sdkGenerate, classifier: new TicketClassifier(llm) };
}

const quotaBody = (quotaId: string, retryDelay?: string) => ({
  code: 429,
  status: "RESOURCE_EXHAUSTED",
  message: "You exceeded your current quota, please check your plan and billing details.",
  details: [
    { "@type": "type.googleapis.com/google.rpc.QuotaFailure", violations: [{ quotaId }] },
    ...(retryDelay ? [{ "@type": "type.googleapis.com/google.rpc.RetryInfo", retryDelay }] : []),
  ],
});

describe("GeminiProvider: valid output", () => {
  it("classifies through structured output and logs tokens with provider gemini", async () => {
    const { classifier, sdkGenerate, records } = setup(async () =>
      fakeGeminiResponse(VALID, { usage: { promptTokenCount: 700, candidatesTokenCount: 30, thoughtsTokenCount: 12 } }),
    );
    const out = await classifier.classify(TICKET, "t1");
    expect(out).toMatchObject({ source: "AI", category: "ISBN_METADATA", priority: "HIGH" });

    const params = sdkGenerate.mock.calls[0]![0];
    expect(params.model).toBe("gemini-3.5-flash-lite");
    expect(params.config).toMatchObject({
      systemInstruction: CLASSIFIER_SYSTEM_PROMPT,
      responseMimeType: "application/json",
      maxOutputTokens: 256,
      thinkingConfig: { thinkingLevel: ThinkingLevel.MINIMAL },
    });
    const schema = params.config!.responseSchema as { properties: Record<string, { enum?: string[] }> };
    expect(schema.properties.category!.enum).toEqual([...CATEGORIES]);
    expect(schema.properties.priority!.enum).toEqual([...PRIORITIES]);
    expect(params.contents).toEqual([{ role: "user", parts: [{ text: expect.stringContaining("<ticket>") }] }]);
    // Anthropic-only prompt caching must never leak into a Gemini request
    expect(JSON.stringify(params)).not.toContain("cache_control");

    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      provider: "gemini",
      model: "gemini-3.5-flash-lite",
      status: "SUCCESS",
      attempts: 1,
      inputTokens: 700,
      outputTokens: 42, // thinking tokens are billed as output
      estCost: 0, // free-tier default
    });
  });

  it("supports thinking off (thinkingBudget 0) for 2.5-family models", async () => {
    const { classifier, sdkGenerate } = setup(async () => fakeGeminiResponse(VALID), { thinking: "off" });
    await classifier.classify(TICKET);
    expect(sdkGenerate.mock.calls[0]![0].config!.thinkingConfig).toEqual({ thinkingBudget: 0 });
  });

  it("splits implicit-cache hits out of input tokens", async () => {
    const { classifier, records } = setup(async () =>
      fakeGeminiResponse(VALID, { usage: { promptTokenCount: 700, cachedContentTokenCount: 600, candidatesTokenCount: 30 } }),
    );
    await classifier.classify(TICKET);
    expect(records[0]).toMatchObject({ inputTokens: 100, cacheReadTokens: 600, outputTokens: 30 });
  });
});

describe("GeminiProvider: bad output falls back to keyword triage", () => {
  it("invalid JSON -> INVALID_OUTPUT, no retry, keyword fallback", async () => {
    const { classifier, sdkGenerate, records, breaker } = setup(async () => fakeGeminiResponse("category: ISBN, sorry"));
    const out = await classifier.classify(TICKET);
    expect(out).toMatchObject({ source: "FALLBACK", category: "ISBN_METADATA", priority: "HIGH", errorCode: "INVALID_OUTPUT" });
    expect(sdkGenerate).toHaveBeenCalledTimes(1);
    expect(records[0]!.status).toBe("INVALID_OUTPUT");
    expect(breaker.getState()).toBe("CLOSED");
  });

  it("an enum value outside the schema is rejected by zod", async () => {
    const { classifier } = setup(async () =>
      fakeGeminiResponse(JSON.stringify({ category: "URGENT_STUFF", priority: "HIGH", reasoning: "x" })),
    );
    await expect(classifier.classify(TICKET)).resolves.toMatchObject({ source: "FALLBACK", errorCode: "INVALID_OUTPUT" });
  });

  it("truncation at MAX_TOKENS is treated as unusable output", async () => {
    const { classifier } = setup(async () => fakeGeminiResponse('{"category": "ISBN_ME', { finishReason: "MAX_TOKENS" }));
    await expect(classifier.classify(TICKET)).resolves.toMatchObject({ source: "FALLBACK", errorCode: "INVALID_OUTPUT" });
  });

  it("a safety block is recorded as REFUSED", async () => {
    const { llm, records } = setup(async () => fakeGeminiResponse("", { finishReason: "SAFETY" }));
    await expect(
      llm.complete({ kind: "DRAFT", system: [{ text: "s" }], messages: [{ role: "user", content: "x" }], maxTokens: 10 }, (r) => r.text),
    ).rejects.toMatchObject({ code: "REFUSED" });
    expect(records[0]!.status).toBe("REFUSED");
  });
});

describe("GeminiProvider: rate limits and quota", () => {
  it("429 with a short RetryInfo delay waits that long, then succeeds", async () => {
    let n = 0;
    const { classifier, sleeps, records } = setup(async () => {
      if (++n === 1) throw geminiApiError(429, quotaBody("GenerateRequestsPerMinutePerProjectPerModel-FreeTier", "2s"));
      return fakeGeminiResponse(VALID);
    });
    await expect(classifier.classify(TICKET)).resolves.toMatchObject({ source: "AI" });
    expect(sleeps).toEqual([2000]);
    expect(records[0]).toMatchObject({ status: "SUCCESS", attempts: 2 });
  });

  it("429 asking for longer than the timeout budget: no wait, breaker opens, later calls fail fast", async () => {
    const { classifier, sleeps, sdkGenerate, breaker, records } = setup(async () => {
      throw geminiApiError(429, quotaBody("GenerateRequestsPerMinutePerProjectPerModel-FreeTier", "41s"));
    });
    await expect(classifier.classify(TICKET)).resolves.toMatchObject({ source: "FALLBACK", errorCode: "RATE_LIMITED" });
    expect(sleeps).toEqual([]);
    expect(breaker.getState()).toBe("OPEN");

    await expect(classifier.classify(TICKET)).resolves.toMatchObject({ source: "FALLBACK", errorCode: "CIRCUIT_OPEN" });
    expect(sdkGenerate).toHaveBeenCalledTimes(1);
    expect(records.map((r) => r.status)).toEqual(["RATE_LIMITED", "CIRCUIT_OPEN"]);
  });

  it("a quota-exhausted 429 (daily limit) opens the breaker on the first failure, with no retries", async () => {
    const { llm, classifier, sdkGenerate, breaker } = setup(async () => {
      throw geminiApiError(429, quotaBody("GenerateRequestsPerDayPerProjectPerModel-FreeTier"));
    });
    const out = await classifier.classify(TICKET);
    expect(out).toMatchObject({ source: "FALLBACK", category: "ISBN_METADATA", errorCode: "RATE_LIMITED" });
    if (out.source === "FALLBACK") expect(out.errorMessage).toMatch(/quota exhausted/);
    expect(sdkGenerate).toHaveBeenCalledTimes(1);
    expect(breaker.getState()).toBe("OPEN");

    // drafts degrade too, without touching the API
    const draft = llm.complete({ kind: "DRAFT", system: [{ text: "s" }], messages: [], maxTokens: 10 }, (r) => r.text);
    await expect(draft).rejects.toMatchObject({ code: "CIRCUIT_OPEN" });
    expect(sdkGenerate).toHaveBeenCalledTimes(1);
  });

  it('"limit: 0" (model not on the free tier) is treated as exhausted', async () => {
    const { breaker, classifier } = setup(async () => {
      throw geminiApiError(429, {
        code: 429,
        status: "RESOURCE_EXHAUSTED",
        message: "Quota exceeded for metric: generate_content_free_tier_requests, limit: 0, model: gemini-x",
      });
    });
    await classifier.classify(TICKET);
    expect(breaker.getState()).toBe("OPEN");
  });
});

describe("GeminiProvider: server errors, timeouts and keys", () => {
  it("503 is retried with backoff, then reported", async () => {
    const { classifier, sdkGenerate, sleeps, records } = setup(async () => {
      throw geminiApiError(503, { code: 503, status: "UNAVAILABLE", message: "The model is overloaded." });
    });
    await expect(classifier.classify(TICKET)).resolves.toMatchObject({ source: "FALLBACK", errorCode: "UPSTREAM_ERROR" });
    expect(sdkGenerate).toHaveBeenCalledTimes(3);
    expect(sleeps).toHaveLength(2);
    expect(records[0]).toMatchObject({ status: "ERROR", attempts: 3, errorCode: "UPSTREAM_ERROR" });
  });

  it("503 then success", async () => {
    let n = 0;
    const { classifier, records } = setup(async () => {
      if (++n === 1) throw geminiApiError(503, { code: 503, status: "UNAVAILABLE", message: "overloaded" });
      return fakeGeminiResponse(VALID);
    });
    await expect(classifier.classify(TICKET)).resolves.toMatchObject({ source: "AI" });
    expect(records[0]).toMatchObject({ status: "SUCCESS", attempts: 2 });
  });

  it("times out on our own deadline and does not retry", async () => {
    const { classifier, sdkGenerate, records } = setup(
      (params) =>
        new Promise((_, reject) => {
          params.config!.abortSignal!.addEventListener("abort", () =>
            reject(Object.assign(new Error("This operation was aborted"), { name: "AbortError" })),
          );
        }),
      { timeoutMs: 30 },
    );
    await expect(classifier.classify(TICKET)).resolves.toMatchObject({ source: "FALLBACK", errorCode: "TIMEOUT" });
    expect(sdkGenerate).toHaveBeenCalledTimes(1);
    expect(records[0]!.status).toBe("TIMEOUT");
  });

  it("a network failure is retried", async () => {
    const { classifier, sdkGenerate } = setup(async () => {
      throw new TypeError("fetch failed");
    });
    await expect(classifier.classify(TICKET)).resolves.toMatchObject({ errorCode: "UPSTREAM_ERROR" });
    expect(sdkGenerate).toHaveBeenCalledTimes(3);
  });

  it("missing GEMINI_API_KEY: disabled, no SDK, DISABLED logged, keyword fallback", async () => {
    const { provider, classifier, records } = setup(async () => fakeGeminiResponse(VALID), { apiKey: undefined });
    expect(provider.enabled).toBe(false);
    await expect(classifier.classify(TICKET)).resolves.toMatchObject({ source: "FALLBACK", errorCode: "DISABLED" });
    expect(records[0]).toMatchObject({ provider: "gemini", status: "DISABLED", errorMessage: "GEMINI_API_KEY is not configured" });
  });

  it("an invalid key is a clear, non-retryable AUTH_ERROR that never echoes the key", async () => {
    const { classifier, sdkGenerate, records } = setup(async () => {
      throw geminiApiError(400, {
        code: 400,
        status: "INVALID_ARGUMENT",
        message: `API key not valid. Please pass a valid API key. (${API_KEY})`,
        details: [{ "@type": "type.googleapis.com/google.rpc.ErrorInfo", reason: "API_KEY_INVALID" }],
      });
    });
    const out = await classifier.classify(TICKET);
    expect(out).toMatchObject({ source: "FALLBACK", errorCode: "AUTH_ERROR" });
    expect(sdkGenerate).toHaveBeenCalledTimes(1);
    expect(records[0]!.errorMessage).toContain("GEMINI_API_KEY");
    expect(JSON.stringify(records)).not.toContain(API_KEY);
    if (out.source === "FALLBACK") expect(out.errorMessage).not.toContain(API_KEY);
  });

  it("a rejected thinking level is reported, naming the setting to change", async () => {
    const { classifier, records } = setup(
      async () => {
        throw geminiApiError(400, {
          code: 400,
          status: "INVALID_ARGUMENT",
          message: "Thinking level MINIMAL is not supported for this model.",
        });
      },
      { thinking: "minimal" },
    );
    await expect(classifier.classify(TICKET)).resolves.toMatchObject({ source: "FALLBACK", errorCode: "BAD_REQUEST" });
    expect(records[0]!.errorMessage).toMatch(/GEMINI_CLASSIFIER_THINKING=minimal/);
  });

  it("an unknown model id points at LLM_MODEL", async () => {
    const { llm } = setup(async () => {
      throw geminiApiError(404, { code: 404, status: "NOT_FOUND", message: "models/gemini-9 is not found" });
    });
    const err = await llm
      .complete({ kind: "DRAFT", system: [{ text: "s" }], messages: [], maxTokens: 10 }, (r) => r.text)
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(LlmError);
    expect((err as LlmError).message).toMatch(/LLM_MODEL/);
  });
});

describe("toGeminiSchema", () => {
  it("keeps enums, required fields and property order from the classifier schema", () => {
    expect(toGeminiSchema(CLASSIFICATION_JSON_SCHEMA as unknown as Record<string, unknown>)).toEqual({
      type: Type.OBJECT,
      properties: {
        category: { type: Type.STRING, format: "enum", enum: [...CATEGORIES] },
        priority: { type: Type.STRING, format: "enum", enum: [...PRIORITIES] },
        reasoning: { type: Type.STRING, description: expect.stringContaining("20 words") },
      },
      propertyOrdering: ["category", "priority", "reasoning"],
      required: ["category", "priority", "reasoning"],
    });
  });
});
