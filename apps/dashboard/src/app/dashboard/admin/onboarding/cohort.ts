export interface RestaurantProgress {
  restaurantId: string;
  restaurantName?: string | null;
  startedAt: string;
  lastEventAt: string;
  completedSteps: number;
  blockedSteps: number;
  firstReservationAt: string | null;
  hoursToFirstReservation: number | null;
}

/** Étapes d'intégration, en clair ; une clé inconnue n'est jamais montrée telle quelle. */
const STEP_LABELS: Record<string, string> = {
  restaurant: 'Restaurant',
  hours: 'Horaires',
  floor: 'Salle',
  knowledge: 'Connaissances',
  phone: 'Téléphone',
  channels: 'Canaux',
  'connect-identity': 'Page en ligne : identité',
  'connect-location': 'Page en ligne : adresse',
  'connect-cuisine': 'Page en ligne : cuisine',
  'connect-activation': 'Page en ligne : activation',
};

export function stepLabel(step: string): string {
  return STEP_LABELS[step] ?? 'Autre étape';
}

/** Établissements qui n'ont pas encore réservé d'abord, les plus bloqués en tête : ce sont eux à relancer. */
export function sortForFollowUp(rows: RestaurantProgress[]): RestaurantProgress[] {
  return [...rows].sort((a, b) => {
    if (!a.firstReservationAt && b.firstReservationAt) return -1;
    if (a.firstReservationAt && !b.firstReservationAt) return 1;
    if (a.blockedSteps !== b.blockedSteps) return b.blockedSteps - a.blockedSteps;
    return a.completedSteps - b.completedSteps;
  });
}
