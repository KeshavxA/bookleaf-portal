import { useEffect, useRef, useState } from 'react';

/**
 * Returns the time the signature last changed after the first value was seen, or null.
 * The first value is a baseline, so a page load never shows "updated just now".
 * Changing `scope` (e.g. the active filters) starts a new baseline, so a change the user made
 * themselves isn't reported as a live update.
 */
export function useChangeCue(signature: string | undefined, scope = '') {
  const baseline = useRef<{ scope: string; signature: string } | null>(null);
  const [changedAt, setChangedAt] = useState<number | null>(null);

  useEffect(() => {
    if (signature === undefined) return;
    const prev = baseline.current;
    baseline.current = { scope, signature };
    if (!prev || prev.scope !== scope) {
      if (prev) setChangedAt(null);
      return;
    }
    if (prev.signature !== signature) setChangedAt(Date.now());
  }, [signature, scope]);

  return changedAt;
}

/** Ids that appeared after the first non-empty render, used to highlight freshly arrived messages. */
export function useNewIds(ids: string[] | undefined) {
  const seen = useRef<Set<string> | null>(null);
  const [fresh, setFresh] = useState<Set<string>>(() => new Set());
  const key = ids?.join(',');

  useEffect(() => {
    if (!ids) return;
    if (seen.current === null) {
      seen.current = new Set(ids);
      return;
    }
    const added = ids.filter((id) => !seen.current!.has(id));
    if (added.length) {
      added.forEach((id) => seen.current!.add(id));
      setFresh((prev) => new Set([...prev, ...added]));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return fresh;
}
