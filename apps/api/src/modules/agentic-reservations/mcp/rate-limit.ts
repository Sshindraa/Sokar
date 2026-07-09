/**
 * Rate limit MCP via Redis token bucket (atomic Lua script).
 *
 * Stratégie : chaque client a un bucket qui se remplit à `refillRate`/sec
 * jusqu'à `capacity`. Si le bucket est vide, on rejette.
 *
 * Config par défaut :
 *   - 60 req / 60s = 1 req/sec en moyenne, burst 60
 *   - 60 req / 60s avec fenêtre glissante
 *
 * Le script Lua garantit l'atomicité du check-and-increment côté Redis.
 *
 * Si Redis est down, on fail-closed (on rejette avec reason='redis_down').
 * Les endpoints MCP sont authentifiés (API key) et appelés par des agents IA
 * qui peuvent retry. Fail-open exposerait l'API à du DoS non limité en cas
 * d'incident Redis.
 */

import type Redis from 'ioredis';
import { alertFailOpen } from '../../../shared/observability/alerts';

export type RateLimitConfig = {
  capacity: number;
  refillPerSecond: number;
};

export const DEFAULT_RATE_LIMIT: RateLimitConfig = {
  capacity: 60,
  refillPerSecond: 1,
};

export type RateLimitResult = {
  allowed: boolean;
  remaining: number;
  resetMs: number;
  reason?: 'over_capacity' | 'redis_down';
};

// Lua script : token bucket atomique
// KEYS[1] = bucket key
// ARGV[1] = capacity
// ARGV[2] = refillPerSecond
// ARGV[3] = now (ms)
const LUA_SCRIPT = `
local key = KEYS[1]
local capacity = tonumber(ARGV[1])
local refill = tonumber(ARGV[2])
local now = tonumber(ARGV[3])

local data = redis.call('HMGET', key, 'tokens', 'last')
local tokens = tonumber(data[1])
local last = tonumber(data[2])

if tokens == nil then
  tokens = capacity
  last = now
end

-- Refill
local elapsed = math.max(0, now - last) / 1000
tokens = math.min(capacity, tokens + elapsed * refill)

if tokens < 1 then
  -- Save state and reject
  redis.call('HMSET', key, 'tokens', tokens, 'last', now)
  redis.call('PEXPIRE', key, math.ceil(capacity / refill * 1000) + 1000)
  return {0, math.floor(tokens), 0}
end

tokens = tokens - 1
redis.call('HMSET', key, 'tokens', tokens, 'last', now)
redis.call('PEXPIRE', key, math.ceil(capacity / refill * 1000) + 1000)

local resetMs = math.ceil((1 - tokens) / refill * 1000)
return {1, math.floor(tokens), resetMs}
`;

export class McpRateLimiter {
  private scriptSha: string | null = null;

  constructor(
    private readonly redis: Redis,
    private readonly config: RateLimitConfig = DEFAULT_RATE_LIMIT,
  ) {}

  async check(clientId: string, toolName: string = 'global'): Promise<RateLimitResult> {
    const key = `sokar:mcp:ratelimit:${clientId}:${toolName}`;
    const now = Date.now();

    try {
      if (!this.scriptSha) {
        this.scriptSha = (await this.redis.script('LOAD', LUA_SCRIPT)) as string;
      }

      const result = (await this.redis.evalsha(
        this.scriptSha,
        1,
        key,
        String(this.config.capacity),
        String(this.config.refillPerSecond),
        String(now),
      )) as [number, number, number];

      const [allowed, remaining, resetMs] = result;
      return {
        allowed: allowed === 1,
        remaining,
        resetMs,
        reason: allowed === 1 ? undefined : 'over_capacity',
      };
    } catch (err: unknown) {
      // NOSCRIPT: Redis a flushé les scripts (restart, FLUSHSCRIPT, etc.).
      // On reload le script et on retry une fois. Si ça échec encore, fail-open.
      const errMsg = err instanceof Error ? err.message : String(err);
      const errCode = (err as { code?: string })?.code;
      if (errMsg.includes('NOSCRIPT') || errCode === 'NOSCRIPT') {
        try {
          this.scriptSha = (await this.redis.script('LOAD', LUA_SCRIPT)) as string;
          const result = (await this.redis.evalsha(
            this.scriptSha,
            1,
            key,
            String(this.config.capacity),
            String(this.config.refillPerSecond),
            String(now),
          )) as [number, number, number];

          const [allowed, remaining, resetMs] = result;
          return {
            allowed: allowed === 1,
            remaining,
            resetMs,
            reason: allowed === 1 ? undefined : 'over_capacity',
          };
        } catch (err2) {
          // Reload ou retry échoué — fail-closed (reject)
          this.scriptSha = null;
          alertFailOpen({
            source: 'mcp_rate_limit',
            reason: 'redis_down_noscript_retry',
            err: err2,
          });
          return {
            allowed: false,
            remaining: 0,
            resetMs: 5000,
            reason: 'redis_down',
          };
        }
      }
      // Autre erreur Redis (down, timeout, etc.) — fail-closed (reject)
      this.scriptSha = null;
      alertFailOpen({ source: 'mcp_rate_limit', reason: 'redis_down', err });
      return {
        allowed: false,
        remaining: 0,
        resetMs: 5000,
        reason: 'redis_down',
      };
    }
  }
}
