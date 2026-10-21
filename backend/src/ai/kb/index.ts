import { readFileSync } from "node:fs";
import { join } from "node:path";
import { CATEGORIES, type Category } from "../../domain/enums";

/**
 * Per-category knowledge base, extracted from the BookLeaf KB in the
 * assignment brief. Only the section for the ticket's category is sent to the
 * drafter - never the whole KB - which keeps prompts small and on-topic.
 */
const FILES: Record<Category, string> = {
  ROYALTY_PAYMENTS: "royalty_payments.md",
  ISBN_METADATA: "isbn_metadata.md",
  PRINTING_QUALITY: "printing_quality.md",
  DISTRIBUTION_AVAILABILITY: "distribution_availability.md",
  BOOK_STATUS_PRODUCTION: "book_status_production.md",
  GENERAL_INQUIRY: "general_inquiry.md",
};

// Loaded once at startup; a missing file fails fast rather than producing ungrounded drafts.
const SECTIONS: Record<Category, string> = Object.fromEntries(
  CATEGORIES.map((c) => [c, readFileSync(join(__dirname, FILES[c]), "utf8").trim()]),
) as Record<Category, string>;

export function kbSectionFor(category: Category): string {
  return SECTIONS[category];
}
