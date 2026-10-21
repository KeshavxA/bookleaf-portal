import { describe, expect, it } from "vitest";
import { ConfigError, envSummary, parseEnv } from "../../src/config/env";
import { createLlmProvider } from "../../src/ai/llm/providers";
import { AnthropicProvider } from "../../src/ai/llm/providers/anthropic";
import { GeminiProvider } from "../../src/ai/llm/providers/gemini";

const DB = { DATABASE_URL: "postgresql://u:p@localhost:5432/db" };
const GEMINI_KEY = "AIzaSy-THIS-IS-A-FAKE-GEMINI-KEY-123";
const ANTHROPIC_KEY = "sk-ant-api03-FAKE-anthropic-key-xyz";
const usage = { inputTokens: 1_000_000, outputTokens: 1_000_000, cacheReadTokens: 0, cacheWriteTokens: 0 };

function problems(source: Record<string, string>): string[] {
  try {
    parseEnv(source);
    return [];
  } catch (err) {
    if (err instanceof ConfigError) return err.problems;
    throw err;
  }
}

describe("provider selection", () => {
  it("defaults to Anthropic with claude-haiku-5-5", () => {
    const env = parseEnv({ ...DB, ANTHROPIC_API_KEY: ANTHROPIC_KEY });
    const p = createLlmProvider(env);
    expect(p).toBeInstanceOf(AnthropicProvider);
    expect(p).toMatchObject({ name: "anthropic", model: "claude-haiku-5-5", enabled: true });
  });

  it("selects Gemini with LLM_PROVIDER=gemini and the configured model", () => {
    const env = parseEnv({ ...DB, LLM_PROVIDER: "gemini", LLM_MODEL: "gemini-3.5-flash-lite", GEMINI_API_KEY: GEMINI_KEY });
    const p = createLlmProvider(env);
    expect(p).toBeInstanceOf(GeminiProvider);
    expect(p).toMatchObject({ name: "gemini", model: "gemini-3.5-flash-lite", enabled: true });
  });

  it("has no default Gemini model: LLM_MODEL is required", () => {
    expect(problems({ ...DB, LLM_PROVIDER: "gemini", GEMINI_API_KEY: GEMINI_KEY })).toEqual([
      expect.stringMatching(/^LLM_MODEL: is required when LLM_PROVIDER=gemini/),
    ]);
  });

  it("rejects an unknown provider", () => {
    expect(problems({ ...DB, LLM_PROVIDER: "openai" })[0]).toMatch(/^LLM_PROVIDER/);
  });

  it("a missing key for the selected provider means degraded, not a crash", () => {
    const env = parseEnv({ ...DB, NODE_ENV: "production", JWT_SECRET: "x".repeat(40), LLM_PROVIDER: "gemini", LLM_MODEL: "gemini-3.5-flash-lite" });
    expect(createLlmProvider(env).enabled).toBe(false);
    expect(envSummary(env).ai).toEqual({
      provider: "gemini",
      model: "gemini-3.5-flash-lite",
      mode: "degraded",
      apiKey: "not set",
      apiKeyVar: "GEMINI_API_KEY",
    });
  });

  it("only the selected provider's key counts", () => {
    const anthropicWithGeminiKey = parseEnv({ ...DB, GEMINI_API_KEY: GEMINI_KEY });
    expect(createLlmProvider(anthropicWithGeminiKey).enabled).toBe(false);
    expect(envSummary(anthropicWithGeminiKey).ai.mode).toBe("degraded");

    const geminiWithAnthropicKey = parseEnv({ ...DB, LLM_PROVIDER: "gemini", LLM_MODEL: "m", ANTHROPIC_API_KEY: ANTHROPIC_KEY });
    expect(createLlmProvider(geminiWithAnthropicKey).enabled).toBe(false);
  });

  it("the startup summary shows provider, model and set/not set, never key values", () => {
    const env = parseEnv({
      ...DB,
      LLM_PROVIDER: "gemini",
      LLM_MODEL: "gemini-3.5-flash-lite",
      GEMINI_API_KEY: GEMINI_KEY,
      ANTHROPIC_API_KEY: ANTHROPIC_KEY,
    });
    const printed = JSON.stringify(envSummary(env));
    expect(envSummary(env).ai).toMatchObject({ provider: "gemini", model: "gemini-3.5-flash-lite", apiKey: "set" });
    for (const secret of [GEMINI_KEY, ANTHROPIC_KEY, "AIza", "sk-ant"]) expect(printed).not.toContain(secret);
  });
});

describe("per-provider pricing", () => {
  it("Gemini defaults to 0 (free tier) and accepts configured rates", () => {
    const free = parseEnv({ ...DB, LLM_PROVIDER: "gemini", LLM_MODEL: "m", GEMINI_API_KEY: GEMINI_KEY });
    expect(createLlmProvider(free).estimateCost(usage)).toBe(0);

    const paid = parseEnv({
      ...DB,
      LLM_PROVIDER: "gemini",
      LLM_MODEL: "m",
      GEMINI_API_KEY: GEMINI_KEY,
      GEMINI_PRICE_INPUT_PER_MTOK: "0.3",
      GEMINI_PRICE_OUTPUT_PER_MTOK: "2.5",
    });
    expect(createLlmProvider(paid).estimateCost(usage)).toBeCloseTo(2.8, 9);
  });

  it("Anthropic uses the built-in rate card unless both prices are overridden", () => {
    const builtIn = parseEnv({ ...DB, ANTHROPIC_API_KEY: ANTHROPIC_KEY });
    // 50k in + 50k out at $0.10 / $0.50 (below Haiku's 100K long-prompt tier)
    const small = { ...usage, inputTokens: 50_000, outputTokens: 50_000 };
    expect(createLlmProvider(builtIn).estimateCost(small)).toBeCloseTo(0.03, 9);

    const overridden = parseEnv({
      ...DB,
      ANTHROPIC_API_KEY: ANTHROPIC_KEY,
      ANTHROPIC_PRICE_INPUT_PER_MTOK: "1",
      ANTHROPIC_PRICE_OUTPUT_PER_MTOK: "5",
    });
    expect(createLlmProvider(overridden).estimateCost(usage)).toBeCloseTo(6, 9);

    expect(problems({ ...DB, ANTHROPIC_PRICE_INPUT_PER_MTOK: "1" })).toEqual([expect.stringMatching(/set both or neither/)]);
    expect(problems({ ...DB, GEMINI_PRICE_INPUT_PER_MTOK: "-1" })[0]).toMatch(/non-negative/);
  });
});
