/**
 * Page /widget/[slug] : le parcours d'essai de l'onboarding (`testBooking=<jeton>`)
 * n'est pas compté dans les statistiques et n'enregistre aucune réservation.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

const mocks = vi.hoisted(() => ({
  fetchWidgetRestaurant: vi.fn(),
  trackEventAsync: vi.fn(),
  bookingWidget: vi.fn((_props: { testBookingToken?: string }) => null),
}));

vi.mock('@/lib/api-client', () => ({ fetchWidgetRestaurant: mocks.fetchWidgetRestaurant }));
vi.mock('@/lib/tracking', () => ({ trackEventAsync: mocks.trackEventAsync }));
vi.mock('@/components/booking-widget', () => ({ BookingWidget: mocks.bookingWidget }));
vi.mock('next/navigation', () => ({
  notFound: () => {
    throw new Error('NEXT_NOT_FOUND');
  },
}));

import WidgetPage from './page';

async function markup(searchParams: Record<string, string>) {
  const page = await WidgetPage({
    params: Promise.resolve({ slug: 'chez-sokar' }),
    searchParams: Promise.resolve(searchParams),
  });
  return renderToStaticMarkup(page);
}

describe('page widget : réservation test', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.fetchWidgetRestaurant.mockResolvedValue({
      id: 'r1',
      slug: 'chez-sokar',
      name: 'Chez Sokar',
      city: 'Lyon',
    });
  });

  const token = `${'a'.repeat(27)}.${'b'.repeat(43)}`;

  it('passe le jeton au widget, sans compter la visite', async () => {
    const html = await markup({ testBooking: token, marketingAttributionToken: 'x'.repeat(40) });
    expect(mocks.trackEventAsync).not.toHaveBeenCalled();
    expect(mocks.bookingWidget.mock.calls[0][0].testBookingToken).toBe(token);
    expect(html).toContain(
      `href="/restaurant/chez-sokar?testBooking=${encodeURIComponent(token)}"`,
    );
  });

  it('reste en mode test avec une valeur mal formée, transmise telle quelle', async () => {
    const html = await markup({ testBooking: '1' });
    expect(mocks.trackEventAsync).not.toHaveBeenCalled();
    expect(mocks.bookingWidget.mock.calls[0][0].testBookingToken).toBe('1');
    expect(html).toContain('href="/restaurant/chez-sokar?testBooking=1"');
  });

  it.each([
    ['vide', ''],
    ['de plus de 100 caractères', 'a'.repeat(101)],
  ])('refuse une valeur %s sans revenir au parcours réel', async (_label, value) => {
    const html = await markup({ testBooking: value });
    expect(mocks.trackEventAsync).not.toHaveBeenCalled();
    expect(mocks.bookingWidget.mock.calls[0][0].testBookingToken).toBe('invalid');
    expect(html).toContain('href="/restaurant/chez-sokar?testBooking=invalid"');
  });

  it('compte la visite et garde le parcours normal sans le paramètre', async () => {
    const html = await markup({});
    expect(mocks.trackEventAsync).toHaveBeenCalledOnce();
    expect(mocks.bookingWidget.mock.calls[0][0].testBookingToken).toBeUndefined();
    expect(html).toContain('href="/restaurant/chez-sokar"');
  });
});
