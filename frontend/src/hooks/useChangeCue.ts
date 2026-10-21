import { useEffect, useRef, useState } from 'react';

/**
 * Returns the time the signature last changed after the first value was seen, or null.
 * The first value is a baseline, so a page load never shows "updated just now".
 */
export function useChangeCue(signature: string | undefined) {
  const baseline = useRef<string | undefined>(undefined);
  const [changedAt, setChangedAt] = useState<number | null>(null);

  useEffect(() => {
    if (signature === undefined) return;
    if (baseline.current === undefined) {
      baseline.current = signature;
      return;
    }
    if (baseline.current !== signature) {
      baseline.current = signature;
      setChangedAt(Date.now());
    }
  }, [signature]);

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
