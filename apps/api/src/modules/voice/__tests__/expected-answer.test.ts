import { describe, expect, it } from 'vitest';
import { rankExpectedAnswers, resolveExpectedAnswer, toPhonemes } from '../stream/expected-answer';

describe('toPhonemes', () => {
  it('rapproche les graphies qui se prononcent pareil', () => {
    expect(toPhonemes('six personnes')).toBe(toPhonemes('6 personnes'));
    expect(toPhonemes('vingt-deux heures trente')).toBe(toPhonemes('22h30'));
    expect(toPhonemes('personne')).toBe(toPhonemes('personnes'));
  });
});

describe('resolveExpectedAnswer', () => {
  // Transcriptions réelles de Scribe au téléphone (appels et banc du 24/09).
  it('classe « six » en tête pour « super femme »', () => {
    const [best] = rankExpectedAnswers('Pour super femme.', 'partySize');
    expect(best.value).toBe('6');
  });

  it.each([
    ['Euh, sick person.', '6'],
    ['Voici personne demain soir', '6'],
  ])('propose un choix qui contient la bonne valeur pour « %s »', (transcript, expected) => {
    const decision = resolveExpectedAnswer(transcript, 'partySize');
    expect(decision.status).toBe('choice');
    expect(decision.status === 'choice' && decision.values).toContain(expected);
  });

  it('accepte un jour prononcé sans ambiguïté', () => {
    expect(resolveExpectedAnswer('un dimanche', 'weekday')).toMatchObject({
      status: 'accepted',
      value: 'dimanche',
    });
  });

  it('ne retient rien quand aucune réponse attendue n’est proche', () => {
    expect(resolveExpectedAnswer('Je voudrais parler au responsable', 'partySize').status).toBe(
      'unresolved',
    );
  });

  it('limite les horaires aux créneaux fournis', () => {
    const decision = resolveExpectedAnswer('Vente de dessert, trente', 'time', ['22:30', '20:00']);
    expect(decision.candidates[0].value).toBe('22:30');
  });
});
