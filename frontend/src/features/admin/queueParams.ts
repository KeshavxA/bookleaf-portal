import { useCallback, useMemo } from 'react';
import { useSearchParams } from 'react-router';
import {
  CATEGORIES,
  PRIORITIES,
  TICKET_STATUSES,
  type AdminTicketQuery,
  type Category,
  type Priority,
  type QueueSort,
  type TicketStatus,
} from '@/api/types';

export const PAGE_SIZE = 20;

/** Contract default: priority weight first, then oldest first among unresolved. */
export const DEFAULT_SORT: QueueSort = 'urgency';
export const SORT_OPTIONS: readonly { value: QueueSort; label: string }[] = [
  { value: 'urgency', label: 'Urgency' },
  { value: 'oldest', label: 'Oldest' },
  { value: 'newest', label: 'Newest' },
];

export type AssigneeChoice = '' | 'me' | 'unassigned';

/** Filter state as it lives in the URL, so filtered views survive reloads and can be shared. */
export interface QueueFilters {
  status: TicketStatus[];
  category: Category[];
  priority: Priority[];
  from: string; // yyyy-mm-dd
  to: string; // yyyy-mm-dd
  assignee: AssigneeChoice;
  q: string;
  sort: QueueSort;
  page: number;
}

/** Comma-separated URL value → known enum values, in canonical order, without duplicates. */
const list = <T extends string>(value: string | null, allowed: readonly T[]): T[] => {
  const picked = new Set((value ?? '').split(',').map((v) => v.trim()));
  return allowed.filter((v) => picked.has(v));
};

const SORTS = SORT_OPTIONS.map((o) => o.value);
const DATE = /^\d{4}-\d{2}-\d{2}$/;

export function parseFilters(params: URLSearchParams): QueueFilters {
  const from = params.get('from') ?? '';
  const to = params.get('to') ?? '';
  const assignee = params.get('assignee');
  const sort = params.get('sort') as QueueSort | null;
  return {
    status: list(params.get('status'), TICKET_STATUSES),
    category: list(params.get('category'), CATEGORIES),
    priority: list(params.get('priority'), PRIORITIES),
    from: DATE.test(from) ? from : '',
    to: DATE.test(to) ? to : '',
    assignee: assignee === 'me' || assignee === 'unassigned' ? assignee : '',
    q: params.get('q') ?? '',
    // Missing or unknown values fall back to the contract default.
    sort: sort && SORTS.includes(sort) ? sort : DEFAULT_SORT,
    page: Math.max(1, Number(params.get('page')) || 1),
  };
}

/**
 * Dates go to the API as bare yyyy-mm-dd values. The contract makes a bare "to" cover that whole
 * day; the backend reads bare dates in UTC (see the README's known limitations).
 */
export function toApiQuery(f: QueueFilters): AdminTicketQuery {
  return {
    status: f.status.length ? f.status : undefined,
    category: f.category.length ? f.category : undefined,
    priority: f.priority.length ? f.priority : undefined,
    assigneeId: f.assignee || undefined,
    from: f.from || undefined,
    to: f.to || undefined,
    q: f.q.trim() || undefined,
    sort: f.sort, // always sent explicitly, so the request never depends on a server default
    page: f.page,
    pageSize: PAGE_SIZE,
  };
}

export function serializeFilters(f: QueueFilters): URLSearchParams {
  const out = new URLSearchParams();
  if (f.status.length) out.set('status', f.status.join(','));
  if (f.category.length) out.set('category', f.category.join(','));
  if (f.priority.length) out.set('priority', f.priority.join(','));
  if (f.from) out.set('from', f.from);
  if (f.to) out.set('to', f.to);
  if (f.assignee) out.set('assignee', f.assignee);
  if (f.q) out.set('q', f.q);
  if (f.sort !== DEFAULT_SORT) out.set('sort', f.sort);
  if (f.page > 1) out.set('page', String(f.page));
  return out;
}

export function useQueueFilters() {
  const [params, setParams] = useSearchParams();
  const filters = useMemo(() => parseFilters(params), [params]);

  const update = useCallback(
    (patch: Partial<QueueFilters>) => {
      setParams(
        (prev) => {
          const next = { ...parseFilters(prev), ...patch };
          // Any filter change returns to page 1; only explicit pagination keeps the page.
          if (!('page' in patch)) next.page = 1;
          return serializeFilters(next);
        },
        { replace: true },
      );
    },
    [setParams],
  );

  // Resets filters, page and sort, so the queue returns to urgency order.
  const clear = useCallback(() => setParams(new URLSearchParams(), { replace: true }), [setParams]);
  /** Any filter set (drives the "no matches" empty state). */
  const active = Boolean(
    filters.status.length ||
      filters.category.length ||
      filters.priority.length ||
      filters.from ||
      filters.to ||
      filters.assignee ||
      filters.q,
  );

  /**
   * Anything differing from the default view, including a non-default sort. This drives the
   * "Clear filters" button, so a stale ?sort=newest (from a bookmark or the back link) can be reset.
   */
  const customized = active || filters.sort !== DEFAULT_SORT;

  return { filters, update, clear, active, customized };
}
