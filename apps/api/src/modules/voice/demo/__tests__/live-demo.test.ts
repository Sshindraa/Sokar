import { describe, expect, it } from 'vitest';
import {
  LIVE_DEMO_DAILY_LIMIT,
  acquireLiveDemoSlot,
  buildLiveDemoWsUrl,
  consumeLiveDemoTicket,
  issueLiveDemoTicket,
  liveDemoUnavailableReason,
  releaseLiveDemoSlot,
} from '../live-demo';

/** Redis minimal en mémoire : juste les commandes utilisées par le module. */
function fakeRedis() {
  const store = new Map<string, string>();
  return {
    store,
    async set(key: string, value: string, ...args: Array<string | number>) {
      if (args.includes('NX') && store.has(key)) return null;
      store.set(key, value);
      return 'OK';
    },
    async getdel(key: string) {
      const value = store.get(key) ?? null;
      store.delete(key);
      return value;
    },
    async incr(key: string) {
      const next = Number(store.get(key) ?? 0) + 1;
      store.set(key, String(next));
      return next;
    },
    async decr(key: string) {
      const next = Number(store.get(key) ?? 0) - 1;
      store.set(key, String(next));
      return next;
    },
    async expire() {
      return 1;
    },
    async eval(_script: string, _n: number, key: string, owner: string) {
      if (store.get(key) === owner) {
        store.delete(key);
        return 1;
      }
      return 0;
    },
  };
}

describe('liveDemoUnavailableReason', () => {
  const configured = { ELEVENLABS_API_KEY: 'k', CARTESIA_API_KEY: 'k' } as NodeJS.ProcessEnv;

  it('est disponible quand les fournisseurs sont configurés', () => {
    expect(liveDemoUnavailableReason(configured)).toBeNull();
  });

  it('respecte le kill switch voix', () => {
    expect(liveDemoUnavailableReason({ ...configured, VOICE_DISABLED: 'true' })).toBe(
      'voice_disabled',
    );
  });

  it('exige la clé du fournisseur STT choisi', () => {
    expect(liveDemoUnavailableReason({ CARTESIA_API_KEY: 'k' } as NodeJS.ProcessEnv)).toBe(
      'stt_unconfigured',
    );
    expect(
      liveDemoUnavailableReason({
        ...configured,
        VOICE_STT_PROVIDER: 'deepgram',
      } as NodeJS.ProcessEnv),
    ).toBe('stt_unconfigured');
    expect(
      liveDemoUnavailableReason({
        VOICE_STT_PROVIDER: 'deepgram',
        DEEPGRAM_API_KEY: 'k',
        CARTESIA_API_KEY: 'k',
      } as NodeJS.ProcessEnv),
    ).toBeNull();
  });

  it('exige la clé Cartesia', () => {
    expect(liveDemoUnavailableReason({ ELEVENLABS_API_KEY: 'k' } as NodeJS.ProcessEnv)).toBe(
      'tts_unconfigured',
    );
  });
});

describe('tickets de démonstration', () => {
  it('un ticket ne sert qu’une fois et reste lié à son restaurant', async () => {
    const redis = fakeRedis();
    const issued = await issueLiveDemoTicket(redis as never, 'rest-1');
    if (!issued.ok) throw new Error('ticket attendu');

    expect(await consumeLiveDemoTicket(redis as never, issued.ticket)).toBe('rest-1');
    expect(await consumeLiveDemoTicket(redis as never, issued.ticket)).toBeNull();
  });

  it('rejette un ticket mal formé sans interroger Redis', async () => {
    const redis = fakeRedis();
    expect(await consumeLiveDemoTicket(redis as never, 'court')).toBeNull();
    expect(await consumeLiveDemoTicket(redis as never, '../../etc/passwd-aaaaaaaaaaaa')).toBeNull();
  });

  it('plafonne les essais par jour et restaurant, sans consommer le quota refusé', async () => {
    const redis = fakeRedis();
    const now = new Date('2026-10-06T10:00:00Z');
    for (let i = 0; i < LIVE_DEMO_DAILY_LIMIT; i++) {
      expect((await issueLiveDemoTicket(redis as never, 'rest-1', now)).ok).toBe(true);
    }
    expect(await issueLiveDemoTicket(redis as never, 'rest-1', now)).toEqual({
      ok: false,
      reason: 'daily_limit',
    });
    // Un autre restaurant, ou le lendemain, repart de zéro.
    expect((await issueLiveDemoTicket(redis as never, 'rest-2', now)).ok).toBe(true);
    expect(
      (await issueLiveDemoTicket(redis as never, 'rest-1', new Date('2026-10-07T10:00:00Z'))).ok,
    ).toBe(true);
  });
});

describe('créneau unique par restaurant', () => {
  it('refuse un second appel simultané et ne se libère que par son propriétaire', async () => {
    const redis = fakeRedis();
    expect(await acquireLiveDemoSlot(redis as never, 'rest-1', 'a')).toBe(true);
    expect(await acquireLiveDemoSlot(redis as never, 'rest-1', 'b')).toBe(false);

    await releaseLiveDemoSlot(redis as never, 'rest-1', 'b'); // pas le propriétaire
    expect(await acquireLiveDemoSlot(redis as never, 'rest-1', 'c')).toBe(false);

    await releaseLiveDemoSlot(redis as never, 'rest-1', 'a');
    expect(await acquireLiveDemoSlot(redis as never, 'rest-1', 'c')).toBe(true);
  });
});

describe('buildLiveDemoWsUrl', () => {
  it('convertit http en ws et https en wss', () => {
    expect(buildLiveDemoWsUrl('http://localhost:4000', 't')).toBe(
      'ws://localhost:4000/voice/demo-stream/t',
    );
    expect(buildLiveDemoWsUrl('https://api.sokar.tech/', 't')).toBe(
      'wss://api.sokar.tech/voice/demo-stream/t',
    );
  });
});
