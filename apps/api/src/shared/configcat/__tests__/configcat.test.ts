import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  rolloutBucket,
  isInRollout,
  isFlagEnabled,
  getFlag,
  isVoicePipelineEnabled,
  getRestaurantPlanOverride,
  isFlagEnabledWithRollout,
  FLAGS,
} from '../index';

describe('configcat', () => {
  const ORIGINAL_KEY = process.env.CONFIGCAT_SDK_KEY;

  beforeEach(() => {
    delete process.env.CONFIGCAT_SDK_KEY;
  });

  afterEach(() => {
    if (ORIGINAL_KEY === undefined) {
      delete process.env.CONFIGCAT_SDK_KEY;
    } else {
      process.env.CONFIGCAT_SDK_KEY = ORIGINAL_KEY;
    }
  });

  describe('rolloutBucket', () => {
    it('is deterministic for the same restaurantId', () => {
      expect(rolloutBucket('rest-123')).toBe(rolloutBucket('rest-123'));
    });

    it('returns a value in [0, 100)', () => {
      for (const id of ['a', 'b', 'abc-123', '00000000-0000-0000-0000-000000000000']) {
        const b = rolloutBucket(id);
        expect(b).toBeGreaterThanOrEqual(0);
        expect(b).toBeLessThan(100);
        expect(Number.isInteger(b)).toBe(true);
      }
    });

    it('distributes roughly uniformly across many restaurants', () => {
      const counts = new Array(10).fill(0);
      for (let i = 0; i < 10_000; i += 1) {
        const b = rolloutBucket(`rest-${i}`);
        counts[Math.floor(b / 10)] += 1;
      }
      // Each decile should hold ~1000 entries; allow wide tolerance.
      for (const c of counts) {
        expect(c).toBeGreaterThan(700);
        expect(c).toBeLessThan(1300);
      }
    });
  });

  describe('isInRollout', () => {
    it('returns false for 0%', () => {
      expect(isInRollout('any', 0)).toBe(false);
    });

    it('returns true for 100%', () => {
      expect(isInRollout('any', 100)).toBe(true);
    });

    it('clamps negative values to 0', () => {
      expect(isInRollout('any', -10)).toBe(false);
    });

    it('clamps values >100 to 100', () => {
      expect(isInRollout('any', 200)).toBe(true);
    });

    it('keeps a given restaurant on the same side of the cutoff', () => {
      const id = 'restaurant-abc';
      const inFirst = isInRollout(id, 50);
      const inSecond = isInRollout(id, 50);
      expect(inFirst).toBe(inSecond);
    });
  });

  describe('when SDK key is absent (default-safe mode)', () => {
    it('isFlagEnabled returns the declared default', async () => {
      expect(await isFlagEnabled(FLAGS.VOICE_PIPELINE_ENABLED, 'r1', true)).toBe(true);
      expect(await isFlagEnabled(FLAGS.SPECULATIVE_LLM, 'r1', false)).toBe(false);
    });

    it('getFlag returns the declared default', async () => {
      expect(await getFlag<string>(FLAGS.RESTAURANT_PLAN, 'STARTER', 'r1')).toBe('STARTER');
      expect(await getFlag<number>('missing_number_flag', 42, 'r1')).toBe(42);
    });

    it('isVoicePipelineEnabled defaults to enabled (fail-open kill switch)', async () => {
      expect(await isVoicePipelineEnabled('r1')).toBe(true);
    });

    it('getRestaurantPlanOverride returns the db plan when no flag value', async () => {
      expect(await getRestaurantPlanOverride('r1', 'PRO')).toBe('PRO');
    });
  });

  describe('isFlagEnabledWithRollout', () => {
    it('returns false if the flag is off, regardless of rollout', async () => {
      // SDK key absent → default is false → must be false
      const result = await isFlagEnabledWithRollout('any_flag', 'r1', 100, false);
      expect(result).toBe(false);
    });

    it('honors the rollout cap when flag is on (via default true)', async () => {
      // For flag with default true and 0% rollout, all should be excluded.
      const r1 = await isFlagEnabledWithRollout('any_flag', 'restaurant-1', 0, true);
      const r2 = await isFlagEnabledWithRollout('any_flag', 'restaurant-2', 0, true);
      expect(r1).toBe(false);
      expect(r2).toBe(false);
    });
  });

  describe('getRestaurantPlanOverride', () => {
    it('returns db plan when SDK key is absent (no override possible)', async () => {
      expect(await getRestaurantPlanOverride('r1', 'STARTER')).toBe('STARTER');
      expect(await getRestaurantPlanOverride('r1', 'PREMIUM')).toBe('PREMIUM');
    });
  });

  describe('FLAGS', () => {
    it('exposes the expected stable flag keys', () => {
      expect(FLAGS.VOICE_PIPELINE_ENABLED).toBe('voice_pipeline_enabled');
      expect(FLAGS.SPECULATIVE_LLM).toBe('speculative_llm');
      expect(FLAGS.RESTAURANT_PLAN).toBe('restaurant_plan');
      expect(FLAGS.NEW_FILLER_SYSTEM_V2).toBe('new_filler_system_v2');
    });

    it('every flag key is a non-empty string', () => {
      for (const v of Object.values(FLAGS)) {
        expect(typeof v).toBe('string');
        expect(v.length).toBeGreaterThan(0);
      }
    });
  });
});
