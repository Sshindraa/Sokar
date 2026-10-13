import type { Metadata } from 'next';
import { PLAN_PRICES_EUR } from '@sokar/shared';

const SITE_NAME = 'Sokar';

// Les montants viennent du catalogue partagé (HT, comme Stripe) : la description ne peut pas
// diverger des prix réellement facturés.
const PRICING_DESCRIPTION = `Essential ${PLAN_PRICES_EUR.ESSENTIAL} € HT/mois, Pro ${PLAN_PRICES_EUR.PRO} € HT/mois, Multi-site dès ${PLAN_PRICES_EUR.PREMIUM} € HT/mois. Sans engagement en mensuel, -20 % en annuel.`;

function pageMetadata(path: string, title: string, description: string): Metadata {
  return {
    title,
    description,
    alternates: { canonical: path },
    robots: { index: true, follow: true },
    openGraph: {
      title,
      description,
      url: path,
      siteName: SITE_NAME,
      locale: 'fr_FR',
      type: 'website',
    },
  };
}

export const HOME_METADATA = pageMetadata(
  '/',
  'Sokar — Assistant téléphonique pour restaurants',
  'Sokar répond aux appels de votre restaurant, consulte vos disponibilités et enregistre les réservations. Démonstration sur demande.',
);

export const PRICING_METADATA = pageMetadata('/pricing', 'Tarifs — Sokar', PRICING_DESCRIPTION);

export const DEMO_METADATA = pageMetadata(
  '/demo',
  'Demander une démonstration — Sokar',
  "Demandez une démonstration de Sokar pour votre restaurant. Nous vous recontactons par e-mail pour convenir d'un créneau.",
);
