import { useEffect, useState } from 'react';
import { CATEGORIES, PRIORITIES, TICKET_STATUSES, type QueueSort } from '@/api/types';
import { Button } from '@/components/Button';
import { Field, Input, Select } from '@/components/Field';
import { useDebouncedValue } from '@/hooks/useDebouncedValue';
import { CATEGORY_LABEL, PRIORITY_LABEL, STATUS_LABEL } from '@/lib/labels';
import type { QueueFilters as Filters } from './queueParams';

interface Props {
  filters: Filters;
  onChange: (patch: Partial<Filters>) => void;
  onClear: () => void;
  active: boolean;
}

export function QueueFilters({ filters, onChange, onClear, active }: Props) {
  // Search is typed locally and pushed to the URL after a pause, so each keystroke isn't a request.
  const [search, setSearch] = useState(filters.q);
  const debounced = useDebouncedValue(search, 350);
  useEffect(() => {
    if (debounced !== filters.q) onChange({ q: debounced });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debounced]);
  useEffect(() => setSearch(filters.q), [filters.q]);

  return (
    <section aria-label="Filters" className="mb-4 rounded-lg border border-slate-200 bg-white p-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-8">
        <Field label="Search" className="sm:col-span-2 xl:col-span-2">
          {(p) => (
            <Input
              {...p}
              type="search"
              placeholder="Subject, author, book, #number"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          )}
        </Field>
        <Field label="Status">
          {(p) => (
            <Select {...p} value={filters.status} onChange={(e) => onChange({ status: e.target.value as Filters['status'] })}>
              <option value="">All statuses</option>
              {TICKET_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {STATUS_LABEL[s]}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Category">
          {(p) => (
            <Select {...p} value={filters.category} onChange={(e) => onChange({ category: e.target.value as Filters['category'] })}>
              <option value="">All categories</option>
              {CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {CATEGORY_LABEL[c]}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Priority">
          {(p) => (
            <Select {...p} value={filters.priority} onChange={(e) => onChange({ priority: e.target.value as Filters['priority'] })}>
              <option value="">All priorities</option>
              {PRIORITIES.map((pr) => (
                <option key={pr} value={pr}>
                  {PRIORITY_LABEL[pr]}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Created from">
          {(p) => (
            <Input {...p} type="date" value={filters.from} max={filters.to || undefined} onChange={(e) => onChange({ from: e.target.value })} />
          )}
        </Field>
        <Field label="Created to">
          {(p) => (
            <Input {...p} type="date" value={filters.to} min={filters.from || undefined} onChange={(e) => onChange({ to: e.target.value })} />
          )}
        </Field>
        <Field label="Sort">
          {(p) => (
            <Select {...p} value={filters.sort} onChange={(e) => onChange({ sort: e.target.value as QueueSort })}>
              <option value="urgency">Most urgent</option>
              <option value="oldest">Oldest first</option>
              <option value="newest">Newest first</option>
            </Select>
          )}
        </Field>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-4">
        <label className="inline-flex items-center gap-2 text-sm text-slate-700">
          <input
            type="checkbox"
            className="h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-600"
            checked={filters.mine}
            onChange={(e) => onChange({ mine: e.target.checked })}
          />
          Assigned to me
        </label>
        {active && (
          <Button variant="ghost" size="sm" onClick={onClear}>
            Clear filters
          </Button>
        )}
      </div>
    </section>
  );
}
