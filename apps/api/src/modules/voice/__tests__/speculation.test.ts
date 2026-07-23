import { afterEach, describe, expect, it } from 'vitest';
import { isSpeculativeLlmEnabled } from '../stream/speculation';

const previousEnabled = process.env.SPECULATIVE_LLM_ENABLED;
const previousRestaurantIds = process.env.SPECULATIVE_LLM_RESTAURANT_IDS;

afterEach(() => {
  if (previousEnabled === undefined) delete process.env.SPECULATIVE_LLM_ENABLED;
  else process.env.SPECULATIVE_LLM_ENABLED = previousEnabled;
  if (previousRestaurantIds === undefined) delete process.env.SPECULATIVE_LLM_RESTAURANT_IDS;
  else process.env.SPECULATIVE_LLM_RESTAURANT_IDS = previousRestaurantIds;
});

describe('isSpeculativeLlmEnabled', () => {
  it('reste désactivé sans kill switch explicite', () => {
    delete process.env.SPECULATIVE_LLM_ENABLED;
    expect(isSpeculativeLlmEnabled({ restaurantId: 'test-resto-1' })).toBe(false);
  });

  it('limite le canari aux restaurants autorisés', () => {
    process.env.SPECULATIVE_LLM_ENABLED = 'true';
    process.env.SPECULATIVE_LLM_RESTAURANT_IDS = 'test-resto-1, rest-2';

    expect(isSpeculativeLlmEnabled({ restaurantId: 'test-resto-1' })).toBe(true);
    expect(isSpeculativeLlmEnabled({ restaurantId: 'rest-3' })).toBe(false);
  });
});
