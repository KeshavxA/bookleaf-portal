import "dotenv/config";
import { ConfigError, parseEnv, type Env } from "./schema";

export * from "./schema";

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
