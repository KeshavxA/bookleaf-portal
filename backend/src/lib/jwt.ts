import jwt, { type SignOptions } from "jsonwebtoken";
import { env } from "../config/env";
import type { Role } from "@prisma/client";

export interface AuthClaims {
  sub: string; // user id
  role: Role;
  authorId: string | null;
}

export function signToken(claims: AuthClaims): string {
  return jwt.sign({ role: claims.role, authorId: claims.authorId }, env.JWT_SECRET, {
    subject: claims.sub,
    expiresIn: env.JWT_EXPIRES_IN as SignOptions["expiresIn"],
    algorithm: "HS256",
  });
}

/** Returns null for any invalid/expired token; callers decide how to respond. */
export function verifyToken(token: string): AuthClaims | null {
  try {
    const payload = jwt.verify(token, env.JWT_SECRET, { algorithms: ["HS256"] });
    if (typeof payload === "string" || !payload.sub) return null;
    const role = payload.role;
    if (role !== "AUTHOR" && role !== "ADMIN") return null;
    return { sub: payload.sub, role, authorId: (payload.authorId as string | null) ?? null };
  } catch {
    return null;
  }
}
