/**
 * Typed application errors. Everything thrown from services should be an
 * AppError; the central error handler maps them to the contract's error shape
 * and turns anything else into a sanitized INTERNAL error.
 */
export type ErrorCode =
  | "VALIDATION_ERROR"
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "CONFLICT"
  | "RATE_LIMITED"
  | "INTERNAL";

export interface ErrorDetail {
  field: string;
  message: string;
}

export class AppError extends Error {
  constructor(
    readonly code: ErrorCode,
    readonly status: number,
    message: string,
    readonly details: ErrorDetail[] = [],
  ) {
    super(message);
    this.name = new.target.name;
  }
}

export class ValidationError extends AppError {
  constructor(message = "Request validation failed", details: ErrorDetail[] = []) {
    super("VALIDATION_ERROR", 400, message, details);
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = "Authentication required") {
    super("UNAUTHORIZED", 401, message);
  }
}

export class ForbiddenError extends AppError {
  constructor(message = "You do not have access to this resource") {
    super("FORBIDDEN", 403, message);
  }
}

export class NotFoundError extends AppError {
  constructor(resource = "Resource") {
    super("NOT_FOUND", 404, `${resource} not found`);
  }
}

export class ConflictError extends AppError {
  constructor(message: string) {
    super("CONFLICT", 409, message);
  }
}

export class RateLimitedError extends AppError {
  constructor(message = "Too many requests, please try again later") {
    super("RATE_LIMITED", 429, message);
  }
}

export class InternalError extends AppError {
  constructor(message = "Something went wrong on our side. Please try again.") {
    super("INTERNAL", 500, message);
  }
}
