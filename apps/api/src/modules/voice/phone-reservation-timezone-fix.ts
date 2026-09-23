/**
 * Correction des réservations téléphoniques enregistrées avant le correctif
 * de fuseau (4e28e85) : `reservedAt` était construit avec
 * `new Date(`${date}T${time}`)`, donc dans le fuseau du serveur.
 *
 * Si le serveur tournait dans le fuseau S, l'heure voulue par le client se
 * relit en formatant l'instant stocké dans S ; l'instant correct est cette
 * même heure dans le fuseau du restaurant. Si S est le fuseau du restaurant,
 * la correction est nulle.
 */
import { utcToZonedParts, zonedTimeToUtc } from '../../shared/timezone/restaurant-time';

export interface PhoneReservationCorrection {
  /** Heure locale voulue par l'appelant, relue dans le fuseau du serveur. */
  localDate: string;
  localTime: string;
  corrected: Date;
  /** Décalage appliqué, en millisecondes (0 : rien à corriger). */
  shiftMs: number;
}

export function correctPhoneReservationInstant(
  stored: Date,
  serverTimeZone: string,
  restaurantTimeZone: string,
): PhoneReservationCorrection {
  const { date, time } = utcToZonedParts(stored, serverTimeZone);
  const corrected = zonedTimeToUtc(date, time, restaurantTimeZone);
  return {
    localDate: date,
    localTime: time,
    corrected,
    shiftMs: corrected.getTime() - stored.getTime(),
  };
}
