import type { TokenUsage } from "./types";

/**
 * USD per million tokens (Anthropic first-party list prices, 2026-10).
 * Cache writes (5-minute TTL) bill at 1.25x input, cache reads at 0.1x input.
 * Used only for the estCost column - an estimate for dashboards, not billing.
 */
interface Rate {
  input: number;
  output: number;
  /** Optional higher rate card above a prompt-length cutoff (Haiku 5.5: >100K tokens). */
  longPrompt?: { aboveTokens: number; input: number; output: number };
}

const RATES: Record<string, Rate> = {
  "claude-haiku-5-5": { input: 0.1, output: 0.5, longPrompt: { aboveTokens: 100_000, input: 0.5, output: 2.5 } },
  "claude-haiku-4-5": { input: 1, output: 5 },
  "claude-sonnet-5-5": { input: 2, output: 10 },
  "claude-opus-5-5": { input: 4, output: 20 },
};

const CACHE_WRITE_MULTIPLIER = 1.25;
const CACHE_READ_MULTIPLIER = 0.1;

/** USD per million tokens set by env (ANTHROPIC_PRICE_*_PER_MTOK); replaces the built-in rate card. */
export interface PriceOverride {
  inputPerMTok: number;
  outputPerMTok: number;
}

export function estimateCostUsd(model: string, usage: TokenUsage, override?: PriceOverride): number {
  const rate: Rate | undefined = override ? { input: override.inputPerMTok, output: override.outputPerMTok } : RATES[model];
  if (!rate) return 0;
  const promptTokens = usage.inputTokens + usage.cacheReadTokens + usage.cacheWriteTokens;
  const useLong = rate.longPrompt !== undefined && promptTokens > rate.longPrompt.aboveTokens;
  const inRate = useLong ? rate.longPrompt!.input : rate.input;
  const outRate = useLong ? rate.longPrompt!.output : rate.output;

  const cost =
    usage.inputTokens * inRate +
    usage.cacheWriteTokens * inRate * CACHE_WRITE_MULTIPLIER +
    usage.cacheReadTokens * inRate * CACHE_READ_MULTIPLIER +
    usage.outputTokens * outRate;
  return cost / 1_000_000;
}

export function hasKnownPricing(model: string): boolean {
  return model in RATES;
}
