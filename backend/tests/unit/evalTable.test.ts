import { describe, expect, it } from "vitest";
import { printCheckTable, type CheckRow } from "../../scripts/ai-eval";
import { checkDraft } from "../../src/ai/drafter/checks";
import type { DraftContext } from "../../src/ai/drafter/types";

const d = (s: string) => new Date(`${s}T00:00:00.000Z`);
const SIGN = "Warm regards,\nBookLeaf Support Team";

const printing: DraftContext = {
  ticket: { id: "t", ticketNumber: 1, subject: "Blurry", description: "Images are blurry.", status: "OPEN", category: "PRINTING_QUALITY", createdAt: d("2026-10-20") },
  author: { name: "Priya Sharma", bankLinked: null, books: [] },
  book: null,
  thread: [],
  today: d("2026-10-21"),
};

describe("ai:eval check table (no API calls)", () => {
  it("shows per-point results, word count as information, and no length pass/fail", () => {
    const good = `Hi Priya,\n\nI'm sorry. Please send photos; after verification we arrange a free reprint in 5-7 business days.\n\n${SIGN}`;
    const partial = `Hi Priya,\n\nI'm sorry about this. We will look into it.\n\n${SIGN}`;
    const rows: CheckRow[] = [
      { n: 4, category: "PRINTING_QUALITY", report: checkDraft(good, printing, []) },
      { n: 5, category: "PRINTING_QUALITY", report: checkDraft(partial, printing, []) },
      { n: 6, category: "BOOK_STATUS_PRODUCTION", report: null, error: "TIMEOUT: AI request timed out" },
    ];
    const lines: string[] = [];
    printCheckTable(rows, (l) => lines.push(l));
    const out = lines.join("\n");

    expect(out).toMatch(/^4 +\| PRINTING_QUALITY +\| \d+ +\| PASS +\|.*sorry\+ photos\+ reprint\+ 5-7d\+$/m);
    expect(out).toMatch(/^5 +\| PRINTING_QUALITY +\| \d+ +\| FAIL +\|.*sorry\+ photos- reprint- 5-7d-$/m);
    expect(out).toContain("6  | BOOK_STATUS_PRODUCTION    | draft failed: TIMEOUT: AI request timed out");
    expect(out).toContain("required points    1 PASS, 1 FAIL");
    expect(out).toMatch(/PRINTING_QUALITY photos +1\/2/);
    expect(out).toContain("information only");
    expect(out).not.toMatch(/\blength\b|WARN/);
  });
});
