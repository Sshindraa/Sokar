/**
 * Catalogue de SLO minimaux (R0-5).
 *
 * Un SLO est un objectif chiffré sur une fenêtre, pas une alerte : il sert à
 * répondre à « est-ce que le service tient sa promesse cette semaine ? ». Les
 * alertes qui en découlent sont volontairement peu nombreuses et critiques,
 * pour rester actionnables. Le détail des objectifs, de la mesure et de la
 * réaction est dans `docs/runbooks/slo.md`.
 *
 * Toutes les mesures proviennent du worker `alert-evaluation` (fenêtre de
 * 5 min pour les signaux HTTP, 24 h pour les signaux métier).
 */

export type SloStatus = 'met' | 'breached' | 'unknown';
export type SloComparator = 'gte' | 'lte';
export type SloUnit = 'ratio' | 'milliseconds';

export interface SloDefinition {
  readonly id: string;
  readonly title: string;
  /** Objectif exprimé en français, affiché dans les alertes et le runbook. */
  readonly objective: string;
  readonly target: number;
  readonly comparator: SloComparator;
  readonly unit: SloUnit;
  readonly windowLabel: string;
}

export const SLO_DEFINITIONS: readonly SloDefinition[] = [
  {
    id: 'api_availability',
    title: 'Disponibilité API',
    objective: 'au moins 99 % des requêtes API ne répondent pas 5xx',
    target: 0.99,
    comparator: 'gte',
    unit: 'ratio',
    windowLabel: '5 min',
  },
  {
    id: 'connect_availability',
    title: 'Disponibilité Sokar Connect',
    objective: 'au moins 99 % des requêtes Connect ne répondent pas 5xx',
    target: 0.99,
    comparator: 'gte',
    unit: 'ratio',
    windowLabel: '5 min',
  },
  {
    id: 'connect_latency_p95',
    title: 'Latence Connect p95',
    objective: 'le p95 des requêtes Connect réussies reste sous 500 ms',
    target: 500,
    comparator: 'lte',
    unit: 'milliseconds',
    windowLabel: '5 min',
  },
  {
    id: 'voice_transcript_coverage',
    title: 'Couverture des transcriptions vocales',
    objective: 'au moins 99 % des appels Telnyx ont une transcription et un outcome',
    target: 0.99,
    comparator: 'gte',
    unit: 'ratio',
    windowLabel: '24 h',
  },
  {
    id: 'reservation_confirmation_coverage',
    title: 'Traçabilité des confirmations',
    objective: 'au moins 99 % des réservations confirmées ont une trace d’envoi du SMS',
    target: 0.99,
    comparator: 'gte',
    unit: 'ratio',
    windowLabel: '24 h',
  },
];

/** Mesures brutes du tick courant. `null` = non mesurable (pas de trafic, pas de baseline). */
export interface SloInputs {
  readonly apiAvailability: number | null;
  readonly connectAvailability: number | null;
  readonly connectLatencyP95Ms: number | null;
  readonly voiceTranscriptCoverage: number | null;
  readonly reservationConfirmationCoverage: number | null;
}

export interface SloMeasurement {
  readonly id: string;
  readonly title: string;
  readonly objective: string;
  readonly status: SloStatus;
  readonly value: number | null;
  readonly target: number;
  readonly comparator: SloComparator;
  readonly unit: SloUnit;
  readonly windowLabel: string;
  /** Phrase prête à envoyer dans une alerte. */
  readonly summary: string;
}

export interface SloBreachFinding {
  readonly kind: 'slo_breach';
  readonly severity: 'warning' | 'critical';
  /** Suffixe de clé de cooldown : identifiant du SLO. */
  readonly identifier: string;
  readonly summary: string;
  readonly detail: string;
}

export function formatSloValue(value: number | null, unit: SloUnit): string {
  if (value === null) return 'non mesuré';
  if (unit === 'ratio') return `${(value * 100).toFixed(2)} %`;
  return `${Math.round(value)} ms`;
}

export function formatSloTarget(definition: SloDefinition): string {
  const comparator = definition.comparator === 'gte' ? '≥' : '≤';
  return `${comparator} ${formatSloValue(definition.target, definition.unit)}`;
}

export function evaluateSlo(definition: SloDefinition, value: number | null): SloMeasurement {
  const status: SloStatus =
    value === null
      ? 'unknown'
      : definition.comparator === 'gte'
        ? value >= definition.target
          ? 'met'
          : 'breached'
        : value <= definition.target
          ? 'met'
          : 'breached';

  const summary =
    status === 'unknown'
      ? `${definition.title} : non mesuré sur ${definition.windowLabel}`
      : status === 'met'
        ? `${definition.title} : objectif tenu (${formatSloValue(value, definition.unit)})`
        : `${definition.title} : objectif manqué — ${formatSloValue(value, definition.unit)} pour une cible ${formatSloTarget(definition)}`;

  return {
    id: definition.id,
    title: definition.title,
    objective: definition.objective,
    status,
    value,
    target: definition.target,
    comparator: definition.comparator,
    unit: definition.unit,
    windowLabel: definition.windowLabel,
    summary,
  };
}

const INPUT_KEYS: Record<string, keyof SloInputs> = {
  api_availability: 'apiAvailability',
  connect_availability: 'connectAvailability',
  connect_latency_p95: 'connectLatencyP95Ms',
  voice_transcript_coverage: 'voiceTranscriptCoverage',
  reservation_confirmation_coverage: 'reservationConfirmationCoverage',
};

export function evaluateSloCompliance(inputs: SloInputs): SloMeasurement[] {
  return SLO_DEFINITIONS.map((definition) => {
    const key = INPUT_KEYS[definition.id];
    return evaluateSlo(definition, key ? inputs[key] : null);
  });
}

/**
 * Convertit les SLO manqués en findings alertables. Un SLO `unknown` ne
 * déclenche rien : l'absence de mesure n'est pas une panne, et le worker
 * `system-health` couvre déjà les cas « pas de données du tout ».
 */
export function sloBreachFindings(measurements: readonly SloMeasurement[]): SloBreachFinding[] {
  return measurements
    .filter((measurement) => measurement.status === 'breached')
    .map((measurement) => ({
      kind: 'slo_breach' as const,
      severity: 'warning' as const,
      identifier: measurement.id,
      summary: `${measurement.title} sous l’objectif (${formatSloValue(measurement.value, measurement.unit)})`,
      detail: [
        `SLO « ${measurement.title} » (${measurement.id}) manqué sur la fenêtre ${measurement.windowLabel}.`,
        `Objectif : ${measurement.objective} — cible ${formatSloTarget({
          id: measurement.id,
          title: measurement.title,
          objective: measurement.objective,
          target: measurement.target,
          comparator: measurement.comparator,
          unit: measurement.unit,
          windowLabel: measurement.windowLabel,
        })}.`,
        `Mesure courante : ${formatSloValue(measurement.value, measurement.unit)}.`,
        'Procédure : docs/runbooks/slo.md.',
      ].join('\n'),
    }));
}
