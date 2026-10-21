import type { Category, Priority } from "../../domain/enums";
import { applyPriorityFloor } from "./rules";
import type { ClassifierInput } from "./prompt";

/**
 * Used when the LLM is unavailable or returns invalid output (and synchronously
 * at ticket creation so the queue is never unsorted while AI runs).
 * Deliberately simple and transparent: weighted keyword hits per category.
 * Priority is fixed at MEDIUM (plus code floors) - a human triages anything this produced.
 *
 * A rule marked "supporting" only adds to a category that already matched a primary
 * rule. An amount alone ("promise me a ₹50,000 bonus") is not a payment ticket.
 */
type Rule = [pattern: RegExp, weight: number, kind?: "supporting"];

/** "update/change/edit/add/new ... description/bio/photo": a how-to request, not a listing or metadata error. */
const PROFILE_OR_DESCRIPTION_UPDATE =
  /\b(updat\w*|chang\w*|edit\w*|modif\w*|add\w*|replac\w*|new)\b[^.?!\n]{0,40}\b(description|blurb|bio|biography|author photo|photo|profile picture|profile)\b/;

const RULES: Record<Category, Rule[]> = {
  ROYALTY_PAYMENTS: [
    [/\broyalt(y|ies)\b/, 3],
    [/\b(payout|payment|paid|unpaid|bank transfer|bank account|earnings?)\b/, 2],
    [/(₹|\brs\.?\s?\d|\binr\b)/, 1, "supporting"],
  ],
  ISBN_METADATA: [
    [/\bisbn\b/, 4],
    [/\b(imprint|metadata|wrong (title|author|book)|duplicate listing)\b/, 2],
  ],
  PRINTING_QUALITY: [
    [/\b(print quality|misprint|misprinted|blurry|blurred|misaligned|binding|smudged|faded)\b/, 3],
    [/\b(pages?|colou?r|ink|author cop(y|ies)|damaged|defect(ive)?)\b/, 1],
  ],
  DISTRIBUTION_AVAILABILITY: [
    [/\b(unavailable|not available|out of stock|not showing|not listed|can'?t find)\b/, 3],
    [/\b(amazon|flipkart|bookleaf store|listing|distribution)\b/, 1],
  ],
  BOOK_STATUS_PRODUCTION: [
    [/\b(typesetting|proofread(ing)?|cover design|editing|production|manuscript)\b/, 3],
    [/\b(status|delay(ed)?|when will|still not (out|published)|timeline)\b/, 1],
  ],
  // Outweighs a stray platform name ("...description on Amazon") that would otherwise pick DISTRIBUTION.
  GENERAL_INQUIRY: [[PROFILE_OR_DESCRIPTION_UPDATE, 5]],
};

const DEFAULT_FALLBACK_PRIORITY: Priority = "MEDIUM";

export interface KeywordClassification {
  category: Category;
  priority: Priority;
  matched: string[];
}

export function classifyByKeywords(input: Pick<ClassifierInput, "subject" | "description">): KeywordClassification {
  const text = `${input.subject}\n${input.description}`.toLowerCase();
  let best: Category = "GENERAL_INQUIRY";
  let bestScore = 0;
  let matched: string[] = [];

  for (const [category, rules] of Object.entries(RULES) as Array<[Category, Rule[]]>) {
    let score = 0;
    const hits: string[] = [];
    for (const [pattern, weight, kind] of rules) {
      if (kind === "supporting") continue;
      const m = text.match(pattern);
      if (m) {
        score += weight;
        hits.push(m[0]);
      }
    }
    if (score > 0) {
      for (const [pattern, weight, kind] of rules) {
        if (kind !== "supporting") continue;
        const m = text.match(pattern);
        if (m) {
          score += weight;
          hits.push(m[0]);
        }
      }
    }
    if (score > bestScore) {
      best = category;
      bestScore = score;
      matched = hits;
    }
  }

  return { category: best, priority: applyPriorityFloor(best, DEFAULT_FALLBACK_PRIORITY), matched };
}
