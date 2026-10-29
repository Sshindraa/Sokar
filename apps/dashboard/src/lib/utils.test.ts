import { describe, expect, it } from 'vitest';
import { formatPhone } from './utils';

describe('formatPhone', () => {
  it('espace un numéro français, laisse les autres intacts', () => {
    expect(formatPhone('+33612345678')).toBe('+33 6 12 34 56 78');
    expect(formatPhone('+447911123456')).toBe('+447911123456');
    expect(formatPhone('erased:abc')).toBe('erased:abc');
  });
});
