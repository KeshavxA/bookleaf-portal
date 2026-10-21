import express, { type Express } from "express";
import helmet from "helmet";
import cors from "cors";
import pinoHttp from "pino-http";
import swaggerUi from "swagger-ui-express";
import { env } from "./config/env";
import { logger } from "./lib/logger";
import type { Container } from "./container";
import { buildApiRouter } from "./routes";
import { errorHandler, notFoundHandler } from "./middleware/errorHandler";
import { openApiSpec } from "./docs/openapi";

export function createApp(container: Container): Express {
  const app = express();
  app.set("trust proxy", 1); // behind Render/Railway's proxy: correct client IPs for rate limiting
  app.disable("x-powered-by");

  app.use(helmet());
  app.use(
    cors({
      origin: (origin, cb) => cb(null, !origin || env.CORS_ORIGINS.includes(origin)),
      credentials: false,
      allowedHeaders: ["Authorization", "Content-Type"],
      methods: ["GET", "POST", "PATCH", "OPTIONS"],
    }),
  );
  app.use(express.json({ limit: "100kb" }));
  app.use(
    pinoHttp({
      logger,
      autoLogging: { ignore: (req) => req.url === "/health" },
      customLogLevel: (_req, res, err) => (err || res.statusCode >= 500 ? "error" : res.statusCode >= 400 ? "warn" : "info"),
    }),
  );

  app.get("/health", async (_req, res) => {
    try {
      await container.db.$queryRaw`SELECT 1`;
      res.json({ status: "ok", db: "ok", ai: container.llm.enabled === false ? "disabled" : "enabled" });
    } catch {
      res.status(503).json({ status: "degraded", db: "unreachable" });
    }
  });

  app.get("/api/docs/openapi.json", (_req, res) => res.json(openApiSpec));
  app.use("/api/docs", swaggerUi.serve, swaggerUi.setup(openApiSpec, { customSiteTitle: "BookLeaf API" }));

  app.use("/api/v1", buildApiRouter(container.controllers));

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
