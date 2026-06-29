import { describe, expect, it, vi, beforeEach } from 'vitest';
import { db } from '../../../db/client';
import { processAnalyticsJob } from '../analytics.worker';

// jobLogger mock : le worker utilise pino sous le capot, on n'a pas besoin
// de tester les logs, juste la persistance.
vi.mock('../helper', () => ({
  setupWorkerListeners: vi.fn(),
  jobLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

function makeJob(data: Record<string, unknown>) {
  return { data, id: 'test-job-1', name: 'track' } as any;
}

describe('analytics.worker — processAnalyticsJob', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('events onboarding_*', () => {
    it('persiste un event onboarding_step_completed dans la table onboarding_events', async () => {
      const job = makeJob({
        event: 'onboarding_step_completed',
        restaurantId: 'rest-1',
        userId: 'user-1',
        task: 'restaurant',
        metadata: { progress: 10, completedCount: 1 },
        createdAt: '2026-06-29T12:00:00.000Z',
      });

      await processAnalyticsJob(job);

      expect(db.onboardingEvent.create).toHaveBeenCalledWith({
        data: {
          restaurantId: 'rest-1',
          userId: 'user-1',
          event: 'onboarding_step_completed',
          task: 'restaurant',
          metadata: { progress: 10, completedCount: 1 },
          createdAt: new Date('2026-06-29T12:00:00.000Z'),
        },
      });
    });

    it('persiste onboarding_first_call avec task=phone', async () => {
      const job = makeJob({
        event: 'onboarding_first_call',
        restaurantId: 'rest-1',
        userId: 'user-1',
        task: 'phone',
        metadata: { callControlId: 'cc-123', phoneNumber: '+33612345678' },
        createdAt: '2026-06-29T12:00:00.000Z',
      });

      await processAnalyticsJob(job);

      expect(db.onboardingEvent.create).toHaveBeenCalledWith({
        data: {
          restaurantId: 'rest-1',
          userId: 'user-1',
          event: 'onboarding_first_call',
          task: 'phone',
          metadata: { callControlId: 'cc-123', phoneNumber: '+33612345678' },
          createdAt: new Date('2026-06-29T12:00:00.000Z'),
        },
      });
    });

    it('gère les champs optionnels absents (userId, task, metadata)', async () => {
      const job = makeJob({
        event: 'onboarding_activated',
        restaurantId: 'rest-1',
        createdAt: '2026-06-29T12:00:00.000Z',
      });

      await processAnalyticsJob(job);

      expect(db.onboardingEvent.create).toHaveBeenCalledWith({
        data: {
          restaurantId: 'rest-1',
          userId: null,
          event: 'onboarding_activated',
          task: null,
          metadata: {},
          createdAt: new Date('2026-06-29T12:00:00.000Z'),
        },
      });
    });

    it(`gère l'absence de createdAt (utilise now)`, async () => {
      const job = makeJob({
        event: 'onboarding_step_started',
        restaurantId: 'rest-1',
      });

      const before = new Date();
      await processAnalyticsJob(job);
      const after = new Date();

      const callArg = (db.onboardingEvent.create as any).mock.calls[0][0];
      const created = callArg.data.createdAt as Date;
      expect(created.getTime()).toBeGreaterThanOrEqual(before.getTime());
      expect(created.getTime()).toBeLessThanOrEqual(after.getTime());
    });

    it(`throw si l'insertion DB échoue (pour déclencher le retry BullMQ)`, async () => {
      (db.onboardingEvent.create as any).mockRejectedValueOnce(new Error('DB connection lost'));
      const job = makeJob({
        event: 'onboarding_step_completed',
        restaurantId: 'rest-1',
        task: 'hours',
        createdAt: '2026-06-29T12:00:00.000Z',
      });

      await expect(processAnalyticsJob(job)).rejects.toThrow('DB connection lost');
    });
  });

  describe('events non-onboarding (RGPD et autres)', () => {
    it('ne persiste pas les events rgpd_* (log uniquement)', async () => {
      const job = makeJob({
        event: 'rgpd_erasure',
        subjectHashPrefix: 'abc12345',
        metadata: { count: 5 },
        createdAt: '2026-06-29T12:00:00.000Z',
      });

      await processAnalyticsJob(job);

      expect(db.onboardingEvent.create).not.toHaveBeenCalled();
    });

    it('ne persiste pas les events inconnus', async () => {
      const job = makeJob({
        event: 'unknown_event',
        createdAt: '2026-06-29T12:00:00.000Z',
      });

      await processAnalyticsJob(job);

      expect(db.onboardingEvent.create).not.toHaveBeenCalled();
    });
  });
});
