import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { getApp, closeApp } from '../../../test/helpers';

const mocks = vi.hoisted(() => ({
  unavailableReason: vi.fn(),
  issueTicket: vi.fn(),
  voiceEnabled: vi.fn(),
}));

vi.mock('../../voice/demo/live-demo', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../voice/demo/live-demo')>()),
  liveDemoUnavailableReason: mocks.unavailableReason,
  issueLiveDemoTicket: mocks.issueTicket,
}));
vi.mock('../../../shared/configcat', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../shared/configcat')>()),
  isVoicePipelineEnabled: mocks.voiceEnabled,
}));

const request = async (headers: Record<string, string> = { authorization: 'Bearer test' }) =>
  (await getApp()).inject({
    method: 'POST',
    url: '/restaurant/onboarding/live-demo',
    headers,
    payload: {},
  });

describe('restaurant.routes — POST /restaurant/onboarding/live-demo', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.PUBLIC_URL = 'https://api.sokar.tech';
    mocks.unavailableReason.mockReturnValue(null);
    mocks.voiceEnabled.mockResolvedValue(true);
    mocks.issueTicket.mockResolvedValue({ ok: true, ticket: 'ticket-ticket-ticket-1' });
  });

  afterAll(async () => {
    await closeApp();
  });

  it('exige une session authentifiée', async () => {
    const res = await request({});
    expect(res.statusCode).toBe(401);
    expect(mocks.issueTicket).not.toHaveBeenCalled();
  });

  it('émet un ticket lié au restaurant authentifié et l’URL WebSocket publique', async () => {
    const res = await request();

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      ticket: 'ticket-ticket-ticket-1',
      wsUrl: 'wss://api.sokar.tech/voice/demo-stream/ticket-ticket-ticket-1',
      maxDurationSec: 180,
    });
    expect(mocks.issueTicket).toHaveBeenCalledWith(expect.anything(), 'test-rest-1');
  });

  it('répond 503 sans ticket quand les fournisseurs vocaux ne sont pas configurés', async () => {
    mocks.unavailableReason.mockReturnValue('tts_unconfigured');

    const res = await request();

    expect(res.statusCode).toBe(503);
    expect(res.json().code).toBe('LIVE_DEMO_UNAVAILABLE');
    expect(mocks.issueTicket).not.toHaveBeenCalled();
  });

  it('respecte le kill switch voix du restaurant', async () => {
    mocks.voiceEnabled.mockResolvedValue(false);

    const res = await request();

    expect(res.statusCode).toBe(503);
    expect(mocks.issueTicket).not.toHaveBeenCalled();
  });

  it('répond 429 quand le plafond quotidien est atteint', async () => {
    mocks.issueTicket.mockResolvedValue({ ok: false, reason: 'daily_limit' });

    const res = await request();

    expect(res.statusCode).toBe(429);
    expect(res.json().code).toBe('LIVE_DEMO_DAILY_LIMIT');
  });
});
