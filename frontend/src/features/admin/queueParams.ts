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

/** Filter state as it lives in the URL, so filtered views survive reloads and can be shared. */
export interface QueueFilters {
  status: TicketStatus | '';
  category: Category | '';
  priority: Priority | '';
  from: string; // yyyy-mm-dd
  to: string; // yyyy-mm-dd
  mine: boolean;
  q: string;
  sort: QueueSort;
  page: number;
}

const pick = <T extends string>(value: string | null, allowed: readonly T[]): T | '' =>
  value && (allowed as readonly string[]).includes(value) ? (value as T) : '';

const SORTS: readonly QueueSort[] = ['urgency', 'oldest', 'newest'];
const DATE = /^\d{4}-\d{2}-\d{2}$/;

export function parseFilters(params: URLSearchParams): QueueFilters {
  const from = params.get('from') ?? '';
  const to = params.get('to') ?? '';
  return {
    status: pick(params.get('status'), TICKET_STATUSES),
    category: pick(params.get('category'), CATEGORIES),
    priority: pick(params.get('priority'), PRIORITIES),
    from: DATE.test(from) ? from : '',
    to: DATE.test(to) ? to : '',
    mine: params.get('mine') === '1',
    q: params.get('q') ?? '',
    sort: pick(params.get('sort'), SORTS) || 'urgency',
    page: Math.max(1, Number(params.get('page')) || 1),
  };
}

/** Local-day boundaries as ISO timestamps, so "to" includes the whole selected day. */
const startOfDay = (d: string) => new Date(`${d}T00:00:00`).toISOString();
const endOfDay = (d: string) => new Date(`${d}T23:59:59.999`).toISOString();

export function toApiQuery(f: QueueFilters, userId: string | undefined): AdminTicketQuery {
  return {
    status: f.status || undefined,
    category: f.category || undefined,
    priority: f.priority || undefined,
    assigneeId: f.mine ? userId : undefined,
    from: f.from ? startOfDay(f.from) : undefined,
    to: f.to ? endOfDay(f.to) : undefined,
    q: f.q.trim() || undefined,
    sort: f.sort,
    page: f.page,
    pageSize: PAGE_SIZE,
  };
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
          const out = new URLSearchParams();
          if (next.status) out.set('status', next.status);
          if (next.category) out.set('category', next.category);
          if (next.priority) out.set('priority', next.priority);
          if (next.from) out.set('from', next.from);
          if (next.to) out.set('to', next.to);
          if (next.mine) out.set('mine', '1');
          if (next.q) out.set('q', next.q);
          if (next.sort !== 'urgency') out.set('sort', next.sort);
          if (next.page > 1) out.set('page', String(next.page));
          return out;
        },
        { replace: true },
      );
    },
    [setParams],
  );

  const clear = useCallback(() => setParams(new URLSearchParams(), { replace: true }), [setParams]);
  const active = Boolean(
    filters.status || filters.category || filters.priority || filters.from || filters.to || filters.mine || filters.q,
  );

  return { filters, update, clear, active };
}
