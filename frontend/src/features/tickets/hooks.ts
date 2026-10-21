import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError } from '@/api/client';
import { authorApi } from '@/api/endpoints';
import { qk } from '@/api/queryKeys';
import type { AuthorTicket, CreateTicketInput } from '@/api/types';
import { useRealtime } from '@/hooks/useRealtime';

export function useMyTickets() {
  const { pollInterval } = useRealtime();
  return useQuery({ queryKey: qk.tickets, queryFn: authorApi.tickets, refetchInterval: pollInterval });
}

export function useTicket(id: string) {
  const { pollInterval } = useRealtime();
  return useQuery({ queryKey: qk.ticket(id), queryFn: () => authorApi.ticket(id), refetchInterval: pollInterval });
}

export function useCreateTicket() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateTicketInput) => authorApi.createTicket(input),
    onSuccess: (ticket) => {
      qc.setQueryData(qk.ticket(ticket.id), ticket);
      qc.invalidateQueries({ queryKey: qk.tickets, exact: true });
    },
  });
}

export function useAddFollowUp(ticketId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: string) => authorApi.addMessage(ticketId, body),
    onSuccess: (message) => {
      // Append immediately from the server response, then refetch: a follow-up on a RESOLVED ticket reopens it.
      qc.setQueryData<AuthorTicket>(qk.ticket(ticketId), (t) => (t ? { ...t, messages: [...t.messages, message] } : t));
      qc.invalidateQueries({ queryKey: qk.tickets });
    },
    onError: (err) => {
      // 409: the ticket was closed meanwhile. Refetch so the page shows the closed state.
      if (err instanceof ApiError && err.code === 'CONFLICT') qc.invalidateQueries({ queryKey: qk.tickets });
    },
  });
}
