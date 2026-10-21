import { useEffect, useState } from 'react';
import { CATEGORIES, PRIORITIES, TICKET_STATUSES, type QueueSort } from '@/api/types';
import { Button } from '@/components/Button';
import { Field, Input, Select } from '@/components/Field';
import { MultiSelect } from '@/components/MultiSelect';
import { useDebouncedValue } from '@/hooks/useDebouncedValue';
import { CATEGORY_LABEL, PRIORITY_LABEL, STATUS_LABEL } from '@/lib/labels';
import { SORT_OPTIONS, type AssigneeChoice, type QueueFilters as Filters } from './queueParams';

interface Props {
  filters: Filters;
  onChange: (patch: Partial<Filters>) => void;
  onClear: () => void;
  /** True when anything (filters or sort) differs from the default view. */
  customized: boolean;
}

const options = <T extends string>(values: readonly T[], labels: Record<T, string>) =>
  values.map((value) => ({ value, label: labels[value] }));

const STATUS_OPTIONS = options(TICKET_STATUSES, STATUS_LABEL);
const CATEGORY_OPTIONS = options(CATEGORIES, CATEGORY_LABEL);
const PRIORITY_OPTIONS = options(PRIORITIES, PRIORITY_LABEL);

export function QueueFilters({ filters, onChange, onClear, customized }: Props) {
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
        <Field label="Search" className="sm:col-span-2 xl:col-span-2" hint="Subject, author, book or #number">
          {(p) => <Input {...p} type="search" placeholder="e.g. royalty or #42" value={search} onChange={(e) => setSearch(e.target.value)} />}
        </Field>
        <MultiSelect label="Status" allLabel="All statuses" options={STATUS_OPTIONS} value={filters.status} onChange={(status) => onChange({ status })} />
        <MultiSelect label="Category" allLabel="All categories" options={CATEGORY_OPTIONS} value={filters.category} onChange={(category) => onChange({ category })} />
        <MultiSelect label="Priority" allLabel="All priorities" options={PRIORITY_OPTIONS} value={filters.priority} onChange={(priority) => onChange({ priority })} />
        <Field label="Assignee">
          {(p) => (
            <Select {...p} value={filters.assignee} onChange={(e) => onChange({ assignee: e.target.value as AssigneeChoice })}>
              <option value="">Anyone</option>
              <option value="me">Assigned to me</option>
              <option value="unassigned">Unassigned</option>
            </Select>
          )}
        </Field>
        <Field label="Created from">
          {(p) => <Input {...p} type="date" value={filters.from} max={filters.to || undefined} onChange={(e) => onChange({ from: e.target.value })} />}
        </Field>
        <Field label="Created to" hint="Includes the whole day">
          {(p) => <Input {...p} type="date" value={filters.to} min={filters.from || undefined} onChange={(e) => onChange({ to: e.target.value })} />}
        </Field>
      </div>
      <div className="mt-3 flex flex-wrap items-end gap-4">
        <Field label="Sort" className="w-48">
          {(p) => (
            <Select {...p} value={filters.sort} onChange={(e) => onChange({ sort: e.target.value as QueueSort })}>
              {SORT_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </Select>
          )}
        </Field>
        {customized && (
          <Button variant="ghost" size="sm" onClick={onClear}>
            Clear filters
          </Button>
        )}
      </div>
    </section>
  );
}
