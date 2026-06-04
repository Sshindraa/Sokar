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
    const prompt = buildSystemPrompt(baseCtx);

    expect(prompt).toContain("Tu es l'assistant vocal de Chez Michel.");
    expect(prompt).toContain('Bonjour, Chez Michel, cet appel peut être enregistré à des fins de qualité de service.');
    expect(prompt).toContain('Lundi : 12:00–14:30');
    expect(prompt).toContain('Dimanche : fermé');
    // Ne doit pas contenir d'extra ni de CRM
    expect(prompt.trim().endsWith('handoffToManager : transférer l\'appel au gérant')).toBe(true);
  });

  it('devrait inclure customerExtra quand fourni dans le contexte', () => {
    const customerExtra = "Le client s'appelle Jean-Pierre. C'est sa 5e visite. ⭐ Client VIP.";
    const prompt = buildSystemPrompt({
      ...baseCtx,
      customerExtra,
    });

    expect(prompt).toContain("Jean-Pierre");
    expect(prompt).toContain("5e visite");
    expect(prompt).toContain("⭐ Client VIP.");
    expect(prompt).toContain(customerExtra);
  });

  it('devrait inclure systemPromptExtra de la personnalité quand fourni', () => {
    const systemPromptExtra = "Sois très jovial et plaisante sur les plats du jour.";
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
    
    const lines = prompt.split('\n').map(l => l.trim()).filter(Boolean);
    const lastLine = lines[lines.length - 1];
    const secondLastLine = lines[lines.length - 2];

    expect(lastLine).toBe(systemPromptExtra);
    expect(secondLastLine).toBe(customerExtra);
  });
});
