import type { NextFunction, Request, Response } from "express";
import type { Role } from "@prisma/client";
import { verifyToken, type AuthClaims } from "../lib/jwt";
import { ForbiddenError, UnauthorizedError } from "../lib/errors";

/** Verifies the Bearer JWT. Applied to every /api/v1 route except POST /auth/login. */
export function authenticate(req: Request, _res: Response, next: NextFunction): void {
  const header = req.headers.authorization;
  const match = header?.match(/^Bearer\s+(.+)$/i);
  if (!match) return next(new UnauthorizedError("Missing or malformed Authorization header"));
  const claims = verifyToken(match[1]!.trim());
  if (!claims) return next(new UnauthorizedError("Invalid or expired token"));
  req.auth = claims;
  next();
}

export function requireRole(...roles: Role[]) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.auth) return next(new UnauthorizedError());
    if (!roles.includes(req.auth.role)) return next(new ForbiddenError());
    if (req.auth.role === "AUTHOR" && !req.auth.authorId) return next(new ForbiddenError("No author profile linked"));
    next();
  };
}

/** Narrowing helper for controllers behind authenticate(). */
export function authOf(req: Request): AuthClaims {
  if (!req.auth) throw new UnauthorizedError();
  return req.auth;
}

export function authorIdOf(req: Request): string {
  const auth = authOf(req);
  if (!auth.authorId) throw new ForbiddenError("No author profile linked");
  return auth.authorId;
}
