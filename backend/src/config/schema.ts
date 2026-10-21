/**
 * Environment schema and pure helpers. No side effects on import, so scripts
 * (npm run ai:eval) can validate their own subset. The server uses ./env.
 */
import { z } from "zod";
import { GEMINI_THINKING_SETTINGS } from "../ai/llm/providers/gemini";
import { LLM_PROVIDERS, apiKeyVarFor, selectedApiKey } from "../ai/llm/providers";

const bool = z
  .enum(["true", "false", "1", "0"])
  .transform((v) => v === "true" || v === "1");

/** The placeholder shipped in .env.example. Fine for local dev, never for production. */
export const DEV_DEFAULT_JWT_SECRET = "change-me-to-a-long-random-string-at-least-32-chars";
const MIN_JWT_SECRET_LENGTH = 32;
/**
 * Gemini's free tier showed single calls of 1-15 s and one 15 s timeout in the first eval,
 * so it gets a longer default. LLM_TIMEOUT_MS overrides either.
 */
export const DEFAULT_TIMEOUT_MS = { anthropic: 15_000, gemini: 30_000 } as const;
/** Only Anthropic has a default model. Gemini ids change too often to hardcode one. */
export const DEFAULT_ANTHROPIC_MODEL = "claude-haiku-5-5";

const optionalSecret = z.string().optional().transform((v) => (v ? v : undefined));
const optionalPrice = z.preprocess(
  (v) => (v === "" || v === undefined ? undefined : v),
  z.coerce.number().nonnegative("must be a non-negative number").optional(),
);

const EnvSchema = z
  .object({
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    PORT: z.coerce.number().int().positive().default(4000),
    CORS_ORIGINS: z
      .string()
      .default("http://localhost:5173")
      .transform((s) =>
        s
          .split(",")
          .map((o) => o.trim())
          .filter(Boolean),
      ),
    LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),

    DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),

    // Optional outside production (falls back to the dev default). Rules: jwtSecretProblems().
    JWT_SECRET: z.string().optional().transform((v) => (v ? v : undefined)),
    JWT_EXPIRES_IN: z.string().default("8h"),

    // Which LLM serves classification and drafts. Only the selected provider's key is used.
    LLM_PROVIDER: z.enum(LLM_PROVIDERS).default("anthropic"),
    // Optional: without the selected provider's key the app runs in degraded mode (keyword triage, manual replies).
    ANTHROPIC_API_KEY: optionalSecret,
    GEMINI_API_KEY: optionalSecret,
    // Defaults to claude-haiku-5-5 for Anthropic; required for Gemini (checked in llmModelProblems).
    LLM_MODEL: z.string().trim().optional().transform((v) => (v ? v : undefined)),
    // Classifier thinking on Gemini: "minimal" where the model supports it, "off" = thinkingBudget 0 (2.5 models).
    GEMINI_CLASSIFIER_THINKING: z.enum(GEMINI_THINKING_SETTINGS).default("minimal"),
    // USD per million tokens, for AiCall.estCost only. Anthropic: unset = built-in rate card.
    ANTHROPIC_PRICE_INPUT_PER_MTOK: optionalPrice,
    ANTHROPIC_PRICE_OUTPUT_PER_MTOK: optionalPrice,
    // Gemini: default 0 (free tier). Set the paid rates if you use a billed project.
    GEMINI_PRICE_INPUT_PER_MTOK: optionalPrice.transform((v) => v ?? 0),
    GEMINI_PRICE_OUTPUT_PER_MTOK: optionalPrice.transform((v) => v ?? 0),
    // Per-attempt timeout. Default depends on the provider (see DEFAULT_TIMEOUT_MS); set to override both.
    LLM_TIMEOUT_MS: z.preprocess((v) => (v === "" ? undefined : v), z.coerce.number().int().positive().optional()),
    LLM_MAX_RETRIES: z.coerce.number().int().min(0).max(5).default(2),
    LLM_BREAKER_THRESHOLD: z.coerce.number().int().positive().default(5),
    LLM_BREAKER_COOLDOWN_MS: z.coerce.number().int().positive().default(30_000),

    RATE_LIMIT_LOGIN_MAX: z.coerce.number().int().positive().default(10),
    RATE_LIMIT_LOGIN_WINDOW_MS: z.coerce.number().int().positive().default(15 * 60_000),
    RATE_LIMIT_AI_MAX: z.coerce.number().int().positive().default(20),
    RATE_LIMIT_AI_WINDOW_MS: z.coerce.number().int().positive().default(60_000),

    // Demo tickets for a fresh deploy (see src/seed/demoTickets.ts). Off unless asked for.
    SEED_DEMO_TICKETS: bool.default(false),
  })
  .transform((e) => ({
    ...e,
    JWT_SECRET: e.JWT_SECRET ?? DEV_DEFAULT_JWT_SECRET,
    // Empty only when Gemini is selected without a model, which parseEnv rejects.
    LLM_MODEL: e.LLM_MODEL ?? (e.LLM_PROVIDER === "anthropic" ? DEFAULT_ANTHROPIC_MODEL : ""),
    LLM_TIMEOUT_MS: e.LLM_TIMEOUT_MS ?? DEFAULT_TIMEOUT_MS[e.LLM_PROVIDER],
  }));

export type Env = z.infer<typeof EnvSchema>;

export class ConfigError extends Error {
  constructor(readonly problems: string[]) {
    super(`Invalid environment configuration:\n${problems.map((p) => `  - ${p}`).join("\n")}`);
    this.name = "ConfigError";
  }
}

/** Pure so it can be tested with any input. Error messages name variables, never their values. */
export function parseEnv(source: Record<string, string | undefined>): Env {
  const parsed = EnvSchema.safeParse(source);
  const problems = [
    ...(parsed.success ? [] : parsed.error.issues.map((i) => `${i.path.join(".") || "(env)"}: ${i.message}`)),
    ...jwtSecretProblems(source.JWT_SECRET || undefined, source.NODE_ENV === "production"),
    ...llmProblems(source),
  ];
  if (problems.length > 0 || !parsed.success) throw new ConfigError(problems);
  return parsed.data;
}

function llmProblems(source: Record<string, string | undefined>): string[] {
  const problems: string[] = [];
  if (source.LLM_PROVIDER === "gemini" && !source.LLM_MODEL?.trim()) {
    problems.push(
      "LLM_MODEL: is required when LLM_PROVIDER=gemini (no default: Gemini model ids change often; see README)",
    );
  }
  if (Boolean(source.ANTHROPIC_PRICE_INPUT_PER_MTOK) !== Boolean(source.ANTHROPIC_PRICE_OUTPUT_PER_MTOK)) {
    problems.push("ANTHROPIC_PRICE_INPUT_PER_MTOK / ANTHROPIC_PRICE_OUTPUT_PER_MTOK: set both or neither");
  }
  return problems;
}

/** Checked outside the schema so these are reported even when other variables are invalid too. */
function jwtSecretProblems(secret: string | undefined, production: boolean): string[] {
  if (production && !secret) return ["JWT_SECRET: is required in production"];
  if (production && secret === DEV_DEFAULT_JWT_SECRET) return ["JWT_SECRET: must not be the development default in production"];
  if (secret && secret.length < MIN_JWT_SECRET_LENGTH) return [`JWT_SECRET: must be at least ${MIN_JWT_SECRET_LENGTH} characters`];
  return [];
}

/**
 * What the server logs at startup. Built from an allowlist: secrets are
 * reported only as set/unset, and the database URL is reduced to host and name.
 */
export function envSummary(e: Env) {
  return {
    nodeEnv: e.NODE_ENV,
    port: e.PORT,
    corsOrigins: e.CORS_ORIGINS,
    logLevel: e.LOG_LEVEL,
    database: describeDatabase(e.DATABASE_URL),
    jwt: {
      secret: e.JWT_SECRET === DEV_DEFAULT_JWT_SECRET ? "dev default" : "set",
      expiresIn: e.JWT_EXPIRES_IN,
    },
    // Provider, model and key presence only. Never key values.
    ai: {
      provider: e.LLM_PROVIDER,
      model: e.LLM_MODEL,
      mode: selectedApiKey(e) ? "enabled" : "degraded",
      apiKey: selectedApiKey(e) ? "set" : "not set",
      apiKeyVar: apiKeyVarFor(e.LLM_PROVIDER),
    },
    rateLimits: {
      login: `${e.RATE_LIMIT_LOGIN_MAX}/${e.RATE_LIMIT_LOGIN_WINDOW_MS}ms`,
      ai: `${e.RATE_LIMIT_AI_MAX}/${e.RATE_LIMIT_AI_WINDOW_MS}ms`,
    },
    seedDemoTickets: e.SEED_DEMO_TICKETS,
  };
}

function describeDatabase(url: string): string {
  try {
    const u = new URL(url);
    return `${u.hostname}${u.port ? `:${u.port}` : ""}${u.pathname}`;
  } catch {
    return "(unparseable URL)";
  }
}
