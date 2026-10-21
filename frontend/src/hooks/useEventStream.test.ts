import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { FetchEventSourceInit } from '@microsoft/fetch-event-source';
import { useEventStream } from './useEventStream';

// Capture the options the hook passes so tests can drive the stream lifecycle by hand.
let captured: (FetchEventSourceInit & { url: string }) | null = null;
vi.mock('@microsoft/fetch-event-source', () => ({
  fetchEventSource: vi.fn((url: string, init: FetchEventSourceInit) => {
    captured = { ...init, url };
    return new Promise<void>(() => {});
  }),
}));

const sseResponse = (status = 200) =>
  new Response(null, { status, headers: { 'Content-Type': status === 200 ? 'text/event-stream' : 'application/json' } });

describe('useEventStream', () => {
  beforeEach(() => {
    captured = null;
  });

  it('sends the bearer token and reports open once the server accepts the stream', async () => {
    const { result } = renderHook(() => useEventStream({ url: 'http://x/events', token: 'abc', onEvent: vi.fn() }));
    expect(result.current.status).toBe('connecting');
    expect(captured?.headers).toMatchObject({ Authorization: 'Bearer abc' });

    await act(() => captured!.onopen!(sseResponse()));
    expect(result.current.status).toBe('open');
  });

  it('forwards known ticket events and ignores unknown or malformed ones', async () => {
    const onEvent = vi.fn();
    renderHook(() => useEventStream({ url: 'http://x/events', token: 'abc', onEvent }));

    act(() => {
      captured!.onmessage!({ event: 'ticket.message', data: '{"ticketId":"t-1"}', id: '', retry: undefined });
      captured!.onmessage!({ event: 'something.else', data: '{"ticketId":"t-2"}', id: '', retry: undefined });
      captured!.onmessage!({ event: 'ticket.updated', data: 'not json', id: '', retry: undefined });
    });

    expect(onEvent).toHaveBeenCalledTimes(1);
    expect(onEvent).toHaveBeenCalledWith({ type: 'ticket.message', ticketId: 't-1' });
  });

  it('marks the stream as reconnecting and backs off when the connection drops', async () => {
    const { result } = renderHook(() => useEventStream({ url: 'http://x/events', token: 'abc', onEvent: vi.fn() }));
    await act(() => captured!.onopen!(sseResponse()));

    let delay: number | null | undefined | void;
    act(() => {
      delay = captured!.onerror!(new TypeError('network down'));
    });
    expect(result.current.status).toBe('reconnecting');
    expect(delay).toBeGreaterThanOrEqual(1000);
  });

  it('stops retrying and signals logout when the server returns 401', async () => {
    const onUnauthorized = vi.fn();
    const { result } = renderHook(() =>
      useEventStream({ url: 'http://x/events', token: 'expired', onEvent: vi.fn(), onUnauthorized }),
    );

    let thrown: unknown;
    try {
      await captured!.onopen!(sseResponse(401));
    } catch (e) {
      thrown = e;
    }
    act(() => {
      expect(() => captured!.onerror!(thrown)).toThrow();
    });
    expect(onUnauthorized).toHaveBeenCalledTimes(1);
    expect(result.current.status).toBe('closed');
  });

  it('does not connect without a token', () => {
    const { result } = renderHook(() => useEventStream({ url: 'http://x/events', token: null, onEvent: vi.fn() }));
    expect(captured).toBeNull();
    expect(result.current.status).toBe('idle');
  });

  it('aborts the request on unmount', () => {
    const { unmount } = renderHook(() => useEventStream({ url: 'http://x/events', token: 'abc', onEvent: vi.fn() }));
    const signal = captured!.signal!;
    expect(signal.aborted).toBe(false);
    unmount();
    expect(signal.aborted).toBe(true);
  });
});
