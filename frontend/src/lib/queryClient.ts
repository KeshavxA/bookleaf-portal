import { QueryClient } from '@tanstack/react-query';
import { ApiError } from '@/api/client';

/**
 * Client errors never succeed on retry. That includes 401 (session gone), 403 (wrong user or role;
 * handled by re-checking the session) and 429 (retrying would make rate limiting worse).
 * Network failures and 5xx get two more tries.
 */
export function shouldRetryQuery(failureCount: number, error: unknown) {
  if (error instanceof ApiError && error.status >= 400 && error.status < 500) return false;
  return failureCount < 2;
}

export function createQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { staleTime: 15_000, retry: shouldRetryQuery },
      mutations: { retry: false },
    },
  });
}
