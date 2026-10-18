import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import GiftCardList from './gift-card-list';
import { giftCardPaymentLabel, giftCardStatusLabel } from './gift-card-labels';
import type { GiftCardListItem } from '@/lib/api/gift-cards';

vi.mock('@/lib/useMediaQuery', () => ({ useIsMobile: () => false }));

const crowdfunded = {
  id: 'cf-1',
  code: 'CAGNOTTE-1',
  type: 'CROWDFUNDED',
  occasion: 'Anniversaire de Léa',
  amount: 120,
  remainingAmount: 120,
  status: 'ACTIVE',
  stripePaymentStatus: 'refunded',
  purchasedAt: '2026-09-01T10:00:00.000Z',
  crowdfundedUntil: '2026-10-30T10:00:00.000Z',
  closedAt: null,
  expiresAt: null,
  recipientName: null,
} as unknown as GiftCardListItem;

describe('libellés des cartes cadeaux', () => {
  it('traduit les statuts et paiements, et ne montre jamais une valeur brute inconnue', () => {
    expect(giftCardStatusLabel('REFUND_PENDING')).toBe('Remboursement en cours');
    expect(giftCardStatusLabel('QUELQUE_CHOSE_DE_NOUVEAU')).toBe('À vérifier');
    expect(giftCardPaymentLabel('failed')).toBe('Échoué');
    expect(giftCardPaymentLabel('refunded')).toBe('Remboursé');
    expect(giftCardPaymentLabel('requires_action')).toBe('À vérifier');
  });
});

describe('GiftCardList', () => {
  it('nomme les vraies dates d’une cagnotte : date butoir et clôture, pas achat et expiration', () => {
    render(<GiftCardList items={[crowdfunded]} isCrowdfunding />);

    expect(screen.getByText('Date butoir')).toBeInTheDocument();
    expect(screen.getByText('Clôturée le')).toBeInTheDocument();
    expect(screen.queryByText('Achetée le')).toBeNull();
    expect(screen.getByText('Remboursé')).toBeInTheDocument();
    expect(screen.queryByText('refunded')).toBeNull();
  });

  it('distingue « aucune carte » de « aucun résultat pour cette recherche »', () => {
    const onClear = vi.fn();
    const { rerender } = render(<GiftCardList items={[]} isCrowdfunding={false} />);
    expect(screen.getByText('Aucune carte cadeau pour le moment')).toBeInTheDocument();

    rerender(<GiftCardList items={[]} isCrowdfunding={false} filtered onClearFilters={onClear} />);
    expect(screen.getByText('Aucune carte ne correspond à cette recherche')).toBeInTheDocument();
    screen.getByRole('button', { name: /effacer la recherche/i }).click();
    expect(onClear).toHaveBeenCalled();
  });
});
