import { Link, useLocation, useNavigate } from 'react-router';
import type { AdminTicket } from '@/api/types';
import { Badge, CategoryBadge, PriorityBadge, StatusBadge } from '@/components/Badge';
import { useNow } from '@/hooks/useNow';
import { cn } from '@/lib/cn';
import { formatAge, formatDateTime, formatTicketNumber, isOlderThanDays } from '@/lib/format';
import { isUnresolved } from '@/lib/labels';

export const STALE_DAYS = 3;

const ROW_ACCENT: Partial<Record<AdminTicket['priority'], string>> = {
  CRITICAL: 'shadow-[inset_4px_0_0_var(--color-red-600)] bg-red-50/40',
  HIGH: 'shadow-[inset_4px_0_0_var(--color-orange-400)]',
};

export function QueueTable({ tickets }: { tickets: AdminTicket[] }) {
  const now = useNow(60_000);
  const navigate = useNavigate();
  const { search } = useLocation();

  return (
    <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
      <table className="min-w-full divide-y divide-slate-200 text-sm">
        <caption className="sr-only">Support tickets, most urgent first</caption>
        <thead className="bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
          <tr>
            <th scope="col" className="px-4 py-2.5">Ticket</th>
            <th scope="col" className="px-3 py-2.5">Priority</th>
            <th scope="col" className="px-3 py-2.5">Category</th>
            <th scope="col" className="px-3 py-2.5">Status</th>
            <th scope="col" className="px-3 py-2.5">Author</th>
            <th scope="col" className="px-3 py-2.5">Book</th>
            <th scope="col" className="px-3 py-2.5">Assignee</th>
            <th scope="col" className="px-3 py-2.5 text-right">Age</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {tickets.map((t) => {
            const open = isUnresolved(t.status);
            const stale = open && isOlderThanDays(t.createdAt, STALE_DAYS, now);
            const href = `/admin/tickets/${t.id}`;
            return (
              <tr
                key={t.id}
                onClick={(e) => {
                  // Make the whole row clickable without hijacking real links or text selection.
                  if ((e.target as HTMLElement).closest('a') || window.getSelection()?.toString()) return;
                  navigate(href, { state: { from: search } });
                }}
                className={cn('cursor-pointer hover:bg-slate-50', open && ROW_ACCENT[t.priority], !open && 'text-slate-500')}
              >
                <td className="max-w-xs px-4 py-3">
                  <Link to={href} state={{ from: search }} className="font-medium text-slate-900 hover:text-brand-700 hover:underline">
                    {t.subject}
                  </Link>
                  <div className="text-xs text-slate-500">{formatTicketNumber(t.ticketNumber)}</div>
                </td>
                <td className="px-3 py-3">
                  <PriorityBadge priority={t.priority} />
                </td>
                <td className="px-3 py-3">
                  {t.aiStatus === 'PENDING' ? (
                    <Badge className="bg-slate-50 text-slate-500 ring-slate-200">Classifying…</Badge>
                  ) : (
                    <div className="flex flex-col items-start gap-1">
                      <CategoryBadge category={t.category} />
                      {t.aiStatus === 'FAILED' && (
                        <Badge className="bg-amber-50 text-amber-800 ring-amber-300">Needs triage</Badge>
                      )}
                    </div>
                  )}
                </td>
                <td className="px-3 py-3">
                  <StatusBadge status={t.status} />
                </td>
                <td className="px-3 py-3">
                  <div className="text-slate-900">{t.author.name}</div>
                  <div className="text-xs text-slate-500">{t.author.email}</div>
                </td>
                <td className="px-3 py-3">{t.book?.title ?? <span className="text-slate-500">General</span>}</td>
                <td className="px-3 py-3">{t.assignee?.name ?? <span className="text-slate-400">Unassigned</span>}</td>
                <td className="whitespace-nowrap px-3 py-3 text-right">
                  <time
                    dateTime={t.createdAt}
                    title={`Opened ${formatDateTime(t.createdAt)}`}
                    className={cn(stale && 'font-semibold text-red-700')}
                  >
                    {stale && <span aria-hidden="true">⚠ </span>}
                    {formatAge(t.createdAt, now)}
                  </time>
                  {stale && <span className="sr-only"> (open longer than {STALE_DAYS} days)</span>}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
