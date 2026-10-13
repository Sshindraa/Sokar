import { PLAN_PRICES_EUR } from '@sokar/shared';

/** Formules publiques, dans l'ordre d'affichage. */
export type PlanLabel = 'Essential' | 'Pro' | 'Multi-site';
export const PLAN_ORDER: readonly PlanLabel[] = ['Essential', 'Pro', 'Multi-site'];

/**
 * « disponible » seulement si la fonctionnalité est livrée et activable pour les comptes de la formule.
 * « prévu » pour tout le reste : affiché comme tel, jamais présenté comme acquis.
 */
export type FeatureStatus = 'disponible' | 'prévu';

export interface CatalogFeature {
  id: string;
  label: string;
  status: FeatureStatus;
  /** Formule à partir de laquelle la fonctionnalité est incluse ; les formules supérieures l'incluent aussi. */
  introducedIn: PlanLabel;
}

/**
 * Source unique des cartes et du tableau de comparaison. L'ordre compte : les fonctionnalités d'une formule
 * sont regroupées derrière celles de la formule inférieure.
 */
export const CATALOG_FEATURES: readonly CatalogFeature[] = [
  {
    id: 'transfer',
    label: 'Répond aux appels transférés',
    status: 'disponible',
    introducedIn: 'Essential',
  },
  {
    id: 'booking',
    label: "Réservations prises pendant l'appel",
    status: 'disponible',
    introducedIn: 'Essential',
  },
  {
    id: 'daily-report',
    label: 'Rapport quotidien de vos appels',
    status: 'disponible',
    introducedIn: 'Essential',
  },
  { id: 'number', label: '1 numéro dédié inclus', status: 'disponible', introducedIn: 'Essential' },
  {
    id: 'google-agenda',
    label: 'Synchronisation Google Agenda',
    status: 'disponible',
    introducedIn: 'Essential',
  },
  {
    id: 'tone',
    label: 'Ton adapté à votre établissement',
    status: 'prévu',
    introducedIn: 'Essential',
  },
  { id: 'no-show', label: 'Suivi des no-shows', status: 'disponible', introducedIn: 'Pro' },
  {
    id: 'ai-booking',
    label: 'Réservation depuis ChatGPT et Claude',
    status: 'prévu',
    introducedIn: 'Pro',
  },
  {
    id: 'pos-sync',
    label: 'Synchronisation ZenChef, TheFork ou Lightspeed',
    status: 'prévu',
    introducedIn: 'Pro',
  },
  {
    id: 'multi-dashboard',
    label: 'Un seul tableau de bord pour tout piloter',
    status: 'disponible',
    introducedIn: 'Multi-site',
  },
  {
    id: 'per-site-agent',
    label: 'Un numéro et un agent par établissement',
    status: 'disponible',
    introducedIn: 'Multi-site',
  },
  {
    id: 'group-invoice',
    label: 'Une seule facture pour tout le groupe',
    status: 'disponible',
    introducedIn: 'Multi-site',
  },
];

const RANK: Record<PlanLabel, number> = { Essential: 0, Pro: 1, 'Multi-site': 2 };

export function planIncludes(plan: PlanLabel, feature: CatalogFeature): boolean {
  return RANK[feature.introducedIn] <= RANK[plan];
}

export function featuresIntroducedIn(plan: PlanLabel): CatalogFeature[] {
  return CATALOG_FEATURES.filter((feature) => feature.introducedIn === plan);
}

export function featuresIncludedIn(plan: PlanLabel): CatalogFeature[] {
  return CATALOG_FEATURES.filter((feature) => planIncludes(plan, feature));
}

const PLAN_KEY: Record<PlanLabel, 'ESSENTIAL' | 'PRO' | 'PREMIUM'> = {
  Essential: 'ESSENTIAL',
  Pro: 'PRO',
  'Multi-site': 'PREMIUM',
};

/** Supplément mensuel HT par établissement supplémentaire de la formule Multi-site. */
const SITE_PRICE_EUR = 99;

/** Remise annuelle de 20 % : la mensualité annuelle vaut 80 % du tarif mensuel. */
const ANNUAL_PERCENT_OF_MONTHLY = 80;

export interface PlanPricing {
  monthlyEur: number;
  sitePriceEur: number | null;
}

/** Tarifs HT en euros entiers, lus dans le catalogue partagé : même source que Stripe et la facturation. */
export function pricingFor(plan: PlanLabel): PlanPricing {
  const monthly = PLAN_PRICES_EUR[PLAN_KEY[plan]];
  if (monthly === null) throw new Error(`Prix manquant pour la formule ${plan}`);
  return { monthlyEur: monthly, sitePriceEur: plan === 'Multi-site' ? SITE_PRICE_EUR : null };
}

/** Mensualité en formule annuelle, en centimes. Exacte : le tarif est en euros entiers. */
export function annualMonthlyCents(euros: number): number {
  return euros * ANNUAL_PERCENT_OF_MONTHLY;
}

/** Total facturé sur l'année, en centimes. */
export function annualTotalCents(euros: number): number {
  return annualMonthlyCents(euros) * 12;
}

/**
 * Montant en euros, sans arrondi : « 159,20 », « 1 910,40 », « 199 ». Les milliers sont séparés par une
 * espace insécable, la décimale est une virgule, les centimes n'apparaissent que s'ils existent.
 */
export function formatEuros(cents: number): string {
  const sign = cents < 0 ? '-' : '';
  const absolute = Math.abs(cents);
  const euros = Math.floor(absolute / 100);
  const remainder = absolute % 100;
  const grouped = String(euros).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  return remainder === 0
    ? `${sign}${grouped}`
    : `${sign}${grouped},${String(remainder).padStart(2, '0')}`;
}
