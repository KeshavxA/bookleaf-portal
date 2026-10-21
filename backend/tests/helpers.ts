import request from "supertest";
import Anthropic from "@anthropic-ai/sdk";
import { ApiError, type GenerateContentParameters, type GenerateContentResponse } from "@google/genai";
import { buildContainer } from "../src/container";
import { createApp } from "../src/app";
import { prisma } from "../src/lib/prisma";
import { LlmClient } from "../src/ai/llm/client";
import { AnthropicProvider } from "../src/ai/llm/providers/anthropic";
import { GeminiProvider } from "../src/ai/llm/providers/gemini";
import { CircuitBreaker } from "../src/ai/llm/circuitBreaker";
import { AiCallRepository } from "../src/repositories/aiCallRepository";
import type { LlmPort } from "../src/ai/llm/types";

export const PASSWORD = "Passw0rd!";
export const PRIYA = "priya.sharma@email.com"; // AUTH001: BK001, BK002
export const ROHIT = "rohit.kapoor@email.com"; // AUTH002: BK003, BK004
export const ADMIN = "admin1@bookleaf.com";

type FakeCreate = (params: Anthropic.MessageCreateParamsNonStreaming) => Promise<Anthropic.Message>;

/** A real LlmClient (retries, breaker, AiCall logging) over a fake SDK transport. */
export function llmWithFakeSdk(create: FakeCreate, opts: { threshold?: number } = {}): LlmClient {
  return new LlmClient({
    provider: new AnthropicProvider({
      apiKey: "test-key",
      model: "claude-haiku-5-5",
      sdk: { messages: { create } } as unknown as Pick<Anthropic, "messages">,
    }),
    timeoutMs: 1000,
    maxRetries: 2,
    breaker: new CircuitBreaker({ threshold: opts.threshold ?? 100, cooldownMs: 60_000 }),
    recorder: new AiCallRepository(prisma),
    sleep: async () => {},
  });
}

type FakeGenerate = (params: GenerateContentParameters) => Promise<unknown>;

/** A real LlmClient over a GeminiProvider with a fake @google/genai transport. */
export function llmWithFakeGemini(generate: FakeGenerate, opts: { threshold?: number } = {}): LlmClient {
  return new LlmClient({
    provider: new GeminiProvider({
      apiKey: "test-gemini-key",
      model: "gemini-3.5-flash-lite",
      classifierThinking: "minimal",
      price: { inputPerMTok: 0, outputPerMTok: 0 },
      sdk: { models: { generateContent: generate } } as never,
    }),
    timeoutMs: 1000,
    maxRetries: 2,
    breaker: new CircuitBreaker({ threshold: opts.threshold ?? 100, cooldownMs: 60_000 }),
    recorder: new AiCallRepository(prisma),
    sleep: async () => {},
  });
}

/** Plain-object stand-in for GenerateContentResponse (the provider reads only these fields). */
export function fakeGeminiResponse(
  text: string,
  opts: { finishReason?: string; usage?: Record<string, number> } = {},
): GenerateContentResponse {
  return {
    candidates: [{ content: { role: "model", parts: [{ text }] }, finishReason: opts.finishReason ?? "STOP" }],
    usageMetadata: opts.usage ?? { promptTokenCount: 120, candidatesTokenCount: 30 },
    modelVersion: "gemini-3.5-flash-lite",
  } as unknown as GenerateContentResponse;
}

/** An SDK ApiError whose message is the JSON error body, as @google/genai builds it. */
export function geminiApiError(status: number, error: Record<string, unknown>): ApiError {
  return new ApiError({ status, message: JSON.stringify({ error }) });
}

export const failingSdk: FakeCreate = async () => {
  throw new Anthropic.InternalServerError(503, { type: "error" }, "overloaded", new Headers());
};

export function fakeMessage(text: string, stop: Anthropic.StopReason = "end_turn"): Anthropic.Message {
  return {
    id: "msg_test",
    type: "message",
    role: "assistant",
    model: "claude-haiku-5-5",
    content: [{ type: "text", text, citations: null }],
    stop_reason: stop,
    stop_sequence: null,
    usage: { input_tokens: 120, output_tokens: 30, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
  } as unknown as Anthropic.Message;
}

export function buildTestApp(llm: LlmPort) {
  const container = buildContainer({ db: prisma, llm });
  return { app: createApp(container), container };
}

export async function login(app: Parameters<typeof request>[0], email: string): Promise<string> {
  const res = await request(app).post("/api/v1/auth/login").send({ email, password: PASSWORD });
  if (res.status !== 200) throw new Error(`login failed for ${email}: ${res.status} ${JSON.stringify(res.body)}`);
  return res.body.token as string;
}

export async function resetTickets(): Promise<void> {
  await prisma.aiCall.deleteMany();
  await prisma.ticket.deleteMany();
}

export { prisma };
