import { beforeEach, describe, expect, it, vi } from 'vitest';
import { toApiError } from '@/lib/api-error';
import { openTestBooking } from './test-booking';

const PUBLIC_URL = 'https://sokar.tech/restaurant/chez-emile';
const TEST_URL = 'https://sokar.tech/restaurant/chez-emile?testBooking=abc';

function fakeTab() {
  return { opener: 'parent' as unknown, location: { href: 'about:blank' }, close: vi.fn() };
}

describe('openTestBooking', () => {
  let tab: ReturnType<typeof fakeTab>;
  let openSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    tab = fakeTab();
    openSpy = vi.fn(() => tab);
    vi.stubGlobal('open', openSpy);
    window.open = openSpy as unknown as typeof window.open;
  });

  it('ouvre l’onglet avant l’appel, puis y charge le lien de test', async () => {
    const order: string[] = [];
    openSpy.mockImplementation(() => {
      order.push('open');
      return tab;
    });
    const post = vi.fn(async () => {
      order.push('post');
      return { url: TEST_URL };
    });

    const result = await openTestBooking({ post }, PUBLIC_URL);

    expect(result).toBeNull();
    expect(order).toEqual(['open', 'post']);
    expect(openSpy).toHaveBeenCalledWith('about:blank', '_blank');
    expect(post).toHaveBeenCalledWith('restaurant/test-booking-link');
    expect(tab.opener).toBeNull();
    expect(tab.location.href).toBe(TEST_URL);
    expect(tab.close).not.toHaveBeenCalled();
  });

  it('ouvre la page publique quand la fonction est coupée', async () => {
    const post = vi.fn().mockRejectedValue(toApiError(404, { code: 'TEST_BOOKING_DISABLED' }));
    expect(await openTestBooking({ post }, PUBLIC_URL)).toBeNull();
    expect(tab.location.href).toBe(PUBLIC_URL);
    expect(tab.close).not.toHaveBeenCalled();
  });

  it('ferme l’onglet et explique quand la page n’est pas publiée', async () => {
    const post = vi.fn().mockRejectedValue(
      toApiError(409, {
        code: 'PAGE_NOT_PUBLISHED',
        error: 'Publiez d’abord votre page pour la tester.',
      }),
    );
    expect(await openTestBooking({ post }, PUBLIC_URL)).toBe(
      'Publiez d’abord votre page pour la tester.',
    );
    expect(tab.close).toHaveBeenCalled();
  });

  it('ferme l’onglet et renvoie un message simple sur une erreur réseau', async () => {
    const post = vi.fn().mockRejectedValue(new Error('network'));
    expect(await openTestBooking({ post }, PUBLIC_URL)).toBe(
      'Le lien de test n’a pas pu être créé. Réessayez.',
    );
    expect(tab.close).toHaveBeenCalled();
  });

  it('demande d’autoriser les onglets si le navigateur bloque l’ouverture', async () => {
    openSpy.mockReturnValue(null);
    const post = vi.fn();
    expect(await openTestBooking({ post }, PUBLIC_URL)).toBe(
      'Autorisez l’ouverture d’un nouvel onglet pour lancer le test.',
    );
    expect(post).not.toHaveBeenCalled();
  });
});
