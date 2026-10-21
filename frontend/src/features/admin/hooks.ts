import { useEffect, useRef } from 'react';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { adminApi } from '@/api/endpoints';
import { qk } from '@/api/queryKeys';
import type { AdminTicket, AdminTicketQuery, DraftResponse, InternalNote, ReplyInput, UpdateTicketInput } from '@/api/types';
import { useRealtime } from '@/hooks/useRealtime';

export function useAdminTickets(query: AdminTicketQuery) {
  const { pollInterval } = useRealtime();
  return useQuery({
    queryKey: qk.admin.list(query),
    queryFn: () => adminApi.tickets(query),
    placeholderData: keepPreviousData,
    refetchInterval: pollInterval,
  });
}

export function useAdminTicket(id: string) {
  const { pollInterval } = useRealtime();
  return useQuery({ queryKey: qk.admin.ticket(id), queryFn: () => adminApi.ticket(id), refetchInterval: pollInterval });
}

export const useAdmins = () =>
  useQuery({ queryKey: qk.admin.admins, queryFn: adminApi.admins, staleTime: 10 * 60_000 });

/**
 * Action endpoints return a full AdminTicket per the contract. Merging defensively keeps the cached
 * thread if a response ever arrives without it, rather than blanking the conversation.
 */
function mergeDetail(prev: AdminTicket | undefined, next: AdminTicket): AdminTicket {
  return prev ? { ...prev, ...next, messages: next.messages ?? prev.messages } : next;
}

function applyOptimistic(t: AdminTicket, input: UpdateTicketInput): AdminTicket {
  return {
    ...t,
    ...(input.status && { status: input.status }),
    ...(input.category && { category: input.category, categoryOverridden: true }),
    ...(input.priority && { priority: input.priority, priorityOverridden: true }),
  };
}

/**
 * PATCH with an optimistic update for status/category/priority. Those are safe to show early
 * because they're simple field sets the server echoes back, and we roll back on error.
 * Assignee changes wait for the server since the assignee's name comes from the response.
 */
export function useUpdateTicket(id: string) {
  const qc = useQueryClient();
  const key = qk.admin.ticket(id);
  return useMutation({
    mutationFn: (input: UpdateTicketInput) => adminApi.update(id, input),
    onMutate: async (input) => {
      await qc.cancelQueries({ queryKey: key });
      const prev = qc.getQueryData<AdminTicket>(key);
      if (prev) qc.setQueryData(key, applyOptimistic(prev, input));
      return { prev };
    },
    onError: (_err, _input, ctx) => {
      if (ctx?.prev) qc.setQueryData(key, ctx.prev);
    },
    onSuccess: (ticket, input, ctx) => {
      qc.setQueryData<AdminTicket>(key, (prev) => mergeDetail(prev, ticket));
      // Changing the category clears the server's cached draft (it was grounded in the old category),
      // so request a new one. The panel keeps the admin's own edits and offers the new draft instead.
      if (input.category && input.category !== ctx?.prev?.category) {
        qc.invalidateQueries({ queryKey: qk.admin.draft(id) });
      }
    },
    onSettled: () => qc.invalidateQueries({ queryKey: qk.admin.lists }),
  });
}

export function useAssignToMe(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => adminApi.assignToMe(id),
    onSuccess: (ticket) => {
      qc.setQueryData<AdminTicket>(qk.admin.ticket(id), (prev) => mergeDetail(prev, ticket));
      qc.invalidateQueries({ queryKey: qk.admin.lists });
    },
  });
}

/** POST /classify → 202 with aiStatus PENDING. ticket.ai_ready (or polling) brings the result. */
export function useRetryTriage(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => adminApi.classify(id),
    onSuccess: (ticket) => {
      qc.setQueryData<AdminTicket>(qk.admin.ticket(id), (prev) => mergeDetail(prev, ticket));
      qc.invalidateQueries({ queryKey: qk.admin.lists });
    },
  });
}

export function useAddNote(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: string) => adminApi.addNote(id, body),
    onSuccess: (note: InternalNote) => {
      qc.setQueryData<AdminTicket>(qk.admin.ticket(id), (t) =>
        t ? { ...t, internalNotes: [...t.internalNotes, note] } : t,
      );
    },
  });
}

/**
 * The draft endpoint is a POST but returns the cached draft unless regenerate=true, so it's
 * modelled as a query: requested once when the ticket opens, never refetched in the background.
 */
export function useDraft(id: string) {
  return useQuery({
    queryKey: qk.admin.draft(id),
    queryFn: () => adminApi.draft(id),
    staleTime: Infinity,
    retry: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });
}

/**
 * The server clears its cached draft when a new author message arrives, so re-request the draft when
 * one shows up in the thread (via SSE or polling). The first render is the baseline.
 */
export function useRedraftOnAuthorMessage(ticket: AdminTicket) {
  const qc = useQueryClient();
  const lastAuthorMessageId = ticket.messages.filter((m) => m.senderType === 'AUTHOR').at(-1)?.id ?? null;
  const baseline = useRef(lastAuthorMessageId);
  useEffect(() => {
    if (lastAuthorMessageId === baseline.current) return;
    baseline.current = lastAuthorMessageId;
    qc.invalidateQueries({ queryKey: qk.admin.draft(ticket.id) });
  }, [lastAuthorMessageId, qc, ticket.id]);
}

export function useRegenerateDraft(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => adminApi.draft(id, true),
    onSuccess: (data: DraftResponse) => qc.setQueryData(qk.admin.draft(id), data),
  });
}

export function useSendReply(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: ReplyInput) => adminApi.reply(id, input),
    // Async so the mutation stays pending until the refetch lands: with no status given, the server
    // may move OPEN to IN_PROGRESS and assign the replier, and the UI should show that result.
    onSuccess: async (message, input) => {
      qc.setQueryData<AdminTicket>(qk.admin.ticket(id), (t) =>
        t ? { ...t, status: input.status ?? t.status, messages: [...t.messages, message] } : t,
      );
      // The server drops the draft once it's answered. Mark ours stale without refetching, so the
      // open editor isn't refilled now but the next visit asks for a fresh draft.
      qc.invalidateQueries({ queryKey: qk.admin.draft(id), refetchType: 'none' });
      qc.invalidateQueries({ queryKey: qk.admin.lists });
      await qc.invalidateQueries({ queryKey: qk.admin.ticket(id) });
    },
  });
}
