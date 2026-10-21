import { useNow } from '@/hooks/useNow';
import { formatRelative } from '@/lib/format';
import { cn } from '@/lib/cn';

const FRESH_MS = 60_000;

/** "Updated just now" pill shown when live data changes; fades to a muted timestamp after a minute. */
export function UpdatedCue({ changedAt, label = 'Updated' }: { changedAt: number | null; label?: string }) {
  const now = useNow(10_000);
  if (!changedAt) return null;
  const fresh = now - changedAt < FRESH_MS;
  return (
    <span
      aria-live="polite"
      className={cn(
        'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium transition-colors',
        fresh ? 'bg-emerald-100 text-emerald-800' : 'text-slate-500',
      )}
    >
      {fresh && <span className="h-1.5 w-1.5 animate-ping rounded-full bg-emerald-500" aria-hidden="true" />}
      {label} {formatRelative(changedAt, now)}
    </span>
  );
}
