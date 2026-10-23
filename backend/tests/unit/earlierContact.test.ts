/**
 * Live app test, ticket #24: a 7-minute-old first message got "I am sorry for the wait and the
 * lack of earlier replies". Earlier contact may only be mentioned when it really happened.
 * Unit tests only: no model is called.
 */
import { describe, expect, it } from "vitest";
import { buildFacts } from "../../src/ai/drafter/facts";
import { focusNotes } from "../../src/ai/drafter/prompt";
import { DRAFTER_SYSTEM_PROMPT } from "../../src/ai/drafter/systemPrompt";
import { checkRequiredPoints } from "../../src/ai/drafter/requiredPoints";
import { checkDraft } from "../../src/ai/drafter/checks";
import { EARLIER_CONTACT_CLAIM, earlierContact } from "../../src/ai/drafter/relevance";
import type { DraftBookInput, DraftContext, DraftThreadMessage } from "../../src/ai/drafter/types";

const NOW = new Date("2026-10-23T10:07:00.000Z");
const minutesAgo = (m: number) => new Date(NOW.getTime() - m * 60_000);
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86_400_000);
const SIGN = "Warm regards,\nBookLeaf Support Team";

/** Review-flagged payment ticket (₹3,570 pending, no payout since 15 Oct 2025): the apology point applies. */
const GANGES: DraftBookInput = {
  title: "Whispers of the Ganges",
  isbn: "978-93-5XXXX-01-2",
  status: "Published & Live",
  publicationDate: new Date("2024-03-15T00:00:00.000Z"),
  mrp: 399,
  authorRoyaltyPerCopy: 35,
  printPartner: "Repro India",
  availableOn: ["Amazon India", "Flipkart", "BookLeaf Store"],
  totalCopiesSold: 342,
  totalRoyaltyEarned: 11970,
  royaltyPaid: 8400,
  royaltyPending: 3570,
  lastRoyaltyPayoutDate: new Date("2025-10-15T00:00:00.000Z"),
};

function ctx(description: string, createdAt: Date, thread: DraftThreadMessage[] = []): DraftContext {
  return {
    ticket: { id: "t24", ticketNumber: 24, subject: "Pending royalty", description, status: "OPEN", category: "ROYALTY_PAYMENTS", createdAt },
    author: { name: "Priya Sharma", bankLinked: null, books: [] },
    book: GANGES,
    thread,
    today: NOW,
  };
}
const msg = (senderType: "AUTHOR" | "ADMIN", body: string, at: Date): DraftThreadMessage => ({
  senderType,
  senderName: senderType === "ADMIN" ? "Ritika Sen" : "Priya Sharma",
  body,
  createdAt: at,
});
const prompt = (c: DraftContext) => ({ facts: buildFacts(c), note: focusNotes(c).join("\n") });
const EARLIER_WORDING = /lack of earlier replies|earlier replies|getting back (to you )?sooner/i;

const FRESH = ctx("When will my pending royalty of ₹3,570 be paid?", minutesAgo(7));
const THIRD_TIME = ctx("This is the third time I am writing about my pending royalty.", minutesAgo(7));
const FIVE_DAYS = ctx("When will my pending royalty of ₹3,570 be paid?", daysAgo(5));

describe("a fresh ticket (ticket #24: 7 minutes old, first message, no replies)", () => {
  it("is not allowed to mention earlier contact", () => {
    expect(earlierContact(FRESH)).toMatchObject({ allowed: false, reason: "fresh", days: 0 });
  });

  it("FACTS say there was no earlier contact", () => {
    expect(prompt(FRESH).facts).toContain(
      "Earlier contact: none - this is the author's first message on a new ticket; do not mention earlier replies or not getting back sooner",
    );
  });

  it("the focus note still asks for an apology, but only for the wait for the payment, never 'earlier replies'", () => {
    const { note } = prompt(FRESH);
    expect(note).toContain("Include one sincere sentence apologising for the wait for the payment or the book itself.");
    expect(note).toContain("do not mention earlier replies or not getting back sooner");
    expect(note).not.toMatch(/for the lack of earlier replies/);
  });
});

describe("the author says they wrote before ('third time writing')", () => {
  it("allows earlier-contact wording in FACTS and the focus note", () => {
    expect(earlierContact(THIRD_TIME)).toMatchObject({ allowed: true, reason: "author-says" });
    const { facts, note } = prompt(THIRD_TIME);
    expect(facts).toContain("Earlier contact: the author says they have written before or not had a reply - acknowledging that is fine");
    expect(note).toContain("apologising for the wait or for the lack of earlier replies");
  });
});

describe("a ticket 5 days old with no BookLeaf reply", () => {
  it("allows earlier-contact wording, citing the days", () => {
    expect(earlierContact(FIVE_DAYS)).toMatchObject({ allowed: true, reason: "no-reply-for-days", days: 5 });
    const { facts, note } = prompt(FIVE_DAYS);
    expect(facts).toContain("Earlier contact: no reply from BookLeaf in 5 days - acknowledging the slow reply is fine");
    expect(note).toContain("for the lack of earlier replies");
  });

  it("but not once BookLeaf has replied", () => {
    const replied = ctx("When will it be paid?", daysAgo(5), [msg("ADMIN", "We're checking.", daysAgo(4))]);
    expect(earlierContact(replied)).toMatchObject({ allowed: false, reason: "already-replied" });
    expect(prompt(replied).facts).toContain("BookLeaf has already replied on this ticket - do not apologise for a lack of replies");
    expect(prompt(replied).note).not.toMatch(/for the lack of earlier replies/);
  });

  it("1 day old is still too fresh; an unanswered follow-up is allowed", () => {
    expect(earlierContact(ctx("When will it be paid?", daysAgo(1))).allowed).toBe(false);
    const followedUp = ctx("When will it be paid?", minutesAgo(60), [msg("AUTHOR", "Any update?", minutesAgo(10))]);
    expect(earlierContact(followedUp)).toMatchObject({ allowed: true, reason: "unanswered-follow-up" });
  });
});

describe("the system prompt states the rule, consistent with no-blame and never-late", () => {
  it("ties earlier-contact wording to FACTS", () => {
    expect(DRAFTER_SYSTEM_PROMPT).toContain(
      'Mention earlier replies, "not getting back to you sooner" or similar only when FACTS under "Earlier contact" say it is fine.',
    );
    expect(DRAFTER_SYSTEM_PROMPT).toContain(
      "Otherwise any apology is for the wait for the payment or the book itself, never for earlier contact. Either way, do not blame the author, do not say a payment is late, and do not admit a fault.",
    );
  });
});

describe("eval check: no false earlier-contact claim", () => {
  const ticket24Draft = `Hi Priya,\n\nI am sorry for the wait and the lack of earlier replies. Your pending royalty is ₹3,570.\n\n${SIGN}`;
  const freshDraft = `Hi Priya,\n\nI'm sorry you have been waiting for this payment. Your pending royalty is ₹3,570.\n\n${SIGN}`;
  const status = (draft: string, c: DraftContext) => checkDraft(draft, c, []).checks.find((x) => x.name === "no false earlier-contact claim")!;

  it("fails the ticket #24 draft on a fresh ticket, passes an apology for the payment wait", () => {
    expect(status(ticket24Draft, FRESH)).toMatchObject({ status: "fail", detail: 'claims "lack of earlier replies"' });
    expect(status(freshDraft, FRESH)).toMatchObject({ status: "pass" });
  });

  it("does not apply when earlier contact is real", () => {
    expect(status(ticket24Draft, THIRD_TIME).status).toBe("n/a");
    expect(status(ticket24Draft, FIVE_DAYS).status).toBe("n/a");
  });

  it.each([
    "Sorry for not getting back to you sooner.",
    "Apologies for the delay in replying.",
    "I'm sorry we didn't reply earlier.",
    "Thank you for your patience despite our previous replies being slow.",
    "Sorry to have kept you waiting for a reply.",
  ])("flags: %s", (sentence) => {
    expect(EARLIER_CONTACT_CLAIM.test(sentence)).toBe(true);
  });

  it.each(["I'm sorry you have waited so long for this payment.", "We will get back to you within 48 hours."])(
    "does not flag: %s",
    (sentence) => {
      expect(EARLIER_CONTACT_CLAIM.test(sentence)).toBe(false);
    },
  );
});

describe("sorry-wait accepts either wording where it applies", () => {
  const covered = (draft: string, c: DraftContext) => checkRequiredPoints(draft, c).find((p) => p.id === "sorry-wait")!.covered;

  it("fresh ticket: an apology for the payment wait covers the point", () => {
    expect(covered("I'm sorry you have been waiting for this payment.", FRESH)).toBe(true);
  });

  it("repeated contact: an apology for the lack of replies covers it too", () => {
    expect(covered("I'm sorry for the lack of replies on this.", THIRD_TIME)).toBe(true);
    expect(covered("I'm sorry for the wait.", THIRD_TIME)).toBe(true);
  });

  it("the fresh-ticket instruction forbids earlier-contact wording rather than asking for it", () => {
    const line = prompt(FRESH).note.split("\n").find((l) => l.includes("apologising"))!;
    expect(line).toContain("do not mention earlier replies or not getting back sooner");
    // the only earlier-contact words in it are inside that prohibition
    expect(line.replace("do not mention earlier replies or not getting back sooner", "")).not.toMatch(EARLIER_WORDING);
  });
});
