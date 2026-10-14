/**
 * Formule choisie sur la page Tarifs, gardée pendant l'inscription.
 *
 * Le choix arrive dans l'adresse (`/dashboard?subscribe_plan=pro&billing=annual`), mais tant que
 * l'inscription n'est pas finie la barrière d'accès renvoie vers `/onboarding` sans ces
 * paramètres : sans mémoire, le choix de formule serait perdu en silence. Le navigateur peut
 * refuser le stockage (navigation privée) : tout est alors simplement oublié.
 */
export const PLAN_SLUGS = ['essential', 'pro', 'multi-site'] as const;
export type PlanSlug = (typeof PLAN_SLUGS)[number];
export type BillingCadence = 'monthly' | 'annual';

export type PlanChoice = {
  plan: PlanSlug;
  billing: BillingCadence;
  /** Nombre d'établissements, Multi-site uniquement (2 à 100). */
  siteCount?: number;
};

const CHOICE_KEY = 'sokar:onboarding:plan-choice';
const DISMISSED_KEY = 'sokar:onboarding:plan-dismissed';

function isPlan(value: string | null): value is PlanSlug {
  return value !== null && (PLAN_SLUGS as readonly string[]).includes(value);
}

function readSiteCount(value: string | null): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 2 && parsed <= 100 ? parsed : 2;
}

/** Lit `subscribe_plan`, `billing` et `sites` d'une adresse. `null` si le choix est absent. */
export function parsePlanChoice(search: string): PlanChoice | null {
  const params = new URLSearchParams(search);
  const plan = params.get('subscribe_plan');
  if (!isPlan(plan)) return null;
  return {
    plan,
    billing: params.get('billing') === 'monthly' ? 'monthly' : 'annual',
    ...(plan === 'multi-site' ? { siteCount: readSiteCount(params.get('sites')) } : {}),
  };
}

function storage(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    return null;
  }
}

/** Mémorise le choix présent dans l'adresse, s'il y en a un. */
export function capturePlanChoice(search: string): void {
  const choice = parsePlanChoice(search);
  if (!choice) return;
  try {
    storage()?.setItem(CHOICE_KEY, JSON.stringify(choice));
  } catch {
    // Stockage indisponible : le choix reste dans l'adresse tant que la page n'est pas quittée.
  }
}

export function readStoredPlanChoice(): PlanChoice | null {
  try {
    const raw = storage()?.getItem(CHOICE_KEY);
    if (!raw) return null;
    const value = JSON.parse(raw) as Partial<PlanChoice>;
    if (!isPlan(value.plan ?? null)) return null;
    return {
      plan: value.plan as PlanSlug,
      billing: value.billing === 'monthly' ? 'monthly' : 'annual',
      ...(value.plan === 'multi-site'
        ? { siteCount: readSiteCount(String(value.siteCount ?? '')) }
        : {}),
    };
  } catch {
    return null;
  }
}

export function clearStoredPlanChoice(): void {
  try {
    storage()?.removeItem(CHOICE_KEY);
  } catch {
    // Rien à nettoyer si le stockage est indisponible.
  }
}

/** Le restaurateur a choisi « Plus tard » : on ne le lui reproposera pas à chaque passage. */
export function dismissPlanPrompt(restaurantId: string): void {
  try {
    storage()?.setItem(`${DISMISSED_KEY}:${restaurantId}`, '1');
  } catch {
    // Au pire, l'écran se représente.
  }
}

export function isPlanPromptDismissed(restaurantId: string): boolean {
  try {
    return storage()?.getItem(`${DISMISSED_KEY}:${restaurantId}`) === '1';
  } catch {
    return false;
  }
}
