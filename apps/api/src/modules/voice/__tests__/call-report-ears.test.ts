import { describe, it, expect } from 'vitest';
import { compareEars, isSpelledAt } from '../call-report/ears';
import { tokenize } from '../call-report/tokens';

describe('isSpelledAt', () => {
  it('reconnaît une épellation (lettres isolées adjacentes)', () => {
    const tokens = tokenize('mon nom est h o u e t merci');
    expect(isSpelledAt(tokens, 3)).toBe(true);
    expect(isSpelledAt(tokens, 7)).toBe(true);
    expect(isSpelledAt(tokens, 1)).toBe(false);
  });

  it('ne prend pas pour une épellation une lettre qui est un mot (« il a », « à 8 h »)', () => {
    expect(isSpelledAt(tokenize('il a mangé'), 1)).toBe(false);
    expect(isSpelledAt(tokenize('à 8 h'), 0)).toBe(false);
    expect(isSpelledAt(tokenize('à 8 h'), 2)).toBe(false);
  });

  it('suit une épellation qui mêle lettres et chiffres', () => {
    const tokens = tokenize('a 2 s a 2 m');
    expect(tokens.every((_, index) => isSpelledAt(tokens, index))).toBe(true);
  });
});

describe('compareEars', () => {
  it('ne signale rien quand les trois oreilles concordent', () => {
    const text = 'je voudrais réserver pour quatre';
    expect(compareEars({ live: text, engines: { nova: text, whisper: text } })).toEqual([]);
  });

  it('signale une lettre perdue en direct que les deux oreilles après coup entendent (8043662c)', () => {
    const result = compareEars({
      live: 'au nom de assam a m',
      engines: {
        nova: 'au nom de assam a 2 s a 2 m',
        whisper: 'au nom de assam a deux s a deux m',
      },
    });
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ kind: 'isolated_letters', severity: 'high' });
    expect(result[0].live).toContain('a m');
  });

  it('signale une lettre isolée lue comme un mot, hors épellation (« deux s » dit « deux secondes »)', () => {
    const result = compareEars({
      live: 'avec deux s et deux m',
      engines: { nova: 'avec deux secondes et deux mètres' },
    });
    expect(result.length).toBeGreaterThan(0);
    expect(result.every((item) => item.kind === 'isolated_letters')).toBe(true);
  });

  it('signale « midi 30 » entendu « midi 35 » comme un nombre', () => {
    const result = compareEars({
      live: 'plutôt midi 30 merci',
      engines: { nova: 'plutôt midi 35 merci', whisper: 'plutôt midi trempe 5 5 merci' },
    });
    expect(result).toHaveLength(1);
    expect(result[0].kind).toBe('number');
  });

  it("signale qu'une seule oreille diffère sur une lettre", () => {
    const result = compareEars({
      live: 'h o u e t',
      engines: { nova: 'h o u e t', whisper: 'h o u e s' },
    });
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      kind: 'isolated_letters',
      severity: 'high',
      agreement: 'one_engine_differs',
      differing: ['whisper'],
    });
  });

  it('signale les deux oreilles après coup contre le direct sur un nombre', () => {
    const result = compareEars({
      live: 'nous sommes 4',
      engines: { nova: 'nous sommes 5', whisper: 'nous sommes 5' },
    });
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      kind: 'number',
      severity: 'high',
      agreement: 'engines_agree_against_live',
    });
  });

  it('signale que les trois oreilles divergent entre elles sur un nombre', () => {
    const result = compareEars({
      live: 'nous sommes 4',
      engines: { nova: 'nous sommes 5', whisper: 'nous sommes 6' },
    });
    expect(result[0]).toMatchObject({ kind: 'number', agreement: 'all_differ' });
  });

  it('classe « deux » contre « 2 » comme une différence de forme, de gravité moyenne', () => {
    const result = compareEars({
      live: 'nous sommes deux',
      engines: { nova: 'nous sommes 2', whisper: 'nous sommes 2' },
    });
    expect(result[0]).toMatchObject({ kind: 'number_form', severity: 'medium' });
  });

  it('classe un mot ordinaire en gravité basse', () => {
    const result = compareEars({
      live: 'bonjour madame',
      engines: { nova: 'bonjour monsieur', whisper: 'bonjour monsieur' },
    });
    expect(result[0]).toMatchObject({ kind: 'word', severity: 'low' });
  });

  it('fonctionne avec une seule oreille après coup', () => {
    const result = compareEars({ live: 'a m', engines: { nova: 'a 2 m' } });
    expect(result).toHaveLength(1);
    expect(result[0].agreement).toBe('engine_differs');
  });
});
