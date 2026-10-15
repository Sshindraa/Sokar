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
