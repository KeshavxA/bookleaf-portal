import { describe, expect, it } from "vitest";
import { assessRoyalty, nextPayout, nextPayoutDate } from "../../src/domain/payout";

const d = (s: string) => new Date(`${s}T00:00:00.000Z`);
const iso = (x: Date) => x.toISOString().slice(0, 10);

describe("nextPayoutDate (quarter end + 45 days, earliest on/after today)", () => {
  it.each([
    ["2026-10-21", "2026-11-14"], // Sep 30 + 45
    ["2026-11-14", "2026-11-14"], // on the day itself counts
    ["2026-11-15", "2027-02-14"], // Dec 31 + 45 crosses the year
    ["2026-01-01", "2026-02-14"], // previous year's Q4 payout
    ["2026-02-15", "2026-05-15"], // Mar 31 + 45
    ["2026-05-16", "2026-08-14"], // Jun 30 + 45
    ["2028-02-14", "2028-02-14"], // leap year does not shift Feb 14
    ["2026-12-31", "2027-02-14"],
  ])("today %s -> %s", (today, expected) => {
    expect(iso(nextPayoutDate(d(today)))).toBe(expected);
  });

  it("ignores time of day", () => {
    expect(iso(nextPayoutDate(new Date("2026-11-14T23:59:59Z")))).toBe("2026-11-14");
  });

  it("labels the quarter the payout covers", () => {
    expect(nextPayout(d("2026-10-21")).covers).toBe("Jul–Sep 2026");
    expect(nextPayout(d("2026-11-20")).covers).toBe("Oct–Dec 2026");
  });
});

describe("assessRoyalty", () => {
  const today = d("2026-10-21"); // last scheduled payout: 2026-08-14 (for Apr–Jun)

  it("flags pending below the ₹1,000 threshold as rolling over, not overdue", () => {
    const r = assessRoyalty({ royaltyPending: 850, lastRoyaltyPayoutDate: null, publicationDate: d("2024-11-05") }, today);
    expect(r.belowThreshold).toBe(true);
    expect(r.payoutReviewNeeded).toBe(false);
  });

  it("flags a never-paid book above the threshold for payout review", () => {
    const r = assessRoyalty({ royaltyPending: 2546, lastRoyaltyPayoutDate: null, publicationDate: d("2024-07-05") }, today);
    expect(r.payoutReviewNeeded).toBe(true);
    expect(r.reviewReason).toMatch(/no payout has ever been recorded/);
  });

  it("does not flag a book paid since the last payout cycle", () => {
    const r = assessRoyalty(
      { royaltyPending: 3000, lastRoyaltyPayoutDate: d("2026-08-14"), publicationDate: d("2023-01-01") },
      today,
    );
    expect(r.payoutReviewNeeded).toBe(false);
  });

  it("does not flag books published after the last cycle closed", () => {
    const r = assessRoyalty({ royaltyPending: 5000, lastRoyaltyPayoutDate: null, publicationDate: d("2026-08-01") }, today);
    expect(r.payoutReviewNeeded).toBe(false);
  });

  it("handles in-production books (nothing pending, no dates)", () => {
    const r = assessRoyalty({ royaltyPending: 0, lastRoyaltyPayoutDate: null, publicationDate: null }, today);
    expect(r).toMatchObject({ belowThreshold: false, payoutReviewNeeded: false });
  });
});
