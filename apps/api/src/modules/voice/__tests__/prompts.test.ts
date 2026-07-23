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

    expect(prompt).toContain("Tu es l'assistant vocal chaleureux de Chez Michel.");
    expect(prompt).toContain("L'accueil a déjà été prononcé");
    expect(prompt).toContain('appelle checkAvailability immédiatement dans le même tour');
    expect(prompt).toContain('Tu évites le ton administratif');
    expect(prompt).toContain('EXEMPLES DE FORMULATION');
    expect(prompt).toContain('Non, plutôt 20 h 30.');
    expect(prompt).toContain("Merci, c'est tout.");
    expect(prompt).toContain("Tu n'inventes jamais un horaire");
    expect(prompt).toContain('toute alternative annoncée doit provenir exactement du résultat');
    expect(prompt).not.toContain('Je peux vous proposer 19 h 30 ou 20 h 30');
    expect(prompt).toContain('mercredi 22 juillet 2026, fuseau Europe/Paris');
    expect(prompt).not.toContain('Au tout début de chaque appel');
    expect(prompt).toContain('Lundi : 12:00–14:30');
    expect(prompt).toContain('Dimanche : fermé');
    // Ne doit pas contenir d'extra ni de CRM
    expect(prompt).toContain("handoffToManager : transférer l'appel au gérant");
    expect(prompt).toContain('purchaseGiftCard : vendre une carte cadeau');
    expect(prompt).toContain('recommendGiftCardAmount : conseiller un montant de carte cadeau');
    expect(
      prompt.trim().endsWith('recommendGiftCardAmount : conseiller un montant de carte cadeau'),
    ).toBe(true);
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
