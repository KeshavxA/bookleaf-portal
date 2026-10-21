import type { AuthClaims } from "../lib/jwt";

declare global {
  namespace Express {
    interface Request {
      auth?: AuthClaims;
      /** Parsed & validated input, populated by the validate() middleware. */
      valid?: { body?: unknown; query?: unknown };
    }
  }
}

export {};
