import { Link, useLocation, useParams } from 'react-router';
import { ApiError } from '@/api/client';
import type { AdminTicket } from '@/api/types';
import { CategoryBadge, PriorityBadge, StatusBadge } from '@/components/Badge';
import { MessageThread } from '@/components/MessageThread';
import { SkeletonBlock } from '@/components/Skeleton';
import { EmptyState, ErrorState } from '@/components/States';
import { UpdatedCue } from '@/components/UpdatedCue';
import { useChangeCue } from '@/hooks/useChangeCue';
import { useNow } from '@/hooks/useNow';
import { cn } from '@/lib/cn';
import { formatAge, formatDateTime, formatTicketNumber, isOlderThanDays } from '@/lib/format';
import { isClassifying, needsManualTriage } from '@/lib/aiState';
import { isUnresolved } from '@/lib/labels';
import { ClassifyingBadge, NeedsTriageBadge, Provisional } from './AiBadges';
import { AiPanel } from './AiPanel';
import { DraftReplyPanel } from './DraftReplyPanel';
import { useAdminTicket } from './hooks';
import { ManagementPanel } from './ManagementPanel';
import { STALE_DAYS } from './QueueTable';

export function AdminTicketPage() {
  const { id = '' } = useParams();
  const location = useLocation();
  const backTo = `/admin${(location.state as { from?: string } | null)?.from ?? ''}`;
  const { data: ticket, isPending, isError, error, refetch } = useAdminTicket(id);
  const changedAt = useChangeCue(
    ticket
      ? [ticket.status, ticket.priority, ticket.category, ticket.aiStatus, ticket.messages.length, ticket.assignee?.id, ticket.updatedAt].join('|')
      : undefined,
    id,
  );

  return (
    <>
      <Link to={backTo} className="text-sm text-brand-700 hover:underline">
        ← Back to queue
      </Link>
      <div className="mt-3">
        {isPending ? (
          <div className="grid gap-6 lg:grid-cols-5">
            <div className="rounded-lg border border-slate-200 bg-white p-6 lg:col-span-3">
              <SkeletonBlock label="Loading ticket" lines={6} />
            </div>
            <div className="rounded-lg border border-slate-200 bg-white p-6 lg:col-span-2">
              <SkeletonBlock label="Loading triage" lines={4} />
            </div>
          </div>
        ) : isError ? (
          error instanceof ApiError && error.status === 404 ? (
            <EmptyState title="Ticket not found">It may have been removed, or the link is wrong.</EmptyState>
          ) : (
            <ErrorState error={error} onRetry={() => refetch()} title="We couldn't load this ticket" />
          )
        ) : (
          <TicketLayout ticket={ticket} changedAt={changedAt} />
        )}
      </div>
    </>
  );
}

function TicketLayout({ ticket, changedAt }: { ticket: AdminTicket; changedAt: number | null }) {
  const now = useNow(60_000);
  const stale = isUnresolved(ticket.status) && isOlderThanDays(ticket.createdAt, STALE_DAYS, now);

  return (
    <div className="grid gap-6 lg:grid-cols-5">
      <div className="space-y-6 lg:col-span-3">
        <header className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm text-slate-500">{formatTicketNumber(ticket.ticketNumber)}</span>
            <StatusBadge status={ticket.status} />
            <Provisional active={isClassifying(ticket)}>
              <PriorityBadge priority={ticket.priority} />
            </Provisional>
            <Provisional active={isClassifying(ticket)}>
              <CategoryBadge category={ticket.category} />
            </Provisional>
            {isClassifying(ticket) ? <ClassifyingBadge /> : needsManualTriage(ticket) && <NeedsTriageBadge />}
            <UpdatedCue changedAt={changedAt} />
          </div>
          <h1 className="mt-2 text-xl font-semibold text-slate-900">{ticket.subject}</h1>
          <dl className="mt-3 grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
            <Meta label="Author">
              {ticket.author.name}{' '}
              <a href={`mailto:${ticket.author.email}`} className="text-brand-700 hover:underline">
                {ticket.author.email}
              </a>
            </Meta>
            <Meta label="Book">{ticket.book?.title ?? 'General / Account Level'}</Meta>
            <Meta label="Opened">
              {formatDateTime(ticket.createdAt)}{' '}
              <span className={cn('text-slate-500', stale && 'font-semibold text-red-700')}>
                ({stale && '⚠ '}
                {formatAge(ticket.createdAt, now)} old)
              </span>
            </Meta>
            <Meta label="Assignee">{ticket.assignee?.name ?? 'Unassigned'}</Meta>
          </dl>
        </header>
        <section aria-label="Conversation with author">
          <h2 className="mb-3 text-sm font-semibold text-slate-900">Conversation</h2>
          <MessageThread
            viewer="ADMIN"
            original={{
              authorName: ticket.author.name,
              body: ticket.description,
              createdAt: ticket.createdAt,
              attachments: ticket.attachments,
            }}
            messages={ticket.messages}
            emptyHint="No replies yet. The author is waiting on a first response."
          />
        </section>
      </div>
      <aside className="space-y-4 lg:col-span-2" aria-label="Ticket actions">
        <AiPanel ticket={ticket} />
        {/* key resets the draft editor when navigating between tickets */}
        <DraftReplyPanel key={ticket.id} ticket={ticket} />
        <ManagementPanel ticket={ticket} />
      </aside>
    </div>
  );
}

function Meta({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wide text-slate-500">{label}</dt>
      <dd className="text-slate-900">{children}</dd>
    </div>
  );
}
