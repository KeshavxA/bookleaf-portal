import { env, envSummary } from "./config/env";
import { apiKeyVarFor, selectedApiKey } from "./ai/llm/providers";
import { logger } from "./lib/logger";
import { buildContainer } from "./container";
import { createApp } from "./app";

async function main() {
  logger.info({ config: envSummary(env) }, "Configuration loaded");
  if (!selectedApiKey(env)) {
    logger.warn(
      `${apiKeyVarFor(env.LLM_PROVIDER)} is not set (LLM_PROVIDER=${env.LLM_PROVIDER}): AI is in degraded mode (keyword triage, no drafts; admins reply manually)`,
    );
  }

  const container = buildContainer();
  const app = createApp(container);

  const server = app.listen(env.PORT, () => {
    logger.info(
      { port: env.PORT },
      "BookLeaf API listening",
    );
  });

  const recovered = await container.recoverPendingClassifications();
  if (recovered > 0) logger.info({ count: recovered }, "Re-queued tickets awaiting AI classification");

  const shutdown = async (signal: string) => {
    logger.info({ signal }, "Shutting down");
    container.hub.close(); // end SSE streams so server.close() can complete
    server.close();
    await Promise.race([container.queue.onIdle(), new Promise((r) => setTimeout(r, 10_000))]);
    await container.db.$disconnect();
    process.exit(0);
  };
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));
}

main().catch((err) => {
  logger.fatal({ err }, "Failed to start");
  process.exit(1);
});
