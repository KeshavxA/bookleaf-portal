const inr = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 });
const num = new Intl.NumberFormat('en-IN');
const dateFmt = new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
const dateTimeFmt = new Intl.DateTimeFormat('en-IN', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
});

export const NA = '—';

export function formatINR(amount: number | null | undefined) {
  return amount == null ? NA : inr.format(amount);
}

export function formatNumber(n: number | null | undefined) {
  return n == null ? NA : num.format(n);
}

/** Date-only strings ("2024-01-10") are parsed as local dates so they don't shift a day in UTC-negative zones. */
function parse(value: string) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : new Date(value);
}

export function formatDate(value: string | null | undefined) {
  if (!value) return NA;
  const d = parse(value);
  return Number.isNaN(d.getTime()) ? NA : dateFmt.format(d);
}

export function formatDateTime(value: string | null | undefined) {
  if (!value) return NA;
  const d = parse(value);
  return Number.isNaN(d.getTime()) ? NA : dateTimeFmt.format(d);
}

export function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

const DAY = 86_400_000;

export function ageMs(from: string, now = Date.now()) {
  return Math.max(0, now - new Date(from).getTime());
}

/** Compact age for tables: "45m", "5h", "3d". */
export function formatAge(from: string, now = Date.now()) {
  const ms = ageMs(from, now);
  const mins = Math.floor(ms / 60_000);
  if (mins < 60) return `${Math.max(mins, 0)}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

export function formatRelative(from: string | number, now = Date.now()) {
  const ms = now - (typeof from === 'number' ? from : new Date(from).getTime());
  if (ms < 45_000) return 'just now';
  const mins = Math.round(ms / 60_000);
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours} hr ago`;
  const days = Math.round(hours / 24);
  return `${days} day${days === 1 ? '' : 's'} ago`;
}

export function isOlderThanDays(from: string, days: number, now = Date.now()) {
  return ageMs(from, now) > days * DAY;
}

/** Backend ticket numbers are integers; show them as "#42". Pre-formatted strings pass through. */
export function formatTicketNumber(n: number | string) {
  return typeof n === 'number' || /^\d+$/.test(n) ? `#${n}` : n;
}
