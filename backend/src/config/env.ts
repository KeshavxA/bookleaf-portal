import "dotenv/config";
import { z } from "zod";

const bool = z
  .enum(["true", "false", "1", "0"])
  .transform((v) => v === "true" || v === "1");

/** The placeholder shipped in .env.example. Fine for local dev, never for production. */
export const DEV_DEFAULT_JWT_SECRET = "change-me-to-a-long-random-string-at-least-32-chars";
const MIN_JWT_SECRET_LENGTH = 32;

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

    // Optional: without a key the app runs in degraded mode (keyword triage, manual replies).
    ANTHROPIC_API_KEY: z.string().optional().transform((v) => (v ? v : undefined)),
    LLM_MODEL: z.string().default("claude-haiku-5-5"),
    LLM_TIMEOUT_MS: z.coerce.number().int().positive().default(15_000),
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
  .transform((e) => ({ ...e, JWT_SECRET: e.JWT_SECRET ?? DEV_DEFAULT_JWT_SECRET }));

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
  ];
  if (problems.length > 0 || !parsed.success) throw new ConfigError(problems);
  return parsed.data;
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
    ai: {
      mode: e.ANTHROPIC_API_KEY ? "enabled" : "degraded",
      apiKey: e.ANTHROPIC_API_KEY ? "set" : "not set",
      model: e.LLM_MODEL,
      timeoutMs: e.LLM_TIMEOUT_MS,
      maxRetries: e.LLM_MAX_RETRIES,
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

function loadEnv(): Env {
  try {
    return parseEnv(process.env);
  } catch (err) {
    if (err instanceof ConfigError) {
      // Fail fast before anything else boots. Plain stderr: the logger depends on env.
      console.error(err.message);
      process.exit(1);
    }
    throw err;
  }
}

export const env = loadEnv();
