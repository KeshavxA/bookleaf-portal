import { Link } from 'react-router';
import { PageHeader } from '@/components/AppShell';
import { Skeleton } from '@/components/Skeleton';
import { EmptyState, ErrorState } from '@/components/States';
import { formatINR } from '@/lib/format';
import { BookCard } from './BookCard';
import { royaltyTotals } from './bookUtils';
import { useBooks } from './useBooks';

export function BooksPage() {
  const { data: books, isPending, isError, error, refetch } = useBooks();

  return (
    <>
      <PageHeader
        title="My Books"
        description="Sales, royalties and production status for every book you publish with BookLeaf."
        actions={
          <Link to="/tickets/new" className="rounded-md bg-brand-600 px-3.5 py-2 text-sm font-medium text-white hover:bg-brand-700">
            Raise a query
          </Link>
        }
      />
      {isPending ? (
        <BooksSkeleton />
      ) : isError ? (
        <ErrorState error={error} onRetry={() => refetch()} title="We couldn't load your books" />
      ) : books.length === 0 ? (
        <EmptyState title="No books yet">
          Once your manuscript is received, your book will appear here with its production status.
        </EmptyState>
      ) : (
        <>
          <RoyaltySummary books={books} />
          <div className="grid gap-4 lg:grid-cols-2">
            {books.map((b) => (
              <BookCard key={b.id} book={b} />
            ))}
          </div>
        </>
      )}
    </>
  );
}

function RoyaltySummary({ books }: { books: Parameters<typeof royaltyTotals>[0] }) {
  const t = royaltyTotals(books);
  const tiles = [
    { label: 'Total royalty earned', value: formatINR(t.earned) },
    { label: 'Paid to you', value: t.paid === 0 ? 'No payouts yet' : formatINR(t.paid) },
    { label: 'Pending payout', value: formatINR(t.pending) },
  ];
  return (
    <section aria-label="Royalty summary" className="mb-6 grid gap-3 sm:grid-cols-3">
      {tiles.map((tile) => (
        <div key={tile.label} className="rounded-lg border border-slate-200 bg-white px-4 py-3">
          <p className="text-xs uppercase tracking-wide text-slate-500">{tile.label}</p>
          <p className="mt-1 text-xl font-semibold text-slate-900">{tile.value}</p>
        </div>
      ))}
      <p className="text-xs text-slate-500 sm:col-span-3">
        Royalties are calculated quarterly and paid within 45 days of the quarter ending.
      </p>
    </section>
  );
}

function BooksSkeleton() {
  return (
    <div role="status" aria-label="Loading your books" className="grid gap-4 lg:grid-cols-2">
      {[0, 1].map((i) => (
        <div key={i} className="space-y-3 rounded-lg border border-slate-200 bg-white p-5">
          <Skeleton className="h-5 w-1/2" />
          <Skeleton className="h-4 w-1/3" />
          <div className="grid grid-cols-3 gap-3 pt-2">
            {Array.from({ length: 9 }, (_, j) => (
              <Skeleton key={j} className="h-8" />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
