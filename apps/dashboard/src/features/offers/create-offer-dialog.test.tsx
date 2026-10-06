import { fireEvent, render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { describe, expect, it, vi } from 'vitest';
import messages from '../../../messages/fr.json';
import { CreateOfferDialog } from './create-offer-dialog';

describe('CreateOfferDialog', () => {
  it('propose les trois formulaires de création et ferme le choix lors d’une sélection', () => {
    const onOpenChange = vi.fn();
    render(
      <NextIntlClientProvider locale="fr" messages={messages}>
        <CreateOfferDialog open onOpenChange={onOpenChange} />
      </NextIntlClientProvider>,
    );
    expect(screen.getByRole('dialog', { name: 'Que souhaitez-vous créer ?' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Créer une expérience/ })).toHaveAttribute(
      'href',
      '/dashboard/experiences?create=1',
    );
    expect(screen.getByRole('link', { name: /Créer un événement/ })).toHaveAttribute(
      'href',
      '/dashboard/events?create=1',
    );
    const giftCardLink = screen.getByRole('link', { name: /Créer une carte cadeau/ });
    expect(giftCardLink).toHaveAttribute('href', '/dashboard/gift-cards?create=1');
    fireEvent.click(giftCardLink);
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});
