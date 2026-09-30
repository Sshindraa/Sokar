import {
  DEFAULT_MCP_SEARCH_DURATION_MINUTES,
  DEFAULT_MCP_TIMEZONE,
  parseMcpDateRange,
} from './tools/date-time';

type DataRecord = Record<string, unknown>;

function asRecord(value: unknown): DataRecord {
  return typeof value === 'object' && value !== null ? (value as DataRecord) : {};
}

function cleanLabel(value: unknown, fallback: string): string {
  if (typeof value !== 'string') return fallback;
  const cleaned = value
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return cleaned ? cleaned.slice(0, 100) : fallback;
}

function formatLocalDateTime(value: unknown, timezone: string): string | undefined {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) return undefined;

  const dateParts = new Intl.DateTimeFormat('fr-FR', {
    timeZone: timezone,
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  }).formatToParts(value);
  const date = Object.fromEntries(dateParts.map((part) => [part.type, part.value]));
  if (!date.weekday || !date.day || !date.month) return undefined;

  const timeParts = new Intl.DateTimeFormat('fr-FR', {
    timeZone: timezone,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(value);
  const time = Object.fromEntries(timeParts.map((part) => [part.type, part.value]));
  if (!time.hour || !time.minute) return undefined;

  const day = date.day === '1' ? '1er' : date.day;
  const localTime =
    time.minute === '00' ? `${Number(time.hour)} h` : `${Number(time.hour)} h ${time.minute}`;
  return `le ${date.weekday} ${day} ${date.month} à ${localTime}`;
}

function formatRequestedSearchTime(args: DataRecord): string | undefined {
  if (typeof args.slotStart !== 'string') return undefined;
  const timezone = typeof args.timezone === 'string' ? args.timezone : DEFAULT_MCP_TIMEZONE;
  const range = parseMcpDateRange({
    start: args.slotStart,
    ...(typeof args.slotEnd === 'string' ? { end: args.slotEnd } : {}),
    defaultDurationMinutes: DEFAULT_MCP_SEARCH_DURATION_MINUTES,
    timezone,
    defaultTimezone: DEFAULT_MCP_TIMEZONE,
  });
  return range.ok ? formatLocalDateTime(range.start, timezone) : undefined;
}

function formatPartySize(value: unknown): string | undefined {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1) return undefined;
  return `${value} ${value === 1 ? 'personne' : 'personnes'}`;
}

function formatRestaurantSearch(args: DataRecord, data: DataRecord): string {
  const result = asRecord(data.requestedRestaurant);
  const status = result.status;
  const name = cleanLabel(result.name, 'Le restaurant demandé');
  const requestedName = cleanLabel(args.restaurantName, 'le restaurant demandé');
  const when = formatRequestedSearchTime(args);
  const partySize = formatPartySize(args.partySize);
  const city = cleanLabel(args.city, 'la ville demandée');
  const context = [when, partySize ? `pour ${partySize}` : undefined].filter(Boolean).join(' ');

  if (status === 'available') {
    return `Oui, une table est disponible${partySize ? ` pour ${partySize}` : ''} au restaurant ${name}${when ? ` ${when}` : ''}.`;
  }
  if (status === 'unavailable') {
    return `Le restaurant ${name} n’a pas de disponibilité${context ? ` ${context}` : ''}.`;
  }
  if (status === 'capacity_exceeded') {
    const limit = Array.isArray(data.capacityLimits)
      ? data.capacityLimits.find((item) => asRecord(item).name === result.name)
      : undefined;
    const maxPartySize = asRecord(limit).maxOnlinePartySize;
    return typeof maxPartySize === 'number'
      ? `La capacité de réservation en ligne du restaurant ${name} est limitée à ${maxPartySize} personnes par groupe.`
      : `La réservation en ligne du restaurant ${name} ne permet pas ce nombre de convives.`;
  }
  if (status === 'not_found') {
    return `Je ne trouve pas de fiche accessible pour ${requestedName} à ${city}.`;
  }

  if (Array.isArray(data.restaurants) && data.restaurants.length > 0) {
    return `J’ai trouvé des restaurants disponibles${when ? ` ${when}` : ''}${partySize ? ` pour ${partySize}` : ''}.`;
  }
  if (data.searchOutcome === 'capacity_exceeded' && Array.isArray(data.capacityLimits)) {
    const maxPartySize = Math.max(
      0,
      ...data.capacityLimits.map((item) => {
        const value = asRecord(item).maxOnlinePartySize;
        return typeof value === 'number' ? value : 0;
      }),
    );
    return maxPartySize > 0
      ? `Je n’ai pas trouvé de créneau pour ce groupe. La capacité maximale relevée en ligne est de ${maxPartySize} personnes.`
      : 'Je n’ai pas trouvé de créneau pour ce groupe avec une réservation en ligne.';
  }
  return `Je n’ai trouvé aucune disponibilité${when ? ` ${when}` : ''}${partySize ? ` pour ${partySize}` : ''} à ${city}.`;
}

function formatAvailability(args: DataRecord, data: DataRecord): string {
  const when = formatRequestedSearchTime(args);
  const partySize = formatPartySize(args.partySize);
  const context = [when, partySize ? 'pour ' + partySize : undefined].filter(Boolean).join(' ');
  const suffix = context ? ' ' + context : '';

  if (data.decision === 'available') return 'Une table est disponible' + suffix + '.';
  if (data.decision === 'capacity_exceeded') {
    return typeof data.maxOnlinePartySize === 'number'
      ? 'Le restaurant accepte jusqu’à ' +
          data.maxOnlinePartySize +
          ' personnes par réservation en ligne.'
      : 'Ce nombre de convives dépasse la capacité de réservation en ligne du restaurant.';
  }
  return Array.isArray(data.alternativeSlots) && data.alternativeSlots.length > 0
    ? 'Il n’y a pas de disponibilité' + suffix + ', mais d’autres horaires sont possibles.'
    : 'Il n’y a pas de disponibilité' + suffix + '.';
}

function reservationState(state: unknown): string {
  if (typeof state !== 'string') return 'mise à jour';
  switch (state.toUpperCase()) {
    case 'CONFIRMED':
      return 'confirmée';
    case 'PENDING':
    case 'PENDING_CONFIRMATION':
      return 'en attente de confirmation';
    case 'CANCELLED':
      return 'annulée';
    case 'HONORED':
      return 'terminée';
    case 'SEATED':
      return 'en cours';
    case 'NO_SHOW':
      return 'marquée comme non honorée';
    case 'FAILED':
      return 'non confirmée';
    case 'EXPIRED':
      return 'expirée';
    default:
      return 'mise à jour';
  }
}

export function formatMcpSuccessMessage(
  toolName: string,
  rawData: unknown,
  rawArgs: unknown,
): string {
  const data = asRecord(rawData);
  const args = asRecord(rawArgs);

  switch (toolName) {
    case 'answer_availability':
      return cleanLabel(data.message, 'Je n’ai pas pu vérifier cette disponibilité.');
    case 'search_restaurants':
      return formatRestaurantSearch(args, data);
    case 'get_restaurant_details':
      return `Voici les informations sur ${cleanLabel(data.name, 'ce restaurant')}.`;
    case 'check_availability':
      return formatAvailability(args, data);
    case 'create_quote':
      return 'L’estimation est prête. Elle ne bloque pas le créneau.';
    case 'create_hold':
      return 'Le créneau est gardé temporairement, en attente de confirmation.';
    case 'create_reservation':
      return `La réservation est ${reservationState(data.state)}.`;
    case 'join_waiting_list':
      return typeof data.position === 'number'
        ? `Vous êtes inscrit sur la liste d’attente, en position ${data.position}.`
        : 'Vous êtes inscrit sur la liste d’attente.';
    case 'cancel_waiting_list':
      return 'Votre inscription à la liste d’attente a été annulée.';
    case 'modify_reservation':
      return data.changed === false
        ? 'La réservation était déjà à jour.'
        : 'Votre réservation a été modifiée.';
    case 'cancel_reservation':
      return 'Votre réservation est annulée.';
    case 'get_reservation_status': {
      const state = reservationState(data.state);
      const partySize = formatPartySize(data.partySize);
      return `Votre réservation est ${state}${partySize ? ` pour ${partySize}` : ''}.`;
    }
    default:
      return 'La demande a été traitée.';
  }
}

export function formatMcpErrorMessage(toolName: string, code: string): string {
  switch (code) {
    case 'FORBIDDEN':
      return 'Cette action nécessite une autorisation supplémentaire.';
    case 'INVALID_INPUT':
      return 'Je n’ai pas pu traiter la demande telle quelle. Vérifiez les informations fournies.';
    case 'NOT_FOUND':
      if (toolName === 'get_restaurant_details')
        return 'Je ne trouve pas la fiche de ce restaurant.';
      if (toolName === 'cancel_waiting_list')
        return 'Je ne trouve pas cette inscription sur la liste d’attente.';
      return 'Je ne trouve pas cette réservation avec les informations fournies.';
    case 'RATE_LIMITED':
      return 'Il y a eu trop de demandes en peu de temps. Réessayez dans un instant.';
    case 'SLOT_UNAVAILABLE':
      return 'Ce créneau n’est plus disponible. Je peux chercher d’autres horaires si vous le souhaitez.';
    case 'SLOT_AVAILABLE':
      return 'Le créneau est disponible; vous pouvez réserver directement.';
    case 'IDEMPOTENCY_CONFLICT':
      return 'Cette réservation n’a pas été répétée, car les informations ne correspondent pas au premier essai.';
    case 'INVALID_HOLD':
      return 'Le créneau gardé temporairement a expiré. Il faut vérifier à nouveau les disponibilités.';
    case 'POLICY_VIOLATION':
      return 'Cette demande ne respecte pas les conditions de réservation du restaurant.';
    case 'INVALID_STATE':
      return 'Cette réservation ne peut pas être modifiée dans son état actuel.';
    case 'WAITING_LIST_DISABLED':
      return 'Ce restaurant ne propose pas de liste d’attente.';
    case 'WAITING_LIST_FULL':
      return 'La liste d’attente est complète.';
    case 'ALREADY_EXISTS':
      return 'Vous êtes déjà inscrit sur cette liste d’attente.';
    case 'INTERNAL':
      return 'Je rencontre un problème temporaire et je n’ai pas pu terminer. Réessayez un peu plus tard.';
    default:
      return 'Je n’ai pas pu terminer cette demande. Réessayez ou demandez de l’aide.';
  }
}

export function formatMcpSuccessContent(
  protocolVersion: string,
  toolName: string,
  data: unknown,
  args: unknown,
): string {
  if (protocolVersion === '2025-03-26') return JSON.stringify(data);
  return formatMcpSuccessMessage(toolName, data, args);
}

export function formatMcpErrorContent(
  protocolVersion: string,
  toolName: string,
  error: string,
  code: string,
): string {
  if (protocolVersion === '2025-03-26') return JSON.stringify({ ok: false, error, code });
  return formatMcpErrorMessage(toolName, code);
}
