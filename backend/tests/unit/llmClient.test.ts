import { describe, expect, it, vi } from "vitest";
import Anthropic from "@anthropic-ai/sdk";
import { LlmClient } from "../../src/ai/llm/client";
import { AnthropicProvider } from "../../src/ai/llm/providers/anthropic";
import { CircuitBreaker } from "../../src/ai/llm/circuitBreaker";
import { LlmError, LlmOutputError, type AiCallRecord, type LlmRequest } from "../../src/ai/llm/types";
import { estimateCostUsd } from "../../src/ai/llm/pricing";
import { fakeMessage } from "../helpers";

const req: LlmRequest = { kind: "CLASSIFY", ticketId: "t1", system: [{ text: "s" }], messages: [], maxTokens: 10 };
const identity = (r: { text: string }) => r.text;

function setup(create: (...a: unknown[]) => Promise<unknown>, opts: { apiKey?: string; threshold?: number } = {}) {
  const records: AiCallRecord[] = [];
  const sdkCreate = vi.fn(create);
  const breaker = new CircuitBreaker({ threshold: opts.threshold ?? 3, cooldownMs: 60_000 });
  const client = new LlmClient({
    provider: new AnthropicProvider({
      apiKey: "apiKey" in opts ? opts.apiKey : "k",
      model: "claude-haiku-5-5",
      sdk: "apiKey" in opts && !opts.apiKey ? undefined : ({ messages: { create: sdkCreate } } as never),
    }),
    timeoutMs: 1000,
    maxRetries: 2,
    breaker,
    recorder: { record: async (r) => void records.push(r) },
    sleep: async () => {},
  });
  return { client, records, sdkCreate, breaker };
}

const err503 = () => new Anthropic.InternalServerError(503, {}, "overloaded", new Headers());
const err429 = () => new Anthropic.RateLimitError(429, {}, "slow down", new Headers({ "retry-after": "1" }));
const err400 = () => new Anthropic.BadRequestError(400, {}, "bad", new Headers());

describe("LlmClient", () => {
  it("retries 429/5xx with backoff and records one AiCall with usage and cost", async () => {
    let n = 0;
    const { client, records, sdkCreate } = setup(async () => {
      n++;
      if (n === 1) throw err429();
      if (n === 2) throw err503();
      return fakeMessage("hello");
    });
    const { value } = await client.complete(req, identity);
    expect(value).toBe("hello");
    expect(sdkCreate).toHaveBeenCalledTimes(3);
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({ status: "SUCCESS", attempts: 3, inputTokens: 120, outputTokens: 30, ticketId: "t1" });
    expect(records[0]!.estCost).toBeGreaterThan(0);
  });

  it("gives up after maxRetries and records the failure", async () => {
    const { client, records, sdkCreate } = setup(async () => {
      throw err503();
    });
    await expect(client.complete(req, identity)).rejects.toMatchObject({ code: "UPSTREAM_ERROR" });
    expect(sdkCreate).toHaveBeenCalledTimes(3);
    expect(records[0]).toMatchObject({ status: "ERROR", attempts: 3 });
  });

  it("does not retry 400s or timeouts", async () => {
    const a = setup(async () => {
      throw err400();
    });
    await expect(a.client.complete(req, identity)).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(a.sdkCreate).toHaveBeenCalledTimes(1);

    const b = setup(async () => {
      throw new Anthropic.APIConnectionTimeoutError();
    });
    await expect(b.client.complete(req, identity)).rejects.toMatchObject({ code: "TIMEOUT" });
    expect(b.sdkCreate).toHaveBeenCalledTimes(1);
    expect(b.records[0]!.status).toBe("TIMEOUT");
  });

  it("opens the circuit after repeated upstream failures and then fails fast", async () => {
    const { client, records, sdkCreate, breaker } = setup(
      async () => {
        throw new Anthropic.APIConnectionTimeoutError();
      },
      { threshold: 2 },
    );
    await expect(client.complete(req, identity)).rejects.toBeInstanceOf(LlmError);
    await expect(client.complete(req, identity)).rejects.toBeInstanceOf(LlmError);
    expect(breaker.getState()).toBe("OPEN");
    await expect(client.complete(req, identity)).rejects.toMatchObject({ code: "CIRCUIT_OPEN" });
    expect(sdkCreate).toHaveBeenCalledTimes(2); // third call never reached the SDK
    expect(records.map((r) => r.status)).toEqual(["TIMEOUT", "TIMEOUT", "CIRCUIT_OPEN"]);
  });

  it("records INVALID_OUTPUT when the parser rejects the response", async () => {
    const { client, records } = setup(async () => fakeMessage("garbage"));
    await expect(
      client.complete(req, () => {
        throw new LlmOutputError("nope");
      }),
    ).rejects.toMatchObject({ code: "INVALID_OUTPUT" });
    expect(records[0]).toMatchObject({ status: "INVALID_OUTPUT", inputTokens: 120 });
  });

  it("treats refusals as a non-retryable failure", async () => {
    const { client, records } = setup(async () => fakeMessage("", "refusal"));
    await expect(client.complete(req, identity)).rejects.toMatchObject({ code: "REFUSED" });
    expect(records[0]!.status).toBe("REFUSED");
  });

  it("runs disabled (and says so) without an API key", async () => {
    const { client, records } = setup(async () => fakeMessage("x"), { apiKey: undefined });
    expect(client.enabled).toBe(false);
    await expect(client.complete(req, identity)).rejects.toMatchObject({ code: "DISABLED" });
    expect(records[0]!.status).toBe("DISABLED");
  });

  it("never sends sampling params (current Haiku rejects them) and passes the JSON schema", async () => {
    const { client, sdkCreate } = setup(async () => fakeMessage("{}"));
    await client.complete({ ...req, jsonSchema: { type: "object" }, effort: "low", thinking: "disabled" }, identity);
    const params = sdkCreate.mock.calls[0]![0] as Record<string, unknown>;
    expect(params).not.toHaveProperty("temperature");
    expect(params).toMatchObject({
      model: "claude-haiku-5-5",
      thinking: { type: "disabled" },
      output_config: { effort: "low", format: { type: "json_schema", schema: { type: "object" } } },
    });
  });

  it("a failing recorder never breaks the call", async () => {
    const client = new LlmClient({
      provider: new AnthropicProvider({
        apiKey: "k",
        model: "claude-haiku-5-5",
        sdk: { messages: { create: async () => fakeMessage("ok") } } as never,
      }),
      timeoutMs: 1000,
      maxRetries: 0,
      breaker: new CircuitBreaker({ threshold: 3, cooldownMs: 1 }),
      recorder: { record: async () => Promise.reject(new Error("db down")) },
    });
    await expect(client.complete(req, identity)).resolves.toMatchObject({ value: "ok" });
  });
});

describe("CircuitBreaker", () => {
  it("half-opens after the cooldown and closes on a successful probe", () => {
    let now = 0;
    const b = new CircuitBreaker({ threshold: 1, cooldownMs: 100, now: () => now });
    b.onFailure();
    expect(b.tryAcquire()).toBe(false);
    now = 150;
    expect(b.tryAcquire()).toBe(true); // probe
    expect(b.tryAcquire()).toBe(false); // only one probe at a time
    b.onSuccess();
    expect(b.getState()).toBe("CLOSED");
  });
});

describe("pricing", () => {
  it("estimates Haiku cost including cache reads/writes", () => {
    const usage = { inputTokens: 10_000, outputTokens: 10_000, cacheReadTokens: 10_000, cacheWriteTokens: 10_000 };
    // (10k*0.10 + 10k*0.50 + 10k*0.10*0.1 + 10k*0.10*1.25) / 1M
    expect(estimateCostUsd("claude-haiku-5-5", usage)).toBeCloseTo((1000 + 5000 + 100 + 1250) / 1_000_000, 9);
    // prompts above 100K tokens use the higher rate card
    const long = estimateCostUsd("claude-haiku-5-5", { ...usage, inputTokens: 200_000 });
    expect(long).toBeCloseTo((200_000 * 0.5 + 10_000 * 2.5 + 10_000 * 0.5 * 0.1 + 10_000 * 0.5 * 1.25) / 1_000_000, 9);
    expect(estimateCostUsd("unknown-model", { inputTokens: 5, outputTokens: 5, cacheReadTokens: 0, cacheWriteTokens: 0 })).toBe(0);
  });
});
