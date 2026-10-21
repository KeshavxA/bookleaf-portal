import { createContext, useCallback, useContext, useMemo, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { apiUrl } from '@/api/client';
import { qk } from '@/api/queryKeys';
import type { TicketEvent } from '@/api/types';
import { useAuth } from '@/features/auth/AuthContext';
import { useEventStream, type StreamStatus } from './useEventStream';

export const POLL_FALLBACK_MS = 10_000;

interface RealtimeValue {
  status: StreamStatus;
  /** Refetch interval for live queries: off while SSE is healthy, 10s while it's down. */
  pollInterval: number | false;
}

const RealtimeContext = createContext<RealtimeValue>({ status: 'idle', pollInterval: POLL_FALLBACK_MS });

/** One SSE connection per session. Events only invalidate queries; the data itself is always refetched. */
export function RealtimeProvider({ children }: { children: ReactNode }) {
  const { user, token, logout } = useAuth();
  const qc = useQueryClient();

  const onEvent = useCallback(
    (e: TicketEvent) => {
      if (user?.role === 'AUTHOR') {
        // ['tickets'] prefixes both the list and every detail query.
        qc.invalidateQueries({ queryKey: qk.tickets });
        return;
      }
      qc.invalidateQueries({ queryKey: qk.admin.lists });
      if (e.type !== 'ticket.created') qc.invalidateQueries({ queryKey: qk.admin.ticket(e.ticketId) });
    },
    [qc, user?.role],
  );

  const onUnauthorized = useCallback(() => logout('expired'), [logout]);
  const url = useMemo(() => apiUrl('/events'), []);
  const { status } = useEventStream({ url, token, enabled: !!user, onEvent, onUnauthorized });

  const value = useMemo<RealtimeValue>(
    () => ({ status, pollInterval: status === 'open' ? false : POLL_FALLBACK_MS }),
    [status],
  );
  return <RealtimeContext.Provider value={value}>{children}</RealtimeContext.Provider>;
}

export const useRealtime = () => useContext(RealtimeContext);
