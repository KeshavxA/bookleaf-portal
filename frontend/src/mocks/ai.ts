import type { Book, Category, Draft, Priority } from '@/api/types';
import type { MockTicket } from './db';
import { findBook, findUser } from './db';

// Deterministic stand-ins for the backend's LLM calls, so the UI can be exercised offline.
// The real classification and drafting live in the backend; the frontend never calls an LLM.

const RULES: { category: Category; pattern: RegExp }[] = [
  { category: 'ISBN_METADATA', pattern: /\bisbn\b|metadata|wrong (book|author)|listing details/i },
  { category: 'ROYALTY_PAYMENTS', pattern: /royalt|payout|payment|paid|bank|earning/i },
  { category: 'PRINTING_QUALITY', pattern: /print|blur|misalign|binding|quality|defect|copies arrived/i },
  { category: 'DISTRIBUTION_AVAILABILITY', pattern: /unavailable|amazon|flipkart|listing|out of stock|available/i },
  { category: 'BOOK_STATUS_PRODUCTION', pattern: /typesetting|cover design|proofread|production|editing|stage/i },
];

export function classify(t: Pick<MockTicket, 'subject' | 'description'>) {
  const text = `${t.subject} ${t.description}`;
  const category = RULES.find((r) => r.pattern.test(text))?.category ?? 'GENERAL_INQUIRY';

  let priority: Priority = 'MEDIUM';
  if (/(\d+|six|several)\s*months?/i.test(text) && /not|haven'?t|never|no /i.test(text) && category === 'ROYALTY_PAYMENTS')
    priority = 'CRITICAL';
  else if (category === 'ISBN_METADATA' || category === 'PRINTING_QUALITY') priority = 'HIGH';
  else if (/urgent|asap|launch|immediately/i.test(text)) priority = 'HIGH';
  else if (/bio|description|update|can i|how do i/i.test(text) && category === 'GENERAL_INQUIRY') priority = 'LOW';

  const reasoning =
    priority === 'CRITICAL'
      ? 'Author reports a prolonged missing payment; financial impact and trust risk warrant immediate attention.'
      : priority === 'HIGH'
        ? 'Issue affects the book itself (data or print quality) and the knowledge base treats it as high priority.'
        : priority === 'LOW'
          ? 'Routine informational request with no time pressure.'
          : 'Standard query that needs a specific, timely answer but nothing is broken.';
  return { category, priority, reasoning };
}

function nextPayoutDate(from = new Date()) {
  // Quarterly cycle, paid within 45 days of the quarter ending.
  const q = Math.floor(from.getMonth() / 3);
  const quarterEnd = new Date(from.getFullYear(), q * 3 + 3, 0);
  const payout = new Date(quarterEnd.getTime() + 45 * 86_400_000);
  return payout.toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' });
}

const inr = (n: number) => `₹${n.toLocaleString('en-IN')}`;

function body(t: MockTicket, book: Book | null): string {
  const title = book ? `“${book.title}”` : 'your book';
  switch (t.category) {
    case 'ROYALTY_PAYMENTS':
      return [
        `I completely understand how frustrating it is to wait on a royalty payment, and I want to get you a clear answer.`,
        book
          ? `For ${title}, our records show ${inr(book.totalRoyaltyEarned)} earned to date, ${inr(book.royaltyPaid)} paid and ${inr(book.royaltyPending)} pending${book.lastRoyaltyPayoutDate ? `, with the last payout on ${book.lastRoyaltyPayoutDate}` : ''}.`
          : `Royalties are calculated quarterly and paid within 45 days of each quarter ending.`,
        `Royalties are calculated quarterly and paid within 45 days of the quarter ending, provided the balance is above the ₹1,000 threshold. Based on that, your next payout is due by ${nextPayoutDate()}.`,
        `Could you confirm that your bank account is linked in your dashboard? If everything is in order and the payment is overdue, I'll escalate this to our finance team today and update you within 48 hours.`,
      ].join('\n\n');
    case 'ISBN_METADATA':
      return `Thank you for flagging this. An ISBN mismatch is a serious data issue and I'm treating it as high priority.\n\nI've escalated ${title} to our production team so they can correct the listing. You'll hear back from us within 48 hours with confirmation that the records match.`;
    case 'PRINTING_QUALITY':
      return `I'm really sorry the copies of ${title} arrived in this condition. That's not the standard we hold ourselves to.\n\nCould you share a few photos of the affected pages? Once we've verified the defect we'll arrange a free reprint, which takes 5–7 business days from confirmation.`;
    case 'DISTRIBUTION_AVAILABILITY':
      return `Thanks for letting us know. When a live book shows as unavailable, it's usually a stock sync issue between our warehouse and the platform.\n\nI've asked our distribution team to trigger a re-sync for ${title}. It should be back on sale within 24–48 hours, and I'll confirm here once it is.`;
    case 'BOOK_STATUS_PRODUCTION':
      return `Thank you for checking in on ${title}. I know how much you're looking forward to seeing it published.\n\nIt is currently at the ${book?.status.replace(/^In Production - /i, '') ?? 'current'} stage. I'm confirming the exact timeline with our production team and will update you within 48 hours with a specific date for the next stage.`;
    default:
      return `Thanks for reaching out! Yes, this is something we can help with. Metadata updates can be submitted through your dashboard or by replying here with the changes, and they typically reflect on all platforms within 3–5 business days.\n\nSend over the updated text whenever you're ready and we'll take it from there.`;
  }
}

export function generateDraft(t: MockTicket): Draft {
  const first = findUser(t.authorId)?.name.split(' ')[0] ?? 'there';
  const book = findBook(t.bookId);
  return {
    body: `Hi ${first},\n\n${body(t, book)}\n\nWarm regards,\nBookLeaf Author Support`,
    source: 'AI',
    generatedAt: new Date().toISOString(),
  };
}
