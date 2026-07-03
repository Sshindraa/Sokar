/**
 * Tests pour la page widget /widget/[slug].
 *
 * Couvre la validation des couleurs passées en query param.
 */

import { describe, it, expect } from 'vitest';
import { toHexColor } from '@/lib/widget-colors';

describe('toHexColor', () => {
  it('accepts a hex color without hash', () => {
    expect(toHexColor('0f172a', '#EA580C')).toBe('#0f172a');
  });

  it('accepts a hex color with hash', () => {
    expect(toHexColor('#f97316', '#0F172A')).toBe('#f97316');
  });

  it('falls back on invalid color', () => {
    expect(toHexColor('not-a-color', '#0F172A')).toBe('#0F172A');
  });

  it('falls back when value is missing', () => {
    expect(toHexColor(undefined, '#0F172A')).toBe('#0F172A');
  });
});
