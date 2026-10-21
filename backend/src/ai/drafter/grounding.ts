/**
 * Cheap hallucination tripwire: every number in the draft should appear
 * somewhere in the material we gave the model (facts, policy, thread, system prompt).
 * Unknown numbers do not block the draft - the admin reviews every reply - but
 * they are logged so prompt regressions show up in monitoring.
 */
const NUMBER_RE = /\d[\d,]*(?:\.\d+)?/g;

function normalise(n: string): string {
  return n.replace(/,/g, "").replace(/\.0+$/, "");
}

export function findUngroundedNumbers(draft: string, sources: string[]): string[] {
  const allowed = new Set<string>();
  for (const src of sources) for (const m of src.match(NUMBER_RE) ?? []) allowed.add(normalise(m));
  const unknown = new Set<string>();
  for (const m of draft.match(NUMBER_RE) ?? []) {
    const n = normalise(m);
    if (!allowed.has(n)) unknown.add(m);
  }
  return [...unknown];
}
