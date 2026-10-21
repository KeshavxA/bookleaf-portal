import { screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { Book } from '@/api/types';
import { renderWithProviders } from '@/test/utils';
import { BookCard } from './BookCard';
import { productionStage } from './bookUtils';

const live: Book = {
  id: 'BK005',
  title: 'Between Two Temples',
  isbn: '978-93-5XXXX-05-9',
  genre: 'Literary Fiction',
  publicationDate: '2024-07-05',
  status: 'Published & Live',
  mrp: 425,
  totalCopiesSold: 67,
  totalRoyaltyEarned: 2546,
  royaltyPaid: 0,
  royaltyPending: 2546,
  lastRoyaltyPayoutDate: null,
  printPartner: 'Epitome Books',
  availableOn: ['Amazon India'],
};

const inProduction: Book = {
  ...live,
  id: 'BK013',
  title: 'Midnight in Mysore',
  status: 'In Production - Cover Design',
  publicationDate: null,
  mrp: null,
  totalCopiesSold: 0,
  totalRoyaltyEarned: 0,
  royaltyPending: 0,
  printPartner: null,
  availableOn: [],
};

const value = (label: string) => within(screen.getByText(label).parentElement!).getByRole('definition');

describe('BookCard', () => {
  it('formats money as INR and shows "No payouts yet" for a live book with zero payouts', () => {
    renderWithProviders(<BookCard book={live} />);
    expect(value('MRP')).toHaveTextContent('₹425');
    expect(value('Royalty pending')).toHaveTextContent('₹2,546');
    expect(value('Royalty paid')).toHaveTextContent('No payouts yet');
    expect(value('Last payout')).toHaveTextContent('No payouts yet');
  });

  it('shows the production stage and dashes for fields that do not apply yet', () => {
    renderWithProviders(<BookCard book={inProduction} />);
    expect(screen.getByText('In production · Cover Design')).toBeInTheDocument();
    for (const label of ['Published', 'MRP', 'Copies sold', 'Royalty earned', 'Royalty paid', 'Royalty pending']) {
      expect(value(label)).toHaveTextContent('—');
    }
    expect(screen.queryByText('No payouts yet')).not.toBeInTheDocument();
  });

  it('notes when pending royalty is below the ₹1,000 payout threshold', () => {
    renderWithProviders(<BookCard book={{ ...live, royaltyPending: 850 }} />);
    expect(screen.getByText(/below the ₹1,000 payout threshold/)).toBeInTheDocument();
  });
});

describe('productionStage', () => {
  it.each([
    ['In Production - Typesetting', 'Typesetting'],
    ['In Production - Cover Design', 'Cover Design'],
    ['In Production', 'In production'],
    ['Published & Live', null],
  ])('%s → %s', (status, expected) => {
    expect(productionStage(status)).toBe(expected);
  });
});
