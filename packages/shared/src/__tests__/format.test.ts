import { describe, it, expect } from 'vitest';
import { formatEuro } from '../utils/format';

describe('formatEuro', () => {
  it('formats a whole number with 2 decimal places', () => {
    expect(formatEuro(50)).toMatch(/^50,00\s€$/);
  });

  it('formats a decimal amount', () => {
    expect(formatEuro(19.99)).toMatch(/^19,99\s€$/);
  });

  it('formats zero', () => {
    expect(formatEuro(0)).toMatch(/^0,00\s€$/);
  });

  it('formats a large amount with thousands separator', () => {
    expect(formatEuro(1000)).toMatch(/^1\s000,00\s€$/);
  });

  it('formats a decimal with a trailing zero', () => {
    expect(formatEuro(10.5)).toMatch(/^10,50\s€$/);
  });

  it('formats a negative amount', () => {
    expect(formatEuro(-50)).toMatch(/^-50,00\s€$/);
  });

  it('rounds a value with more than 2 decimal places up', () => {
    expect(formatEuro(19.999)).toMatch(/^20,00\s€$/);
  });

  it('formats a very small amount', () => {
    expect(formatEuro(0.01)).toMatch(/^0,01\s€$/);
  });

  it('rounds a tiny amount down to 2 decimal places', () => {
    expect(formatEuro(0.001)).toMatch(/^0,00\s€$/);
  });
});
