import { describe, it, expect } from 'vitest';
import { tokenize } from '../call-report/tokens';
import { alignTokens, divergenceRuns } from '../call-report/align';

describe('tokenize', () => {
  it('découpe sans ponctuation, en minuscules, en gardant les élisions', () => {
    expect(tokenize("S'il vous plaît, a2m. Midi-trempe")).toEqual([
      "s'il",
      'vous',
      'plaît',
      'a',
      '2',
      'm',
      'midi',
      'trempe',
    ]);
  });

  it("traite l'apostrophe typographique comme l'apostrophe droite", () => {
    expect(tokenize('c’est')).toEqual(["c'est"]);
  });

  it('sépare les lettres des chiffres collés', () => {
    expect(tokenize('a2f 35')).toEqual(['a', '2', 'f', '35']);
  });

  it('renvoie une liste vide pour un texte sans mot', () => {
    expect(tokenize(' … ')).toEqual([]);
  });
});

describe('alignTokens', () => {
  it('aligne deux suites identiques sans écart', () => {
    const ops = alignTokens(['a', 'b', 'c'], ['a', 'b', 'c']);
    expect(ops.map((op) => op.type)).toEqual(['match', 'match', 'match']);
  });

  it('repère une lettre isolée perdue comme une suppression', () => {
    const ops = alignTokens(['a', 'deux', 's', 'a', 'deux', 'm'], ['a', 'deux', 's', 'deux', 'm']);
    expect(ops.filter((op) => op.type !== 'match')).toEqual([{ type: 'del', refIndex: 3 }]);
  });

  it('aligne deux mots proches comme une substitution, pas comme une suppression plus insertion', () => {
    const ops = alignTokens(['nom', 'assam'], ['nom', 'assan']);
    expect(ops.filter((op) => op.type !== 'match')).toEqual([
      { type: 'sub', refIndex: 1, hypIndex: 1 },
    ]);
  });

  it('repère un mot ajouté', () => {
    const ops = alignTokens(['bonjour', 'madame'], ['bonjour', 'euh', 'madame']);
    expect(ops.filter((op) => op.type !== 'match')).toEqual([{ type: 'ins', hypIndex: 1 }]);
  });
});

describe('divergenceRuns', () => {
  it('regroupe les insertions consécutives en une plage', () => {
    const ref = ['a', 'deux', 's', 'a', 'deux', 'm', 'oui'];
    const hyp = ['a', 'deux', 's', 'a', 'deux', 'f', 'a', '2', 'm', 'oui'];
    const runs = divergenceRuns(ref, hyp, alignTokens(ref, hyp));
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({ refStart: 5, hypStart: 5 });
    expect(runs[0].ref).toEqual([]);
    expect(runs[0].hyp).toEqual(['f', 'a', '2']);
  });

  it('ne renvoie rien quand tout concorde', () => {
    const tokens = ['bonjour', 'madame'];
    expect(divergenceRuns(tokens, tokens, alignTokens(tokens, tokens))).toEqual([]);
  });
});
