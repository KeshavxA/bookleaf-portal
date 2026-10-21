import "dotenv/config";
import { defineConfig } from "vitest/config";

/**
 * Integration tests run against a separate database: TEST_DATABASE_URL, or the
 * DATABASE_URL from .env with "_test" appended to the database name. Never the dev DB.
 */
function testDatabaseUrl(): string {
  if (process.env.TEST_DATABASE_URL) return process.env.TEST_DATABASE_URL;
  const base = process.env.DATABASE_URL;
  if (!base) throw new Error("Set TEST_DATABASE_URL (or DATABASE_URL) to run tests");
  const url = new URL(base);
  url.pathname = `${url.pathname.replace(/_test$/, "")}_test`;
  return url.toString();
}

const TEST_DATABASE_URL = testDatabaseUrl();
process.env.TEST_DATABASE_URL = TEST_DATABASE_URL; // read by globalSetup

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    globalSetup: ["tests/globalSetup.ts"],
    // Integration tests share one database; run files sequentially.
    fileParallelism: false,
    testTimeout: 20_000,
    env: {
      NODE_ENV: "test",
      DATABASE_URL: TEST_DATABASE_URL,
      JWT_SECRET: "test-secret-test-secret-test-secret-123456",
      ANTHROPIC_API_KEY: "",
      SEED_DEMO_TICKETS: "false",
    },
  },
});
