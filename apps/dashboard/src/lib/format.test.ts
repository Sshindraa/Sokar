import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { formatDuration, formatEUR, formatPercent, formatRelativeDateTime } from './format';

describe('formatEUR', () => {
  it('formate en euros fr-FR et utilise le repli pour une valeur absente', () => {
    expect(formatEUR(12.5)).toMatch(/^12,50\s€$/);
    expect(formatEUR('8')).toMatch(/^8,00\s€$/);
    expect(formatEUR(null)).toBe('—');
    expect(formatEUR(null, 'À rapprocher')).toBe('À rapprocher');
    expect(formatEUR('pas un nombre', 'Non renseigné')).toBe('Non renseigné');
  });
});

describe('formatPercent', () => {
  it('convertit un ratio en pourcentage fr-FR', () => {
    expect(formatPercent(0.45)).toMatch(/^45\s%$/);
    expect(formatPercent(null)).toBe('—');
    expect(formatPercent(Number.NaN, 'n.d.')).toBe('n.d.');
  });
});

describe('formatDuration', () => {
  it('écrit minutes et secondes, et le repli pour zéro ou absent', () => {
    expect(formatDuration(192)).toBe('3 min 12 s');
    expect(formatDuration(120)).toBe('2 min');
    expect(formatDuration(45)).toBe('45 s');
    expect(formatDuration(0)).toBe('—');
    expect(formatDuration(null, '—')).toBe('—');
  });
});

describe('formatRelativeDateTime', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 9, 28, 12, 0, 0));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('écrit Aujourd’hui et Hier, puis la date courte', () => {
    expect(formatRelativeDateTime(new Date(2026, 9, 28, 9, 5))).toBe('Aujourd’hui, 09:05');
    expect(formatRelativeDateTime(new Date(2026, 9, 27, 18, 30))).toBe('Hier, 18:30');
    expect(formatRelativeDateTime(new Date(2026, 9, 20, 10, 0))).toMatch(/^20 oct\.?, 10:00$/);
  });

  it("ajoute l'année hors année courante et renvoie le repli pour une date invalide", () => {
    expect(formatRelativeDateTime(new Date(2025, 0, 3, 8, 15))).toMatch(/^3 janv\.? 2025, 08:15$/);
    expect(formatRelativeDateTime('pas une date')).toBe('—');
    expect(formatRelativeDateTime(null, 'Jamais')).toBe('Jamais');
  });
});
