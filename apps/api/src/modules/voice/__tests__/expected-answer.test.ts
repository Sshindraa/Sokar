import { describe, expect, it } from 'vitest';
import { rankExpectedAnswers, resolveExpectedAnswer, toPhonemes } from '../stream/expected-answer';

describe('toPhonemes', () => {
  it('rapproche les graphies qui se prononcent pareil', () => {
    expect(toPhonemes('six personnes')).toBe(toPhonemes('6 personnes'));
    expect(toPhonemes('vingt-deux heures trente')).toBe(toPhonemes('22h30'));
    expect(toPhonemes('personne')).toBe(toPhonemes('personnes'));
  });
});

describe('resolveExpectedAnswer — valeurs exactes', () => {
  it.each([
    ['six personnes', '6'],
    ['deux personnes', '2'],
    ['Euh, on sera six.', '6'],
    ['euh… on sera six', '6'],
  ])('retient « %s » → %s', (transcript, value) => {
    expect(resolveExpectedAnswer(transcript, 'partySize')).toMatchObject({
      status: 'accepted',
      value,
    });
  });

  it('retient un jour prononcé sans ambiguïté', () => {
    expect(resolveExpectedAnswer('un dimanche', 'weekday')).toMatchObject({
      status: 'accepted',
      value: 'dimanche',
    });
  });
});

describe('resolveExpectedAnswer — confusions du téléphone', () => {
  // Transcriptions réelles de Scribe au téléphone (appels et banc du 24/09).
  it('classe « six » en tête pour « super femme »', () => {
    expect(rankExpectedAnswers('Pour super femme.', 'partySize')[0].value).toBe('6');
  });

  it.each([
    ['Euh, sick person.', '6'],
    ['Voici personne demain soir', '6'],
  ])('propose un choix qui contient la bonne valeur pour « %s »', (transcript, expected) => {
    const decision = resolveExpectedAnswer(transcript, 'partySize');
    expect(decision.status).toBe('choice');
    expect(decision.status === 'choice' && decision.values).toContain(expected);
  });
});

describe('resolveExpectedAnswer — paires pièges', () => {
  it.each([
    ['tisz personnes', 'partySize', ['6', '10']],
    ['dou personnes', 'partySize', ['2', '12']],
    ['tras personnes', 'partySize', ['3', '13']],
    ['sise personnes', 'partySize', ['16', '6']],
    ['vin d heures', 'time', ['20:00', '22:00']],
    ['ouit heures', 'time', ['08:00', '20:00']],
  ] as const)('« %s » donne un choix entre %j', (transcript, kind, values) => {
    const decision = resolveExpectedAnswer(
      transcript,
      kind,
      kind === 'time' ? ['08:00', '20:00', '22:00'] : undefined,
    );
    expect(decision.status).toBe('choice');
    expect(decision.status === 'choice' && [...decision.values].sort()).toEqual([...values].sort());
  });
});

describe('resolveExpectedAnswer — réponses hors sujet', () => {
  it.each([
    ['C’est pour un anniversaire', 'partySize'],
    ['Je sais pas encore', 'partySize'],
    ['Allô ?', 'partySize'],
    ['Je voudrais parler au responsable', 'partySize'],
    ['C’est pour ce soir', 'partySize'],
    ['Au nom de Martin', 'weekday'],
    ['Je sais pas encore', 'weekday'],
    ['Allô ?', 'time'],
    ['Plutôt en terrasse', 'time'],
  ] as const)('« %s » (%s) reste non résolu', (transcript, kind) => {
    expect(resolveExpectedAnswer(transcript, kind).status).toBe('unresolved');
  });
});

describe('resolveExpectedAnswer — heures possibles', () => {
  it('limite les candidats aux horaires fournis', () => {
    const decision = resolveExpectedAnswer('Vente de dessert, trente', 'time', ['22:30', '20:00']);
    expect(decision.candidates.map((candidate) => candidate.value)).toEqual(['22:30', '20:00']);
  });

  it('garde la liste par défaut sans horaires fournis', () => {
    expect(rankExpectedAnswers('vingt heures', 'time').length).toBeGreaterThan(10);
  });
});
