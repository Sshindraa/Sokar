/**
 * Tests du rate limiter MCP — vérifie le comportement fail-closed
 * quand Redis est down (audit sécurité Phase 1).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { McpRateLimiter, DEFAULT_RATE_LIMIT } from '../mcp/rate-limit';

// Mock Redis that always throws (simulates Redis down)
function makeFailingRedis() {
  const redis = {
    script: vi.fn().mockRejectedValue(new Error('Connection refused')),
    evalsha: vi.fn().mockRejectedValue(new Error('Connection refused')),
  };
  return redis as unknown as Parameters<typeof McpRateLimiter.prototype.check>[0] extends never
    ? never
    : ConstructorParameters<typeof McpRateLimiter>[0];
}

describe('McpRateLimiter — fail-closed on Redis down', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('rejects requests when Redis is down (fail-closed)', async () => {
    const limiter = new McpRateLimiter(makeFailingRedis(), DEFAULT_RATE_LIMIT);
    const result = await limiter.check('client-1', 'test_tool');

    expect(result.allowed).toBe(false);
    expect(result.reason).toBe('redis_down');
    expect(result.remaining).toBe(0);
  });

  it('returns a resetMs > 0 so callers can set Retry-After', async () => {
    const limiter = new McpRateLimiter(makeFailingRedis(), DEFAULT_RATE_LIMIT);
    const result = await limiter.check('client-2', 'test_tool');

    expect(result.resetMs).toBeGreaterThan(0);
  });
});
