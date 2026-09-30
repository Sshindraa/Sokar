import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { GiftCardBeneficiaryPage } from '../gift-card-beneficiary';
import { getGiftCardBeneficiary } from '@/lib/api/gift-cards';
vi.mock('@/lib/api/gift-cards', () => ({ getGiftCardBeneficiary: vi.fn() }));
const card = {
  displayCode: 'SKR-TEST-01',
  amount: 100,
  remainingAmount: 75,
  expiresAt: null,
  status: 'ACTIVE',
  usable: true,
  restaurantName: 'Restaurant test',
  restaurantSlug: 'test-resto',
  packName: null,
};
describe('gift card beneficiary', () => {
  beforeEach(() => vi.clearAllMocks());
  it('links to a booking with the gift code and explains payment at the restaurant', async () => {
    vi.mocked(getGiftCardBeneficiary).mockResolvedValue(card);
    render(<GiftCardBeneficiaryPage code="SKR-TEST-01" />);
    expect(await screen.findByRole('link', { name: 'Réserver une table' })).toHaveAttribute(
      'href',
      '/widget/test-resto?giftCardCode=SKR-TEST-01',
    );
    expect(screen.getByText(/sans débiter son solde/)).toBeInTheDocument();
  });
  it('does not offer booking with a frozen gift card', async () => {
    vi.mocked(getGiftCardBeneficiary).mockResolvedValue({
      ...card,
      status: 'REFUND_PENDING',
      usable: false,
    });
    render(<GiftCardBeneficiaryPage code="SKR-TEST-01" />);
    expect(await screen.findByText(/ne peut pas être utilisée/)).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Réserver une table' })).not.toBeInTheDocument();
  });
});
