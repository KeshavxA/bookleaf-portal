import { useState } from 'react';
import { Link, useParams } from 'react-router';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { ApiError } from '@/api/client';
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
import { formatDateTime, formatTicketNumber } from '@/lib/format';
import { applyServerErrors } from '@/lib/serverErrors';
import { useAddFollowUp, useTicket } from './hooks';

export function TicketDetailPage() {
  const { id = '' } = useParams();
  const { data: ticket, isPending, isError, error, refetch } = useTicket(id);
  const changedAt = useChangeCue(ticket ? `${ticket.status}|${ticket.messages.length}|${ticket.updatedAt}` : undefined);

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
  // Text from a follow-up rejected with 409 because the ticket closed meanwhile, kept so it isn't lost.
  const [unsent, setUnsent] = useState<string | null>(null);
  return (
    <>
      <header className="mb-6">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm text-slate-500">{formatTicketNumber(ticket.ticketNumber)}</span>
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
        messages={ticket.messages}
        emptyHint="Our support team will reply here. You'll see their response as soon as it's sent, with no need to refresh."
      />
      {ticket.status === 'CLOSED' ? (
        <div className="mt-6 rounded-lg border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700" role="status">
          <p className="font-medium text-slate-900">This ticket is closed</p>
          <p className="mt-1">
            It can't take new replies. If you still need help,{' '}
            <Link to="/tickets/new" className="text-brand-700 hover:underline">
              raise a new query
            </Link>
            .
          </p>
          {unsent && (
            <div className="mt-3">
              <p>The ticket was closed before your message was sent. Here's what you wrote, so you can reuse it:</p>
              <blockquote className="mt-1 whitespace-pre-wrap rounded border border-slate-200 bg-white px-3 py-2 text-slate-800">
                {unsent}
              </blockquote>
            </div>
          )}
        </div>
      ) : (
        <FollowUpForm ticketId={ticket.id} resolved={ticket.status === 'RESOLVED'} onClosedConflict={setUnsent} />
      )}
    </>
  );
}

const followUpSchema = z.object({
  body: z.string().trim().min(1, 'Write a message first').max(5000, 'Messages must be 5,000 characters or fewer'),
});
type FollowUpValues = z.infer<typeof followUpSchema>;

function FollowUpForm({
  ticketId,
  resolved,
  onClosedConflict,
}: {
  ticketId: string;
  resolved: boolean;
  onClosedConflict: (text: string) => void;
}) {
  const send = useAddFollowUp(ticketId);
  const {
    register,
    handleSubmit,
    reset,
    setError,
    formState: { errors },
  } = useForm<FollowUpValues>({ resolver: zodResolver(followUpSchema), defaultValues: { body: '' } });

  const onSubmit = (values: FollowUpValues) =>
    send.mutateAsync(values.body.trim()).then(
      () => reset({ body: '' }),
      (e) => {
        if (e instanceof ApiError && e.code === 'CONFLICT') {
          // The ticket was closed meanwhile; the hook refetches it, which swaps this form for the closed notice.
          onClosedConflict(values.body.trim());
          return;
        }
        applyServerErrors(e, setError, ['body'], 'Your message could not be sent.');
      },
    );

  return (
    <form className="mt-6 space-y-3 rounded-lg border border-slate-200 bg-white p-4" onSubmit={handleSubmit(onSubmit)} noValidate>
      {errors.root?.server?.message && <Banner tone="error">{errors.root.server.message}</Banner>}
      <Field
        label="Add a follow-up"
        error={errors.body?.message}
        hint={resolved ? 'Replying will reopen this ticket.' : undefined}
      >
        {(p) => (
          <Textarea
            {...p}
            rows={3}
            placeholder="Anything to add? Extra details help us resolve this faster."
            disabled={send.isPending}
            {...register('body')}
          />
        )}
      </Field>
      <Button type="submit" size="sm" loading={send.isPending}>
        {resolved ? 'Send and reopen' : 'Send'}
      </Button>
    </form>
  );
}
