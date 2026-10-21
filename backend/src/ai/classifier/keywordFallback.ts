import type { Category, Priority } from "../../domain/enums";
import { applyPriorityFloor } from "./rules";
import type { ClassifierInput } from "./prompt";

/**
 * Used when the LLM is unavailable or returns invalid output (and synchronously
 * at ticket creation so the queue is never unsorted while AI runs).
 * Deliberately simple and transparent: weighted keyword hits per category.
 * Priority is fixed at MEDIUM (plus code floors) - a human triages anything this produced.
 */
const RULES: Record<Exclude<Category, "GENERAL_INQUIRY">, Array<[RegExp, number]>> = {
  ROYALTY_PAYMENTS: [
    [/\broyalt(y|ies)\b/, 3],
    [/\b(payout|payment|paid|unpaid|bank transfer|bank account|earnings?)\b/, 2],
    [/(₹|\brs\.?\s?\d|\binr\b)/, 1],
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

  for (const [category, patterns] of Object.entries(RULES) as Array<[Category, Array<[RegExp, number]>]>) {
    let score = 0;
    const hits: string[] = [];
    for (const [pattern, weight] of patterns) {
      const m = text.match(pattern);
      if (m) {
        score += weight;
        hits.push(m[0]);
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
