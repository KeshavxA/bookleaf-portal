import { useEffect, useRef, useState } from 'react';
import { fetchEventSource, type EventSourceMessage } from '@microsoft/fetch-event-source';
import { TICKET_EVENTS, type TicketEvent, type TicketEventType } from '@/api/types';

export type StreamStatus = 'idle' | 'connecting' | 'open' | 'reconnecting' | 'closed';

class FatalStreamError extends Error {
  constructor(readonly status: number) {
    super(`Event stream rejected with HTTP ${status}`);
  }
}
class RetriableStreamError extends Error {}

const MAX_BACKOFF_MS = 30_000;

/** Exponential backoff with a little jitter: 1s, 2s, 4s ... capped at 30s. */
export function backoffDelay(attempt: number) {
  const base = Math.min(MAX_BACKOFF_MS, 1000 * 2 ** Math.max(0, attempt - 1));
  return base + Math.floor(Math.random() * 250);
}

interface Options {
  url: string;
  token: string | null;
  enabled?: boolean;
  onEvent: (event: TicketEvent) => void;
  /** Called once if the server rejects the stream with 401; the hook stops retrying. */
  onUnauthorized?: () => void;
}

/**
 * Subscribes to the contract's SSE endpoint. Uses fetch-event-source rather than EventSource
 * because EventSource can't send an Authorization header.
 */
export function useEventStream({ url, token, enabled = true, onEvent, onUnauthorized }: Options) {
  const [status, setStatus] = useState<StreamStatus>('idle');
  const onEventRef = useRef(onEvent);
  const onUnauthorizedRef = useRef(onUnauthorized);
  onEventRef.current = onEvent;
  onUnauthorizedRef.current = onUnauthorized;

  useEffect(() => {
    if (!enabled || !token) {
      setStatus('idle');
      return;
    }
    const ctrl = new AbortController();
    const set = (s: StreamStatus) => {
      if (!ctrl.signal.aborted) setStatus(s);
    };
    let attempt = 0;
    set('connecting');

    fetchEventSource(url, {
      signal: ctrl.signal,
      headers: { Authorization: `Bearer ${token}`, Accept: 'text/event-stream' },
      // Keep the stream open in background tabs so authors see replies the moment they switch back.
      openWhenHidden: true,
      async onopen(res) {
        const type = res.headers.get('content-type') ?? '';
        if (res.ok && type.includes('text/event-stream')) {
          attempt = 0;
          set('open');
          return;
        }
        // Auth and other client errors won't fix themselves; 429 and 5xx are worth retrying.
        if (res.status >= 400 && res.status < 500 && res.status !== 429) throw new FatalStreamError(res.status);
        throw new RetriableStreamError(`Unexpected stream response ${res.status}`);
      },
      onmessage(msg: EventSourceMessage) {
        if (!(TICKET_EVENTS as readonly string[]).includes(msg.event)) return;
        try {
          const data = JSON.parse(msg.data) as { ticketId?: unknown };
          if (typeof data.ticketId === 'string') {
            onEventRef.current({ type: msg.event as TicketEventType, ticketId: data.ticketId });
          }
        } catch {
          /* ignore malformed payloads */
        }
      },
      onclose() {
        // The server ended the stream (deploy, proxy timeout). Treat it as a drop and reconnect.
        throw new RetriableStreamError('Stream closed by server');
      },
      onerror(err) {
        if (err instanceof FatalStreamError) {
          set('closed');
          if (err.status === 401) onUnauthorizedRef.current?.();
          throw err; // stops fetch-event-source from retrying
        }
        attempt += 1;
        set('reconnecting');
        return backoffDelay(attempt);
      },
    }).catch(() => {
      /* fatal errors are already reflected in status */
    });

    return () => ctrl.abort();
  }, [url, token, enabled]);

  return { status };
}
