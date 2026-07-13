import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { Job } from 'bullmq';

// Mock les dépendances externes avant d'importer le worker.
vi.mock('../../../redis/client', () => ({
  redisQueue: { url: 'redis://localhost:6379' },
}));
vi.mock('../../../telnyx/client', () => ({
  sendSms: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../helper', () => ({
  setupWorkerListeners: vi.fn(),
  jobLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));
vi.mock('../../queues', () => ({
  queues: {
    analytics: { add: vi.fn().mockResolvedValue(undefined) },
  },
}));

import { sendSms } from '../../../telnyx/client';
import { queues } from '../../queues';
import { processCallRecoveryJob } from '../call-recovery.worker';
import type { CallRecoveryJobData } from '../call-recovery.worker';

function makeJob(data: Partial<CallRecoveryJobData>) {
  return {
    data: {
      callId: 'call-1',
      restaurantId: 'rest-1',
      customerPhone: '+33612345678',
      customerName: null,
      restaurantName: 'Chez Sokar',
      restaurantSlug: 'chez-sokar-demo',
      restaurantPhone: '+33123456789',
      reason: 'no_action_with_intent' as const,
      ...data,
    },
    id: 'job-1',
    name: 'send-recovery-sms',
  } as unknown as Job<CallRecoveryJobData>;
}

describe('call-recovery.worker', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.SITE_URL = 'https://sokar.tech';
  });

  it('envoie un SMS avec le prénom du client quand customerName est fourni', async () => {
    await processCallRecoveryJob(makeJob({ customerName: 'Jean Dupont' }));

    expect(sendSms).toHaveBeenCalledTimes(1);
    const [to, text] = vi.mocked(sendSms).mock.calls[0] as [string, string];
    expect(to).toBe('+33612345678');
    expect(text).toContain('Bonjour Jean');
    expect(text).toContain('Chez Sokar');
  });

  it('envoie un SMS générique quand customerName est null', async () => {
    await processCallRecoveryJob(makeJob({ customerName: null }));

    const [, text] = vi.mocked(sendSms).mock.calls[0] as [string, string];
    expect(text).toContain('Bonjour,');
    expect(text).not.toContain('Bonjour Jean');
  });

  it('inclut le lien de réservation Connect quand restaurantSlug est fourni', async () => {
    await processCallRecoveryJob(makeJob({ restaurantSlug: 'chez-sokar-demo' }));

    const [, text] = vi.mocked(sendSms).mock.calls[0] as [string, string];
    expect(text).toContain('https://sokar.tech/restaurant/chez-sokar-demo/book');
    expect(text).toContain('Réservez en ligne');
  });

  it('fallback sur numéro de téléphone quand restaurantSlug est null', async () => {
    await processCallRecoveryJob(
      makeJob({ restaurantSlug: null, restaurantPhone: '+33123456789' }),
    );

    const [, text] = vi.mocked(sendSms).mock.calls[0] as [string, string];
    expect(text).not.toContain('/restaurant/');
    expect(text).toContain('Appelez le +33123456789');
  });

  it('fallback générique quand ni slug ni téléphone ne sont disponibles', async () => {
    await processCallRecoveryJob(makeJob({ restaurantSlug: null, restaurantPhone: null }));

    const [, text] = vi.mocked(sendSms).mock.calls[0] as [string, string];
    expect(text).toContain('Rappelez-nous quand vous voulez');
    expect(text).not.toContain('Appelez le');
    expect(text).not.toContain('/restaurant/');
  });

  it('utilise SITE_URL personnalisé pour le lien booking', async () => {
    process.env.SITE_URL = 'https://staging.sokar.tech';
    await processCallRecoveryJob(makeJob({ restaurantSlug: 'chez-sokar-demo' }));

    const [, text] = vi.mocked(sendSms).mock.calls[0] as [string, string];
    expect(text).toContain('https://staging.sokar.tech/restaurant/chez-sokar-demo/book');
  });

  it('enregistre un event analytics call-recovery-sent', async () => {
    await processCallRecoveryJob(makeJob({}));

    expect(queues.analytics.add).toHaveBeenCalledWith(
      'call-recovery-sent',
      expect.objectContaining({
        restaurantId: 'rest-1',
        callId: 'call-1',
        reason: 'no_action_with_intent',
      }),
    );
  });

  it('ne plante pas si analytics échoue (best-effort)', async () => {
    vi.mocked(queues.analytics.add).mockRejectedValueOnce(new Error('Redis down'));
    await expect(processCallRecoveryJob(makeJob({}))).resolves.not.toThrow();
    expect(sendSms).toHaveBeenCalledTimes(1);
  });

  it("propage l'erreur si sendSms échoue (pour retry BullMQ)", async () => {
    vi.mocked(sendSms).mockRejectedValueOnce(new Error('Telnyx API error'));
    await expect(processCallRecoveryJob(makeJob({}))).rejects.toThrow('Telnyx API error');
  });
});
