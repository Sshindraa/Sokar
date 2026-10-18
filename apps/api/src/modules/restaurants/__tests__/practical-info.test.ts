import { describe, expect, it } from 'vitest';
import {
  buildPracticalFacts,
  hasAnsweredPracticalInfo,
  mergePracticalInfo,
  normalizePracticalInfo,
  PracticalInfoUpdateSchema,
  syncManagedFeatures,
} from '../practical-info';

describe('normalizePracticalInfo', () => {
  it('garde les valeurs valides et ignore les autres sans tout rejeter', () => {
    expect(
      normalizePracticalInfo({
        parking: 'onsite',
        pets: 'cats',
        accessible: true,
        menuUrl: 'nope',
      }),
    ).toEqual({ parking: 'onsite', accessible: true });
  });

  it('renvoie un objet vide pour une valeur inattendue', () => {
    expect(normalizePracticalInfo(null)).toEqual({});
    expect(normalizePracticalInfo([])).toEqual({});
    expect(normalizePracticalInfo('x')).toEqual({});
  });
});

describe('PracticalInfoUpdateSchema', () => {
  it('accepte null pour effacer une réponse', () => {
    expect(
      PracticalInfoUpdateSchema.safeParse({ practicalInfo: { parking: null }, dietary: ['vegan'] })
        .success,
    ).toBe(true);
  });

  it('refuse une valeur hors liste et des précisions trop longues', () => {
    expect(
      PracticalInfoUpdateSchema.safeParse({ practicalInfo: { parking: 'garage' } }).success,
    ).toBe(false);
    expect(
      PracticalInfoUpdateSchema.safeParse({ practicalInfo: { notes: 'a'.repeat(501) } }).success,
    ).toBe(false);
  });
});

describe('mergePracticalInfo', () => {
  it('remplace, retire avec null et conserve le reste', () => {
    expect(
      mergePracticalInfo({ parking: 'onsite', kidsMenu: true }, { parking: null, pets: 'yes' }),
    ).toEqual({ kidsMenu: true, pets: 'yes' });
  });
});

describe('syncManagedFeatures', () => {
  it('ajoute, retire et laisse intactes les autres valeurs', () => {
    expect(
      syncManagedFeatures(['brunch', 'terrasse'], { terrace: false, privatization: true }),
    ).toEqual(['brunch', 'privatisation']);
  });

  it('ne touche à rien quand la réponse est absente', () => {
    expect(syncManagedFeatures(['terrasse', 'groupe'], {})).toEqual(['terrasse', 'groupe']);
  });
});

describe('buildPracticalFacts', () => {
  it('ne dit rien d’un fait non précisé', () => {
    expect(buildPracticalFacts({ practicalInfo: {}, dietary: [], ambiance: [] })).toEqual([]);
  });

  it('distingue « oui », « non » et « non précisé »', () => {
    const facts = buildPracticalFacts({
      practicalInfo: { parking: 'none', accessible: true, kidsMenu: false },
    });
    expect(facts).toContain('Il n’y a pas de parking.');
    expect(facts).toContain('Le restaurant est accessible aux personnes à mobilité réduite.');
    expect(facts).toContain('Il n’y a pas de menu enfant.');
    expect(facts.join(' ')).not.toMatch(/animaux|terrasse|privatisation/);
  });

  it('reprend terrasse et privatisation de la fiche Connect quand rien n’est saisi', () => {
    const facts = buildPracticalFacts({ ambiance: ['terrasse', 'privatisation'] });
    expect(facts).toEqual([
      'Le restaurant a une terrasse.',
      'Le restaurant propose la privatisation.',
    ]);
  });

  it('donne la priorité à la réponse saisie sur la fiche Connect', () => {
    const facts = buildPracticalFacts({
      practicalInfo: { terrace: false },
      ambiance: ['terrasse'],
    });
    expect(facts).toEqual(['Le restaurant n’a pas de terrasse.']);
  });

  it('liste les options alimentaires et résume le menu sans épeler l’adresse', () => {
    const facts = buildPracticalFacts({
      practicalInfo: { menuUrl: 'https://exemple.fr/menu.pdf' },
      dietary: ['végétarien', 'vegan'],
    });
    expect(facts).toContain('Options alimentaires proposées : végétarien, vegan.');
    expect(facts).toContain('Le menu est consultable en ligne sur le site du restaurant.');
    expect(facts.join(' ')).not.toContain('exemple.fr');
  });

  it('met les précisions libres sur une seule ligne', () => {
    const facts = buildPracticalFacts({ practicalInfo: { notes: 'Chiens  bienvenus\nle midi' } });
    expect(facts).toEqual(['Autres précisions du restaurateur : Chiens bienvenus le midi']);
  });
});

describe('hasAnsweredPracticalInfo', () => {
  const all = {
    terrace: false,
    parking: 'none',
    accessible: true,
    pets: 'no',
    kidsMenu: false,
    privatization: false,
  };

  it('exige une réponse à chacune des six questions', () => {
    expect(hasAnsweredPracticalInfo(all, [])).toBe(true);
    const { parking: _parking, ...withoutParking } = all;
    expect(hasAnsweredPracticalInfo(withoutParking, [])).toBe(false);
    expect(hasAnsweredPracticalInfo({}, [])).toBe(false);
    expect(hasAnsweredPracticalInfo(null, [])).toBe(false);
  });

  it('compte terrasse et privatisation déjà affichées sur la fiche Connect', () => {
    const { terrace: _terrace, privatization: _privatization, ...rest } = all;
    expect(hasAnsweredPracticalInfo(rest, ['terrasse', 'privatisation'])).toBe(true);
    expect(hasAnsweredPracticalInfo(rest, ['terrasse'])).toBe(false);
  });

  it('laisse libres les options alimentaires, le menu et les précisions', () => {
    expect(hasAnsweredPracticalInfo(all, [])).toBe(true);
  });
});
