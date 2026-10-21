import type { Category, Priority, TicketStatus } from '@/api/types';

export const STATUS_LABEL: Record<TicketStatus, string> = {
  OPEN: 'Open',
  IN_PROGRESS: 'In Progress',
  RESOLVED: 'Resolved',
  CLOSED: 'Closed',
};

export const CATEGORY_LABEL: Record<Category, string> = {
  ROYALTY_PAYMENTS: 'Royalty & Payments',
  ISBN_METADATA: 'ISBN & Metadata',
  PRINTING_QUALITY: 'Printing & Quality',
  DISTRIBUTION_AVAILABILITY: 'Distribution & Availability',
  BOOK_STATUS_PRODUCTION: 'Book Status & Production',
  GENERAL_INQUIRY: 'General Inquiry',
};

export const PRIORITY_LABEL: Record<Priority, string> = {
  CRITICAL: 'Critical',
  HIGH: 'High',
  MEDIUM: 'Medium',
  LOW: 'Low',
};

export const STATUS_TONE: Record<TicketStatus, string> = {
  OPEN: 'bg-sky-100 text-sky-800 ring-sky-200',
  IN_PROGRESS: 'bg-amber-100 text-amber-800 ring-amber-200',
  RESOLVED: 'bg-emerald-100 text-emerald-800 ring-emerald-200',
  CLOSED: 'bg-slate-100 text-slate-600 ring-slate-200',
};

export const PRIORITY_TONE: Record<Priority, string> = {
  CRITICAL: 'bg-red-600 text-white ring-red-700',
  HIGH: 'bg-orange-100 text-orange-800 ring-orange-300',
  MEDIUM: 'bg-yellow-50 text-yellow-800 ring-yellow-200',
  LOW: 'bg-slate-100 text-slate-600 ring-slate-200',
};

export const CATEGORY_TONE: Record<Category, string> = {
  ROYALTY_PAYMENTS: 'bg-violet-50 text-violet-800 ring-violet-200',
  ISBN_METADATA: 'bg-rose-50 text-rose-800 ring-rose-200',
  PRINTING_QUALITY: 'bg-teal-50 text-teal-800 ring-teal-200',
  DISTRIBUTION_AVAILABILITY: 'bg-blue-50 text-blue-800 ring-blue-200',
  BOOK_STATUS_PRODUCTION: 'bg-lime-50 text-lime-800 ring-lime-200',
  GENERAL_INQUIRY: 'bg-slate-50 text-slate-700 ring-slate-200',
};

export const isUnresolved = (s: TicketStatus) => s === 'OPEN' || s === 'IN_PROGRESS';
export const isUrgent = (p: Priority) => p === 'CRITICAL' || p === 'HIGH';
