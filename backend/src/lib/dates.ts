/** Date-only helpers. All date-only values are handled in UTC to avoid TZ drift. */

export function toIsoDate(d: Date | null | undefined): string | null {
  return d ? d.toISOString().slice(0, 10) : null;
}

export function startOfUtcDay(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

export function addDays(d: Date, days: number): Date {
  const out = new Date(d);
  out.setUTCDate(out.getUTCDate() + days);
  return out;
}

/** "14 Nov 2026" - unambiguous for Indian and US readers alike. */
export function formatHumanDate(d: Date): string {
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
}

export function daysBetween(from: Date, to: Date): number {
  return Math.floor((startOfUtcDay(to).getTime() - startOfUtcDay(from).getTime()) / 86_400_000);
}
