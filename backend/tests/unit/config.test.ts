import { describe, expect, it } from "vitest";
import { ConfigError, DEV_DEFAULT_JWT_SECRET, envSummary, parseEnv } from "../../src/config/env";

const STRONG_SECRET = "s3cr3t-jwt-value-that-is-long-enough-0123456789";
const API_KEY = "sk-ant-api03-THIS-IS-A-FAKE-KEY-abcdefghijklmnop";
const DB_PASSWORD = "db-pa55word-xyz";
const DATABASE_URL = `postgresql://bookleaf:${DB_PASSWORD}@db.internal:5432/bookleaf?schema=public`;

const base = { DATABASE_URL };
const prod = { ...base, NODE_ENV: "production" };

function problemsOf(source: Record<string, string>): string[] {
  try {
    parseEnv(source);
  } catch (err) {
    if (err instanceof ConfigError) return err.problems;
    throw err;
  }
  return [];
}

describe("config validation", () => {
  it("accepts a minimal development config and falls back to the dev JWT secret", () => {
    const e = parseEnv(base);
    expect(e.NODE_ENV).toBe("development");
    expect(e.JWT_SECRET).toBe(DEV_DEFAULT_JWT_SECRET);
    expect(e.SEED_DEMO_TICKETS).toBe(false);
  });

  it("refuses to start in production without a JWT secret", () => {
    expect(problemsOf(prod)).toEqual(["JWT_SECRET: is required in production"]);
  });

  it("refuses a short JWT secret", () => {
    expect(problemsOf({ ...prod, JWT_SECRET: "too-short" })).toEqual(["JWT_SECRET: must be at least 32 characters"]);
    expect(problemsOf({ ...base, JWT_SECRET: "too-short" })).toHaveLength(1);
  });

  it("refuses the development default secret in production", () => {
    expect(problemsOf({ ...prod, JWT_SECRET: DEV_DEFAULT_JWT_SECRET })).toEqual([
      "JWT_SECRET: must not be the development default in production",
    ]);
  });

  it("starts in production without ANTHROPIC_API_KEY (AI degraded, not fatal)", () => {
    const e = parseEnv({ ...prod, JWT_SECRET: STRONG_SECRET, ANTHROPIC_API_KEY: "" });
    expect(e.ANTHROPIC_API_KEY).toBeUndefined();
    expect(envSummary(e).ai.mode).toBe("degraded");
  });

  it("never echoes values in validation errors", () => {
    const err = (() => {
      try {
        parseEnv({ ...prod, JWT_SECRET: "short-but-secret", PORT: "not-a-port" });
      } catch (e) {
        return e as Error;
      }
    })();
    expect(err).toBeInstanceOf(ConfigError);
    expect(err!.message).toContain("JWT_SECRET");
    expect(err!.message).not.toContain("short-but-secret");
    expect(err!.message).not.toContain(DB_PASSWORD);
  });
});

describe("startup config summary", () => {
  const e = parseEnv({ ...prod, JWT_SECRET: STRONG_SECRET, ANTHROPIC_API_KEY: API_KEY });
  const printed = JSON.stringify(envSummary(e));

  it("contains no key or secret values", () => {
    for (const secret of [API_KEY, STRONG_SECRET, DB_PASSWORD, DATABASE_URL]) {
      expect(printed).not.toContain(secret);
    }
    // not even a recognisable fragment of the key
    expect(printed).not.toContain("sk-ant");
    expect(printed).not.toContain(API_KEY.slice(-8));
  });

  it("still says what is configured", () => {
    expect(envSummary(e)).toMatchObject({
      nodeEnv: "production",
      database: "db.internal:5432/bookleaf",
      jwt: { secret: "set" },
      ai: { mode: "enabled", apiKey: "set", model: "claude-haiku-5-5" },
    });
  });
});
