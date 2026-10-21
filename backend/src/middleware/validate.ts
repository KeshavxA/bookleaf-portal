import type { NextFunction, Request, Response } from "express";
import type { z } from "zod";
import { ValidationError, type ErrorDetail } from "../lib/errors";

export function zodDetails(error: z.ZodError): ErrorDetail[] {
  return error.issues.map((i) => ({ field: i.path.length ? i.path.join(".") : "(root)", message: i.message }));
}

/** Validates req.body / req.query and stores the parsed (coerced, defaulted) value on req.valid. */
export function validate(part: "body" | "query", schema: z.ZodType) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const input = part === "body" ? (req.body ?? {}) : req.query;
    const result = schema.safeParse(input);
    if (!result.success) return next(new ValidationError("Request validation failed", zodDetails(result.error)));
    req.valid = { ...req.valid, [part]: result.data };
    next();
  };
}

export function validBody<T>(req: Request): T {
  return req.valid?.body as T;
}

export function validQuery<T>(req: Request): T {
  return req.valid?.query as T;
}
