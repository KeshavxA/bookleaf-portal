import { PageHeader } from '@/components/AppShell';
import { Button } from '@/components/Button';
import { Skeleton } from '@/components/Skeleton';
import { EmptyState, ErrorState } from '@/components/States';
import { UpdatedCue } from '@/components/UpdatedCue';
import { useAuth } from '@/features/auth/AuthContext';
import { useChangeCue } from '@/hooks/useChangeCue';
import { useAdminTickets } from './hooks';
import { QueueFilters } from './QueueFilters';
import { PAGE_SIZE, toApiQuery, useQueueFilters } from './queueParams';
import { QueueTable, STALE_DAYS } from './QueueTable';

export function QueuePage() {
  const { user } = useAuth();
  const { filters, update, clear, active } = useQueueFilters();
  const { data, isPending, isError, error, refetch, isFetching, isPlaceholderData } = useAdminTickets(
    toApiQuery(filters, user?.id),
  );
  // Scoped to the current filters/page, so only live changes within the same view show the cue.
  const changedAt = useChangeCue(
    data && !isPlaceholderData ? `${data.total}|${data.items.map((t) => `${t.id}:${t.updatedAt}`).join(',')}` : undefined,
    JSON.stringify(filters),
  );

  return (
    <>
      <PageHeader
        title="Ticket queue"
        description={
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span>Sorted by urgency by default: priority first, then the oldest unresolved.</span>
            <UpdatedCue changedAt={changedAt} label="Queue updated" />
          </span>
        }
      />
      <QueueFilters filters={filters} onChange={update} onClear={clear} active={active} />
      <Legend />

      {isPending ? (
        <div role="status" aria-label="Loading tickets" className="space-y-2 rounded-lg border border-slate-200 bg-white p-4">
          {Array.from({ length: 6 }, (_, i) => (
            <Skeleton key={i} className="h-10 w-full" />
          ))}
        </div>
      ) : isError ? (
        <ErrorState error={error} onRetry={() => refetch()} title="We couldn't load the queue" />
      ) : data.items.length === 0 ? (
        <EmptyState
          title={active ? 'No tickets match these filters' : 'The queue is empty'}
          action={active ? <Button variant="secondary" onClick={clear}>Clear filters</Button> : undefined}
        >
          {active ? 'Try widening the date range or clearing a filter.' : 'New author queries will appear here automatically.'}
        </EmptyState>
      ) : (
        <div className={isFetching && isPlaceholderData ? 'opacity-60 transition-opacity' : undefined} aria-busy={isFetching}>
          <QueueTable tickets={data.items} />
          <Pagination page={data.page} pageSize={data.pageSize || PAGE_SIZE} total={data.total} onPage={(page) => update({ page })} />
        </div>
      )}
    </>
  );
}

function Legend() {
  return (
    <p className="mb-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-500">
      <span className="inline-flex items-center gap-1.5">
        <span className="h-3 w-1 rounded bg-red-600" aria-hidden="true" /> Critical
      </span>
      <span className="inline-flex items-center gap-1.5">
        <span className="h-3 w-1 rounded bg-orange-400" aria-hidden="true" /> High
      </span>
      <span className="font-medium text-red-700">⚠ Open longer than {STALE_DAYS} days</span>
    </p>
  );
}

function Pagination({ page, pageSize, total, onPage }: { page: number; pageSize: number; total: number; onPage: (p: number) => void }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const first = (page - 1) * pageSize + 1;
  const last = Math.min(total, page * pageSize);
  return (
    <nav aria-label="Pagination" className="mt-3 flex items-center justify-between text-sm text-slate-600">
      <span>
        Showing {first}–{last} of {total}
      </span>
      <div className="flex items-center gap-2">
        <Button variant="secondary" size="sm" disabled={page <= 1} onClick={() => onPage(page - 1)}>
          Previous
        </Button>
        <span aria-current="page">
          Page {page} of {pages}
        </span>
        <Button variant="secondary" size="sm" disabled={page >= pages} onClick={() => onPage(page + 1)}>
          Next
        </Button>
      </div>
    </nav>
  );
}
