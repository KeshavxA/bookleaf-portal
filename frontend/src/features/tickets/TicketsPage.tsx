import { Link } from 'react-router';
import { PageHeader } from '@/components/AppShell';
import { StatusBadge } from '@/components/Badge';
import { Skeleton } from '@/components/Skeleton';
import { EmptyState, ErrorState } from '@/components/States';
import { UpdatedCue } from '@/components/UpdatedCue';
import { useChangeCue } from '@/hooks/useChangeCue';
import { useNow } from '@/hooks/useNow';
import { formatDate, formatRelative, formatTicketNumber } from '@/lib/format';
import { useMyTickets } from './hooks';

const newTicketLink = (
  <Link to="/tickets/new" className="rounded-md bg-brand-600 px-3.5 py-2 text-sm font-medium text-white hover:bg-brand-700">
    New query
  </Link>
);

export function TicketsPage() {
  const { data: tickets, isPending, isError, error, refetch } = useMyTickets();
  const now = useNow();
  const changedAt = useChangeCue(tickets?.map((t) => `${t.id}:${t.status}:${t.updatedAt}`).join('|'));

  return (
    <>
      <PageHeader
        title="My Tickets"
        description={
          <span className="flex items-center gap-2">
            Replies from the BookLeaf team appear here automatically. <UpdatedCue changedAt={changedAt} />
          </span>
        }
        actions={newTicketLink}
      />
      {isPending ? (
        <div role="status" aria-label="Loading your tickets" className="space-y-2">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-16 w-full" />
          ))}
        </div>
      ) : isError ? (
        <ErrorState error={error} onRetry={() => refetch()} title="We couldn't load your tickets" />
      ) : tickets.length === 0 ? (
        <EmptyState title="No tickets yet" action={newTicketLink}>
          Questions about royalties, ISBNs, printing or your book's status? Raise a query and we'll get back to you.
        </EmptyState>
      ) : (
        <ul className="divide-y divide-slate-200 overflow-hidden rounded-lg border border-slate-200 bg-white">
          {tickets.map((t) => (
            <li key={t.id}>
              <Link to={`/tickets/${t.id}`} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3 hover:bg-slate-50">
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium text-slate-900">{t.subject}</p>
                  <p className="text-xs text-slate-500">
                    {formatTicketNumber(t.ticketNumber)} · {t.book?.title ?? 'General / Account Level'} · Opened {formatDate(t.createdAt)}
                  </p>
                </div>
                <span className="text-xs text-slate-500">Updated {formatRelative(t.updatedAt, now)}</span>
                <StatusBadge status={t.status} />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
