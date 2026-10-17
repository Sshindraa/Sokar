/**
 * Erreurs de l'API vues par le restaurateur.
 *
 * L'API répond de trois façons : un message français rédigé pour l'utilisateur (« La modification des
 * notes client est réservée aux responsables. »), un code stable (`CAPABILITY_NOT_INCLUDED`,
 * `LOYALTY_DISABLED`…), ou un texte technique anglais (« Authentication required », « Validation Error »).
 * Seul le premier cas est lisible tel quel : les deux autres sont traduits ici, une fois pour toutes les
 * pages, au lieu d'afficher « Erreur 409 » ou du jargon.
 */

export type ApiErrorKind =
  | 'session'
  | 'forbidden'
  /** La fonction n'est pas dans la formule du restaurant. */
  | 'not-included'
  /** La fonction existe mais n'est pas encore ouverte (réglage serveur, qualification en cours). */
  | 'not-ready'
  | 'not-found'
  | 'conflict'
  | 'invalid'
  | 'rate-limited'
  | 'unavailable'
  | 'other';

export interface ApiErrorPayload {
  status: number;
  code: string | null;
  message: string | null;
  details: Array<{ path?: string; message?: string }>;
}

export class ApiError extends Error {
  readonly status: number;
  readonly code: string | null;
  readonly kind: ApiErrorKind;

  constructor(message: string, status: number, code: string | null) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.kind = classifyApiError(status, code);
  }
}

const CODE_PATTERN = /^[A-Z][A-Z0-9_]{2,}$/;

/** Code stable de l'API : le champ `code`, ou le champ `error` quand il a la forme d'un code. */
export function extractApiCode(data: Record<string, unknown>): string | null {
  for (const key of ['code', 'error']) {
    const value = data[key];
    if (typeof value === 'string' && CODE_PATTERN.test(value)) return value;
  }
  return null;
}

export function classifyApiError(status: number, code: string | null): ApiErrorKind {
  if (status === 401) return 'session';
  if (code === 'CAPABILITY_NOT_INCLUDED') return 'not-included';
  if (code && (code.endsWith('_DISABLED') || code.endsWith('_NOT_CONFIGURED'))) return 'not-ready';
  if (status === 403) return 'forbidden';
  if (status === 404) return 'not-found';
  if (status === 409) return 'conflict';
  if (status === 400 || status === 422) return 'invalid';
  if (status === 429) return 'rate-limited';
  if (status >= 500) return 'unavailable';
  return 'other';
}

/** Messages propres à un code, quand le texte de l'API parle de « pilote », de « chantier » ou de réglages. */
const CODE_MESSAGES: Record<string, string> = {
  IDENTITY_REQUIRED: 'La vérification d’identité a expiré. Demandez un nouveau code.',
  MARKETING_SENDS_DISABLED: 'L’envoi de messages n’est pas encore ouvert sur votre compte.',
  RESERVATION_PAYMENTS_DISABLED:
    'Le paiement des réservations n’est pas encore ouvert sur votre compte.',
};

const KIND_MESSAGES: Record<ApiErrorKind, string> = {
  session: 'Votre session a expiré. Reconnectez-vous pour continuer.',
  forbidden: 'Vous n’avez pas accès à cette fonction avec votre rôle.',
  'not-included': 'Cette fonctionnalité n’est pas incluse dans votre formule.',
  'not-ready': 'Cette fonctionnalité n’est pas encore ouverte sur votre compte.',
  'not-found': 'Élément introuvable. Il a peut-être été supprimé : actualisez la page.',
  conflict:
    'Cette action n’est plus possible : l’élément a changé entre-temps. Actualisez la page.',
  invalid: 'Certains champs ne sont pas valides. Vérifiez votre saisie.',
  'rate-limited': 'Trop de requêtes en peu de temps. Réessayez dans un instant.',
  unavailable: 'Le service est momentanément indisponible. Réessayez dans quelques instants.',
  other: 'Une erreur est survenue. Réessayez.',
};

/** Noms de champs de l'API, en français, pour dire quoi corriger après une validation refusée. */
const FIELD_LABELS: Record<string, string> = {
  phone: 'numéro de téléphone',
  managerPhone: 'numéro de téléphone',
  customerPhone: 'numéro de téléphone',
  email: 'adresse e-mail',
  managerEmail: 'adresse e-mail',
  customerEmail: 'adresse e-mail',
  name: 'nom',
  customerName: 'nom',
  partySize: 'nombre de couverts',
  date: 'date',
  time: 'heure',
  slug: 'adresse publique',
  domain: 'nom de domaine',
  subject: 'objet',
  body: 'message',
};

/** Texte technique ou générique : à remplacer, jamais à montrer. */
const TECHNICAL_MESSAGE =
  /^(authentication required|organization required|forbidden|unauthorized|not found|bad request|validation error|internal server error|service unavailable|sokar operator access required|authentication provider not configured|erreur \d+|error|internalservererror|badrequesterror)\b/i;

/** Phrase anglaise de l'API (« Restaurant not found », « Slug is required ») : jamais lisible par le restaurateur. */
const ENGLISH_MESSAGE =
  /\b(not found|is required|are required|required|invalid|failed|failure|must be|cannot|unable to|denied|missing|already exists|not allowed|not configured|is not|are not|please)\b/i;

function isTechnicalMessage(message: string | null): boolean {
  if (!message) return true;
  const text = message.trim();
  return (
    !text || TECHNICAL_MESSAGE.test(text) || ENGLISH_MESSAGE.test(text) || CODE_PATTERN.test(text)
  );
}

function invalidFieldsHint(details: ApiErrorPayload['details']): string {
  const labels = new Set<string>();
  for (const detail of details) {
    const field = detail.path?.split('.').pop();
    const label = field ? FIELD_LABELS[field] : undefined;
    if (label) labels.add(label);
  }
  return labels.size > 0 ? ` À vérifier : ${[...labels].join(', ')}.` : '';
}

/** Message à montrer au restaurateur pour une réponse d'erreur de l'API. */
export function describeApiError(payload: ApiErrorPayload): string {
  const kind = classifyApiError(payload.status, payload.code);
  if (kind === 'session' || kind === 'not-included') return KIND_MESSAGES[kind];
  if (payload.code && CODE_MESSAGES[payload.code]) return CODE_MESSAGES[payload.code];
  if (kind === 'not-ready') return KIND_MESSAGES['not-ready'];
  if (kind === 'invalid' && isTechnicalMessage(payload.message)) {
    return `${KIND_MESSAGES.invalid}${invalidFieldsHint(payload.details)}`;
  }
  if (!isTechnicalMessage(payload.message)) return payload.message!.trim();
  return KIND_MESSAGES[kind];
}

/** Construit l'erreur levée par le client API depuis la réponse JSON. */
export function toApiError(status: number, data: Record<string, unknown>): ApiError {
  const code = extractApiCode(data);
  const message =
    [data.message, data.error, data.detail].find(
      (value): value is string => typeof value === 'string' && value.trim().length > 0,
    ) ?? null;
  const details = Array.isArray(data.details)
    ? (data.details as ApiErrorPayload['details']).filter(
        (item) => item && typeof item === 'object',
      )
    : [];
  return new ApiError(describeApiError({ status, code, message, details }), status, code);
}

export interface FeatureLock {
  kind: 'not-included' | 'not-ready';
  message: string;
}

/**
 * Vrai blocage de fonctionnalité (formule ou ouverture), à présenter calmement : ce n'est ni une panne ni
 * une erreur à réessayer. `null` pour toute autre erreur.
 */
export function featureLockFromError(error: unknown): FeatureLock | null {
  if (error instanceof ApiError && (error.kind === 'not-included' || error.kind === 'not-ready')) {
    return { kind: error.kind, message: error.message };
  }
  return null;
}

export function isSessionExpired(error: unknown): boolean {
  return error instanceof ApiError && error.kind === 'session';
}
