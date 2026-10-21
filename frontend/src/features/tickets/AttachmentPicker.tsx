import { useId, useRef, useState } from 'react';
import type { Attachment } from '@/api/types';
import { formatBytes } from '@/lib/format';
import { MAX_ATTACHMENTS, MAX_ATTACHMENT_BYTES } from './schema';

interface Props {
  value: Attachment[];
  onChange: (next: Attachment[]) => void;
  disabled?: boolean;
}

/**
 * UI-only attachment picker: it records file names and sizes for the ticket but never uploads
 * file contents (upload is out of scope for v1 of the contract).
 */
export function AttachmentPicker({ value, onChange, disabled }: Props) {
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);

  const addFiles = (files: FileList | null) => {
    if (!files) return;
    const incoming = Array.from(files);
    const tooBig = incoming.filter((f) => f.size > MAX_ATTACHMENT_BYTES);
    const accepted = incoming
      .filter((f) => f.size <= MAX_ATTACHMENT_BYTES)
      .map((f) => ({ name: f.name, size: f.size }));
    const next = [...value, ...accepted].slice(0, MAX_ATTACHMENTS);

    const problems: string[] = [];
    if (tooBig.length) problems.push(`${tooBig.map((f) => f.name).join(', ')} exceeds the 10 MB limit.`);
    if (value.length + accepted.length > MAX_ATTACHMENTS) problems.push(`You can attach up to ${MAX_ATTACHMENTS} files.`);
    setError(problems.length ? problems.join(' ') : null);
    onChange(next);
    if (inputRef.current) inputRef.current.value = '';
  };

  return (
    <div>
      <span className="mb-1 block text-sm font-medium text-slate-700">
        Attachments <span className="font-normal text-slate-500">(optional)</span>
      </span>
      <label
        htmlFor={inputId}
        className="inline-flex cursor-pointer items-center gap-2 rounded-md bg-white px-3 py-2 text-sm font-medium text-slate-800 ring-1 ring-inset ring-slate-300 hover:bg-slate-50 has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-60 has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-brand-600"
      >
        📎 Add files
        <input
          ref={inputRef}
          id={inputId}
          type="file"
          multiple
          className="sr-only"
          disabled={disabled || value.length >= MAX_ATTACHMENTS}
          onChange={(e) => addFiles(e.target.files)}
          aria-describedby={`${inputId}-hint`}
        />
      </label>
      <p id={`${inputId}-hint`} className="mt-1 text-xs text-slate-500">
        Screenshots, photos of print defects or statements. Up to {MAX_ATTACHMENTS} files, 10 MB each.
      </p>
      {error && (
        <p role="alert" className="mt-1 text-xs font-medium text-red-700">
          {error}
        </p>
      )}
      {value.length > 0 && (
        <ul className="mt-2 divide-y divide-slate-100 rounded-md border border-slate-200 bg-white" aria-label="Selected files">
          {value.map((a, i) => (
            <li key={`${a.name}-${i}`} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
              <span className="truncate">
                {a.name} <span className="text-slate-500">({formatBytes(a.size)})</span>
              </span>
              <button
                type="button"
                className="text-xs font-medium text-red-700 hover:underline disabled:opacity-50"
                onClick={() => onChange(value.filter((_, j) => j !== i))}
                disabled={disabled}
                aria-label={`Remove ${a.name}`}
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
