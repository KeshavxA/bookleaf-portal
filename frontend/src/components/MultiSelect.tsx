import { useEffect, useId, useRef, useState } from 'react';
import { cn } from '@/lib/cn';
import { controlClass } from './Field';

interface Props<T extends string> {
  label: string;
  options: readonly { value: T; label: string }[];
  value: T[];
  onChange: (next: T[]) => void;
  /** Summary shown when nothing is selected, e.g. "All statuses". */
  allLabel: string;
}

/**
 * Checkbox list behind a disclosure button. Native <select multiple> needs Ctrl/Cmd-click, which
 * few people discover. Closes on Escape (returning focus) and on outside click.
 */
export function MultiSelect<T extends string>({ label, options, value, onChange, allLabel }: Props<T>) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointer = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false);
        buttonRef.current?.focus();
      }
    };
    document.addEventListener('pointerdown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const labels = options.filter((o) => value.includes(o.value)).map((o) => o.label);
  const summary = labels.length === 0 ? allLabel : labels.length <= 2 ? labels.join(', ') : `${labels.length} selected`;
  const toggle = (v: T) => onChange(value.includes(v) ? value.filter((x) => x !== v) : [...value, v]);

  return (
    <div ref={rootRef} className="relative">
      <span id={`${id}-label`} className="mb-1 block text-sm font-medium text-slate-700">
        {label}
      </span>
      <button
        ref={buttonRef}
        id={`${id}-button`}
        type="button"
        aria-haspopup="true"
        aria-expanded={open}
        aria-controls={`${id}-panel`}
        aria-labelledby={`${id}-label ${id}-button`}
        onClick={() => setOpen((o) => !o)}
        className={cn(controlClass, 'flex items-center justify-between text-left', labels.length > 0 && 'ring-brand-500')}
      >
        <span className="truncate">{summary}</span>
        <span aria-hidden="true" className="ml-2 text-slate-400">▾</span>
      </button>
      {open && (
        <fieldset
          id={`${id}-panel`}
          className="absolute z-20 mt-1 w-full min-w-52 rounded-md bg-white p-1.5 shadow-lg ring-1 ring-slate-200"
        >
          <legend className="sr-only">{label}</legend>
          {options.map((o) => (
            <label key={o.value} className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-slate-50">
              <input
                type="checkbox"
                className="h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-600"
                checked={value.includes(o.value)}
                onChange={() => toggle(o.value)}
              />
              {o.label}
            </label>
          ))}
          {value.length > 0 && (
            <button type="button" className="mt-1 w-full rounded px-2 py-1 text-left text-xs text-brand-700 hover:bg-slate-50" onClick={() => onChange([])}>
              Clear {label.toLowerCase()}
            </button>
          )}
        </fieldset>
      )}
    </div>
  );
}
