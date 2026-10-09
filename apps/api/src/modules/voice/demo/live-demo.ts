import { randomBytes } from 'node:crypto';
import type { Redis } from 'ioredis';

/**
 * Démonstration en direct pendant l'onboarding : le futur client du produit parle à son propre
 * assistant depuis le navigateur, avec le même pipeline que pour un vrai appel (STT → LLM → TTS).
 *
 * Ce module porte les garde-fous qui n'ont pas lieu d'être sur un appel Telnyx :
 *  - un ticket à usage unique (le WebSocket est public, l'authentification Clerk se fait à
 *    l'émission du ticket, pas sur la socket) ;
 *  - une seule démonstration à la fois par restaurant ;
 *  - un plafond quotidien et une durée maximale, car chaque minute consomme STT + LLM + TTS.
 */

export const LIVE_DEMO_MAX_DURATION_SEC = 180;
export const LIVE_DEMO_TICKET_TTL_SEC = 60;
export const LIVE_DEMO_DAILY_LIMIT = 20;

const DAY_SECONDS = 24 * 60 * 60;

type RedisLike = Pick<Redis, 'set' | 'getdel' | 'incr' | 'expire' | 'decr' | 'eval'>;

export type LiveDemoUnavailableReason = 'voice_disabled' | 'stt_unconfigured' | 'tts_unconfigured';

/**
 * Vrai si les fournisseurs du pipeline vocal sont configurés dans cet environnement. Sans eux, la
 * démonstration en direct est indisponible et l'interface retombe sur l'aperçu pré-enregistré.
 */
export function liveDemoUnavailableReason(
  env: NodeJS.ProcessEnv = process.env,
): LiveDemoUnavailableReason | null {
  if (env.VOICE_DISABLED === 'true') return 'voice_disabled';
  const sttKey =
    env.VOICE_STT_PROVIDER === 'deepgram' ? env.DEEPGRAM_API_KEY : env.ELEVENLABS_API_KEY;
  if (!sttKey?.trim()) return 'stt_unconfigured';
  if (!env.CARTESIA_API_KEY?.trim()) return 'tts_unconfigured';
  return null;
}

const ticketKey = (ticket: string) => `live-demo:ticket:${ticket}`;
const slotKey = (restaurantId: string) => `live-demo:slot:${restaurantId}`;
const dailyKey = (restaurantId: string, now: Date) =>
  `live-demo:daily:${restaurantId}:${now.toISOString().slice(0, 10)}`;

export type IssueTicketResult = { ok: true; ticket: string } | { ok: false; reason: 'daily_limit' };

/** Émet un ticket à usage unique lié à un restaurant. Compte l'essai dans le plafond quotidien. */
export async function issueLiveDemoTicket(
  redis: RedisLike,
  restaurantId: string,
  now: Date = new Date(),
): Promise<IssueTicketResult> {
  const daily = dailyKey(restaurantId, now);
  const count = await redis.incr(daily);
  if (count === 1) await redis.expire(daily, DAY_SECONDS);
  if (count > LIVE_DEMO_DAILY_LIMIT) {
    await redis.decr(daily);
    return { ok: false, reason: 'daily_limit' };
  }

  const ticket = randomBytes(24).toString('base64url');
  await redis.set(ticketKey(ticket), restaurantId, 'EX', LIVE_DEMO_TICKET_TTL_SEC);
  return { ok: true, ticket };
}

/** Consomme un ticket : il ne sert qu'une fois. Retourne l'id du restaurant, ou null. */
export async function consumeLiveDemoTicket(
  redis: RedisLike,
  ticket: string,
): Promise<string | null> {
  if (!/^[A-Za-z0-9_-]{16,64}$/.test(ticket)) return null;
  return redis.getdel(ticketKey(ticket));
}

/** Réserve l'unique créneau de démonstration du restaurant. `owner` identifie la session. */
export async function acquireLiveDemoSlot(
  redis: RedisLike,
  restaurantId: string,
  owner: string,
): Promise<boolean> {
  // Marge au-delà de la durée maximale : le créneau expire seul si le process meurt en vol.
  const result = await redis.set(
    slotKey(restaurantId),
    owner,
    'EX',
    LIVE_DEMO_MAX_DURATION_SEC + 30,
    'NX',
  );
  return result === 'OK';
}

const RELEASE_IF_OWNER = `if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end`;

/** Libère le créneau seulement s'il appartient encore à cette session. */
export async function releaseLiveDemoSlot(
  redis: RedisLike,
  restaurantId: string,
  owner: string,
): Promise<void> {
  await redis.eval(RELEASE_IF_OWNER, 1, slotKey(restaurantId), owner);
}

/** URL WebSocket publique de la démonstration, déduite de l'URL publique de l'API. */
export function buildLiveDemoWsUrl(publicUrl: string, ticket: string): string {
  const base = publicUrl.replace(/\/+$/, '').replace(/^http/, 'ws');
  return `${base}/voice/demo-stream/${ticket}`;
}
