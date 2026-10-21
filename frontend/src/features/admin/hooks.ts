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

/** Mutation responses may omit messages/notes; keep what's already cached rather than blanking the thread. */
function mergeDetail(prev: AdminTicket | undefined, next: AdminTicket): AdminTicket {
  return {
    ...prev,
    ...next,
    messages: next.messages ?? prev?.messages,
    internalNotes: next.internalNotes ?? prev?.internalNotes,
    draft: next.draft !== undefined ? next.draft : prev?.draft,
  };
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
    onSuccess: (ticket) => qc.setQueryData<AdminTicket>(key, (prev) => mergeDetail(prev, ticket)),
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

export function useAddNote(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: string) => adminApi.addNote(id, body),
    onSuccess: (note: InternalNote) => {
      qc.setQueryData<AdminTicket>(qk.admin.ticket(id), (t) =>
        t ? { ...t, internalNotes: [...(t.internalNotes ?? []), note] } : t,
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
    onSuccess: (message, input) => {
      qc.setQueryData<AdminTicket>(qk.admin.ticket(id), (t) =>
        t ? { ...t, status: input.status ?? t.status, messages: [...(t.messages ?? []), message] } : t,
      );
      // The draft answered the previous state of the thread. Mark it stale without refetching, so the
      // open editor isn't refilled now, but the next visit to this ticket asks for a fresh draft.
      qc.invalidateQueries({ queryKey: qk.admin.draft(id), refetchType: 'none' });
      qc.invalidateQueries({ queryKey: qk.admin.ticket(id) });
      qc.invalidateQueries({ queryKey: qk.admin.lists });
    },
  });
}
