import type { FieldValues, Path, UseFormSetError } from 'react-hook-form';
import { ApiError, errorMessage, ROOT_FIELD } from '@/api/client';

/**
 * Maps a contract error onto a react-hook-form form. Each detail whose dotted `field` path names a
 * field in `fields` is set on that field; "(root)" and any other detail (e.g. "attachments.0.size",
 * which has no input of its own) are folded into one form-level root message.
 * Returns true if anything was set.
 */
export function applyServerErrors<T extends FieldValues>(
  err: unknown,
  setError: UseFormSetError<T>,
  fields: readonly Path<T>[],
  fallback?: string,
): boolean {
  const known = new Set<string>(fields);
  const rootMessages: string[] = [];
  let firstField = true;

  if (err instanceof ApiError) {
    for (const d of err.details) {
      if (d.field !== ROOT_FIELD && known.has(d.field)) {
        setError(d.field as Path<T>, { type: 'server', message: d.message }, { shouldFocus: firstField });
        firstField = false;
      } else {
        rootMessages.push(d.field === ROOT_FIELD ? d.message : `${describeField(d.field)}: ${d.message}`);
      }
    }
  }

  // Only add the generic message when no field-level message explains the problem.
  if (rootMessages.length === 0 && firstField) rootMessages.push(errorMessage(err, fallback));
  if (rootMessages.length) setError('root.server' as Path<T>, { type: 'server', message: rootMessages.join(' ') });
  return true;
}

/** "attachments.0.size" → "Attachment 1 size"; other paths are shown as-is. */
export function describeField(path: string) {
  const m = /^attachments\.(\d+)(?:\.(\w+))?$/.exec(path);
  if (m) return `Attachment ${Number(m[1]) + 1}${m[2] ? ` ${m[2]}` : ''}`;
  return path;
}

/** One-line message for forms that don't use react-hook-form (field details appended). */
export function errorSummary(err: unknown, fallback?: string) {
  if (err instanceof ApiError && err.details.length && err.code === 'VALIDATION_ERROR') {
    return err.details.map((d) => d.message).join(' ');
  }
  return errorMessage(err, fallback);
}
