import { describe, expect, it } from 'vitest';
import { addDays, evaluateConversation, extractTimes, type EvaluationInput } from '../checks';
import { loadScenarios, ScenarioSchema } from '../scenario';

describe('extractTimes', () => {
  it.each([
    ['On sera là à 20 h 30.', ['20:30']],
    ['Plutôt 20h, ou 21 heures', ['20:00', '21:00']],
    ['J’ai 19:30 de libre', ['19:30']],
    ['vingt heures trente, ou dix-neuf heures', ['20:30', '19:00']],
    ['vingt et une heures', ['21:00']],
    ['a table at 8 pm or 9:30 pm', ['20:00', '21:30']],
    ['Pour quatre personnes demain', []],
  ])('%s', (text, expected) => {
    expect(extractTimes(text).sort()).toEqual([...expected].sort());
  });
});

function input(overrides: Partial<EvaluationInput> = {}): EvaluationInput {
  return {
    scenario: ScenarioSchema.parse({
      id: 's',
      category: 'c',
      persona: 'p',
      goal: 'g',
      expected: { reservation: { dateOffsetDays: 1, time: '20:00', partySize: 2 } },
    }),
    transcript: [
      { speaker: 'agent', text: 'Bonjour, ici Test, je suis son assistant virtuel.' },
      { speaker: 'caller', text: 'Deux personnes demain à 20 h.' },
      { speaker: 'agent', text: "C'est bon pour 20 h. À quel nom ?" },
    ],
    toolCalls: [{ name: 'createReservation', args: {} }],
    createdReservations: [{ date: '2026-09-24', time: '20:00', partySize: 2 }],
    returnedSlots: ['20:00'],
    openingTimes: ['12:00', '22:30'],
    today: '2026-09-23',
    callerTurns: 3,
    ...overrides,
  };
}

const failed = (results: ReturnType<typeof evaluateConversation>) =>
  results.filter((result) => !result.passed).map((result) => result.name);

describe('evaluateConversation', () => {
  it('valide une réservation correcte', () => {
    expect(failed(evaluateConversation(input()))).toEqual([]);
  });

  it('signale une réservation fausse comme erreur critique', () => {
    const results = evaluateConversation(
      input({ createdReservations: [{ date: '2026-09-24', time: '21:00', partySize: 2 }] }),
    );
    const reservation = results.find((result) => result.name === 'reservation');
    expect(reservation?.passed).toBe(false);
    expect(reservation?.critical).toBe(true);
  });

  it('signale une réservation manquante sans la classer critique', () => {
    const reservation = evaluateConversation(input({ createdReservations: [] })).find(
      (result) => result.name === 'reservation',
    );
    expect(reservation?.passed).toBe(false);
    expect(reservation?.critical).toBe(false);
  });

  it('détecte un horaire inventé, mais admet ceux de l’appelant et du restaurant', () => {
    const transcript = [
      { speaker: 'agent' as const, text: 'Bonjour, ici Test.' },
      { speaker: 'caller' as const, text: 'Demain à 20 h.' },
      { speaker: 'agent' as const, text: 'J’ai 19 h 30 ou 21 h 15. Nous fermons à 22 h 30.' },
    ];
    const results = evaluateConversation(input({ transcript, returnedSlots: ['21:15'] }));
    const check = results.find((result) => result.name === 'no_invented_time');
    expect(check?.passed).toBe(false);
    expect(check?.detail).toContain('19:30');
    expect(check?.detail).not.toContain('21:15');
    expect(check?.detail).not.toContain('22:30');
  });

  it('détecte une répétition de l’accueil et un dépassement de tours', () => {
    const transcript = [
      { speaker: 'agent' as const, text: 'Bonjour, ici Test, je suis son assistant virtuel.' },
      { speaker: 'caller' as const, text: 'Allô ?' },
      { speaker: 'agent' as const, text: 'Bonjour, ici Test. En quoi puis-je vous aider ?' },
    ];
    expect(failed(evaluateConversation(input({ transcript, callerTurns: 20 })))).toEqual(
      expect.arrayContaining(['no_greeting_repeat', 'turns']),
    );
  });

  it('vérifie les outils attendus et interdits', () => {
    const scenario = ScenarioSchema.parse({
      id: 'g',
      category: 'large_group',
      persona: 'p',
      goal: 'g',
      expected: { tools: ['handoffToManager'], forbiddenTools: ['createReservation'] },
    });
    const results = evaluateConversation(
      input({
        scenario,
        createdReservations: [],
        toolCalls: [{ name: 'createReservation', args: {} }],
      }),
    );
    expect(failed(results)).toEqual(
      expect.arrayContaining(['tool:handoffToManager', 'forbidden:createReservation']),
    );
  });

  it('calcule les dates relatives', () => {
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
  });
});

describe('scénarios', () => {
  it('garde un sous-ensemble PR d’une dizaine de scénarios, toutes catégories', () => {
    const pr = loadScenarios().filter((scenario) => scenario.pr);
    expect(pr.length).toBeGreaterThanOrEqual(8);
    expect(pr.length).toBeLessThanOrEqual(12);
    expect(new Set(pr.map((scenario) => scenario.category)).size).toBeGreaterThanOrEqual(8);
  });

  it('charge au moins 50 scénarios valides et couvre toutes les catégories demandées', () => {
    const scenarios = loadScenarios();
    expect(scenarios.length).toBeGreaterThanOrEqual(50);
    const categories = new Set(scenarios.map((scenario) => scenario.category));
    for (const category of [
      'reservation_simple',
      'paraphrase',
      'hesitation',
      'correction',
      'allo',
      'practical_question',
      'large_group',
      'unavailable',
      'english',
    ]) {
      expect(categories.has(category)).toBe(true);
    }
  });

  it('pose « ouvert dimanche ? » à un restaurant ouvert le dimanche', () => {
    const scenarios = loadScenarios();
    expect(
      scenarios.some(
        (scenario) => scenario.restaurant === 'open_sunday' && /dimanche/u.test(scenario.goal),
      ),
    ).toBe(true);
  });
});
