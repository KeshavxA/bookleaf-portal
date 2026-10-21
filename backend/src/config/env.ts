import "dotenv/config";
import { z } from "zod";

const bool = z
  .enum(["true", "false", "1", "0"])
  .transform((v) => v === "true" || v === "1");

const EnvSchema = z.object({
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

  JWT_SECRET: z.string().min(32, "JWT_SECRET must be at least 32 characters"),
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

  SEED_DEMO_TICKETS: bool.default(true),
});

export type Env = z.infer<typeof EnvSchema>;

function loadEnv(): Env {
  const parsed = EnvSchema.safeParse(process.env);
  if (!parsed.success) {
    // Print variable names and reasons only; never echo values (they may be secrets).
    const problems = parsed.error.issues.map((i) => `  - ${i.path.join(".")}: ${i.message}`).join("\n");
    throw new Error(`Invalid environment configuration:\n${problems}`);
  }
  return parsed.data;
}

export const env = loadEnv();
