import { describe, it, expect } from 'vitest';
import {
  CALL_INTENT_VALUES,
  CALL_OUTCOME_VALUES,
  CALL_INTENT_LABELS,
  CALL_OUTCOME_LABELS,
  normalizeCallEndedReason,
} from '../call';

describe('call', () => {
  it('every intent/outcome has a label (no UI holes)', () => {
    for (const i of CALL_INTENT_VALUES) {
      expect(CALL_INTENT_LABELS[i], `intent label for ${i}`).toBeTypeOf('string');
    }
    for (const o of CALL_OUTCOME_VALUES) {
      expect(CALL_OUTCOME_LABELS[o], `outcome label for ${o}`).toBeTypeOf('string');
    }
  });

  describe('normalizeCallEndedReason', () => {
    it('returns the input if it matches a known reason', () => {
      expect(normalizeCallEndedReason('customer-ended-call')).toBe('customer-ended-call');
      expect(normalizeCallEndedReason('transfer')).toBe('transfer');
    });

    it('returns "other" for null/undefined/empty', () => {
      expect(normalizeCallEndedReason(null)).toBe('other');
      expect(normalizeCallEndedReason(undefined)).toBe('other');
      expect(normalizeCallEndedReason('')).toBe('other');
    });

    it('returns "other" for unknown carrier strings (defensive)', () => {
      // Telnyx sometimes emits freeform reasons; we never want to crash
      // the dashboard on an unexpected value.
      expect(normalizeCallEndedReason('telnyx-weird-reason-9000')).toBe('other');
    });
  });
});
