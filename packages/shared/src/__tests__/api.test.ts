import { describe, it, expect } from 'vitest';
import { ERROR_CODE_VALUES, ERROR_CODE_MESSAGES, type ErrorCode } from '../api';

describe('api', () => {
  it('every error code has a French default message', () => {
    for (const c of ERROR_CODE_VALUES) {
      expect(ERROR_CODE_MESSAGES[c], `message for ${c}`).toBeTypeOf('string');
      expect(ERROR_CODE_MESSAGES[c].length).toBeGreaterThan(0);
    }
  });

  it('ErrorCode type covers every code value', () => {
    // This assignment only compiles if every value satisfies the type
    const all: ErrorCode[] = ERROR_CODE_VALUES;
    expect(all.length).toBeGreaterThan(0);
  });
});
