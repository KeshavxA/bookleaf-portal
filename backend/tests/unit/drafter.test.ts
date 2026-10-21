import { describe, expect, it } from "vitest";
import { buildFacts } from "../../src/ai/drafter/facts";
import { buildDraftPrompt, THREAD_WINDOW } from "../../src/ai/drafter/prompt";
import { postProcess, TicketDrafter } from "../../src/ai/drafter/drafter";
import { findUngroundedNumbers } from "../../src/ai/drafter/grounding";
import { kbSectionFor } from "../../src/ai/kb";
import type { DraftContext, DraftBookInput } from "../../src/ai/drafter/types";
import type { LlmPort, LlmRequest } from "../../src/ai/llm/types";

const d = (s: string) => new Date(`${s}T00:00:00.000Z`);
const today = d("2026-10-21");

const publishedBook: DraftBookInput = {
  title: "Between Two Temples",
  isbn: "978-93-5XXXX-05-9",
  status: "Published & Live",
  publicationDate: d("2024-07-05"),
  mrp: 425,
  authorRoyaltyPerCopy: 38,
  printPartner: "Epitome Books",
  availableOn: ["Amazon India", "BookLeaf Store"],
  totalCopiesSold: 67,
  totalRoyaltyEarned: 2546,
  royaltyPaid: 0,
  royaltyPending: 2546,
  lastRoyaltyPayoutDate: null,
};

function ctx(over: Partial<DraftContext> = {}): DraftContext {
  return {
    ticket: {
      id: "t1",
      ticketNumber: 42,
      subject: "No royalty yet",
      description: "I published over a year ago and have received nothing.",
      status: "OPEN",
      category: "ROYALTY_PAYMENTS",
      createdAt: d("2026-10-19"),
    },
    author: { name: "Ananya Reddy", bankLinked: null, books: [{ title: "Between Two Temples", status: "Published & Live" }] },
    book: publishedBook,
    thread: [],
    today,
    ...over,
  };
}

describe("FACTS block", () => {
  it("contains code-computed payout facts and the bank-details prompt", () => {
    const facts = buildFacts(ctx());
    expect(facts).toContain("Next scheduled payout date: 14 Nov 2026 (for Jul–Sep 2026 royalties)");
    expect(facts).toContain("pending: ₹2,546");
    expect(facts).toContain("Payout review: NEEDED");
    expect(facts).toMatch(/Bank details linked in dashboard: unknown/);
    expect(facts).toContain("address them as Ananya");
  });

  it("explains threshold roll-over for small balances", () => {
    const facts = buildFacts(ctx({ book: { ...publishedBook, royaltyPending: 850, totalRoyaltyEarned: 850 } }));
    expect(facts).toMatch(/below the ₹1,000 minimum, so it rolls over/);
    expect(facts).not.toContain("Payout review");
  });

  it("omits money entirely for books in production", () => {
    const facts = buildFacts(
      ctx({
        ticket: { ...ctx().ticket, category: "BOOK_STATUS_PRODUCTION" },
        book: { ...publishedBook, status: "In Production - Typesetting", publicationDate: null, mrp: null, royaltyPending: 0 },
      }),
    );
    expect(facts).toContain("In Production - Typesetting - not yet published");
    expect(facts).not.toMatch(/Royalty earned|Next scheduled payout|MRP/);
  });

  it("leaves royalty figures out of non-money categories (token discipline)", () => {
    const facts = buildFacts(ctx({ ticket: { ...ctx().ticket, category: "PRINTING_QUALITY" } }));
    expect(facts).not.toMatch(/Royalty earned|Next scheduled payout/);
    expect(facts).toContain("Print partner: Epitome Books");
  });

  it("lists the author's books for account-level tickets", () => {
    const facts = buildFacts(ctx({ book: null, ticket: { ...ctx().ticket, category: "GENERAL_INQUIRY" } }));
    expect(facts).toContain("Book: none selected");
    expect(facts).toContain('"Between Two Temples" (Published & Live)');
  });
});

describe("draft prompt", () => {
  it("sends only the KB section for the ticket's category, with cache breakpoints", () => {
    const { system } = buildDraftPrompt(ctx());
    expect(system).toHaveLength(2);
    expect(system.every((b) => b.cache_control?.type === "ephemeral")).toBe(true);
    expect(system[1]!.text).toContain(kbSectionFor("ROYALTY_PAYMENTS"));
    expect(system[1]!.text).not.toContain("Printing & Quality");
    // static prefix must be byte-identical across tickets, or the cache never hits
    const other = buildDraftPrompt(ctx({ author: { name: "Rohit Kapoor", bankLinked: true, books: [] }, today: d("2027-01-01") }));
    expect(other.system[0]!.text).toBe(system[0]!.text);
  });

  it("keeps only the last N thread messages", () => {
    const thread = Array.from({ length: 10 }, (_, i) => ({
      senderType: (i % 2 ? "ADMIN" : "AUTHOR") as "ADMIN" | "AUTHOR",
      senderName: "x",
      body: `message-${i}`,
      createdAt: d("2026-10-20"),
    }));
    const { messages } = buildDraftPrompt(ctx({ thread }));
    const content = messages[0]!.content as string;
    expect(content).not.toContain("message-3");
    expect(content).toContain(`message-${10 - THREAD_WINDOW}`);
    expect(content).toContain("message-9");
    expect(content).toContain("4 older message(s) omitted");
  });
});

describe("drafter output handling", () => {
  it("enforces the sign-off and strips markdown", () => {
    expect(postProcess("**Hi** there\n\nThanks,")).toBe("Hi there\n\nWarm regards,\nBookLeaf Support Team");
    const ok = "Hi Ananya,\n\nBody.\n\nWarm regards,\nBookLeaf Support Team";
    expect(postProcess(ok)).toBe(ok);
  });

  it("flags numbers that appear in none of the sources", () => {
    expect(findUngroundedNumbers("You'll get ₹2,546 on 14 Nov 2026, or ₹9,999.", ["pending: ₹2,546", "14 Nov 2026"])).toEqual([
      "9,999",
    ]);
  });

  it("returns the draft and its grounding check", async () => {
    let seen: LlmRequest | undefined;
    const body = `Hi Ananya,\n\n${"I understand the wait has been frustrating. ".repeat(8)}Your next payout is 14 Nov 2026 and pending is ₹2,546.\n\nWarm regards,\nBookLeaf Support Team`;
    const llm: LlmPort = {
      model: "fake",
      async complete(req, parse) {
        seen = req;
        const response = { text: body, model: "fake", stopReason: "end_turn", usage: { inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0 }, latencyMs: 1, attempts: 1 };
        return { value: parse(response), response };
      },
    };
    const out = await new TicketDrafter(llm).draft(ctx());
    expect(out.body).toBe(body);
    expect(out.ungroundedNumbers).toEqual([]);
    expect(seen?.kind).toBe("DRAFT");
  });
});
