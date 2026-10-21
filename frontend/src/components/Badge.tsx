import type { ReactNode } from 'react';
import type { Category, Priority, TicketStatus } from '@/api/types';
import { cn } from '@/lib/cn';
import {
  CATEGORY_LABEL,
  CATEGORY_TONE,
  PRIORITY_LABEL,
  PRIORITY_TONE,
  STATUS_LABEL,
  STATUS_TONE,
} from '@/lib/labels';

export function Badge({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset',
        className,
      )}
    >
      {children}
    </span>
  );
}

export const StatusBadge = ({ status }: { status: TicketStatus }) => (
  <Badge className={STATUS_TONE[status]}>{STATUS_LABEL[status]}</Badge>
);

export const PriorityBadge = ({ priority }: { priority: Priority }) => (
  <Badge className={PRIORITY_TONE[priority]}>{PRIORITY_LABEL[priority]}</Badge>
);

export const CategoryBadge = ({ category }: { category: Category }) => (
  <Badge className={CATEGORY_TONE[category]}>{CATEGORY_LABEL[category]}</Badge>
);
