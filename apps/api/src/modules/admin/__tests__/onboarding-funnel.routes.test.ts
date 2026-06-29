import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { getApp, closeApp } from '../../../test/helpers';
import { db } from '../../../shared/db/client';

describe('onboarding-funnel.routes — GET /admin/onboarding-funnel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterAll(async () => {
    await closeApp();
  });

  it("retourne un funnel vide quand aucun event n'existe", async () => {
    const app = await getApp();
    vi.mocked(db.onboardingEvent.findMany).mockResolvedValue([]);

    const res = await app.inject({
      method: 'GET',
      url: '/admin/onboarding-funnel',
      headers: { authorization: 'Bearer test' },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.totalEvents).toBe(0);
    expect(body.totalStarted).toBe(0);
    expect(body.funnelCompletionRate).toBe(0);
    expect(body.steps).toHaveLength(10);
    expect(body.milestones.activated).toBe(0);
    expect(body.milestones.demoCallPlayed).toBe(0);
  });

  it('agrège les events par étape avec counts started/completed/skipped', async () => {
    const app = await getApp();
    vi.mocked(db.onboardingEvent.findMany).mockResolvedValue([
      { event: 'onboarding_step_started', task: 'restaurant', createdAt: new Date('2026-06-29') },
      { event: 'onboarding_step_completed', task: 'restaurant', createdAt: new Date('2026-06-29') },
      { event: 'onboarding_step_started', task: 'hours', createdAt: new Date('2026-06-29') },
      { event: 'onboarding_step_completed', task: 'hours', createdAt: new Date('2026-06-29') },
      { event: 'onboarding_step_started', task: 'knowledge', createdAt: new Date('2026-06-29') },
      {
        event: 'onboarding_demo_call_played',
        task: 'knowledge',
        createdAt: new Date('2026-06-29'),
      },
      { event: 'onboarding_step_completed', task: 'knowledge', createdAt: new Date('2026-06-29') },
      { event: 'onboarding_activated', task: null, createdAt: new Date('2026-06-29') },
    ] as any);

    const res = await app.inject({
      method: 'GET',
      url: '/admin/onboarding-funnel',
      headers: { authorization: 'Bearer test' },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.totalEvents).toBe(8);
    expect(body.totalStarted).toBe(1); // restaurant started = entrée dans le funnel

    const restaurantStep = body.steps.find((s: any) => s.step === 'restaurant');
    expect(restaurantStep.started).toBe(1);
    expect(restaurantStep.completed).toBe(1);

    const knowledgeStep = body.steps.find((s: any) => s.step === 'knowledge');
    expect(knowledgeStep.started).toBe(1);
    expect(knowledgeStep.completed).toBe(1);

    expect(body.milestones.activated).toBe(1);
    expect(body.milestones.demoCallPlayed).toBe(1);

    // 3 étapes complétées sur 10 = 30%
    expect(body.funnelCompletionRate).toBe(30);
  });

  it('calcule les rates de conversion par étape', async () => {
    const app = await getApp();
    vi.mocked(db.onboardingEvent.findMany).mockResolvedValue([
      { event: 'onboarding_step_started', task: 'restaurant', createdAt: new Date() },
      { event: 'onboarding_step_started', task: 'restaurant', createdAt: new Date() },
      { event: 'onboarding_step_completed', task: 'restaurant', createdAt: new Date() },
      { event: 'onboarding_step_started', task: 'hours', createdAt: new Date() },
      // hours started mais jamais completed
    ] as any);

    const res = await app.inject({
      method: 'GET',
      url: '/admin/onboarding-funnel',
      headers: { authorization: 'Bearer test' },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();

    const restaurantRate = body.conversionRates.find((r: any) => r.step === 'restaurant');
    expect(restaurantRate.rate).toBe(50); // 1 completed / 2 started

    const hoursRate = body.conversionRates.find((r: any) => r.step === 'hours');
    expect(hoursRate.rate).toBe(0); // 0 completed / 1 started
  });

  it('retourne 500 si la DB échoue', async () => {
    const app = await getApp();
    vi.mocked(db.onboardingEvent.findMany).mockRejectedValue(new Error('db down'));

    const res = await app.inject({
      method: 'GET',
      url: '/admin/onboarding-funnel',
      headers: { authorization: 'Bearer test' },
    });

    expect(res.statusCode).toBe(500);
    expect(res.json().error).toMatch(/failed/i);
  });
});
