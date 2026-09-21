import { describe, expect, it } from 'vitest';
import {
  SLO_DEFINITIONS,
  evaluateSlo,
  evaluateSloCompliance,
  formatSloTarget,
  formatSloValue,
  sloBreachFindings,
  type SloInputs,
} from '../slo';

const ALL_UNKNOWN: SloInputs = {
  apiAvailability: null,
  connectAvailability: null,
  connectLatencyP95Ms: null,
  voiceTranscriptCoverage: null,
  reservationConfirmationCoverage: null,
};

function definitionFor(id: string) {
  const definition = SLO_DEFINITIONS.find((entry) => entry.id === id);
  if (!definition) throw new Error(`SLO inconnu : ${id}`);
  return definition;
}

describe('catalogue SLO', () => {
  it('couvre les cinq signaux minimaux attendus', () => {
    expect(SLO_DEFINITIONS.map((entry) => entry.id)).toEqual([
      'api_availability',
      'connect_availability',
      'connect_latency_p95',
      'voice_transcript_coverage',
      'reservation_confirmation_coverage',
    ]);
  });

  it('déclare un objectif chiffré et une fenêtre pour chaque SLO', () => {
    for (const definition of SLO_DEFINITIONS) {
      expect(definition.target).toBeGreaterThan(0);
      expect(definition.windowLabel.length).toBeGreaterThan(0);
      expect(definition.objective.length).toBeGreaterThan(0);
    }
  });
});

describe('evaluateSlo', () => {
  it('marque un objectif atteint', () => {
    const measurement = evaluateSlo(definitionFor('api_availability'), 0.995);
    expect(measurement.status).toBe('met');
  });

  it('marque un objectif manqué', () => {
    const measurement = evaluateSlo(definitionFor('api_availability'), 0.97);
    expect(measurement.status).toBe('breached');
    expect(measurement.summary).toContain('objectif manqué');
  });

  it('traite l’absence de mesure comme inconnue, pas comme une panne', () => {
    const measurement = evaluateSlo(definitionFor('voice_transcript_coverage'), null);
    expect(measurement.status).toBe('unknown');
    expect(sloBreachFindings([measurement])).toHaveLength(0);
  });

  it('applique le comparateur « au plus » pour la latence', () => {
    expect(evaluateSlo(definitionFor('connect_latency_p95'), 420).status).toBe('met');
    expect(evaluateSlo(definitionFor('connect_latency_p95'), 900).status).toBe('breached');
  });

  it('respecte la borne exacte de l’objectif', () => {
    expect(evaluateSlo(definitionFor('api_availability'), 0.99).status).toBe('met');
    expect(evaluateSlo(definitionFor('connect_latency_p95'), 500).status).toBe('met');
  });
});

describe('evaluateSloCompliance', () => {
  it('évalue chaque SLO à partir de sa mesure', () => {
    const measurements = evaluateSloCompliance({
      apiAvailability: 0.999,
      connectAvailability: 0.95,
      connectLatencyP95Ms: 180,
      voiceTranscriptCoverage: 1,
      reservationConfirmationCoverage: null,
    });

    const byId = Object.fromEntries(measurements.map((m) => [m.id, m.status]));
    expect(byId).toEqual({
      api_availability: 'met',
      connect_availability: 'breached',
      connect_latency_p95: 'met',
      voice_transcript_coverage: 'met',
      reservation_confirmation_coverage: 'unknown',
    });
  });

  it('renvoie cinq mesures même sans aucune donnée', () => {
    const measurements = evaluateSloCompliance(ALL_UNKNOWN);
    expect(measurements).toHaveLength(SLO_DEFINITIONS.length);
    expect(measurements.every((m) => m.status === 'unknown')).toBe(true);
  });
});

describe('formatage et findings', () => {
  it('formate un ratio en pourcentage et une latence en millisecondes', () => {
    expect(formatSloValue(0.9876, 'ratio')).toBe('98.76 %');
    expect(formatSloValue(412.4, 'milliseconds')).toBe('412 ms');
    expect(formatSloValue(null, 'ratio')).toBe('non mesuré');
  });

  it('formate la cible selon le comparateur', () => {
    expect(formatSloTarget(definitionFor('api_availability'))).toBe('≥ 99.00 %');
    expect(formatSloTarget(definitionFor('connect_latency_p95'))).toBe('≤ 500 ms');
  });

  it('ne produit un finding que pour les SLO manqués', () => {
    const measurements = evaluateSloCompliance({
      ...ALL_UNKNOWN,
      apiAvailability: 0.9,
      connectLatencyP95Ms: 800,
    });

    const findings = sloBreachFindings(measurements);
    expect(findings.map((finding) => finding.identifier)).toEqual([
      'api_availability',
      'connect_latency_p95',
    ]);
    expect(findings[0]).toMatchObject({ kind: 'slo_breach', severity: 'warning' });
    expect(findings[0]?.detail).toContain('docs/runbooks/slo.md');
  });
});
