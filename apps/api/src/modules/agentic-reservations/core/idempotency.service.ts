/**
 * Idempotency service pour create_reservation.
 *
 * Postgres = source de vérité. Redis = cache TTL pour accélérer les lookups.
 * Scope composite (restaurant + channel + client) pour éviter les collisions
 * inter-clients.
 *
 * Flow :
 *   1. computeIdempotencyScope(restaurantId, channel, clientId?) → "restaurant:abc:channel:MCP:client:cursor"
 *   2. hashPayload(payload) → sha256 hex
 *   3. lookup(scope, key) :
 *      - absent → INSERT pending + execute + UPDATE completed
 *      - présent, même hash → renvoie la résa existante
 *      - présent, hash différent → 409 Conflict
 *   4. tryRedisCache(store) pour les hits répétés
 *
 * Le contrat : si la même key est présentée 2 fois avec le même payload
 * avant expiration, le service retourne la résa existante (cache hit).
 * Si la key est présentée avec un payload différent, 409 Conflict.
 */

import { createHash } from 'node:crypto';
import type { ReservationChannel } from './state-machine.js';

export type IdempotencyScope = string;

export type IdempotencyLookupResult =
  | { kind: 'miss' }
  | { kind: 'hit'; reservationId: string; payloadHash: string }
  | { kind: 'conflict'; existingPayloadHash: string };

export type IdempotencyStore = {
  /**
   * Cherche un record existant. Renvoie null si absent.
   * Doit lire Postgres, peut lire Redis en cache.
   */
  get(
    scope: string,
    key: string,
  ): Promise<{
    payloadHash: string;
    reservationId: string | null;
    status: 'pending' | 'completed' | 'failed';
    expiresAt: Date;
  } | null>;

  /**
   * Insère un nouveau record avec status='pending'.
   * Doit respecter la contrainte unique composite (scope, key) côté Postgres.
   * Renvoie l'erreur P2002 (unique violation) si la key existe déjà.
   */
  insertPending(args: {
    scope: string;
    key: string;
    payloadHash: string;
    expiresAt: Date;
  }): Promise<void>;

  /**
   * Met à jour un record pending → completed avec reservationId.
   */
  markCompleted(args: {
    scope: string;
    key: string;
    reservationId: string;
    responseHash?: string;
  }): Promise<void>;

  /**
   * Met à jour un record pending → failed (cleanup si l'opération a planté).
   */
  markFailed(args: { scope: string; key: string }): Promise<void>;

  /**
   * Supprime les records expirés (cron job).
   */
  purgeExpired(): Promise<number>;
};

export class IdempotencyConflictError extends Error {
  public readonly scope: string;
  public readonly key: string;

  constructor(scope: string, key: string) {
    super(
      `Idempotency conflict: key '${key}' already used in scope '${scope}' with a different payload`,
    );
    this.name = 'IdempotencyConflictError';
    this.scope = scope;
    this.key = key;
  }
}

export class IdempotencyPendingError extends Error {
  constructor(
    public readonly scope: string,
    public readonly key: string,
  ) {
    super(`Idempotency request already in progress: key '${key}' in scope '${scope}'`);
    this.name = 'IdempotencyPendingError';
  }
}

const UNKNOWN_CLIENT = 'unknown';
const SCOPE_VERSION = 'v1';

function isUniqueConstraintError(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    (err as { code?: string }).code === 'P2002'
  );
}

/**
 * Construit la scope string à partir des paramètres d'appel.
 * Inclut restaurantId + channel + clientId pour isoler les namespaces.
 */
export function computeIdempotencyScope(args: {
  restaurantId: string;
  channel: ReservationChannel;
  clientId?: string | null;
}): IdempotencyScope {
  const client = args.clientId && args.clientId.length > 0 ? args.clientId : UNKNOWN_CLIENT;
  return `${SCOPE_VERSION}:restaurant:${args.restaurantId}:channel:${args.channel}:client:${client}`;
}

/**
 * Hash canonique d'un payload JSON. Le payload est sérialisé de manière
 * déterministe (clés triées) avant hash pour que deux payloads équivalents
 * produisent le même hash quel que soit l'ordre des clés.
 */
export function hashPayload(payload: unknown): string {
  const canonical = canonicalize(payload);
  return createHash('sha256').update(canonical).digest('hex');
}

function canonicalize(value: unknown): string {
  if (value === null) return 'null';
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('Non-finite number in payload');
    return JSON.stringify(value);
  }
  if (typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (value instanceof Date) return JSON.stringify(value.toISOString());
  if (Array.isArray(value)) {
    return '[' + value.map(canonicalize).join(',') + ']';
  }
  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    const keys = Object.keys(obj)
      .filter((k) => obj[k] !== undefined)
      .sort();
    return '{' + keys.map((k) => JSON.stringify(k) + ':' + canonicalize(obj[k])).join(',') + '}';
  }
  throw new Error(`Unsupported payload value type: ${typeof value}`);
}

/**
 * Service haut niveau qui orchestre le store Postgres + cache Redis.
 * Le `cache` est optionnel : si absent, on parle directement au store.
 */
export class IdempotencyService {
  constructor(
    private readonly store: IdempotencyStore,
    private readonly cache?: IdempotencyCache,
  ) {}

  /**
   * Lookup d'un record existant. Renvoie :
   *   - miss : pas de record pour (scope, key)
   *   - hit : record completed avec reservationId
   *   - conflict : record existant avec un payloadHash différent
   *
   * Stratégie cache : le cache est un fast-path. S'il jette (Redis down),
   * on retombe sur Postgres. Le cache n'est jamais la source de vérité.
   */
  async lookup(scope: string, key: string, payloadHash: string): Promise<IdempotencyLookupResult> {
    // Fast-path cache
    if (this.cache) {
      try {
        const cached = await this.cache.get(scope, key);
        if (cached) {
          if (cached.payloadHash !== payloadHash) {
            return { kind: 'conflict', existingPayloadHash: cached.payloadHash };
          }
          return { kind: 'hit', reservationId: cached.reservationId, payloadHash };
        }
      } catch {
        // Cache down : on continue vers Postgres
      }
    }

    const existing = await this.store.get(scope, key);
    if (!existing) {
      return { kind: 'miss' };
    }
    if (existing.expiresAt.getTime() <= Date.now()) {
      return { kind: 'miss' };
    }
    if (existing.payloadHash !== payloadHash) {
      return { kind: 'conflict', existingPayloadHash: existing.payloadHash };
    }
    if (!existing.reservationId) {
      return { kind: 'miss' };
    }
    return { kind: 'hit', reservationId: existing.reservationId, payloadHash };
  }

  /**
   * Réserve un slot idempotency en status=pending.
   * Jette IdempotencyConflictError si un record existe avec un hash différent.
   * Renvoie 'reserved' si l'insertion a réussi.
   */
  async reserve(args: {
    scope: string;
    key: string;
    payloadHash: string;
    ttlSeconds: number;
    now?: Date;
  }): Promise<'reserved' | 'reused'> {
    const existing = await this.lookup(args.scope, args.key, args.payloadHash);
    if (existing.kind === 'hit') {
      return 'reused';
    }
    if (existing.kind === 'conflict') {
      throw new IdempotencyConflictError(args.scope, args.key);
    }
    const expiresAt = new Date((args.now ?? new Date()).getTime() + args.ttlSeconds * 1000);
    await this.store.purgeExpired();
    try {
      await this.store.insertPending({
        scope: args.scope,
        key: args.key,
        payloadHash: args.payloadHash,
        expiresAt,
      });
    } catch (err) {
      if (!isUniqueConstraintError(err)) {
        throw err;
      }

      const concurrent = await this.store.get(args.scope, args.key);
      if (!concurrent || concurrent.expiresAt.getTime() <= Date.now()) {
        await this.store.purgeExpired();
        await this.store.insertPending({
          scope: args.scope,
          key: args.key,
          payloadHash: args.payloadHash,
          expiresAt,
        });
        return 'reserved';
      }
      if (concurrent.payloadHash !== args.payloadHash) {
        throw new IdempotencyConflictError(args.scope, args.key);
      }
      if (concurrent.status === 'failed') {
        throw new IdempotencyConflictError(args.scope, args.key);
      }
      return 'reused';
    }
    return 'reserved';
  }

  /**
   * Finalise un record pending → completed.
   * Le payloadHash du cache Redis doit être l'original (celui passé à reserve/insertPending),
   * pas le responseHash, sinon les lookups suivants déclareraient un conflict à tort.
   */
  async complete(args: {
    scope: string;
    key: string;
    payloadHash: string;
    reservationId: string;
    responseHash?: string;
  }): Promise<void> {
    await this.store.markCompleted({
      scope: args.scope,
      key: args.key,
      reservationId: args.reservationId,
      responseHash: args.responseHash,
    });
    if (this.cache) {
      try {
        await this.cache.set(args.scope, args.key, {
          reservationId: args.reservationId,
          payloadHash: args.payloadHash,
        });
      } catch {
        // Cache down : pas critique, Postgres est la source de vérité
      }
    }
  }

  /**
   * Annule un record pending (l'opération a planté).
   */
  async fail(args: { scope: string; key: string }): Promise<void> {
    await this.store.markFailed(args);
  }
}

export type IdempotencyCache = {
  get(scope: string, key: string): Promise<{ reservationId: string; payloadHash: string } | null>;
  set(
    scope: string,
    key: string,
    value: { reservationId: string; payloadHash: string },
    ttlSeconds?: number,
  ): Promise<void>;
};
