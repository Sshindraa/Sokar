import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { closeApp, getApp } from '../../../test/helpers';
import { db } from '../../../shared/db/client';
import { ServiceCopilotService } from '../service-copilot.service';
import { ServiceCopilotPulseService } from '../service-copilot-pulse.service';
import { FloorPlanService } from '../floor-plan.service';
import { getEffectiveEntitlements } from '../../entitlements/entitlement.service';
const AUTH = { authorization: 'Bearer test' };
const prefix = '/restaurants/test-rest-1/service-copilot';
describe('service copilot commercial access', () => {
  afterAll(closeApp);
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.CONFIGCAT_SDK_KEY;
    vi.mocked(db.restaurant.findUnique).mockResolvedValue({
      plan: 'ESSENTIAL',
      serviceCopilotLegacyAccess: false,
    } as never);
  });
  it.each([
    ['GET', 'recommendations'],
    ['POST', 'telemetry'],
    ['GET', 'telemetry-summary'],
    ['GET', 'telemetry-review'],
    ['POST', 'telemetry-review/occurrence-test'],
    ['POST', 'actions/server-rebalance'],
    ['POST', 'simulate'],
    ['POST', 'delay-impact'],
    ['POST', 'delay-impact/drafts'],
    ['POST', 'delay-impact/apply'],
    ['POST', 'delay-impact/revert'],
    ['GET', 'delay-recoveries'],
  ] as const)(
    'refuse %s %s avant toute analyse ou mutation pour un nouvel Essential',
    async (method, route) => {
      const app = await getApp();
      const result = await app.inject({
        method,
        url: `${prefix}/${route}`,
        headers: AUTH,
        ...(method === 'POST' ? { payload: {} } : {}),
      });
      expect(result.statusCode).toBe(403);
      expect(result.json()).toMatchObject({
        error: 'CAPABILITY_NOT_INCLUDED',
        capability: 'floorPlan.copilot',
      });
      expect(db.$transaction).not.toHaveBeenCalled();
    },
  );
  it.each(['PRO', 'PREMIUM', 'legacy'] as const)(
    'autorise le périmètre %s sans accorder d’autres droits',
    async (plan) => {
      vi.mocked(db.restaurant.findUnique).mockResolvedValue({
        plan: plan === 'legacy' ? 'ESSENTIAL' : plan,
        serviceCopilotLegacyAccess: plan === 'legacy',
      } as never);
      const spy = vi
        .spyOn(ServiceCopilotService.prototype, 'getRecommendations')
        .mockResolvedValue([]);
      const app = await getApp();
      expect(
        (await app.inject({ method: 'GET', url: `${prefix}/recommendations`, headers: AUTH }))
          .statusCode,
      ).toBe(200);
      expect(spy).toHaveBeenCalledWith('test-rest-1');
      const rights = await getEffectiveEntitlements('test-rest-1');
      expect(rights.capabilities['floorPlan.copilot']).toBe(true);
      if (plan === 'legacy') {
        expect(rights.id).toBe('essential');
        expect(rights.capabilities['marketing.campaigns']).toBe(false);
      }
    },
  );
  it('conserve le pouls opérationnel et le plan de salle pour Essential', async () => {
    vi.spyOn(ServiceCopilotPulseService.prototype, 'getPulse').mockResolvedValue({} as never);
    vi.spyOn(FloorPlanService.prototype, 'getOrCreateFloorPlan').mockResolvedValue({
      id: 'floor-test',
    } as never);
    const app = await getApp();
    expect(
      (await app.inject({ method: 'GET', url: `${prefix}/pulse?date=2099-03-10`, headers: AUTH }))
        .statusCode,
    ).toBe(200);
    expect(
      (
        await app.inject({
          method: 'GET',
          url: '/restaurants/test-rest-1/floor-plan',
          headers: AUTH,
        })
      ).statusCode,
    ).toBe(200);
  });
  it('refuse le restaurant d’une autre session même avec Pro', async () => {
    vi.mocked(db.restaurant.findUnique).mockResolvedValue({ plan: 'PRO' } as never);
    const spy = vi.spyOn(ServiceCopilotService.prototype, 'getRecommendations');
    const app = await getApp();
    expect(
      (
        await app.inject({
          method: 'GET',
          url: '/restaurants/another-site/service-copilot/recommendations',
          headers: AUTH,
        })
      ).statusCode,
    ).toBe(403);
    expect(spy).not.toHaveBeenCalled();
  });
});
