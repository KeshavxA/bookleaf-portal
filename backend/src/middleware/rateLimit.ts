import rateLimit, { ipKeyGenerator } from "express-rate-limit";
import { env } from "../config/env";
import { RateLimitedError } from "../lib/errors";

const common = {
  standardHeaders: "draft-7" as const,
  legacyHeaders: false,
  skip: () => env.NODE_ENV === "test",
};

/** Brute-force protection: keyed by IP + email so one attacker can't lock out everyone. */
export const loginRateLimit = rateLimit({
  ...common,
  windowMs: env.RATE_LIMIT_LOGIN_WINDOW_MS,
  limit: env.RATE_LIMIT_LOGIN_MAX,
  keyGenerator: (req) => `${ipKeyGenerator(req.ip ?? "")}:${String(req.body?.email ?? "").toLowerCase()}`,
  handler: (_req, _res, next) => next(new RateLimitedError("Too many login attempts. Please try again later.")),
});

/** Cost protection for endpoints that call the LLM. Keyed by user (auth runs first). */
export const aiRateLimit = rateLimit({
  ...common,
  windowMs: env.RATE_LIMIT_AI_WINDOW_MS,
  limit: env.RATE_LIMIT_AI_MAX,
  keyGenerator: (req) => req.auth?.sub ?? ipKeyGenerator(req.ip ?? ""),
  handler: (_req, _res, next) => next(new RateLimitedError("Too many AI requests. Please wait a moment.")),
});
