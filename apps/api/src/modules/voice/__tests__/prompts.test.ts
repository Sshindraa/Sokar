import { describe, it, expect } from 'vitest';
import { buildSystemPrompt } from '../prompts';

describe('buildSystemPrompt', () => {
  const baseCtx = {
    name: 'Chez Michel',
    openingHours: {
      mon: { open: '12:00', close: '14:30' },
      tue: { open: '12:00', close: '14:30' },
      wed: { open: '12:00', close: '14:30' },
      thu: { open: '12:00', close: '14:30' },
      fri: { open: '12:00', close: '14:30' },
      sat: { open: '19:00', close: '23:00' },
      sun: null,
    },
    personality: null,
  };

  it('devrait generer le prompt de base sans CRM ni prompt extra', () => {
    const prompt = buildSystemPrompt(baseCtx, new Date('2026-07-22T10:00:00Z'));

    expect(prompt).toContain("L'accueil a déjà été prononcé");
    expect(prompt).toContain('RESTAURANT : Chez Michel');
    expect(prompt).toContain('appelle checkAvailability dans le même tour');
    expect(prompt).toContain('Pas de ton administratif');
    expect(prompt).toContain('réponds honnêtement');
    expect(prompt).toContain('mercredi 22 juillet 2026, fuseau Europe/Paris');
    expect(prompt).toContain('Lundi : 12:00–14:30');
    expect(prompt).toContain('Dimanche : fermé');
    expect(prompt).toContain('montant minimum 10 €');
    expect(prompt).toContain("handoffToManager : transférer l'appel au gérant");
    expect(prompt).toContain('purchaseGiftCard : vendre une carte cadeau');
    expect(prompt).toContain('recommendGiftCardAmount : conseiller un montant de carte cadeau');
  });

  it('organise le prompt en blocs, avec des dialogues complets', () => {
    const prompt = buildSystemPrompt(baseCtx, new Date('2026-07-22T10:00:00Z'));
    const blocks = [
      'IDENTITÉ ET TON',
      'RÈGLES MÉTIER NON NÉGOCIABLES',
      'EXEMPLES DE DIALOGUES',
      'OUTILS',
      "CONTEXTE DE L'APPEL",
    ].map((title) => prompt.indexOf(title));
    expect(blocks.every((index) => index >= 0)).toBe(true);
    expect([...blocks].sort((a, b) => a - b)).toEqual(blocks);
    for (const dialogue of [
      'Réservation simple :',
      'Correction :',
      'Indisponibilité :',
      'Question pratique :',
    ]) {
      expect(prompt).toContain(dialogue);
    }
  });

  it('retire les listes de synonymes et les hésitations artificielles', () => {
    const prompt = buildSystemPrompt(baseCtx);
    expect(prompt).not.toContain('Voyons voir');
    expect(prompt).not.toMatch(/Alterne avec/u);
    expect(prompt).not.toMatch(/« Super », « Noté »/u);
  });

  it('garde un préfixe identique entre restaurants, dates et clients', () => {
    const a = buildSystemPrompt(baseCtx, new Date('2026-07-22T10:00:00Z'));
    const b = buildSystemPrompt(
      {
        ...baseCtx,
        name: 'Le Bistrot',
        customerExtra: 'Client régulier.',
        customerGreeting: 'ravi de vous réentendre',
        giftCardMinimumAmount: 25,
      },
      new Date('2026-12-01T18:00:00Z'),
    );
    const prefixEnd = a.indexOf("CONTEXTE DE L'APPEL");
    expect(prefixEnd).toBeGreaterThan(1_000);
    expect(b.slice(0, prefixEnd)).toBe(a.slice(0, prefixEnd));
    expect(a.slice(0, prefixEnd)).not.toContain('Chez Michel');
  });

  it('reste plus court que l’ancien prompt (5 867 caractères)', () => {
    expect(buildSystemPrompt(baseCtx).length).toBeLessThan(5_000);
  });

  it('devrait inclure customerExtra quand fourni dans le contexte', () => {
    const customerExtra = "Le client s'appelle Jean-Pierre. C'est sa 5e visite. ⭐ Client VIP.";
    const prompt = buildSystemPrompt({
      ...baseCtx,
      customerExtra,
    });

    expect(prompt).toContain('Jean-Pierre');
    expect(prompt).toContain('5e visite');
    expect(prompt).toContain('⭐ Client VIP.');
    expect(prompt).toContain(customerExtra);
  });

  it('devrait inclure systemPromptExtra de la personnalité quand fourni', () => {
    const systemPromptExtra = 'Sois très jovial et plaisante sur les plats du jour.';
    const prompt = buildSystemPrompt({
      ...baseCtx,
      personality: {
        fillerStyle: 'CASUAL',
        systemPromptExtra,
      },
    });

    expect(prompt).toContain(systemPromptExtra);
    expect(prompt.trim().endsWith(systemPromptExtra)).toBe(true);
  });

  it('devrait inclure a la fois customerExtra et systemPromptExtra dans le bon ordre', () => {
    const customerExtra = "Le client s'appelle Alice.";
    const systemPromptExtra = "Parle avec l'accent marseillais.";
    const prompt = buildSystemPrompt({
      ...baseCtx,
      customerExtra,
      personality: {
        fillerStyle: 'CASUAL',
        systemPromptExtra,
      },
    });

    expect(prompt).toContain(customerExtra);
    expect(prompt).toContain(systemPromptExtra);

    const lines = prompt
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean);
    const lastLine = lines[lines.length - 1];
    const secondLastLine = lines[lines.length - 2];

    expect(lastLine).toBe(systemPromptExtra);
    expect(secondLastLine).toBe(customerExtra);
  });

  it('devrait injecter le customerGreeting VIP dans les instructions de continuité', () => {
    const customerGreeting = ', content de vous revoir M. Jean';
    const prompt = buildSystemPrompt({
      ...baseCtx,
      customerGreeting,
    });

    expect(prompt).toContain('CLIENT RECONNU');
    expect(prompt).toContain(customerGreeting);
    const ruleIdx = prompt.indexOf('CLIENT RECONNU');
    const greetIdx = prompt.indexOf(customerGreeting);
    expect(greetIdx).toBeGreaterThan(ruleIdx);
    expect(greetIdx).toBeLessThan(ruleIdx + 200);
  });
});
