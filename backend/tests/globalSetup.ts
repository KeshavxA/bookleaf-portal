import { execSync } from "node:child_process";

/**
 * Brings the test database schema up to date and loads seed data.
 * Non-destructive by design (migrate deploy + idempotent upsert seed);
 * test files clear the tables they write to (see resetTickets()).
 */
export default function setup() {
  const url = process.env.TEST_DATABASE_URL!; // resolved in vitest.config.mts
  const env = { ...process.env, DATABASE_URL: url, SEED_DEMO_TICKETS: "false" };
  execSync("npx prisma migrate deploy", { env, stdio: "pipe" });
  execSync("npx tsx src/seed/seed.ts", { env, stdio: "pipe" });
}
