import { config } from '@/lib/config';
import { tokenStorage } from '@/lib/tokenStorage';
import type { ApiErrorBody, ErrorCode } from './types';

export type ClientErrorCode = ErrorCode | 'NETWORK_ERROR';

export class ApiError extends Error {
  readonly status: number;
  readonly code: ClientErrorCode;
  readonly details: unknown[];

  constructor(status: number, code: ClientErrorCode, message: string, details: unknown[] = []) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

/** Field-level messages from a VALIDATION_ERROR, if the backend sent them as { field|path, message }. */
export function fieldErrors(err: unknown): Record<string, string> {
  if (!(err instanceof ApiError) || err.code !== 'VALIDATION_ERROR') return {};
  const out: Record<string, string> = {};
  for (const d of err.details) {
    if (d && typeof d === 'object' && 'message' in d) {
      const rec = d as { field?: unknown; path?: unknown; message: unknown };
      const key = Array.isArray(rec.path) ? rec.path.join('.') : (rec.field ?? rec.path);
      if (typeof key === 'string' && typeof rec.message === 'string') out[key] = rec.message;
    }
  }
  return out;
}

export function errorMessage(err: unknown, fallback = 'Something went wrong. Please try again.') {
  if (err instanceof ApiError) return err.message || fallback;
  return fallback;
}

let onUnauthorized: (() => void) | null = null;

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
    if (isErrorBody(data)) {
      const { code, message, details } = data.error;
      throw new ApiError(res.status, code, message, details ?? []);
    }
    throw new ApiError(res.status, res.status >= 500 ? 'INTERNAL' : 'VALIDATION_ERROR', `Request failed (${res.status})`);
  }

  return data as T;
}
