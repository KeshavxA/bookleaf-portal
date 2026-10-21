import { SIGN_OFF } from "./systemPrompt";
import { isPaymentRelated, OFF_TOPIC_MONEY_RE } from "./relevance";
import type { DraftContext } from "./types";

/**
 * Deterministic checks on a generated draft. The drafter uses them to fix or
 * flag drafts (never to reject one for length); `npm run ai:eval` prints them
 * as a pass/fail table.
 */

/** Target body length in the prompt, and the wider band outside which we log a warning. */
export const TARGET_WORDS = { min: 100, max: 180 } as const;
export const WARN_WORDS = { min: 80, max: 220 } as const;

const BANK_RE = /\bbank (details|account)/i;
/** A sentence plus its trailing whitespace; the final fragment may have no terminator. */
const SENTENCE_RE = /[^.!?]+(?:[.!?]+|$)\s*/g;

/** Words in the body: greeting line and sign-off excluded. */
export function bodyWordCount(draft: string): number {
  const body = draft
    .replace(new RegExp(`${SIGN_OFF.replace(/\n/g, "\\s*")}\\s*$`), "")
    .replace(/^Hi\b[^\n]*\n/, "")
    .trim();
  return body ? body.split(/\s+/).length : 0;
}

export function countBankRequests(draft: string): number {
  return draft.split(/\n{2,}/).flatMap((p) => p.match(SENTENCE_RE) ?? [p]).filter((s) => BANK_RE.test(s)).length;
}

/**
 * Keeps the first sentence that asks about bank details and drops any later ones.
 * Returns the text unchanged when there is at most one.
 */
export function dedupeBankRequests(draft: string): string {
  if (countBankRequests(draft) <= 1) return draft;
  let seen = false;
  return draft
    .split(/\n{2,}/)
    .map((para) =>
      (para.match(SENTENCE_RE) ?? [para])
        .filter((sentence) => {
          if (!BANK_RE.test(sentence)) return true;
          if (seen) return false;
          seen = true;
          return true;
        })
        .join("")
        .trim(),
    )
    .filter((p) => p.length > 0)
    .join("\n\n");
}

const MONTH = "January|February|March|April|May|June|July|August|September|October|November|December|Sept|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Oct|Nov|Dec";
const DAY_MONTH_YEAR = new RegExp(`\\b\\d{1,2}(?:st|nd|rd|th)?\\s+(?:of\\s+)?(?:${MONTH})\\.?,?\\s+\\d{4}\\b`, "gi");
const MONTH_DAY_YEAR = new RegExp(`\\b(?:${MONTH})\\.?\\s+\\d{1,2}(?:st|nd|rd|th)?,?\\s+\\d{4}\\b`, "gi");
const NUMERIC_DATE = /\b\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4}\b|\b\d{4}-\d{2}-\d{2}\b/g;
const HOUSE_DATE = /^\d{1,2} (Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) \d{4}$/;

/** Dates not in the house format "14 Nov 2026" (e.g. "1 Sept 2025", "November 14, 2026", "14/11/2026"). */
export function findBadDates(draft: string): string[] {
  const bad = [
    ...(draft.match(DAY_MONTH_YEAR) ?? []).filter((d) => !HOUSE_DATE.test(d)),
    ...(draft.match(MONTH_DAY_YEAR) ?? []),
    ...(draft.match(NUMERIC_DATE) ?? []),
  ];
  return [...new Set(bad)];
}

export type CheckStatus = "pass" | "warn" | "fail" | "n/a";

export interface DraftCheck {
  name: "length" | "bank once" | "no off-topic money" | "dates" | "numbers grounded";
  status: CheckStatus;
  detail: string;
}

export function checkDraft(draft: string, ctx: DraftContext, ungroundedNumbers: string[]): DraftCheck[] {
  const words = bodyWordCount(draft);
  const lengthStatus: CheckStatus =
    words >= TARGET_WORDS.min && words <= TARGET_WORDS.max
      ? "pass"
      : words >= WARN_WORDS.min && words <= WARN_WORDS.max
        ? "warn"
        : "fail";
  const bank = countBankRequests(draft);
  const payment = isPaymentRelated(ctx);
  const offTopic = payment ? null : (OFF_TOPIC_MONEY_RE.exec(draft)?.[0] ?? "");
  const badDates = findBadDates(draft);

  return [
    { name: "length", status: lengthStatus, detail: `${words} words` },
    { name: "bank once", status: bank <= 1 ? "pass" : "fail", detail: `${bank} request${bank === 1 ? "" : "s"}` },
    {
      name: "no off-topic money",
      status: offTopic === null ? "n/a" : offTopic ? "fail" : "pass",
      detail: offTopic === null ? "payment ticket" : offTopic ? `mentions "${offTopic}"` : "none",
    },
    { name: "dates", status: badDates.length ? "fail" : "pass", detail: badDates.join(", ") || "ok" },
    {
      name: "numbers grounded",
      status: ungroundedNumbers.length ? "fail" : "pass",
      detail: ungroundedNumbers.join(", ") || "ok",
    },
  ];
}
