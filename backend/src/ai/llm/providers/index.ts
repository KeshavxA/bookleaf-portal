import type Anthropic from "@anthropic-ai/sdk";
import type { GoogleGenAI } from "@google/genai";
import type { LlmProvider, LlmProviderName } from "../types";
import { AnthropicProvider } from "./anthropic";
import { GeminiProvider, type GeminiThinking } from "./gemini";

export const LLM_PROVIDERS = ["anthropic", "gemini"] as const satisfies readonly LlmProviderName[];

/** The subset of validated env the AI module needs (src/config/env.ts satisfies it). */
export interface ProviderConfig {
  LLM_PROVIDER: LlmProviderName;
  LLM_MODEL: string;
  ANTHROPIC_API_KEY?: string;
  GEMINI_API_KEY?: string;
  ANTHROPIC_PRICE_INPUT_PER_MTOK?: number;
  ANTHROPIC_PRICE_OUTPUT_PER_MTOK?: number;
  GEMINI_PRICE_INPUT_PER_MTOK: number;
  GEMINI_PRICE_OUTPUT_PER_MTOK: number;
  GEMINI_CLASSIFIER_THINKING: GeminiThinking;
}

/** Fake SDKs for tests. */
export interface ProviderSdks {
  anthropic?: Pick<Anthropic, "messages">;
  gemini?: Pick<GoogleGenAI, "models">;
}

/** Picks the provider named by LLM_PROVIDER. Only that provider's key is read; a missing key gives a disabled provider. */
export function createLlmProvider(cfg: ProviderConfig, sdks: ProviderSdks = {}): LlmProvider {
  if (cfg.LLM_PROVIDER === "gemini") {
    return new GeminiProvider({
      apiKey: cfg.GEMINI_API_KEY,
      model: cfg.LLM_MODEL,
      classifierThinking: cfg.GEMINI_CLASSIFIER_THINKING,
      price: { inputPerMTok: cfg.GEMINI_PRICE_INPUT_PER_MTOK, outputPerMTok: cfg.GEMINI_PRICE_OUTPUT_PER_MTOK },
      sdk: sdks.gemini,
    });
  }
  const price =
    cfg.ANTHROPIC_PRICE_INPUT_PER_MTOK !== undefined && cfg.ANTHROPIC_PRICE_OUTPUT_PER_MTOK !== undefined
      ? { inputPerMTok: cfg.ANTHROPIC_PRICE_INPUT_PER_MTOK, outputPerMTok: cfg.ANTHROPIC_PRICE_OUTPUT_PER_MTOK }
      : undefined;
  return new AnthropicProvider({ apiKey: cfg.ANTHROPIC_API_KEY, model: cfg.LLM_MODEL, price, sdk: sdks.anthropic });
}

export function apiKeyVarFor(provider: LlmProviderName): "ANTHROPIC_API_KEY" | "GEMINI_API_KEY" {
  return provider === "gemini" ? "GEMINI_API_KEY" : "ANTHROPIC_API_KEY";
}

export function selectedApiKey(cfg: Pick<ProviderConfig, "LLM_PROVIDER" | "ANTHROPIC_API_KEY" | "GEMINI_API_KEY">) {
  return cfg[apiKeyVarFor(cfg.LLM_PROVIDER)];
}
