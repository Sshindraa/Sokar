import { beforeEach, describe, expect, it, vi } from 'vitest';

const { getObject } = vi.hoisted(() => ({ getObject: vi.fn() }));

vi.mock('../call-recording.service', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../call-recording.service')>()),
  getPrivateRecording: getObject,
  isTestCallRecordingEnabled: (restaurantId: string) => restaurantId === 'rest-1',
}));

import { db } from '../../../shared/db/client';
import { loadDailySummary, readStoredReport } from '../call-report/report-store';

const body = (text: string) => ({
  Body: (async function* () {
    yield new TextEncoder().encode(text);
  })(),
});

const jsonReport = {
  reportVersion: 1,
  call: {
    id: 'aaaaaaaa-1',
    restaurantId: 'rest-1',
    createdAt: '2026-10-02T12:00:00.000Z',
    durationSec: 60,
    outcome: 'RESERVED',
  },
  logs: { status: 'linked', callKey: 'k' },
  silences: [],
  ears: [],
  mouth: [],
  outcome: { result: 'RESERVED', abandoned: false, lastExchanges: [] },
  summary: { oneLine: 'Aucun problème détecté.', issues: [] },
  costUsd: 0.01,
};

describe('readStoredReport', () => {
  beforeEach(() => vi.clearAllMocks());

  it('lit le rapport Markdown stocké à côté de l’enregistrement', async () => {
    vi.mocked(db.call.findFirst).mockResolvedValue({
      id: 'aaaaaaaa-1',
      restaurantId: 'rest-1',
      recordingStorageKey: 'call-recordings/rest-1/aaaaaaaa-1/rec.mp3',
    } as never);
    getObject.mockResolvedValue(body('# rapport'));

    expect(await readStoredReport('aaaaaaaa', 'markdown')).toBe('# rapport');
    expect(getObject).toHaveBeenCalledWith('call-recordings/rest-1/aaaaaaaa-1/report.md');
  });

  it('renvoie null quand aucun rapport n’existe', async () => {
    vi.mocked(db.call.findFirst).mockResolvedValue({
      id: 'aaaaaaaa-1',
      restaurantId: 'rest-1',
      recordingStorageKey: 'call-recordings/rest-1/aaaaaaaa-1/rec.mp3',
    } as never);
    getObject.mockRejectedValue(Object.assign(new Error('NoSuchKey'), { name: 'NoSuchKey' }));
    expect(await readStoredReport('aaaaaaaa', 'json')).toBeNull();
  });

  it('refuse un restaurant hors de la liste des tests', async () => {
    vi.mocked(db.call.findFirst).mockResolvedValue({
      id: 'x',
      restaurantId: 'client-restaurant',
      recordingStorageKey: 'call-recordings/client-restaurant/x/rec.mp3',
    } as never);
    expect(await readStoredReport('x', 'markdown')).toBeNull();
    expect(getObject).not.toHaveBeenCalled();
  });
});

describe('loadDailySummary', () => {
  beforeEach(() => vi.clearAllMocks());

  it('agrège les rapports de la journée et ignore les appels sans rapport', async () => {
    vi.mocked(db.call.findMany).mockResolvedValue([
      {
        id: 'aaaaaaaa-1',
        restaurantId: 'rest-1',
        recordingStorageKey: 'call-recordings/rest-1/aaaaaaaa-1/rec.mp3',
      },
      {
        id: 'bbbbbbbb-2',
        restaurantId: 'rest-1',
        recordingStorageKey: 'call-recordings/rest-1/bbbbbbbb-2/rec.mp3',
      },
    ] as never);
    getObject
      .mockResolvedValueOnce(body(JSON.stringify(jsonReport)))
      .mockRejectedValueOnce(Object.assign(new Error('NoSuchKey'), { name: 'NoSuchKey' }));

    const markdown = await loadDailySummary('2026-10-02', 'rest-1');
    expect(markdown).toContain('Appels avec rapport : **1**');
    expect(markdown).toContain('voice_call_audio.py report aaaaaaaa');
  });
});
