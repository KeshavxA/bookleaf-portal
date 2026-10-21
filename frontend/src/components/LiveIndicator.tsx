import { useRealtime } from '@/hooks/useRealtime';
import { cn } from '@/lib/cn';

export function LiveIndicator() {
  const { status } = useRealtime();
  const live = status === 'open';
  const label = live ? 'Live' : status === 'connecting' ? 'Connecting…' : 'Reconnecting · polling every 10s';
  return (
    <span
      className="inline-flex items-center gap-1.5 text-xs text-slate-600"
      role="status"
      title={live ? 'Receiving live updates' : 'Live updates paused; refreshing every 10 seconds'}
    >
      <span className={cn('h-2 w-2 rounded-full', live ? 'bg-emerald-500' : 'animate-pulse bg-amber-500')} aria-hidden="true" />
      {label}
    </span>
  );
}
