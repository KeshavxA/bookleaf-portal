import { useId, type ReactNode } from 'react';
import { cn } from '@/lib/cn';

export function Panel({ title, aside, children, className }: { title: string; aside?: ReactNode; children: ReactNode; className?: string }) {
  const id = useId();
  return (
    <section aria-labelledby={id} className={cn('rounded-lg border border-slate-200 bg-white p-4 shadow-sm', className)}>
      <header className="mb-3 flex items-center justify-between gap-2">
        <h2 id={id} className="text-sm font-semibold text-slate-900">
          {title}
        </h2>
        {aside}
      </header>
      {children}
    </section>
  );
}
