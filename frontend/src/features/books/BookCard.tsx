import type { ReactNode } from 'react';
import { Link } from 'react-router';
import type { Book } from '@/api/types';
import { Badge } from '@/components/Badge';
import { formatDate, formatINR, formatNumber, NA } from '@/lib/format';
import { hasNoPayouts, isBelowPayoutThreshold, productionStage } from './bookUtils';

export function BookCard({ book }: { book: Book }) {
  const stage = productionStage(book.status);
  const inProduction = stage !== null;
  const noPayouts = hasNoPayouts(book);
  // Sales and royalty figures don't apply until a book is live.
  const money = (n: number) => (inProduction ? NA : formatINR(n));

  return (
    <article className="flex flex-col rounded-lg border border-slate-200 bg-white p-5 shadow-sm" aria-labelledby={`book-${book.id}`}>
      <header className="flex items-start justify-between gap-3">
        <div>
          <h2 id={`book-${book.id}`} className="text-base font-semibold text-slate-900">
            {book.title}
          </h2>
          <p className="text-sm text-slate-500">{book.genre}</p>
        </div>
        {inProduction ? (
          <Badge className="bg-amber-50 text-amber-800 ring-amber-200">In production · {stage}</Badge>
        ) : (
          <Badge className="bg-emerald-50 text-emerald-800 ring-emerald-200">{book.status}</Badge>
        )}
      </header>

      <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 text-sm sm:grid-cols-3">
        <Item label="ISBN">{book.isbn || NA}</Item>
        <Item label="Published">{formatDate(book.publicationDate)}</Item>
        <Item label="MRP">{formatINR(book.mrp)}</Item>
        <Item label="Copies sold">{inProduction ? NA : formatNumber(book.totalCopiesSold)}</Item>
        <Item label="Royalty earned">{money(book.totalRoyaltyEarned)}</Item>
        <Item label="Royalty paid">
          {noPayouts ? <span className="text-slate-500">No payouts yet</span> : money(book.royaltyPaid)}
        </Item>
        <Item label="Royalty pending">
          <span className={!inProduction && book.royaltyPending > 0 ? 'font-semibold text-amber-700' : undefined}>
            {money(book.royaltyPending)}
          </span>
        </Item>
        <Item label="Last payout">
          {inProduction ? NA : book.lastRoyaltyPayoutDate ? formatDate(book.lastRoyaltyPayoutDate) : 'No payouts yet'}
        </Item>
        <Item label="Printed by">{book.printPartner ?? NA}</Item>
      </dl>

      {inProduction && (
        <p className="mt-4 rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-900">
          Your book is currently at the <strong>{stage}</strong> stage. Sales and royalty figures will appear once it is
          published and live.
        </p>
      )}
      {!inProduction && isBelowPayoutThreshold(book) && (
        <p className="mt-4 rounded-md bg-slate-50 px-3 py-2 text-xs text-slate-700">
          Pending royalty is below the ₹1,000 payout threshold, so it rolls over to the next quarter.
        </p>
      )}
      {!inProduction && book.availableOn.length > 0 && (
        <p className="mt-4 text-xs text-slate-500">Available on {book.availableOn.join(', ')}</p>
      )}

      <div className="mt-auto pt-4">
        <Link
          to={`/tickets/new?bookId=${encodeURIComponent(book.id)}`}
          className="text-sm font-medium text-brand-700 hover:underline"
        >
          Ask a question about this book →
        </Link>
      </div>
    </article>
  );
}

function Item({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wide text-slate-500">{label}</dt>
      <dd className="mt-0.5 text-slate-900">{children}</dd>
    </div>
  );
}
