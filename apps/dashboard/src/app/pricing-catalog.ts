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
 * sont regroupées derrière celles de la formule inférieure. Les libellés reprennent la rédaction publique de
 * la page Tarifs ; une fonctionnalité non livrée reste « prévu », jamais « disponible ».
 */
export const CATALOG_FEATURES: readonly CatalogFeature[] = [
  {
    id: 'phone-assistant',
    label: 'Un assistant pour les réservations par téléphone',
    status: 'disponible',
    introducedIn: 'Essential',
  },
  {
    id: 'shared-planning',
    label: 'Les réservations téléphone, web et en salle dans un planning commun',
    status: 'disponible',
    introducedIn: 'Essential',
  },
  {
    id: 'connect-widget',
    label: 'Votre page Connect et votre widget de réservation',
    status: 'disponible',
    introducedIn: 'Essential',
  },
  {
    id: 'floor-waitlist',
    label: 'Plan de salle et liste d’attente pour organiser les couverts',
    status: 'disponible',
    introducedIn: 'Essential',
  },
  {
    id: 'client-file',
    label: 'Un fichier client et le suivi des absences',
    status: 'disponible',
    introducedIn: 'Essential',
  },
  {
    id: 'number',
    label: 'Un numéro dédié, configuré lors de la mise en service',
    status: 'disponible',
    introducedIn: 'Essential',
  },
  {
    id: 'google-agenda',
    label: 'Synchronisation Google Agenda',
    status: 'disponible',
    introducedIn: 'Essential',
  },
  {
    id: 'daily-report',
    label: 'Rapport quotidien de vos appels',
    status: 'disponible',
    introducedIn: 'Essential',
  },
  {
    id: 'tone',
    label: 'Ton adapté à votre établissement',
    status: 'prévu',
    introducedIn: 'Essential',
  },
  {
    id: 'copilot-suggestions',
    label: 'Des suggestions pour traiter les retards',
    status: 'disponible',
    introducedIn: 'Pro',
  },
  {
    id: 'copilot-estimates',
    label: 'Une estimation des tables bientôt disponibles, avec indication de fiabilité',
    status: 'disponible',
    introducedIn: 'Pro',
  },
  {
    id: 'copilot-matching',
    label: 'Des rapprochements entre tables et clients en attente',
    status: 'disponible',
    introducedIn: 'Pro',
  },
  {
    id: 'copilot-reorganisation',
    label: 'L’analyse d’une réorganisation et l’application d’un plan validé par l’équipe',
    status: 'disponible',
    introducedIn: 'Pro',
  },
  {
    id: 'copilot-history',
    label: 'L’historique des plans de retard et un retour arrière sous conditions',
    status: 'disponible',
    introducedIn: 'Pro',
  },
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
    id: 'multi-navigation',
    label: 'Passage d’une adresse à l’autre dans votre espace',
    status: 'disponible',
    introducedIn: 'Multi-site',
  },
  {
    id: 'per-site-planning',
    label: 'Planning et fichier client propres à chaque restaurant',
    status: 'disponible',
    introducedIn: 'Multi-site',
  },
  {
    id: 'per-site-hours',
    label: 'Horaires et règles de réservation par adresse',
    status: 'disponible',
    introducedIn: 'Multi-site',
  },
  {
    id: 'per-site-number',
    label: 'Un numéro dédié par établissement',
    status: 'disponible',
    introducedIn: 'Multi-site',
  },
  {
    id: 'group-invoice',
    label: 'Une facturation réunie au niveau du groupe',
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
