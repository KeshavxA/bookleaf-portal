import request from "supertest";
import Anthropic from "@anthropic-ai/sdk";
import { buildContainer } from "../src/container";
import { createApp } from "../src/app";
import { prisma } from "../src/lib/prisma";
import { LlmClient } from "../src/ai/llm/client";
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
    apiKey: "test-key",
    model: "claude-haiku-5-5",
    timeoutMs: 1000,
    maxRetries: 2,
    breaker: new CircuitBreaker({ threshold: opts.threshold ?? 100, cooldownMs: 60_000 }),
    recorder: new AiCallRepository(prisma),
    sdk: { messages: { create } } as unknown as Pick<Anthropic, "messages">,
    sleep: async () => {},
  });
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
