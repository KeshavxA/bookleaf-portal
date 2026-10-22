/**
 * Draft fixes from reading the third Gemini eval (pass 3). Unit tests only: no model is called.
 * Fixtures use the dataset rows the problems were seen on.
 */
import { describe, expect, it } from "vitest";
import { buildFacts } from "../../src/ai/drafter/facts";
import { focusNotes } from "../../src/ai/drafter/prompt";
import { DRAFTER_SYSTEM_PROMPT } from "../../src/ai/drafter/systemPrompt";
import { applicablePoints, checkRequiredPoints } from "../../src/ai/drafter/requiredPoints";
import { checkDraft, findUpcomingDates } from "../../src/ai/drafter/checks";
import {
  isRoyaltyDispute,
  saysIgnoredOrRepeated,
  shouldAskBankDetails,
  titlesNamedByAuthor,
} from "../../src/ai/drafter/relevance";
import type { Category } from "../../src/domain/enums";
import type { DraftBookInput, DraftContext, DraftThreadMessage } from "../../src/ai/drafter/types";

const d = (s: string) => new Date(`${s}T00:00:00.000Z`);
const TODAY = d("2026-10-21");
const SIGN = "Warm regards,\nBookLeaf Support Team";

const book = (over: Partial<DraftBookInput>): DraftBookInput => ({
  title: "Book",
  isbn: "978-93-5XXXX-00-0",
  status: "Published & Live",
  publicationDate: d("2024-01-01"),
  mrp: 300,
  authorRoyaltyPerCopy: 25,
  printPartner: "Repro India",
  availableOn: ["Amazon India", "BookLeaf Store"],
  totalCopiesSold: 0,
  totalRoyaltyEarned: 0,
  royaltyPaid: 0,
  royaltyPending: 0,
  lastRoyaltyPayoutDate: null,
  ...over,
});

/** BK016: ₹850 pending, never paid (below the ₹1,000 threshold). */
const NAGPUR = book({ title: "The Nagpur Notebooks", publicationDate: d("2025-06-30"), totalCopiesSold: 34, totalRoyaltyEarned: 850, royaltyPending: 850 });
/** BK001: ₹8,400 paid, ₹3,570 pending, last payout 15 Oct 2025 (review flagged). */
const GANGES = book({ title: "Whispers of the Ganges", totalCopiesSold: 342, authorRoyaltyPerCopy: 35, totalRoyaltyEarned: 11970, royaltyPaid: 8400, royaltyPending: 3570, lastRoyaltyPayoutDate: d("2025-10-15") });
/** BK014: 156 copies, ₹3,120 earned and paid in full. */
const GHAZAL = book({ title: "Ghazal of the Forgotten", totalCopiesSold: 156, authorRoyaltyPerCopy: 20, totalRoyaltyEarned: 3120, royaltyPaid: 3120, royaltyPending: 0, lastRoyaltyPayoutDate: d("2025-12-01") });
/** BK003: ₹5,280 pending, last payout 1 Sep 2025 (review flagged). */
const KARMA = book({ title: "Code & Karma", totalCopiesSold: 876, totalRoyaltyEarned: 26280, royaltyPaid: 21000, royaltyPending: 5280, lastRoyaltyPayoutDate: d("2025-09-01") });

function ctx(
  category: Category,
  description: string,
  b: DraftBookInput | null,
  opts: { bankLinked?: boolean | null; subject?: string; books?: string[]; thread?: DraftThreadMessage[] } = {},
): DraftContext {
  return {
    ticket: { id: "t", ticketNumber: 1, subject: opts.subject ?? "Question", description, status: "OPEN", category, createdAt: d("2026-10-19") },
    author: {
      name: "Kavita Deshmukh",
      bankLinked: opts.bankLinked === undefined ? null : opts.bankLinked,
      books: (opts.books ?? []).map((title) => ({ title, status: "Published & Live" })),
    },
    book: b,
    thread: opts.thread ?? [],
    today: TODAY,
  };
}
const ids = (c: DraftContext) => applicablePoints(c).map((p) => p.id);
const check = (draft: string, c: DraftContext, name: string) => checkDraft(draft, c, []).checks.find((x) => x.name === name)!;

describe("1. roll-over balances get no payout date", () => {
  const c = ctx("ROYALTY_PAYMENTS", "My dashboard shows royalty pending for The Nagpur Notebooks but I've never been paid.", NAGPUR);

  it("FACTS state the carry-forward rule and give no date for an ₹850 balance", () => {
    const facts = buildFacts(c);
    expect(facts).toContain(
      "pending ₹850 is below the ₹1,000 minimum. It carries forward and is paid in the first quarterly payout cycle after accumulated royalty reaches ₹1,000.",
    );
    expect(facts).toContain("Payout date for this balance: none yet (do not give one); nothing is wrong, so no investigation is needed");
    expect(facts).not.toMatch(/Next scheduled payout|14 Nov|Payout review/);
    // only "Today: 21 Oct 2026" may be a current date in FACTS; no payout date for the balance
    const bookFacts = facts.slice(facts.indexOf('Book: "The Nagpur Notebooks"'));
    expect(findUpcomingDates(bookFacts, TODAY)).toEqual([]);
  });

  it("the focus note asks for the roll-over, forbids a date and an investigation, and has no date or 48h point", () => {
    const note = focusNotes(c).join("\n");
    expect(note).toContain("give no payout date for it and do not promise a team investigation");
    expect(note).toMatch(/carries forward, and is paid in the first quarterly payout cycle after accumulated royalty reaches ₹1,000/);
    expect(note).not.toMatch(/14 Nov|next scheduled payout date|48 hours/i);
    expect(ids(c)).not.toContain("date");
    expect(ids(c)).not.toContain("48h");
    expect(ids(c)).toContain("rollover");
  });

  it("eval check: any upcoming or year-less date fails, a past date or no date passes", () => {
    const ok = `Hi Kavita,\n\nYour ₹850 carries forward and is paid in the first quarterly cycle after it reaches ₹1,000.\n\n${SIGN}`;
    expect(check(ok, c, "no roll-over date").status).toBe("pass");
    expect(checkRequiredPoints(ok, c).find((p) => p.id === "rollover")!.covered).toBe(true);
    expect(check(`Hi Kavita,\n\nIt rolls over; the next payout is 14 Nov 2026.\n\n${SIGN}`, c, "no roll-over date")).toMatchObject({
      status: "fail",
      detail: "14 Nov 2026",
    });
    expect(check(`It will be paid on 14 Nov.`, c, "no roll-over date").status).toBe("fail");
    expect(check(`Your last payout was on 1 Dec 2025.`, c, "no roll-over date").status).toBe("pass");
  });

  it("the system prompt's roll-over rule matches FACTS and forbids a date", () => {
    expect(DRAFTER_SYSTEM_PROMPT).toContain(
      "explain that it carries forward and is paid in the first quarterly payout cycle after accumulated royalty reaches ₹1,000. Give no payout date for that balance.",
    );
    expect(DRAFTER_SYSTEM_PROMPT).not.toContain("rolls over to the next quarter");
  });

  it("the check does not apply to tickets above the threshold", () => {
    const ganges = ctx("ROYALTY_PAYMENTS", "When will my pending royalty be paid?", GANGES);
    expect(check("The next payout is 14 Nov 2026.", ganges, "no roll-over date").status).toBe("n/a");
  });
});

describe("2. bank details only when nothing has ever been paid", () => {
  it("asks when royalty paid is 0 (BK016)", () => {
    const c = ctx("ROYALTY_PAYMENTS", "Where is my royalty?", NAGPUR);
    expect(shouldAskBankDetails(c)).toBe(true);
    expect(buildFacts(c)).toContain("Bank details: unknown, and no royalty has ever been paid for this book - ask the author once");
    expect(focusNotes(c)[0]).toContain("Ask about bank details exactly once.");
    expect(ids(c)).toContain("bank");
  });

  it("does not ask when any royalty has been paid (BK001, ₹8,400 paid)", () => {
    const c = ctx("ROYALTY_PAYMENTS", "When will my pending ₹3,570 be paid?", GANGES);
    expect(shouldAskBankDetails(c)).toBe(false);
    expect(buildFacts(c)).toContain("Bank details: a royalty payout has already reached this author for this book - do not ask about bank details");
    expect(buildFacts(c)).not.toMatch(/confirm their bank details/);
    expect(focusNotes(c)[0]).toContain("Do not ask about bank details.");
    expect(ids(c)).not.toContain("bank");
  });

  it("explicit bank status wins; no book means no ask", () => {
    expect(shouldAskBankDetails(ctx("ROYALTY_PAYMENTS", "x", GANGES, { bankLinked: false }))).toBe(true);
    expect(shouldAskBankDetails(ctx("ROYALTY_PAYMENTS", "x", NAGPUR, { bankLinked: true }))).toBe(false);
    expect(shouldAskBankDetails(ctx("ROYALTY_PAYMENTS", "x", null))).toBe(false);
  });
});

describe("3. royalty amount disputes: records and a breakdown offer", () => {
  const dispute = ctx("ROYALTY_PAYMENTS", "My royalty amount seems too low. I sold 200 copies but only received ₹3,000.", GHAZAL);

  it.each([
    ["I sold 200 copies but only received ₹3,000.", true],
    ["The royalty is different from what I expected.", true],
    ["I was paid Rs. 1,200 but the dashboard says more.", true],
    ["This doesn't match my own sales count.", true],
    ["₹5,280 is still pending and nobody replies.", false],
    ["I published my book 4 months ago and have no royalty.", false],
  ])("%s -> dispute %s", (text, expected) => {
    expect(isRoyaltyDispute(ctx("ROYALTY_PAYMENTS", text, GHAZAL))).toBe(expected);
  });

  it("adds the records and breakdown points, and FACTS carry the figures to state", () => {
    expect(ids(dispute)).toEqual(expect.arrayContaining(["records", "breakdown"]));
    const facts = buildFacts(dispute);
    expect(facts).toContain("Copies sold: 156");
    expect(facts).toContain("author royalty per copy: ₹20");
    expect(facts).toContain("Royalty earned: ₹3,120; paid: ₹3,120; pending: ₹0");
    const note = focusNotes(dispute).join("\n");
    expect(note).toContain("state plainly what our records show for this book");
    expect(note).toContain("without being defensive");
    expect(note).toContain("Offer to share a detailed line-by-line royalty breakdown.");
  });

  it("keyword checks: records = copies sold and total earned; breakdown = 'breakdown'", () => {
    const good = `Hi Farhan,\n\nOur records show 156 copies sold at ₹20 per copy, ₹3,120 earned and paid. I'd be glad to send a detailed line-by-line breakdown.\n\n${SIGN}`;
    const res = Object.fromEntries(checkRequiredPoints(good, dispute).map((p) => [p.id, p.covered]));
    expect(res).toMatchObject({ records: true, breakdown: true });
    const vague = `Hi Farhan,\n\nRoyalties are net of costs, so the amount is correct.\n\n${SIGN}`;
    expect(Object.fromEntries(checkRequiredPoints(vague, dispute).map((p) => [p.id, p.covered]))).toMatchObject({
      records: false,
      breakdown: false,
    });
  });

  it("not a dispute -> no records/breakdown points", () => {
    expect(ids(ctx("ROYALTY_PAYMENTS", "When will my pending royalty be paid?", GANGES))).not.toContain("breakdown");
  });
});

describe("4. own the wait", () => {
  it("applies when the author says they wrote before or were ignored (any category)", () => {
    const escalation = ctx("ROYALTY_PAYMENTS", "This is the third time I am writing. ₹5,280 is still pending and nobody replies.", KARMA);
    expect(saysIgnoredOrRepeated(escalation)).toBe(true);
    expect(ids(escalation)).toContain("sorry-wait");

    const isbnAgain = ctx("ISBN_METADATA", "I emailed you before about the wrong ISBN and got no response.", KARMA);
    expect(ids(isbnAgain)).toContain("sorry-wait");

    const followUp = ctx("PRINTING_QUALITY", "Blurry pages.", KARMA, {
      thread: [{ senderType: "AUTHOR", senderName: "Rohit", body: "Any update?", createdAt: d("2026-10-20") }],
    });
    expect(ids(followUp)).toContain("sorry-wait");
  });

  it("applies when the payout-review flag is set on a payment ticket, not otherwise", () => {
    expect(ids(ctx("ROYALTY_PAYMENTS", "When will my pending royalty be paid?", GANGES))).toContain("sorry-wait");
    expect(ids(ctx("ISBN_METADATA", "The ISBN is wrong.", GANGES))).not.toContain("sorry-wait");
    expect(ids(ctx("ROYALTY_PAYMENTS", "Where is my royalty?", NAGPUR))).not.toContain("sorry-wait");
  });

  it("the instruction forbids saying the payment is late or admitting a fault", () => {
    const note = focusNotes(ctx("ROYALTY_PAYMENTS", "Third time asking.", KARMA)).join("\n");
    expect(note).toContain("Include one sincere sentence apologising for the wait or for the lack of earlier replies.");
    expect(note).toContain("Do not say the payment is late, overdue or missed, and do not admit a fault.");
  });

  it("check: an apology for the wait passes; 'late' or 'our mistake' fails; a generic sorry fails", () => {
    const c = ctx("ROYALTY_PAYMENTS", "Third time asking.", KARMA);
    const covered = (t: string) => checkRequiredPoints(t, c).find((p) => p.id === "sorry-wait")!.covered;
    expect(covered("I'm sorry you have had to wait this long without a reply.")).toBe(true);
    expect(covered("I apologise for the delay in getting back to you.")).toBe(true);
    expect(covered("I'm sorry for the wait. Your payment is late.")).toBe(false);
    expect(covered("I'm sorry for the wait; this was our mistake.")).toBe(false);
    expect(covered("I'm sorry to hear that.")).toBe(false);
  });
});

describe("5. stay inside the knowledge base", () => {
  it("the system prompt forbids 'yes, you can' and unsupported policy, with a 48-hour fallback", () => {
    expect(DRAFTER_SYSTEM_PROMPT).toContain(
      'Stay inside POLICY and FACTS. Do not say "yes, you can", and do not state any policy, process, timeline or capability that is not in POLICY or FACTS.',
    );
    expect(DRAFTER_SYSTEM_PROMPT).toContain(
      "For anything they do not cover (for example adding a co-author), say the team will confirm and reply within 48 hours.",
    );
  });

  it("a co-author question gets the 'kb-only' point; 'Yes, you can' fails it", () => {
    const c = ctx("GENERAL_INQUIRY", "Can I add a co-author name to The Last Monsoon?", null);
    expect(ids(c)).toEqual(["kb-only"]);
    const covered = (t: string) => checkRequiredPoints(`Hi Vikram,\n\n${t}\n\n${SIGN}`, c)[0]!.covered;
    expect(covered("Our team will confirm whether a co-author can be added and reply within 48 hours.")).toBe(true);
    expect(covered("Yes, you can add a co-author through the dashboard. We'll reply within 48 hours.")).toBe(false);
    expect(covered("We'll look into it.")).toBe(false);
  });
});

describe("6. account-level tickets do not name a book the author didn't", () => {
  const bio = ctx("GENERAL_INQUIRY", "Could you help me update the author bio on my BookLeaf profile?", null, {
    subject: "Change my author bio",
    books: ["Turban Tales"],
  });

  it("FACTS give a count of books on file, not titles, plus the instruction", () => {
    const facts = buildFacts(bio);
    expect(facts).toContain("Book: none selected (account-level query). Do not name a specific book unless the author named it.");
    expect(facts).toContain("Books on file: 1");
    expect(facts).not.toContain("Turban Tales");
    expect(focusNotes(bio).join("\n")).toContain("No book is selected: do not name a specific book unless the author named it.");
  });

  it("a book the author named is included, and only that one", () => {
    const named = ctx("GENERAL_INQUIRY", "Can I update the bio shown on Turban Tales?", null, { books: ["Turban Tales", "Another Book"] });
    expect(titlesNamedByAuthor(named)).toEqual(["Turban Tales"]);
    const facts = buildFacts(named);
    expect(facts).toContain('named by the author: "Turban Tales"');
    expect(facts).not.toContain("Another Book");
    expect(facts).toContain("Books on file: 2");
  });
});
