import seedData from '@seed/bookleaf_sample_data.json';
import type { Book, Category, Priority, TicketStatus } from '@/api/types';
import type { MockDb, MockTicket, MockUser } from './db';

interface SeedBook {
  book_id: string;
  title: string;
  isbn: string;
  genre: string;
  publication_date: string | null;
  status: string;
  mrp: number | null;
  total_copies_sold: number;
  total_royalty_earned: number;
  royalty_paid: number;
  royalty_pending: number;
  last_royalty_payout_date: string | null;
  print_partner: string | null;
  available_on: string[];
}
interface SeedAuthor {
  author_id: string;
  name: string;
  email: string;
  books: SeedBook[];
}

const toBook = (b: SeedBook): Book => ({
  id: b.book_id,
  title: b.title,
  isbn: b.isbn,
  genre: b.genre,
  publicationDate: b.publication_date,
  status: b.status,
  mrp: b.mrp,
  totalCopiesSold: b.total_copies_sold,
  totalRoyaltyEarned: b.total_royalty_earned,
  royaltyPaid: b.royalty_paid,
  royaltyPending: b.royalty_pending,
  lastRoyaltyPayoutDate: b.last_royalty_payout_date,
  printPartner: b.print_partner,
  availableOn: b.available_on ?? [],
});

export const ADMINS: MockUser[] = [
  { id: 'ADM001', name: 'Neha Gupta', email: 'admin1@bookleaf.com', role: 'ADMIN' },
  { id: 'ADM002', name: 'Rahul Verma', email: 'admin2@bookleaf.com', role: 'ADMIN' },
];

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

interface TicketSpec {
  authorId: string;
  bookId: string | null;
  subject: string;
  description: string;
  status: TicketStatus;
  category: Category;
  priority: Priority;
  age: number;
  ai?: { category: Category; priority: Priority; reasoning: string } | 'FAILED';
  assigneeId?: string;
  attachments?: { name: string; size: number }[];
  thread?: { from: 'AUTHOR' | 'ADMIN'; body: string; after: number; adminId?: string }[];
  notes?: { adminId: string; body: string; after: number }[];
}

const SPECS: TicketSpec[] = [
  {
    authorId: 'AUTH006',
    bookId: 'BK010',
    subject: "Haven't received any royalty for over 6 months",
    description:
      'Turban Tales has been live since September 2024 and has sold 88 copies, but I have not received a single royalty payment. My bank details are linked in the dashboard. Can someone please tell me what is happening?',
    status: 'IN_PROGRESS',
    category: 'ROYALTY_PAYMENTS',
    priority: 'CRITICAL',
    age: 2 * DAY,
    assigneeId: 'ADM002',
    ai: {
      category: 'ROYALTY_PAYMENTS',
      priority: 'CRITICAL',
      reasoning: 'Author reports no royalty for 6+ months on a live book with sales; possible missed payout cycles.',
    },
    notes: [{ adminId: 'ADM002', body: 'Pending ₹2,464 crossed the threshold last quarter. Checking with finance why it was skipped.', after: 3 * HOUR }],
  },
  {
    authorId: 'AUTH002',
    bookId: 'BK003',
    subject: 'Amazon shows a different ISBN than my printed copy',
    description:
      'The Amazon India listing for Code & Karma shows an ISBN ending in -03-6, but the physical copies I received show 978-93-5XXXX-03-5. Readers are confused and I am worried sales are being split across two listings.',
    status: 'OPEN',
    category: 'ISBN_METADATA',
    priority: 'CRITICAL',
    age: 26 * HOUR,
    ai: {
      category: 'ISBN_METADATA',
      priority: 'CRITICAL',
      reasoning: 'ISBN mismatch between retailer listing and printed copy is a data integrity issue the policy escalates.',
    },
  },
  {
    authorId: 'AUTH003',
    bookId: 'BK005',
    subject: 'No royalty received since publication',
    description:
      'My book was published in July 2024 and I still have not received any royalty. The dashboard shows ₹2,546 pending. What is going on?',
    status: 'OPEN',
    category: 'ROYALTY_PAYMENTS',
    priority: 'HIGH',
    age: 5 * DAY,
    ai: {
      category: 'ROYALTY_PAYMENTS',
      priority: 'HIGH',
      reasoning: 'Pending royalty above the ₹1,000 threshold with no payout since publication.',
    },
  },
  {
    authorId: 'AUTH005',
    bookId: 'BK008',
    subject: 'Blurry images and misaligned pages in author copies',
    description:
      'I received 20 author copies of Cardamom & Chaos last week. The recipe photos are blurry and several pages in chapter 4 are misaligned. I have a launch event in two weeks.',
    status: 'IN_PROGRESS',
    category: 'PRINTING_QUALITY',
    priority: 'HIGH',
    age: 4 * DAY,
    assigneeId: 'ADM001',
    attachments: [
      { name: 'chapter4-misaligned.jpg', size: 482_133 },
      { name: 'blurry-photo-p62.jpg', size: 351_870 },
    ],
    ai: {
      category: 'PRINTING_QUALITY',
      priority: 'HIGH',
      reasoning: 'Print defects reported with a time-sensitive launch event.',
    },
    thread: [
      {
        from: 'ADMIN',
        adminId: 'ADM001',
        after: 5 * HOUR,
        body: "Hi Meera, I'm really sorry the copies arrived like this, especially with your launch coming up. Thank you for the photos. They clearly show the misalignment. Could you also share a photo of the printer's mark on the last page? Once verified we'll arrange a free reprint, which takes 5–7 business days.",
      },
      { from: 'AUTHOR', after: 9 * HOUR, body: 'Thank you Neha. The last page says Repro India, batch RI-2291.' },
    ],
    notes: [{ adminId: 'ADM001', body: 'Repro India batch RI-2291. Asked them to confirm whether other titles are affected.', after: 10 * HOUR }],
  },
  {
    authorId: 'AUTH009',
    bookId: 'BK015',
    subject: 'Still in typesetting after 3 weeks',
    description:
      "It's been 3 weeks and Raising Roots is still showing Typesetting. When will it be done? I was hoping to launch before Diwali.",
    status: 'OPEN',
    category: 'BOOK_STATUS_PRODUCTION',
    priority: 'MEDIUM',
    age: 6 * DAY,
    ai: {
      category: 'BOOK_STATUS_PRODUCTION',
      priority: 'MEDIUM',
      reasoning: 'Production timeline question; author has a soft launch deadline but nothing is broken.',
    },
  },
  {
    authorId: 'AUTH004',
    bookId: 'BK007',
    subject: "Book shows 'Currently Unavailable' on Amazon",
    description: 'The Last Monsoon is published but Amazon India shows Currently Unavailable since yesterday.',
    status: 'OPEN',
    category: 'DISTRIBUTION_AVAILABILITY',
    priority: 'MEDIUM',
    age: 2 * DAY,
    ai: {
      category: 'GENERAL_INQUIRY',
      priority: 'MEDIUM',
      reasoning: 'Availability question; unclear whether the listing or stock is affected.',
    },
  },
  {
    authorId: 'AUTH007',
    bookId: 'BK013',
    subject: 'Cover design approval',
    description: 'I sent my feedback on the second cover concept for Midnight in Mysore on Monday. Has the designer seen it?',
    status: 'OPEN',
    category: 'GENERAL_INQUIRY',
    priority: 'MEDIUM',
    age: 20 * HOUR,
    ai: 'FAILED',
  },
  {
    authorId: 'AUTH001',
    bookId: null,
    subject: 'Can I update my author bio?',
    description: 'I would like to update the author bio that appears on my book pages. Is that possible after the books are live?',
    status: 'OPEN',
    category: 'GENERAL_INQUIRY',
    priority: 'LOW',
    age: 3 * HOUR,
    ai: { category: 'GENERAL_INQUIRY', priority: 'LOW', reasoning: 'Routine metadata request with no urgency.' },
  },
  {
    authorId: 'AUTH001',
    bookId: 'BK001',
    subject: 'Royalty amount seems too low',
    description: 'I sold 342 copies of Whispers of the Ganges but only ₹8,400 has been paid out. Can you explain the calculation?',
    status: 'RESOLVED',
    category: 'ROYALTY_PAYMENTS',
    priority: 'MEDIUM',
    age: 12 * DAY,
    assigneeId: 'ADM001',
    ai: {
      category: 'ROYALTY_PAYMENTS',
      priority: 'MEDIUM',
      reasoning: 'Royalty calculation question rather than a missed payment.',
    },
    thread: [
      {
        from: 'ADMIN',
        adminId: 'ADM001',
        after: 20 * HOUR,
        body: "Hi Priya, thanks for asking. Happy to walk you through it. Your total royalty earned so far is ₹11,970 (₹35 per copy × 342 copies). ₹8,400 has been paid and ₹3,570 is pending for the current quarter, which will be paid within 45 days of the quarter ending. I've attached a line-by-line breakdown to your dashboard. Let me know if anything doesn't add up.",
      },
      { from: 'AUTHOR', after: 2 * DAY, body: 'That makes sense now, thank you!' },
    ],
  },
  {
    authorId: 'AUTH010',
    bookId: 'BK018',
    subject: 'When will I get my first payout?',
    description: 'Howrah Nights went live in January. When can I expect my first royalty payment?',
    status: 'OPEN',
    category: 'ROYALTY_PAYMENTS',
    priority: 'MEDIUM',
    age: 40 * 60_000,
    ai: { category: 'ROYALTY_PAYMENTS', priority: 'MEDIUM', reasoning: 'First-payout timing question.' },
  },
  {
    authorId: 'AUTH002',
    bookId: 'BK004',
    subject: 'Listing on Amazon UK',
    description: 'Is Startup Sutra available on Amazon UK yet?',
    status: 'RESOLVED',
    category: 'DISTRIBUTION_AVAILABILITY',
    priority: 'LOW',
    age: 9 * DAY,
    assigneeId: 'ADM002',
    ai: { category: 'DISTRIBUTION_AVAILABILITY', priority: 'LOW', reasoning: 'Availability check with no reported problem.' },
    thread: [{ from: 'ADMIN', adminId: 'ADM002', after: 6 * HOUR, body: 'Hi Rohit, yes. Startup Sutra is live on Amazon UK. Happy selling!' }],
  },
  {
    authorId: 'AUTH008',
    bookId: 'BK014',
    subject: 'Update book description on Amazon',
    description: 'Can I update the description of Ghazal of the Forgotten on Amazon after it is already live?',
    status: 'CLOSED',
    category: 'GENERAL_INQUIRY',
    priority: 'LOW',
    age: 20 * DAY,
    assigneeId: 'ADM001',
    ai: { category: 'GENERAL_INQUIRY', priority: 'LOW', reasoning: 'Routine metadata update request.' },
    thread: [
      {
        from: 'ADMIN',
        adminId: 'ADM001',
        after: 4 * HOUR,
        body: 'Hi Farhan, yes. Send us the new description and we will submit it. Changes typically reflect within 3–5 business days.',
      },
    ],
  },
];

export function buildSeedDb(now = Date.now()): MockDb {
  const authors = (seedData as { authors: SeedAuthor[] }).authors;
  const users: MockUser[] = [
    ...authors.map((a): MockUser => ({ id: a.author_id, name: a.name, email: a.email, role: 'AUTHOR' })),
    ...ADMINS,
  ];
  const books: MockDb['books'] = {};
  for (const a of authors) books[a.author_id] = a.books.map(toBook);

  const adminName = (id?: string) => ADMINS.find((x) => x.id === id)?.name ?? 'BookLeaf Support';
  let seq = 0;
  const tickets: MockTicket[] = SPECS.map((s, i) => {
    const created = now - s.age;
    const iso = (offset: number) => new Date(created + offset).toISOString();
    const author = users.find((u) => u.id === s.authorId)!;
    const messages = (s.thread ?? []).map((m) => ({
      id: `m-${++seq}`,
      senderType: m.from,
      senderName: m.from === 'ADMIN' ? adminName(m.adminId) : author.name,
      body: m.body,
      createdAt: iso(m.after),
    }));
    const lastActivity = Math.max(0, ...(s.thread ?? []).map((m) => m.after), ...(s.notes ?? []).map((n) => n.after));
    const failed = s.ai === 'FAILED';
    const ai = s.ai && s.ai !== 'FAILED' ? s.ai : null;
    return {
      id: `t-${1001 + i}`,
      ticketNumber: `BL-${1001 + i}`,
      authorId: s.authorId,
      bookId: s.bookId,
      subject: s.subject,
      description: s.description,
      status: s.status,
      attachments: s.attachments ?? [],
      messages,
      createdAt: iso(0),
      updatedAt: iso(lastActivity),
      category: s.category,
      priority: s.priority,
      aiStatus: failed ? 'FAILED' : 'DONE',
      aiSuggestion: ai,
      categoryOverridden: !!ai && ai.category !== s.category,
      priorityOverridden: !!ai && ai.priority !== s.priority,
      assigneeId: s.assigneeId ?? null,
      internalNotes: (s.notes ?? []).map((n) => ({
        id: `n-${++seq}`,
        adminName: adminName(n.adminId),
        body: n.body,
        createdAt: iso(n.after),
      })),
      draft: null,
    };
  });

  return { version: 1, users, books, tickets, seq: 2000 };
}
