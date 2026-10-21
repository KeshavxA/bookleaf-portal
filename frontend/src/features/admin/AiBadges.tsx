import { Badge } from '@/components/Badge';
import { Spinner } from '@/components/Spinner';

export function ClassifyingBadge() {
  return (
    <Badge className="bg-violet-50 text-violet-800 ring-violet-200">
      <Spinner className="h-3 w-3" />
      Classifying...
    </Badge>
  );
}

export function NeedsTriageBadge() {
  return <Badge className="bg-amber-100 text-amber-900 ring-amber-300">Needs manual triage</Badge>;
}

/** Wraps a badge whose value is a provisional keyword guess while the AI is still classifying. */
export function Provisional({ active, children }: { active: boolean; children: React.ReactNode }) {
  if (!active) return <>{children}</>;
  return (
    <span className="inline-flex opacity-60" title="Provisional: keyword-based until AI classification finishes">
      {children}
      <span className="sr-only"> (provisional)</span>
    </span>
  );
}
