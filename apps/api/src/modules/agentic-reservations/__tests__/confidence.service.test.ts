import { describe, expect, it } from 'vitest';
import {
  computeAttributeConfidence,
  computeRestaurantConfidence,
  MAX_CONFIDENCE,
  STALE_DECAY_DAYS,
  type AttributeInput,
} from '../core/confidence.service.js';

const NOW = new Date('2026-06-21T12:00:00.000Z');

describe('confidence.service', () => {
  describe('MAX_CONFIDENCE', () => {
    it('merchant_declared cap 0.9', () => {
      expect(MAX_CONFIDENCE.merchant_declared).toBe(0.9);
    });
    it('review_inferred cap 0.7', () => {
      expect(MAX_CONFIDENCE.review_inferred).toBe(0.7);
    });
    it('manual_verified cap 1.0', () => {
      expect(MAX_CONFIDENCE.manual_verified).toBe(1.0);
    });
    it('unknown 0', () => {
      expect(MAX_CONFIDENCE.unknown).toBe(0);
    });
  });

  describe('computeAttributeConfidence', () => {
    it('retourne 0 si aucun input', () => {
      const r = computeAttributeConfidence([], NOW);
      expect(r.source).toBe('unknown');
      expect(r.raw).toBe(0);
      expect(r.final).toBe(0);
      expect(r.stale).toBe(false);
    });

    it('merchant_declared → 0.9', () => {
      const r = computeAttributeConfidence([{ source: 'merchant_declared', verifiedAt: NOW }], NOW);
      expect(r.source).toBe('merchant_declared');
      expect(r.raw).toBe(0.9);
      expect(r.final).toBe(0.9);
      expect(r.stale).toBe(false);
    });

    it('manual_verified → 1.0', () => {
      const r = computeAttributeConfidence([{ source: 'manual_verified', verifiedAt: NOW }], NOW);
      expect(r.source).toBe('manual_verified');
      expect(r.raw).toBe(1.0);
      expect(r.final).toBe(1.0);
    });

    it('review_inferred < merchant_declared', () => {
      const r = computeAttributeConfidence(
        [
          { source: 'review_inferred', verifiedAt: NOW },
          { source: 'merchant_declared', verifiedAt: NOW },
        ],
        NOW,
      );
      expect(r.source).toBe('merchant_declared');
      expect(r.raw).toBe(0.9);
    });

    it('review_inferred gagne si pas de déclaration', () => {
      const r = computeAttributeConfidence([{ source: 'review_inferred', verifiedAt: NOW }], NOW);
      expect(r.source).toBe('review_inferred');
      expect(r.raw).toBe(0.7);
    });

    it('stale decay après 180 jours', () => {
      const oldDate = new Date(NOW.getTime() - (STALE_DECAY_DAYS + 1) * 86_400_000);
      const r = computeAttributeConfidence(
        [{ source: 'merchant_declared', verifiedAt: oldDate }],
        NOW,
      );
      expect(r.stale).toBe(true);
      expect(r.raw).toBe(0.9);
      expect(r.final).toBe(0.8);
    });

    it('stale decay ne descend pas en dessous de 0', () => {
      const ancient = new Date(NOW.getTime() - 1000 * 86_400_000);
      const r = computeAttributeConfidence(
        [{ source: 'review_inferred', verifiedAt: ancient }],
        NOW,
      );
      expect(r.final).toBeGreaterThanOrEqual(0);
    });

    it('pas de stale decay si verifiedAt null', () => {
      const r = computeAttributeConfidence(
        [{ source: 'merchant_declared', verifiedAt: null }],
        NOW,
      );
      expect(r.stale).toBe(false);
      expect(r.verifiedAt).toBeNull();
    });

    it('source la plus récente gagne à cap égal', () => {
      const inputs: AttributeInput[] = [
        { source: 'merchant_declared', verifiedAt: '2026-01-01T00:00:00Z' },
        { source: 'merchant_declared', verifiedAt: '2026-05-01T00:00:00Z' },
      ];
      const r = computeAttributeConfidence(inputs, NOW);
      expect(r.verifiedAt).toBe('2026-05-01T00:00:00.000Z');
    });

    it('accepte Date et string pour verifiedAt', () => {
      const r1 = computeAttributeConfidence(
        [{ source: 'manual_verified', verifiedAt: new Date('2026-06-21T10:00:00Z') }],
        NOW,
      );
      const r2 = computeAttributeConfidence(
        [{ source: 'manual_verified', verifiedAt: '2026-06-21T10:00:00Z' }],
        NOW,
      );
      expect(r1.verifiedAt).toBe(r2.verifiedAt);
    });
  });

  describe('computeRestaurantConfidence', () => {
    it("retourne 0 si pas d'attributs", () => {
      expect(computeRestaurantConfidence({})).toBe(0);
    });

    it('moyenne de plusieurs attributs', () => {
      const conf = computeRestaurantConfidence({
        cuisine: {
          source: 'manual_verified',
          raw: 1.0,
          final: 1.0,
          verifiedAt: null,
          stale: false,
        },
        ambiance: {
          source: 'merchant_declared',
          raw: 0.9,
          final: 0.9,
          verifiedAt: null,
          stale: false,
        },
      });
      expect(conf).toBeCloseTo(0.95, 5);
    });
  });
});
