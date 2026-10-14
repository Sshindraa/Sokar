import type { RestaurantSiteRole } from './site-context';

/**
 * Ce que chaque rôle d'un établissement peut appeler.
 *
 * - `OWNER`, `MANAGER` et `ORG_MEMBER` (comptes historiques sans rôle enregistré) : tout ce que
 *   les routes autorisent. Les actions réservées au propriétaire (facturation, établissements,
 *   équipe) vérifient `OWNER` dans leur propre route.
 * - `READ_ONLY` : lecture seule, sur toutes les routes.
 * - `STAFF` (équipe de service) : refus par défaut. Seules les routes ci-dessous passent, celles
 *   d'un service : réservations, plan de salle, liste d'attente, copilote de service. Une nouvelle
 *   route est donc fermée à l'équipe tant qu'on ne l'a pas ajoutée ici.
 *
 * Les chemins sont les modèles de route Fastify (`/restaurants/:id/...`), pas l'URL appelée.
 */
export type RolePolicyDecision =
  | { allowed: true }
  | { allowed: false; code: 'READ_ONLY_ACCESS' | 'ROLE_FORBIDDEN' };

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

export type Rule = {
  /** Absent : toutes les méthodes. */
  methods?: readonly string[];
  path: string;
  /** Vrai : le chemin et tout ce qui est en dessous (`/a/b` et `/a/b/c`, pas `/a/bc`). */
  below?: boolean;
};

/** Exporté pour que les tests vérifient que chaque règle vise encore une route qui existe. */
export const STAFF_RULES: readonly Rule[] = [
  // Lecture : de quoi tenir un service.
  { methods: ['GET', 'HEAD'], path: '/reservations' },
  { methods: ['GET', 'HEAD'], path: '/restaurants/:id/floor-plan', below: true },
  { methods: ['GET', 'HEAD'], path: '/restaurants/:id/floor-plans', below: true },
  { methods: ['GET', 'HEAD'], path: '/restaurants/:id/availability' },
  // L'en-tête du dashboard lit le nom du restaurant et la liste des établissements.
  { methods: ['GET', 'HEAD'], path: '/restaurants/:id' },
  { methods: ['GET', 'HEAD'], path: '/restaurants/sites' },
  { methods: ['GET', 'HEAD'], path: '/restaurant/onboarding' },
  { methods: ['GET', 'HEAD'], path: '/api/restaurant/onboarding' },
  { methods: ['GET', 'HEAD'], path: '/entitlements' },
  // La synchronisation du compte à l'ouverture du dashboard : elle ne crée rien pour un restaurant
  // existant, mais un refus ferait une erreur à chaque ouverture.
  { methods: ['POST'], path: '/api/auth/sync' },
  // Écriture : seulement les gestes d'un service.
  { methods: ['POST'], path: '/reservations' },
  { methods: ['PATCH'], path: '/reservations/:id' },
  { methods: ['POST'], path: '/reservations/:id/allocate-table' },
  { methods: ['POST'], path: '/restaurants/:id/floor-plan/walk-ins' },
  { path: '/restaurants/:id/floor-plan/reservations', below: true },
  { path: '/restaurants/:id/waiting-list', below: true },
  { path: '/restaurants/:id/service-copilot', below: true },
];

function matches(rule: Rule, method: string, route: string): boolean {
  if (rule.methods && !rule.methods.includes(method)) return false;
  return rule.below
    ? route === rule.path || route.startsWith(`${rule.path}/`)
    : route === rule.path;
}

export function evaluateRolePolicy(input: {
  role: RestaurantSiteRole;
  method: string;
  /** Modèle de route Fastify. Inconnu : seule la lecture est permise à l'équipe de service. */
  route: string | undefined;
}): RolePolicyDecision {
  const method = input.method.toUpperCase();

  if (input.role === 'READ_ONLY') {
    return SAFE_METHODS.has(method)
      ? { allowed: true }
      : { allowed: false, code: 'READ_ONLY_ACCESS' };
  }

  if (input.role === 'STAFF') {
    const route = input.route;
    if (!route) return { allowed: false, code: 'ROLE_FORBIDDEN' };
    return STAFF_RULES.some((rule) => matches(rule, method, route))
      ? { allowed: true }
      : { allowed: false, code: 'ROLE_FORBIDDEN' };
  }

  return { allowed: true };
}

export const ROLE_FORBIDDEN_MESSAGE = 'Votre rôle ne permet pas cette action.';
export const READ_ONLY_MESSAGE = 'Ce membre dispose d’un accès en lecture seule.';
