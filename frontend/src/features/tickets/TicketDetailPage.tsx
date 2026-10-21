import { useState } from 'react';
import { Link, useParams } from 'react-router';
import { ApiError, errorMessage } from '@/api/client';
import type { AuthorTicket } from '@/api/types';
import { StatusBadge } from '@/components/Badge';
import { Button } from '@/components/Button';
import { Field, Textarea } from '@/components/Field';
import { MessageThread } from '@/components/MessageThread';
import { SkeletonBlock } from '@/components/Skeleton';
import { Banner, EmptyState, ErrorState } from '@/components/States';
import { UpdatedCue } from '@/components/UpdatedCue';
import { useAuth } from '@/features/auth/AuthContext';
import { useChangeCue } from '@/hooks/useChangeCue';
import { formatDateTime } from '@/lib/format';
import { useAddFollowUp, useTicket } from './hooks';

export function TicketDetailPage() {
  const { id = '' } = useParams();
  const { data: ticket, isPending, isError, error, refetch } = useTicket(id);
  const changedAt = useChangeCue(ticket ? `${ticket.status}|${ticket.messages?.length ?? 0}|${ticket.updatedAt}` : undefined);

  return (
    <div className="max-w-3xl">
      <Link to="/tickets" className="text-sm text-brand-700 hover:underline">
        ← All tickets
      </Link>
      <div className="mt-3">
        {isPending ? (
          <div className="space-y-4 rounded-lg border border-slate-200 bg-white p-6">
            <SkeletonBlock label="Loading ticket" lines={5} />
          </div>
        ) : isError ? (
          error instanceof ApiError && (error.status === 404 || error.status === 403) ? (
            <EmptyState title="Ticket not found">This ticket doesn't exist or isn't linked to your account.</EmptyState>
          ) : (
            <ErrorState error={error} onRetry={() => refetch()} title="We couldn't load this ticket" />
          )
        ) : (
          <TicketView ticket={ticket} changedAt={changedAt} />
        )}
      </div>
    </div>
  );
}

function TicketView({ ticket, changedAt }: { ticket: AuthorTicket; changedAt: number | null }) {
  const { user } = useAuth();
  return (
    <>
      <header className="mb-6">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm text-slate-500">{ticket.ticketNumber}</span>
          <StatusBadge status={ticket.status} />
          <UpdatedCue changedAt={changedAt} />
        </div>
        <h1 className="mt-1 text-2xl font-semibold text-slate-900">{ticket.subject}</h1>
        <p className="mt-1 text-sm text-slate-600">
          {ticket.book?.title ?? 'General / Account Level'} · Opened {formatDateTime(ticket.createdAt)}
        </p>
      </header>
      <MessageThread
        viewer="AUTHOR"
        original={{
          authorName: user?.name ?? 'You',
          body: ticket.description,
          createdAt: ticket.createdAt,
          attachments: ticket.attachments,
        }}
        messages={ticket.messages ?? []}
        emptyHint="Our support team will reply here. You'll see their response as soon as it's sent, with no need to refresh."
      />
      {ticket.status === 'CLOSED' ? (
        <p className="mt-6 text-sm text-slate-600">
          This ticket is closed. If you need more help, <Link to="/tickets/new" className="text-brand-700 hover:underline">raise a new query</Link>.
        </p>
      ) : (
        <FollowUpForm ticketId={ticket.id} />
      )}
    </>
  );
}

function FollowUpForm({ ticketId }: { ticketId: string }) {
  const [body, setBody] = useState('');
  const send = useAddFollowUp(ticketId);
  const trimmed = body.trim();

  return (
    <form
      className="mt-6 space-y-3 rounded-lg border border-slate-200 bg-white p-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (!trimmed) return;
        send.mutate(trimmed, { onSuccess: () => setBody('') });
      }}
    >
      {send.isError && <Banner tone="error">{errorMessage(send.error, 'Your message could not be sent.')}</Banner>}
      <Field label="Add a follow-up">
        {(p) => (
          <Textarea
            {...p}
            rows={3}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="Anything to add? Extra details help us resolve this faster."
            disabled={send.isPending}
          />
        )}
      </Field>
      <Button type="submit" size="sm" loading={send.isPending} disabled={!trimmed}>
        Send
      </Button>
    </form>
  );
}
