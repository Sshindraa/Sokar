import { describe, expect, it, vi } from 'vitest';
import { deriveDisplayName, isFaithfulName, stripLocationSuffix } from '../place-display-name';

const lyon = { city: 'Lyon', postalCode: '69002' };

describe('stripLocationSuffix', () => {
  it.each([
    ['Little Italy lyon 2', 'Little Italy'],
    ['Little Italy Lyon 2ème', 'Little Italy'],
    ['Pizzeria Napoli - Lyon', 'Pizzeria Napoli'],
    ['Chez Marcel, Lyon 6', 'Chez Marcel'],
    ['Le Bouchon 69002', 'Le Bouchon 69002'],
    ['Le Bouchon Lyon 69002', 'Le Bouchon'],
  ])('%s → %s', (name, expected) => {
    expect(stripLocationSuffix({ name, ...lyon })).toBe(expected);
  });

  it.each([
    'Café de Lyon',
    'Le Comptoir Lyonnais',
    'Brasserie Lyon',
    'Lyon',
    'Lyon 2',
    'Le Lyon 2000',
  ])('garde %s tel quel', (name) => {
    expect(stripLocationSuffix({ name, ...lyon })).toBe(name);
  });

  it('gère une ville en plusieurs mots', () => {
    expect(
      stripLocationSuffix({
        name: 'Le Petit Zinc - Saint-Étienne',
        city: 'Saint-Étienne',
        postalCode: '42000',
      }),
    ).toBe('Le Petit Zinc');
  });
});

describe('isFaithfulName', () => {
  it('accepte un retrait de mots dans le même ordre', () => {
    expect(isFaithfulName('Little Italy', 'Little Italy lyon 2')).toBe(true);
    expect(isFaithfulName('Pizzeria Napoli', 'Pizzeria Napoli - Restaurant italien Lyon 6')).toBe(
      true,
    );
  });

  it('refuse un mot ajouté, un ordre changé ou une réponse vide', () => {
    expect(isFaithfulName('Little Italy Pizzeria', 'Little Italy lyon 2')).toBe(false);
    expect(isFaithfulName('Italy Little', 'Little Italy lyon 2')).toBe(false);
    expect(isFaithfulName('', 'Little Italy lyon 2')).toBe(false);
  });
});

describe('deriveDisplayName', () => {
  it("n'appelle pas le LLM quand la règle suffit", async () => {
    const llm = vi.fn();
    await expect(deriveDisplayName({ name: 'Little Italy lyon 2', ...lyon }, llm)).resolves.toBe(
      'Little Italy',
    );
    expect(llm).not.toHaveBeenCalled();
  });

  it("n'appelle pas le LLM pour un nom d'un seul mot", async () => {
    const llm = vi.fn();
    await expect(deriveDisplayName({ name: 'Bouillon', ...lyon }, llm)).resolves.toBe('Bouillon');
    expect(llm).not.toHaveBeenCalled();
  });

  it('utilise la proposition du LLM quand elle ne fait que retirer des mots', async () => {
    const llm = vi.fn().mockResolvedValue('Pizzeria Napoli');
    await expect(
      deriveDisplayName({ name: 'Pizzeria Napoli Restaurant italien Presqu’île', ...lyon }, llm),
    ).resolves.toBe('Pizzeria Napoli');
  });

  it('ignore une proposition qui invente des mots', async () => {
    const llm = vi.fn().mockResolvedValue('Trattoria Napoli');
    await expect(
      deriveDisplayName({ name: 'Pizzeria Napoli Restaurant italien', ...lyon }, llm),
    ).resolves.toBe('Pizzeria Napoli Restaurant italien');
  });

  it('rend le nom Google si le LLM échoue ou ne répond pas', async () => {
    await expect(
      deriveDisplayName(
        { name: 'Pizzeria Napoli Restaurant italien', ...lyon },
        vi.fn().mockRejectedValue(new Error('timeout')),
      ),
    ).resolves.toBe('Pizzeria Napoli Restaurant italien');
    await expect(
      deriveDisplayName(
        { name: 'Pizzeria Napoli Restaurant italien', ...lyon },
        vi.fn().mockResolvedValue(null),
      ),
    ).resolves.toBe('Pizzeria Napoli Restaurant italien');
  });
});
