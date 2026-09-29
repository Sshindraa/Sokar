import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { buildRequests } from '../behavior-eval/build';
import { MIN_VALID_RATE, scoreCase } from '../behavior-eval/score';
import type { BehaviorCase, BehaviorCasesFile } from '../behavior-eval/types';

const baseCase = (checks: BehaviorCase['checks']): BehaviorCase => ({
  id: 'cas',
  behavior: 'test',
  source: 'test',
  history: [],
  transcript: 'bonjour',
  checks,
});

const say = (text: string, extra: Record<string, unknown> = {}) => ({ say: text, ...extra });

describe('scoreCase', () => {
  it('mesure la part des tirages qui tiennent un champ, en ignorant les réponses invalides', () => {
    const result = scoreCase(
      baseCase([{ kind: 'field', path: 'turnComplete', equals: false, minRate: 0.7 }]),
      [
        say('', { turnComplete: false }),
        say('', { turnComplete: false }),
        say('', { turnComplete: false }),
        say('ok', { turnComplete: true }),
        say('', { turnComplete: false }),
        say('', { turnComplete: false }),
        say('', { turnComplete: false }),
        say('', { turnComplete: false }),
        say('', { turnComplete: false }),
        null,
      ],
    );
    expect(result.valid).toBe(9);
    expect(result.checks[0].rate).toBeCloseTo(8 / 9);
    expect(result.passed).toBe(true);
  });

  it('échoue quand trop de réponses sont invalides, même si le reste est parfait', () => {
    const samples = [say('', { turnComplete: false }), null, null];
    expect(1 / 3).toBeLessThan(MIN_VALID_RATE);
    const result = scoreCase(
      baseCase([{ kind: 'field', path: 'turnComplete', equals: false, minRate: 0.5 }]),
      samples,
    );
    expect(result.passed).toBe(false);
  });

  it('échoue sans aucune réponse valide (quota épuisé, réseau coupé)', () => {
    const result = scoreCase(baseCase([{ kind: 'say', pattern: 'x', expect: false, minRate: 0 }]), [
      null,
      null,
    ]);
    expect(result.passed).toBe(false);
  });

  it('interdit un motif dans la phrase, insensible à la casse', () => {
    const result = scoreCase(
      baseCase([{ kind: 'say', pattern: 'soirée', expect: false, minRate: 0.5 }]),
      [say('Bonne SOIRÉE'), say('Bonne fin d’après-midi'), say('À demain')],
    );
    expect(result.checks[0].rate).toBeCloseTo(2 / 3);
    expect(result.passed).toBe(true);
  });

  it('compare un champ du brouillon sans tenir compte de la casse, et les nombres exactement', () => {
    const result = scoreCase(
      baseCase([
        { kind: 'draft', field: 'customerName', equals: 'HOUET', minRate: 1 },
        { kind: 'draft', field: 'partySize', equals: 6, minRate: 1 },
      ]),
      [say('', { draft: { customerName: 'Houet', partySize: 6 } })],
    );
    expect(result.passed).toBe(true);
  });

  it('détecte la recopie de la dernière question, ponctuation et casse ignorées', () => {
    const result = scoreCase(
      baseCase([
        { kind: 'noRepeatOf', text: 'Vers quelle heure vous aimeriez venir', minRate: 0.6 },
      ]),
      [
        say('Oui, il y a une terrasse. Vers quelle heure vous aimeriez venir ?'),
        say('Oui, une terrasse. Et pour quelle heure ?'),
        say('Une terrasse, oui. Vous venez à quelle heure ?'),
      ],
    );
    expect(result.checks[0].rate).toBeCloseTo(2 / 3);
    expect(result.passed).toBe(true);
  });

  it('borne la longueur moyenne des phrases', () => {
    const short = scoreCase(baseCase([{ kind: 'sayWords', maxMean: 5 }]), [
      say('un deux trois'),
      say('quatre cinq'),
    ]);
    const long = scoreCase(baseCase([{ kind: 'sayWords', maxMean: 2 }]), [
      say('un deux trois'),
      say('quatre cinq'),
    ]);
    expect(short.passed).toBe(true);
    expect(long.passed).toBe(false);
  });
});

describe('cas réels du jeu de comportements', () => {
  const file = JSON.parse(
    readFileSync(
      path.join(__dirname, '../../../../scripts/fixtures/voice-behavior/cases.json'),
      'utf8',
    ),
  ) as BehaviorCasesFile;

  it('chaque cas se compose en une requête complète avec le prompt courant', () => {
    const requests = buildRequests(file);
    expect(requests).toHaveLength(file.cases.length);
    for (const request of requests) {
      expect(request.messages[0].role).toBe('system');
      expect(request.messages.at(-1)?.role).toBe('user');
      expect(request.samples).toBeGreaterThan(0);
    }
  });

  it('les identifiants sont uniques et chaque cas a au moins un contrôle', () => {
    const ids = file.cases.map((testCase) => testCase.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const testCase of file.cases) expect(testCase.checks.length).toBeGreaterThan(0);
  });

  it("un cas après action n'autorise que parler ou terminer l'appel", () => {
    const request = buildRequests(file).find((r) => r.id === 'au-revoir-selon-heure');
    const schema = request?.format.json_schema.schema as {
      properties: { action: { enum: string[] } };
    };
    expect(schema.properties.action.enum).toEqual(['none', 'end_call']);
  });

  it('le fait du moment de la journée est bien transmis quand le cas le demande', () => {
    const request = buildRequests(file).find((r) => r.id === 'au-revoir-selon-heure');
    expect(request?.messages[0].content).toContain('15 h, après-midi');
  });
});
