import type { NextFunction, Request, Response } from "express";
import { Prisma } from "@prisma/client";
import { ZodError } from "zod";
import { AppError, ConflictError, InternalError, NotFoundError, ValidationError } from "../lib/errors";
import { logger } from "../lib/logger";
import { zodDetails } from "./validate";

/** Maps anything thrown into the contract's error envelope. Clients never see a bare 500 or a stack. */
export function errorHandler(err: unknown, req: Request, res: Response, _next: NextFunction): void {
  const appError = toAppError(err);
  if (appError.status >= 500) {
    logger.error({ err, path: req.path, method: req.method }, "Unhandled error");
  }
  if (res.headersSent) return; // e.g. an SSE stream; nothing safe to send
  res.status(appError.status).json({
    error: { code: appError.code, message: appError.message, details: appError.details },
  });
}

function toAppError(err: unknown): AppError {
  if (err instanceof AppError) return err;
  if (err instanceof ZodError) return new ValidationError("Request validation failed", zodDetails(err));

  // body-parser errors (malformed JSON, payload too large)
  if (isHttpError(err)) {
    if (err.type === "entity.parse.failed") return new ValidationError("Request body is not valid JSON");
    if (err.type === "entity.too.large") return new ValidationError("Request body is too large");
    if (err.status >= 400 && err.status < 500) return new ValidationError(err.message);
  }

  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    if (err.code === "P2025") return new NotFoundError();
    if (err.code === "P2002") return new ConflictError("A record with these values already exists");
    if (err.code === "P2003") return new ValidationError("Referenced record does not exist");
  }
  return new InternalError();
}

function isHttpError(err: unknown): err is { status: number; type?: string; message: string } {
  return typeof err === "object" && err !== null && "status" in err && typeof (err as { status: unknown }).status === "number";
}

export function notFoundHandler(req: Request, _res: Response, next: NextFunction): void {
  next(new AppError("NOT_FOUND", 404, `Route ${req.method} ${req.path} not found`));
}
