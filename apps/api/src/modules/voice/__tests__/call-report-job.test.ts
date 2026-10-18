import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  buildCallReportJob,
  isCallReportEnabled,
  reportLimit,
  reserveReportSlot,
  type ReportJobDeps,
} from '../call-report/job';
import type { Transcriber } from '../call-report/deepgram-batch';
import { stereoMp3 } from './fixtures/call-report-stereo';

const mp3 = stereoMp3();
const word = (text: string, start: number, end: number) => ({ text, start, end, confidence: 1 });

const transcribe: Transcriber = async (_wav, engine) => ({
  engine,
  model: engine,
  words: [word('bonjour', 0.6, 1.2)],
  text: 'bonjour',
  durationSec: 3,
  costUsd: 0.001,
});

const callRow = {
  id: 'call-1',
  restaurantId: 'rest-1',
  callSid: 'leg-1',
  createdAt: new Date('2026-10-02T12:00:00.000Z'),
  durationSec: 3,
  outcome: 'INFO',
  intent: 'RESERVATION',
  recordingStatus: 'AVAILABLE',
  recordingStorageKey: 'call-recordings/rest-1/call-1/rec-1.mp3',
  recordingStartedAt: new Date('2026-10-02T12:00:00.000Z'),
};

function deps(overrides: Partial<ReportJobDeps> = {}): ReportJobDeps {
  return {
    isAllowed: () => true,
    findCall: vi.fn().mockResolvedValue(callRow),
    loadTurns: vi
      .fn()
      .mockResolvedValue([
        { sequence: 1, turnId: 't1', callerText: 'bonjour', agentText: 'Bonsoir.' },
      ]),
    readRecording: vi.fn().mockResolvedValue(mp3),
    readLogs: vi.fn().mockResolvedValue([]),
    transcribe,
    store: vi.fn().mockResolvedValue(undefined),
    log: { info: vi.fn(), warn: vi.fn() },
    ...overrides,
  };
}

describe('isCallReportEnabled', () => {
  beforeEach(() => {
    delete process.env.CALL_REPORT_ENABLED;
  });

  it('est désactivé par défaut', () => {
    expect(isCallReportEnabled()).toBe(false);
  });

  it("ne s'active que par CALL_REPORT_ENABLED=true", () => {
    process.env.CALL_REPORT_ENABLED = 'true';
    expect(isCallReportEnabled()).toBe(true);
    process.env.CALL_REPORT_ENABLED = '1';
    expect(isCallReportEnabled()).toBe(false);
    delete process.env.CALL_REPORT_ENABLED;
  });
});

describe('buildCallReportJob', () => {
  it('stocke le JSON et le Markdown à côté de l’enregistrement', async () => {
    const d = deps();
    const result = await buildCallReportJob('leg-1', d);
    expect(result.status).toBe('stored');
    const keys = vi.mocked(d.store).mock.calls.map((call) => call[0]);
    expect(keys).toEqual([
      'call-recordings/rest-1/call-1/report.json',
      'call-recordings/rest-1/call-1/report.md',
    ]);
    const json = JSON.parse(String(vi.mocked(d.store).mock.calls[0][1]));
    expect(json.call.id).toBe('call-1');
    expect(json.call.restaurantId).toBe('rest-1');
  });

  it("n'écrit rien pour un restaurant hors de la liste des tests", async () => {
    const d = deps({ isAllowed: () => false });
    const result = await buildCallReportJob('leg-1', d);
    expect(result).toEqual({ status: 'skipped', reason: 'restaurant_not_allowed' });
    expect(d.readRecording).not.toHaveBeenCalled();
    expect(d.store).not.toHaveBeenCalled();
  });

  it("ne fait rien quand l'enregistrement n'est pas disponible", async () => {
    const d = deps({
      findCall: vi.fn().mockResolvedValue({ ...callRow, recordingStatus: 'PENDING' }),
    });
    expect((await buildCallReportJob('leg-1', d)).status).toBe('skipped');
    expect(d.store).not.toHaveBeenCalled();
  });

  it('ne fait rien quand l’appel est inconnu', async () => {
    const d = deps({ findCall: vi.fn().mockResolvedValue(null) });
    expect(await buildCallReportJob('leg-x', d)).toEqual({
      status: 'skipped',
      reason: 'call_not_found',
    });
  });

  it('échoue sans effet : une erreur est journalisée, jamais relancée', async () => {
    const d = deps({
      transcribe: async () => {
        throw new Error('Deepgram nova transcription failed: 500');
      },
    });
    const result = await buildCallReportJob('leg-1', d);
    expect(result.status).toBe('failed');
    expect(d.store).not.toHaveBeenCalled();
    expect(d.log.warn).toHaveBeenCalled();
  });

  it("n'écrit dans les journaux ni texte d'appel ni numéro", async () => {
    const d = deps({
      loadTurns: vi.fn().mockResolvedValue([
        {
          sequence: 1,
          turnId: 't1',
          callerText: 'mon numéro 06 12 34 56 78',
          agentText: 'Merci.',
        },
      ]),
    });
    await buildCallReportJob('leg-1', d);
    const logged = JSON.stringify([
      ...vi.mocked(d.log.info).mock.calls,
      ...vi.mocked(d.log.warn).mock.calls,
    ]);
    expect(logged).not.toContain('06 12 34 56 78');
    expect(logged).not.toContain('Merci');
  });

  it("signale que le dialogue par tour n'est pas conservé pour ce restaurant", async () => {
    const d = deps({
      loadTurns: vi
        .fn()
        .mockResolvedValue([{ sequence: 1, turnId: 't1', callerText: null, agentText: null }]),
    });
    await buildCallReportJob('leg-1', d);
    const json = JSON.parse(String(vi.mocked(d.store).mock.calls[0][1]));
    expect(json.limits.join(' ')).toMatch(/dialogue/i);
  });
});

describe('plafond du nombre de rapports', () => {
  it("n'a pas de plafond par défaut", () => {
    expect(reportLimit({})).toBeNull();
    expect(reportLimit({ CALL_REPORT_MAX_REPORTS: '' })).toBeNull();
    expect(reportLimit({ CALL_REPORT_MAX_REPORTS: 'abc' })).toBeNull();
  });

  it('lit un plafond entier positif', () => {
    expect(reportLimit({ CALL_REPORT_MAX_REPORTS: '100' })).toBe(100);
    expect(reportLimit({ CALL_REPORT_MAX_REPORTS: '0' })).toBeNull();
  });

  it('ne fait rien (ni transcription, ni lecture, ni écriture) quand le plafond est atteint', async () => {
    const d = deps({ reserveSlot: vi.fn().mockResolvedValue(false), releaseSlot: vi.fn() });
    const result = await buildCallReportJob('leg-1', d);
    expect(result).toEqual({ status: 'skipped', reason: 'limit_reached' });
    expect(d.readRecording).not.toHaveBeenCalled();
    expect(d.store).not.toHaveBeenCalled();
    expect(d.releaseSlot).not.toHaveBeenCalled();
  });

  it('garde la place prise quand le rapport est écrit', async () => {
    const d = deps({ reserveSlot: vi.fn().mockResolvedValue(true), releaseSlot: vi.fn() });
    expect((await buildCallReportJob('leg-1', d)).status).toBe('stored');
    expect(d.releaseSlot).not.toHaveBeenCalled();
  });

  it('rend la place quand la génération échoue (un échec ne consomme pas le plafond)', async () => {
    const d = deps({
      reserveSlot: vi.fn().mockResolvedValue(true),
      releaseSlot: vi.fn(),
      transcribe: async () => {
        throw new Error('down');
      },
    });
    expect((await buildCallReportJob('leg-1', d)).status).toBe('failed');
    expect(d.releaseSlot).toHaveBeenCalledTimes(1);
  });

  it("ne prend pas de place pour un appel qu'on ignore (restaurant hors liste, enregistrement absent)", async () => {
    const d = deps({ isAllowed: () => false, reserveSlot: vi.fn().mockResolvedValue(true) });
    await buildCallReportJob('leg-1', d);
    expect(d.reserveSlot).not.toHaveBeenCalled();
  });
});

describe('reserveReportSlot', () => {
  function fakeRedis() {
    let value = 0;
    return {
      incr: vi.fn(async () => ++value),
      decr: vi.fn(async () => --value),
      get value() {
        return value;
      },
    };
  }

  it('accepte jusqu’au plafond puis refuse sans dépasser le compteur', async () => {
    const redis = fakeRedis();
    const results = [];
    for (let i = 0; i < 4; i++) results.push(await reserveReportSlot(redis, 3));
    expect(results).toEqual([true, true, true, false]);
    expect(redis.value).toBe(3);
  });

  it('accepte toujours sans plafond, sans toucher au compteur', async () => {
    const redis = fakeRedis();
    expect(await reserveReportSlot(redis, null)).toBe(true);
    expect(redis.incr).not.toHaveBeenCalled();
  });
});
