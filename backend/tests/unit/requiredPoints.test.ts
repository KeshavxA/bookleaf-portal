import { describe, expect, it } from "vitest";
import { focusNotes } from "../../src/ai/drafter/prompt";
import { applicablePoints, checkRequiredPoints, REQUIRED_POINTS } from "../../src/ai/drafter/requiredPoints";
import { kbSectionFor } from "../../src/ai/kb";
import type { Category } from "../../src/domain/enums";
import type { DraftBookInput, DraftContext } from "../../src/ai/drafter/types";

const d = (s: string) => new Date(`${s}T00:00:00.000Z`);
const SIGN = "Warm regards,\nBookLeaf Support Team";

const neverPaid: DraftBookInput = {
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
const belowThreshold: DraftBookInput = { ...neverPaid, totalRoyaltyEarned: 850, royaltyPending: 850 };
const inCoverDesign: DraftBookInput = { ...neverPaid, status: "In Production - Cover Design", publicationDate: null };

function ctx(
  category: Category,
  description: string,
  book: DraftBookInput | null = neverPaid,
  bankLinked: boolean | null = null,
): DraftContext {
  return {
    ticket: { id: "t", ticketNumber: 1, subject: "Question", description, status: "OPEN", category, createdAt: d("2026-10-20") },
    author: { name: "Ananya Reddy", bankLinked, books: [] },
    book,
    thread: [],
    today: d("2026-10-21"),
  };
}

const ids = (c: DraftContext) => applicablePoints(c).map((p) => p.id);

describe("which points apply", () => {
  it("royalty: review flagged, never paid -> apology, cycle, date, bank and the 48-hour review; no roll-over", () => {
    expect(ids(ctx("ROYALTY_PAYMENTS", "No royalty yet"))).toEqual(["ack", "sorry-wait", "cycle", "date", "bank", "48h"]);
  });

  it("royalty: under ₹1,000 -> roll-over and no payout date; bank linked -> no bank point", () => {
    expect(ids(ctx("ROYALTY_PAYMENTS", "Where is my royalty?", belowThreshold, true))).toEqual(["ack", "cycle", "rollover"]);
  });

  it("royalty without a book: no date, roll-over or bank point", () => {
    expect(ids(ctx("ROYALTY_PAYMENTS", "When are royalties paid?", null))).toEqual(["ack", "cycle"]);
  });

  it("general: metadata questions get the KB answer; anything else gets 'confirm within 48 hours'", () => {
    expect(ids(ctx("GENERAL_INQUIRY", "Can I update my book description?"))).toEqual(["direct", "channels", "3-5d"]);
    expect(ids(ctx("GENERAL_INQUIRY", "Which publishing packages do you offer?"))).toEqual(["kb-only"]);
  });

  it("every category has at least one point", () => {
    for (const points of Object.values(REQUIRED_POINTS)) expect(points.length).toBeGreaterThan(0);
  });
});

describe("focus note lists the points", () => {
  const note = (c: DraftContext) => focusNotes(c).join("\n");

  it("numbers the applicable points under 'Cover these points'", () => {
    const n = note(ctx("PRINTING_QUALITY", "Blurry images in my author copies"));
    expect(n).toContain("Cover these points (skip one only if it clearly does not apply):");
    expect(n).toContain("1. Apologise sincerely.");
    expect(n).toContain("2. Ask for photos of the defective copies.");
    expect(n).toContain("3. Say BookLeaf arranges a free reprint once the defect is verified.");
    expect(n).toContain("4. Give 5 to 7 business days for the reprint.");
  });

  it("covers each category's KB guidance", () => {
    expect(note(ctx("ISBN_METADATA", "Wrong ISBN"))).toMatch(/serious issue[\s\S]*escalated to the production team now[\s\S]*48-hour/);
    expect(note(ctx("DISTRIBUTION_AVAILABILITY", "Unavailable on Amazon"))).toMatch(/stock sync[\s\S]*re-sync[\s\S]*24 to 48 hours/);
    expect(note(ctx("BOOK_STATUS_PRODUCTION", "When will it be out?", inCoverDesign))).toMatch(
      /actual current status[\s\S]*without blaming the author[\s\S]*specific timeline/,
    );
    expect(note(ctx("GENERAL_INQUIRY", "Can I change my bio?"))).toMatch(/dashboard or by emailing[\s\S]*3 to 5 business days/);
  });

  it("a production question gets the 'not about payment' guard and no 'no sales or royalties yet' wording", () => {
    const n = note(ctx("BOOK_STATUS_PRODUCTION", "When will it be out?", inCoverDesign));
    expect(n).toContain("This ticket is not about payment.");
    expect(n).not.toMatch(/no sales|royalties yet|not yet published/i);
  });
});

describe("points are taken from the knowledge base", () => {
  // The specific facts each point asks for must appear in that category's KB section.
  it.each([
    ["ROYALTY_PAYMENTS", ["quarterly", "45 days", "₹1,000", "roll over", "bank", "48-hour"]],
    ["ISBN_METADATA", ["serious data issue", "production team", "48-hour"]],
    ["PRINTING_QUALITY", ["Apologise", "photos of the defective copies", "free reprint", "5-7 business days"]],
    ["DISTRIBUTION_AVAILABILITY", ["stock sync issue", "re-sync", "distribution team", "24-48 hours"]],
    ["BOOK_STATUS_PRODUCTION", ["actual production status", "Don't blame the author", "specific updated timeline"]],
    ["GENERAL_INQUIRY", ["through the dashboard or by emailing the BookLeaf team", "3-5 business days"]],
  ] as Array<[Category, string[]]>)("%s", (category, phrases) => {
    const kb = kbSectionFor(category);
    for (const p of phrases) expect(kb, p).toContain(p);
  });
});

describe("keyword checks", () => {
  const covered = (draft: string, c: DraftContext) =>
    Object.fromEntries(checkRequiredPoints(draft, c).map((r) => [r.id, r.covered]));

  it("royalty: a complete draft covers every point; a missing date is caught", () => {
    const c = ctx("ROYALTY_PAYMENTS", "No royalty yet");
    const good = `Hi Ananya,\n\nI understand how frustrating this is, and I'm sorry you have had to wait so long. Royalties are calculated each quarter and paid within 45 days of the quarter ending. Your next scheduled payout is 14 Nov 2026. Could you confirm your bank details in your dashboard? Our accounts team is checking this payment and will update you within 48 hours.\n\n${SIGN}`;
    expect(covered(good, c)).toEqual({ ack: true, "sorry-wait": true, cycle: true, date: true, bank: true, "48h": true });
    expect(covered(good.replace("14 Nov 2026", "mid-November"), c).date).toBe(false);
  });

  it("royalty roll-over", () => {
    const c = ctx("ROYALTY_PAYMENTS", "Where is it?", belowThreshold, true);
    expect(covered("₹850 is below ₹1,000, so it rolls over to the next quarter.", c).rollover).toBe(true);
    expect(covered("₹850 will be paid later.", c).rollover).toBe(false);
  });

  it("ISBN", () => {
    const c = ctx("ISBN_METADATA", "Wrong ISBN");
    expect(covered("This is a serious data issue. I have escalated it to our production team; update within 48 hours.", c)).toEqual({
      serious: true,
      escalate: true,
      "48h": true,
    });
    expect(covered("We will look into it.", c)).toEqual({ serious: false, escalate: false, "48h": false });
  });

  it("printing", () => {
    const c = ctx("PRINTING_QUALITY", "Blurry");
    expect(
      covered("I'm sorry. Please send photos of the pages. Once verified we'll arrange a free reprint within 5-7 business days.", c),
    ).toEqual({ sorry: true, photos: true, reprint: true, "5-7d": true });
    expect(covered("We will reprint it in a week.", c)).toEqual({ sorry: false, photos: false, reprint: false, "5-7d": false });
  });

  it("distribution", () => {
    const c = ctx("DISTRIBUTION_AVAILABILITY", "Unavailable");
    expect(
      covered("This is usually a stock sync issue. I've asked our distribution team to trigger a re-sync; live again in 24 to 48 hours.", c),
    ).toEqual({ sync: true, resync: true, "24-48h": true });
    expect(covered("We will check with Amazon.", c)).toEqual({ sync: false, resync: false, "24-48h": false });
  });

  it("production: stage named, no blame, a timeline; blaming is caught", () => {
    const c = ctx("BOOK_STATUS_PRODUCTION", "When will it be out?", inCoverDesign);
    expect(covered("It is at the cover design stage. We'll confirm the timeline within 48 hours.", c)).toEqual({
      status: true,
      "no-blame": true,
      timeline: true,
    });
    expect(covered("It is delayed because you didn't approve the cover. Soon.", c)).toEqual({
      status: false,
      "no-blame": false,
      timeline: false,
    });
  });

  it("general metadata question", () => {
    const c = ctx("GENERAL_INQUIRY", "Can I update my book description?");
    expect(
      covered(
        `Hi Ananya,\n\nYes, you can. Submit it through your dashboard or email the BookLeaf team; changes reflect within 3-5 business days.\n\n${SIGN}`,
        c,
      ),
    ).toEqual({ direct: true, channels: true, "3-5d": true });
    expect(covered(`Hi Ananya,\n\nReply with the new text and we'll update it.\n\n${SIGN}`, c)).toEqual({
      direct: false,
      channels: false,
      "3-5d": false,
    });
  });
});
