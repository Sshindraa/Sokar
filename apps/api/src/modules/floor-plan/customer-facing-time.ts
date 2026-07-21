/**
 * Heure présentée à un client : jamais de minutes difficiles à retenir.
 * On arrondit toujours au créneau supérieur pour ne jamais promettre une
 * disponibilité plus tôt que celle calculée par le moteur opérationnel.
 */
export function toCustomerFacingTime(date: Date, incrementMinutes = 5): Date {
  const incrementMs = incrementMinutes * 60_000;
  return new Date(Math.ceil(date.getTime() / incrementMs) * incrementMs);
}

export function formatCustomerFacingTime(date: Date, timeZone = 'Europe/Paris'): string {
  return date.toLocaleTimeString('fr-FR', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone,
  });
}
