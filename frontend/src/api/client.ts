import { config } from '@/lib/config';
import { tokenStorage } from '@/lib/tokenStorage';
import type { ApiErrorBody, ErrorCode, ErrorDetail } from './types';

export type ClientErrorCode = ErrorCode | 'NETWORK_ERROR';

export class ApiError extends Error {
  readonly status: number;
  readonly code: ClientErrorCode;
  readonly details: ErrorDetail[];

  constructor(status: number, code: ClientErrorCode, message: string, details: ErrorDetail[] = []) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export const ROOT_FIELD = '(root)';
export const RATE_LIMITED_MESSAGE = 'Too many requests, try again shortly.';

export const isRateLimited = (err: unknown) =>
  err instanceof ApiError && (err.code === 'RATE_LIMITED' || err.status === 429);

/** User-facing message for any error. Rate limiting always gets the same friendly wording. */
export function errorMessage(err: unknown, fallback = 'Something went wrong. Please try again.') {
  if (isRateLimited(err)) return RATE_LIMITED_MESSAGE;
  if (err instanceof ApiError) return err.message || fallback;
  return fallback;
}

/** Keep only well-formed { field, message } entries; anything else is dropped rather than trusted. */
function parseDetails(raw: unknown): ErrorDetail[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter(
    (d): d is ErrorDetail => !!d && typeof d === 'object' && typeof d.field === 'string' && typeof d.message === 'string',
  );
}

let onUnauthorized: (() => void) | null = null;
let onForbidden: (() => Promise<void>) | null = null;

/**
 * AuthContext registers a session re-check here. A 403 on an authenticated call often means another
 * tab signed in as a different user (the token in localStorage is shared), so the session is
 * re-validated before the error reaches the UI.
 */
export function setForbiddenHandler(handler: (() => Promise<void>) | null) {
  onForbidden = handler;
}

/** AuthContext registers its logout here so any 401 from an authenticated call ends the session. */
export function setUnauthorizedHandler(handler: (() => void) | null) {
  onUnauthorized = handler;
}

export function notifyUnauthorized() {
  onUnauthorized?.();
}

export function apiUrl(path: string, query?: Record<string, unknown>) {
  const base = config.apiUrl.startsWith('http') ? config.apiUrl : `${window.location.origin}${config.apiUrl}`;
  const url = new URL(base + path);
  if (query) {
    for (const [k, v] of Object.entries(query)) {
      if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, String(v));
    }
  }
  return url.toString();
}

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  body?: unknown;
  query?: Record<string, unknown>;
  signal?: AbortSignal;
}

function isErrorBody(v: unknown): v is ApiErrorBody {
  return (
    !!v &&
    typeof v === 'object' &&
    'error' in v &&
    !!(v as ApiErrorBody).error &&
    typeof (v as ApiErrorBody).error.message === 'string'
  );
}

/** The single fetch wrapper: attaches the token, parses the contract error shape, logs out on 401. */
export async function api<T>(path: string, opts: RequestOptions = {}): Promise<T> {
  const token = tokenStorage.get();
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (opts.body !== undefined) headers['Content-Type'] = 'application/json';
  if (token) headers.Authorization = `Bearer ${token}`;

  let res: Response;
  try {
    res = await fetch(apiUrl(path, opts.query), {
      method: opts.method ?? 'GET',
      headers,
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
      signal: opts.signal,
    });
  } catch (e) {
    if ((e as Error)?.name === 'AbortError') throw e;
    throw new ApiError(0, 'NETWORK_ERROR', 'Could not reach the server. Check your connection and try again.');
  }

  const text = await res.text();
  let data: unknown = undefined;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = undefined;
    }
  }

  if (!res.ok) {
    // A 401 on an authenticated request means the session is gone. A 401 on login is just bad credentials.
    if (res.status === 401 && token) notifyUnauthorized();
    // Re-check who we are before surfacing the 403. /auth/me itself is excluded to avoid recursion.
    if (res.status === 403 && token && path !== '/auth/me' && onForbidden) {
      await onForbidden().catch(() => undefined);
    }
    if (isErrorBody(data)) {
      const { code, message, details } = data.error;
      throw new ApiError(res.status, code, message, parseDetails(details));
    }
    // No contract-shaped body (e.g. a proxy error page): classify by status alone.
    const code: ClientErrorCode =
      res.status === 429 ? 'RATE_LIMITED' : res.status === 404 ? 'NOT_FOUND' : res.status >= 500 ? 'INTERNAL' : 'VALIDATION_ERROR';
    throw new ApiError(res.status, code, `Request failed (${res.status})`);
  }

  return data as T;
}
