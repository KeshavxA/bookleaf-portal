import { assessRoyalty, MIN_PAYOUT_THRESHOLD_INR } from "../../domain/payout";
import { formatHumanDate } from "../../lib/dates";
import type { Category } from "../../domain/enums";
import { isInProduction, productionStage } from "./facts";
import type { DraftContext } from "./types";

/**
 * The points a reply should cover, per category, taken only from the KB's
 * "How to answer" guidance (src/ai/kb/*.md). One definition feeds two places:
 *   - the prompt's <focus> note lists the points that apply to this ticket
 *   - `npm run ai:eval` checks each applicable point with a simple keyword test
 *
 * The keyword tests are deliberately simple and documented next to each point. They
 * catch a missing point, not a badly made one: a match says the words are there,
 * not that the sentence is good.
 */
export interface RequiredPoint {
  /** Short id shown in the eval table. */
  id: string;
  /** What the prompt asks for. */
  instruction: string;
  /** False when the point does not apply to this ticket (it is then neither asked for nor checked). */
  applies?: (ctx: DraftContext) => boolean;
  /** Keyword test on the draft text; documented in `checkDescription`. */
  check: (draft: string, ctx: DraftContext) => boolean;
  checkDescription: string;
}

const today = (ctx: DraftContext) => ctx.today ?? new Date();
const royalty = (ctx: DraftContext) => (ctx.book && !isInProduction(ctx.book.status) ? assessRoyalty(ctx.book, today(ctx)) : null);
/** "24-48", "24 to 48", "24–48" */
const range = (a: number, b: number) => new RegExp(`\\b${a}\\s*(?:-|–|to)\\s*${b}\\b`, "i");

const ACKNOWLEDGE = /\b(understand|sorry|apologi[sz]e|frustrat\w*|concern\w*|thank you for)\b/i;
const METADATA_TOPIC = /\b(description|blurb|bio|biography|photo|metadata|author name|subtitle|keywords?)\b/i;

/** Body paragraphs after the greeting line. */
function firstBodyParagraphs(draft: string, n: number): string {
  return draft.replace(/^Hi\b[^\n]*\n+/, "").split(/\n{2,}/).slice(0, n).join("\n\n");
}

export const REQUIRED_POINTS: Record<Category, RequiredPoint[]> = {
  ROYALTY_PAYMENTS: [
    {
      id: "ack",
      instruction: "Acknowledge the author's concern first.",
      check: (d) => ACKNOWLEDGE.test(d),
      checkDescription: "understand | sorry | apologise | frustrat* | concern* | thank you for",
    },
    {
      id: "cycle",
      instruction: "Explain that royalties are calculated quarterly and paid within 45 days of the quarter ending.",
      check: (d) => /quarter/i.test(d) && /\b45 days\b/i.test(d),
      checkDescription: '"quarter" and "45 days"',
    },
    {
      id: "date",
      instruction: "Give the next scheduled payout date from FACTS.",
      applies: (ctx) => royalty(ctx) !== null,
      check: (d, ctx) => d.includes(formatHumanDate(royalty(ctx)!.next.payoutDate)),
      checkDescription: "the computed next payout date, e.g. \"14 Nov 2026\"",
    },
    {
      id: "rollover",
      instruction: `Explain that the pending amount is under ₹${MIN_PAYOUT_THRESHOLD_INR.toLocaleString("en-IN")} and rolls over to the next quarter.`,
      applies: (ctx) => royalty(ctx)?.belowThreshold === true && (ctx.book?.royaltyPending ?? 0) > 0,
      check: (d) => /\broll(s|ed|ing)?[ -]?over\b/i.test(d),
      checkDescription: '"roll over" / "rolls over"',
    },
    {
      id: "bank",
      instruction: "Ask the author once to confirm their bank details in the dashboard.",
      applies: (ctx) => ctx.author.bankLinked !== true,
      check: (d) => /\bbank (details|account)\b/i.test(d),
      checkDescription: '"bank details" or "bank account" (the separate "bank once" check caps it at one)',
    },
    {
      id: "48h",
      instruction: "Say the team is checking this payment and will update the author within 48 hours.",
      applies: (ctx) => royalty(ctx)?.payoutReviewNeeded === true,
      check: (d) => /\b48 hours\b/i.test(d),
      checkDescription: '"48 hours"',
    },
  ],
  ISBN_METADATA: [
    {
      id: "serious",
      instruction: "Treat it as a serious issue that is BookLeaf's responsibility.",
      check: (d) => /\b(serious|priority|responsibility)\b/i.test(d),
      checkDescription: "serious | priority | responsibility",
    },
    {
      id: "escalate",
      instruction: "Say it is being escalated to the production team now.",
      check: (d) => /\bescalat\w*/i.test(d) && /\bproduction team\b/i.test(d),
      checkDescription: '"escalat*" and "production team"',
    },
    {
      id: "48h",
      instruction: "Give a 48-hour timeline.",
      check: (d) => /\b48 hours\b/i.test(d),
      checkDescription: '"48 hours"',
    },
  ],
  PRINTING_QUALITY: [
    {
      id: "sorry",
      instruction: "Apologise sincerely.",
      check: (d) => /\b(sorry|apologi[sz]e)\b/i.test(d),
      checkDescription: "sorry | apologise | apologize",
    },
    {
      id: "photos",
      instruction: "Ask for photos of the defective copies.",
      check: (d) => /\bphotos?\b/i.test(d),
      checkDescription: '"photo" / "photos"',
    },
    {
      id: "reprint",
      instruction: "Say BookLeaf arranges a free reprint once the defect is verified.",
      check: (d) => /\breprint\b/i.test(d) && /\b(free|no cost|no charge)\b/i.test(d),
      checkDescription: '"reprint" and free | no cost | no charge',
    },
    {
      id: "5-7d",
      instruction: "Give 5 to 7 business days for the reprint.",
      check: (d) => range(5, 7).test(d) && /business days/i.test(d),
      checkDescription: '"5-7" / "5 to 7" and "business days"',
    },
  ],
  DISTRIBUTION_AVAILABILITY: [
    {
      id: "sync",
      instruction: "Explain that this is usually a stock sync issue.",
      check: (d) => /\bstock[ -]?sync\b/i.test(d) || /\bsync(ing|hroni[sz]ation)? issue\b/i.test(d),
      checkDescription: '"stock sync" or "sync issue"',
    },
    {
      id: "resync",
      instruction: "Say a re-sync is being triggered with the distribution team.",
      check: (d) => /\bre-?sync\w*/i.test(d) && /\bdistribution team\b/i.test(d),
      checkDescription: '"re-sync"/"resync" and "distribution team"',
    },
    {
      id: "24-48h",
      instruction: "Give 24 to 48 hours for the listing to be live again.",
      check: (d) => range(24, 48).test(d) && /hours/i.test(d),
      checkDescription: '"24-48" / "24 to 48" and "hours"',
    },
  ],
  BOOK_STATUS_PRODUCTION: [
    {
      id: "status",
      instruction: "State the book's actual current status or stage from FACTS.",
      applies: (ctx) => ctx.book !== null,
      check: (d, ctx) => d.toLowerCase().includes((productionStage(ctx.book!.status) ?? ctx.book!.status).toLowerCase()),
      checkDescription: 'the stage or status from FACTS, e.g. "Cover Design"',
    },
    {
      id: "no-blame",
      instruction: "If there is a delay, be honest about it without blaming the author.",
      check: (d) => !/\b(your fault|because you|you (didn'?t|did not|haven'?t|have not|failed to|forgot))\b/i.test(d),
      checkDescription: 'NEGATIVE test: fails on "your fault", "because you", "you didn\'t/haven\'t/failed to". Weak: cannot see a missing explanation',
    },
    {
      id: "timeline",
      instruction: "Give a specific timeline for the next update (48 hours if FACTS have no completion date).",
      check: (d) => /\b48 hours\b|\bwithin \d+(\s*(-|–|to)\s*\d+)? (business )?days\b|\bby \d{1,2} [A-Z][a-z]{2} \d{4}\b/i.test(d),
      checkDescription: '"48 hours", "within N (business) days" or "by 14 Nov 2026"',
    },
  ],
  GENERAL_INQUIRY: [
    {
      id: "direct",
      instruction: "Answer the question directly from POLICY.",
      check: (d) => /\b(yes|no|you can|can be|is possible|is not possible)\b/i.test(firstBodyParagraphs(d, 2)),
      checkDescription: 'weak: "yes", "no", "you can", "can be", "is possible" in the first two body paragraphs',
    },
    {
      id: "channels",
      instruction: "Metadata updates (description, bio, photo) go through the dashboard or by emailing the BookLeaf team.",
      applies: (ctx) => METADATA_TOPIC.test(`${ctx.ticket.subject}\n${ctx.ticket.description}`),
      check: (d) => /\bdashboard\b/i.test(d) && /\be-?mail/i.test(d),
      checkDescription: '"dashboard" and "email" (only for description/bio/photo/metadata questions)',
    },
    {
      id: "3-5d",
      instruction: "Changes reflect on the platforms within 3 to 5 business days.",
      applies: (ctx) => METADATA_TOPIC.test(`${ctx.ticket.subject}\n${ctx.ticket.description}`),
      check: (d) => range(3, 5).test(d) && /business days/i.test(d),
      checkDescription: '"3-5" / "3 to 5" and "business days" (only for metadata questions)',
    },
  ],
};

/** The points that apply to this ticket, in order. */
export function applicablePoints(ctx: DraftContext): RequiredPoint[] {
  return REQUIRED_POINTS[ctx.ticket.category].filter((p) => !p.applies || p.applies(ctx));
}

export interface PointResult {
  id: string;
  covered: boolean;
}

export function checkRequiredPoints(draft: string, ctx: DraftContext): PointResult[] {
  return applicablePoints(ctx).map((p) => ({ id: p.id, covered: p.check(draft, ctx) }));
}
