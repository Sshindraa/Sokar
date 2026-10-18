import { ApiError } from '@/lib/api-error';

const POPUP_BLOCKED_MESSAGE = 'Autorisez l’ouverture d’un nouvel onglet pour lancer le test.';
const GENERIC_MESSAGE = 'Le lien de test n’a pas pu être créé. Réessayez.';
const DISABLED_NOTICE =
  'Le mode test n’est pas encore disponible : cette réservation sera réelle. Pensez à l’annuler ensuite.';

/** `error` : rien n'a été ouvert. `notice` : la page s'est ouverte, avec une information à afficher. */
export type TestBookingOutcome = { kind: 'error' | 'notice'; message: string } | null;

/**
 * Ouvre le parcours de réservation test dans un nouvel onglet.
 *
 * L'onglet est ouvert avant l'appel à l'API : après un `await`, les navigateurs ne reconnaissent plus
 * le clic et bloquent la fenêtre. Renvoie `null` si tout s'est bien passé, sinon le message à afficher.
 */
export async function openTestBooking(
  api: { post: (path: string) => Promise<unknown> },
  publicUrl: string,
): Promise<TestBookingOutcome> {
  const tab = window.open('about:blank', '_blank');
  if (!tab) return { kind: 'error', message: POPUP_BLOCKED_MESSAGE };
  tab.opener = null;

  try {
    const response = (await api.post('restaurant/test-booking-link')) as { url?: unknown };
    if (typeof response?.url !== 'string' || !response.url) {
      tab.close();
      return { kind: 'error', message: GENERIC_MESSAGE };
    }
    tab.location.href = response.url;
    return null;
  } catch (error) {
    if (error instanceof ApiError && error.code === 'TEST_BOOKING_DISABLED') {
      // Mode test coupé : la page publique s'ouvre quand même, mais la réservation sera réelle.
      tab.location.href = publicUrl;
      return { kind: 'notice', message: DISABLED_NOTICE };
    }
    tab.close();
    if (error instanceof ApiError && error.code === 'PAGE_NOT_PUBLISHED' && error.message) {
      return { kind: 'error', message: error.message };
    }
    return { kind: 'error', message: GENERIC_MESSAGE };
  }
}
