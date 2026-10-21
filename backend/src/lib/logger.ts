import pino from "pino";
import { env } from "../config/env";

export const logger = pino({
  level: env.NODE_ENV === "test" ? "silent" : env.LOG_LEVEL,
  // Defence in depth: these paths must never reach log output.
  redact: {
    paths: [
      "req.headers.authorization",
      "req.headers.cookie",
      "headers.authorization",
      "headers['x-api-key']",
      "*.apiKey",
      "*.password",
      "*.passwordHash",
      "ANTHROPIC_API_KEY",
    ],
    censor: "[redacted]",
  },
  transport:
    env.NODE_ENV === "development"
      ? { target: "pino-pretty", options: { translateTime: "HH:MM:ss", ignore: "pid,hostname" } }
      : undefined,
});
