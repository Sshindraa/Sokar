import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { LoyaltyBenefitRule, LoyaltyBenefitStatus, LoyaltyGrantStatus } from '@prisma/client';
import { createHash } from 'node:crypto';
import { closeApp, getApp } from '../../../test/helpers';
import { db } from '../../../shared/db/client';

const AUTH = { authorization: 'Bearer test' };
const NOW = new Date('2026-09-14T10:00:00.000Z');

function codeHash(code: string): string {
  return createHash('sha256').update(`sokar:loyalty-code:${code}`).digest('hex');
}

function benefitRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'benefit-1',
    restaurantId: 'test-rest-1',
    key: 'vip-drink',
    name: 'Boisson VIP',
    description: 'Une boisson offerte.',
    rule: LoyaltyBenefitRule.VIP,
    ruleValue: null,
    costCents: 350,
    currency: 'EUR',
    validityDays: 30,
    maxUsesPerCustomer: 1,
    status: LoyaltyBenefitStatus.ACTIVE,
    createdAt: NOW,
    updatedAt: NOW,
    _count: { grants: 0 },
    ...overrides,
  };
}

function grantRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'grant-1',
    restaurantId: 'test-rest-1',
    benefitId: 'benefit-1',
    customerId: 'customer-1',
    reservationId: null,
    status: LoyaltyGrantStatus.ISSUED,
    issuedAt: NOW,
    expiresAt: new Date('2026-10-14T10:00:00.000Z'),
    redeemedAt: null,
    voidedAt: null,
    redemptionNote: null,
    createdAt: NOW,
    updatedAt: NOW,
    benefit: { key: 'vip-drink', name: 'Boisson VIP', costCents: 350, currency: 'EUR' },
    customer: { name: 'Camille', phone: '+33601020304' },
    ...overrides,
  };
}

describe('loyalty routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('LOYALTY_ENABLED', 'false');
    vi.mocked(db.restaurant.findUnique).mockResolvedValue({
      id: 'test-rest-1',
      plan: 'PRO',
      siteStatus: 'ACTIVE',
    } as never);
    vi.mocked(db.restaurant.findFirst).mockResolvedValue({ id: 'test-rest-1' } as never);
  });

  afterAll(async () => {
    vi.unstubAllEnvs();
    await closeApp();
  });

  it('keeps benefits disabled during the freeze', async () => {
    const app = await getApp();
    const response = await app.inject({ method: 'GET', url: '/loyalty/benefits', headers: AUTH });
    expect(response.statusCode).toBe(503);
    expect(response.json()).toMatchObject({ error: 'LOYALTY_DISABLED' });
    expect(db.loyaltyBenefit.findMany).not.toHaveBeenCalled();
  });

  it('enforces the Pro entitlement before the runtime flag', async () => {
    vi.stubEnv('LOYALTY_ENABLED', 'true');
    vi.mocked(db.restaurant.findUnique).mockResolvedValue({
      id: 'test-rest-1',
      plan: 'ESSENTIAL',
      siteStatus: 'ACTIVE',
    } as never);
    const app = await getApp();
    const response = await app.inject({ method: 'GET', url: '/loyalty/benefits', headers: AUTH });
    expect(response.statusCode).toBe(403);
    expect(response.json()).toMatchObject({
      error: 'CAPABILITY_NOT_INCLUDED',
      capability: 'reputation.loyalty',
    });
  });

  it('creates a benefit for an enabled Pro restaurant', async () => {
    vi.stubEnv('LOYALTY_ENABLED', 'true');
    vi.mocked(db.loyaltyBenefit.create).mockResolvedValue(benefitRow() as never);
    const app = await getApp();
    const response = await app.inject({
      method: 'POST',
      url: '/loyalty/benefits',
      headers: AUTH,
      payload: {
        key: 'vip-drink',
        name: 'Boisson VIP',
        rule: 'VIP',
        costCents: 350,
      },
    });
    expect(response.statusCode).toBe(201);
    expect(response.json().data).toMatchObject({
      id: 'benefit-1',
      key: 'vip-drink',
      rule: LoyaltyBenefitRule.VIP,
    });
  });

  it('issues an idempotent grant and returns its code once', async () => {
    vi.stubEnv('LOYALTY_ENABLED', 'true');
    vi.mocked(db.loyaltyGrant.findUnique).mockResolvedValue(null);
    vi.mocked(db.loyaltyBenefit.findFirst).mockResolvedValue(benefitRow() as never);
    vi.mocked(db.customer.findFirst).mockResolvedValue({
      id: 'customer-1',
      isVip: true,
      visitCount: 12,
      birthMonth: null,
      metricSnapshot: null,
    } as never);
    vi.mocked(db.loyaltyGrant.count).mockResolvedValue(0);
    vi.mocked(db.loyaltyGrant.create).mockResolvedValue(grantRow() as never);
    const app = await getApp();
    const response = await app.inject({
      method: 'POST',
      url: '/loyalty/grants',
      headers: { ...AUTH, 'idempotency-key': 'grant-vip-0001' },
      payload: { benefitId: 'benefit-1', customerId: 'customer-1' },
    });
    expect(response.statusCode).toBe(201);
    expect(response.json().data).toMatchObject({
      id: 'grant-1',
      code: expect.stringMatching(/^[A-F0-9]{12}$/),
      providerContacted: false,
      dryRun: true,
    });
  });

  it('redeems a grant through the operator route', async () => {
    vi.stubEnv('LOYALTY_ENABLED', 'true');
    vi.mocked(db.loyaltyGrant.findFirst)
      .mockResolvedValueOnce(
        grantRow({
          codeHash: codeHash('ABCDEF123456'),
        }) as never,
      )
      .mockResolvedValueOnce(grantRow({ status: LoyaltyGrantStatus.REDEEMED }) as never);
    vi.mocked(db.loyaltyGrant.updateMany).mockResolvedValue({ count: 1 } as never);
    const app = await getApp();
    const response = await app.inject({
      method: 'POST',
      url: '/loyalty/grants/grant-1/redeem',
      headers: AUTH,
      payload: { code: 'ABCDEF123456', note: 'Servi en salle' },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().data).toMatchObject({ status: LoyaltyGrantStatus.REDEEMED });
  });

  it('allows staff to list grants but not to issue one', async () => {
    vi.stubEnv('LOYALTY_ENABLED', 'true');
    vi.mocked(db.loyaltyGrant.findMany).mockResolvedValue([grantRow()] as never);
    const app = await getApp();
    const listResponse = await app.inject({
      method: 'GET',
      url: '/loyalty/grants',
      headers: { ...AUTH, 'x-test-site-role': 'STAFF' },
    });
    expect(listResponse.statusCode).toBe(200);
    expect(listResponse.json().data[0]).toMatchObject({ phoneLast4: '0304' });

    const issueResponse = await app.inject({
      method: 'POST',
      url: '/loyalty/grants',
      headers: { ...AUTH, 'x-test-site-role': 'STAFF' },
      payload: { benefitId: 'benefit-1', customerId: 'customer-1' },
    });
    expect(issueResponse.statusCode).toBe(403);
    expect(issueResponse.json()).toMatchObject({ error: 'LOYALTY_ROLE_REQUIRED' });
  });

  it('allows staff to redeem a grant during service', async () => {
    vi.stubEnv('LOYALTY_ENABLED', 'true');
    vi.mocked(db.loyaltyGrant.findFirst)
      .mockResolvedValueOnce(grantRow({ codeHash: codeHash('ABCDEF123456') }) as never)
      .mockResolvedValueOnce(grantRow({ status: LoyaltyGrantStatus.REDEEMED }) as never);
    vi.mocked(db.loyaltyGrant.updateMany).mockResolvedValue({ count: 1 } as never);
    const app = await getApp();
    const response = await app.inject({
      method: 'POST',
      url: '/loyalty/grants/grant-1/redeem',
      headers: { ...AUTH, 'x-test-site-role': 'STAFF' },
      payload: { code: 'ABCDEF123456' },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().data).toMatchObject({ status: LoyaltyGrantStatus.REDEEMED });
  });
});
