import { beforeEach, describe, expect, it, vi } from 'vitest';
import { LoyaltyBenefitRule, LoyaltyBenefitStatus, LoyaltyGrantStatus } from '@prisma/client';
import { createHash } from 'node:crypto';
import { db } from '../../../shared/db/client';
import {
  createLoyaltyBenefit,
  expireLoyaltyGrants,
  issueLoyaltyGrant,
  LoyaltyGrantConflictError,
  LoyaltyGrantStateError,
  LoyaltyInputError,
  LoyaltyNotEligibleError,
  redeemLoyaltyGrant,
  voidLoyaltyGrant,
} from '../loyalty.service';

const RESTAURANT_ID = 'restaurant-1';
const BENEFIT_ID = 'benefit-1';
const CUSTOMER_ID = 'customer-1';
const GRANT_ID = 'grant-1';
const NOW = new Date('2026-09-14T10:00:00.000Z');

function benefitRow(overrides: Record<string, unknown> = {}) {
  return {
    id: BENEFIT_ID,
    restaurantId: RESTAURANT_ID,
    key: 'birthday-dessert',
    name: 'Dessert anniversaire',
    description: 'Une attention offerte.',
    rule: LoyaltyBenefitRule.BIRTHDAY_MONTH,
    ruleValue: null,
    costCents: 500,
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
    id: GRANT_ID,
    restaurantId: RESTAURANT_ID,
    benefitId: BENEFIT_ID,
    customerId: CUSTOMER_ID,
    reservationId: null,
    status: LoyaltyGrantStatus.ISSUED,
    issuedAt: NOW,
    expiresAt: new Date('2026-10-14T10:00:00.000Z'),
    redeemedAt: null,
    voidedAt: null,
    redemptionNote: null,
    createdAt: NOW,
    updatedAt: NOW,
    benefit: {
      key: 'birthday-dessert',
      name: 'Dessert anniversaire',
      costCents: 500,
      currency: 'EUR',
    },
    customer: { name: 'Camille', phone: '+33601020304' },
    ...overrides,
  };
}

function codeHash(code: string): string {
  return createHash('sha256').update(`sokar:loyalty-code:${code}`).digest('hex');
}

describe('loyalty benefits foundation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(db.restaurant.findFirst).mockResolvedValue({ id: RESTAURANT_ID } as never);
  });

  it('creates a bounded benefit with an explainable rule', async () => {
    vi.mocked(db.loyaltyBenefit.create).mockResolvedValue(benefitRow() as never);

    const result = await createLoyaltyBenefit({
      restaurantId: RESTAURANT_ID,
      key: 'birthday-dessert',
      name: 'Dessert anniversaire',
      description: 'Une attention offerte.',
      rule: 'BIRTHDAY_MONTH',
      costCents: 500,
      actor: 'user-1',
    });

    expect(result).toMatchObject({
      id: BENEFIT_ID,
      key: 'birthday-dessert',
      rule: LoyaltyBenefitRule.BIRTHDAY_MONTH,
      grantCount: 0,
    });
    expect(db.loyaltyBenefit.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ createdByHash: expect.stringMatching(/^[a-f0-9]{64}$/) }),
      }),
    );
  });

  it('rejects a value on a rule that does not use one', async () => {
    await expect(
      createLoyaltyBenefit({
        restaurantId: RESTAURANT_ID,
        key: 'vip-drink',
        name: 'Boisson VIP',
        rule: 'VIP',
        ruleValue: 2,
        actor: 'user-1',
      }),
    ).rejects.toMatchObject({ code: 'LOYALTY_BENEFIT_RULE_VALUE_INVALID' });
    expect(db.loyaltyBenefit.create).not.toHaveBeenCalled();
  });

  it('issues one VIP grant with a one-time code and no provider call', async () => {
    const benefit = benefitRow({ rule: LoyaltyBenefitRule.VIP, ruleValue: null });
    vi.mocked(db.loyaltyGrant.findUnique).mockResolvedValue(null);
    vi.mocked(db.loyaltyBenefit.findFirst).mockResolvedValue(benefit as never);
    vi.mocked(db.customer.findFirst).mockResolvedValue({
      id: CUSTOMER_ID,
      isVip: true,
      visitCount: 3,
      birthMonth: 1,
      metricSnapshot: null,
    } as never);
    vi.mocked(db.loyaltyGrant.count).mockResolvedValue(0);
    vi.mocked(db.loyaltyGrant.create).mockResolvedValue(grantRow() as never);

    const result = await issueLoyaltyGrant({
      restaurantId: RESTAURANT_ID,
      benefitId: BENEFIT_ID,
      customerId: CUSTOMER_ID,
      idempotencyKey: 'issue-vip-0001',
      actor: 'user-1',
      now: NOW,
    });

    expect(result).toMatchObject({
      id: GRANT_ID,
      code: expect.stringMatching(/^[A-F0-9]{12}$/),
      providerContacted: false,
      dryRun: true,
      replayed: false,
      phoneLast4: '0304',
    });
    expect(JSON.stringify(result)).not.toContain('codeHash');
    expect(db.loyaltyGrant.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          idempotencyKey: expect.stringMatching(/^[a-f0-9]{64}$/),
          codeHash: expect.stringMatching(/^[a-f0-9]{64}$/),
          status: LoyaltyGrantStatus.ISSUED,
        }),
      }),
    );
  });

  it('replays an idempotent grant without recovering its code', async () => {
    vi.mocked(db.loyaltyGrant.findUnique).mockResolvedValue(grantRow() as never);

    const result = await issueLoyaltyGrant({
      restaurantId: RESTAURANT_ID,
      benefitId: BENEFIT_ID,
      customerId: CUSTOMER_ID,
      idempotencyKey: 'issue-vip-0001',
      actor: 'user-1',
      now: NOW,
    });

    expect(result).toMatchObject({ replayed: true, code: null });
    expect(db.loyaltyBenefit.findFirst).not.toHaveBeenCalled();
  });

  it('does not issue a grant when the customer fails the rule', async () => {
    vi.mocked(db.loyaltyBenefit.findFirst).mockResolvedValue(
      benefitRow({ rule: LoyaltyBenefitRule.VIP }) as never,
    );
    vi.mocked(db.customer.findFirst).mockResolvedValue({
      id: CUSTOMER_ID,
      isVip: false,
      visitCount: 2,
      birthMonth: 4,
      metricSnapshot: null,
    } as never);

    await expect(
      issueLoyaltyGrant({
        restaurantId: RESTAURANT_ID,
        benefitId: BENEFIT_ID,
        customerId: CUSTOMER_ID,
        actor: 'user-1',
        now: NOW,
      }),
    ).rejects.toBeInstanceOf(LoyaltyNotEligibleError);
    expect(db.loyaltyGrant.create).not.toHaveBeenCalled();
  });

  it('serializes issuance by customer and benefit before enforcing max uses', async () => {
    vi.mocked(db.loyaltyBenefit.findFirst).mockResolvedValue(
      benefitRow({ rule: LoyaltyBenefitRule.ANY }) as never,
    );
    vi.mocked(db.customer.findFirst).mockResolvedValue({
      id: CUSTOMER_ID,
      isVip: false,
      visitCount: 0,
      birthMonth: null,
      metricSnapshot: null,
    } as never);
    vi.mocked(db.loyaltyGrant.count).mockResolvedValue(1);

    await expect(
      issueLoyaltyGrant({
        restaurantId: RESTAURANT_ID,
        benefitId: BENEFIT_ID,
        customerId: CUSTOMER_ID,
        actor: 'user-1',
        now: NOW,
      }),
    ).rejects.toMatchObject({ code: 'LOYALTY_GRANT_LIMIT_REACHED' });
    expect(db.$executeRaw).toHaveBeenCalledTimes(1);
    expect(db.loyaltyGrant.create).not.toHaveBeenCalled();
  });

  it('redeems once with the code and can attach a reservation', async () => {
    const code = 'ABCDEF123456';
    vi.mocked(db.loyaltyGrant.findFirst)
      .mockResolvedValueOnce(grantRow({ codeHash: codeHash(code) }) as never)
      .mockResolvedValueOnce(
        grantRow({
          status: LoyaltyGrantStatus.REDEEMED,
          redeemedAt: NOW,
          reservationId: 'reservation-1',
          redemptionNote: 'Dessert servi',
        }) as never,
      );
    vi.mocked(db.reservation.findFirst).mockResolvedValue({ id: 'reservation-1' } as never);
    vi.mocked(db.loyaltyGrant.updateMany).mockResolvedValue({ count: 1 } as never);

    const result = await redeemLoyaltyGrant({
      restaurantId: RESTAURANT_ID,
      grantId: GRANT_ID,
      code,
      reservationId: 'reservation-1',
      note: 'Dessert servi',
      actor: 'user-1',
      now: NOW,
    });

    expect(result).toMatchObject({ status: LoyaltyGrantStatus.REDEEMED, replayed: false });
    expect(db.loyaltyGrant.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ status: LoyaltyGrantStatus.ISSUED }),
      }),
    );
  });

  it('rejects an invalid code without mutating the grant', async () => {
    vi.mocked(db.loyaltyGrant.findFirst).mockResolvedValue(
      grantRow({ codeHash: codeHash('ABCDEF123456') }) as never,
    );

    await expect(
      redeemLoyaltyGrant({
        restaurantId: RESTAURANT_ID,
        grantId: GRANT_ID,
        code: '000000000000',
        actor: 'user-1',
        now: NOW,
      }),
    ).rejects.toBeInstanceOf(LoyaltyInputError);
    expect(db.loyaltyGrant.updateMany).not.toHaveBeenCalled();
  });

  it('expires an issued grant before redemption', async () => {
    const code = 'ABCDEF123456';
    vi.mocked(db.loyaltyGrant.findFirst).mockResolvedValue(
      grantRow({
        codeHash: codeHash(code),
        expiresAt: new Date('2026-09-13T10:00:00.000Z'),
      }) as never,
    );
    vi.mocked(db.loyaltyGrant.updateMany).mockResolvedValue({ count: 1 } as never);

    await expect(
      redeemLoyaltyGrant({
        restaurantId: RESTAURANT_ID,
        grantId: GRANT_ID,
        code,
        actor: 'user-1',
        now: NOW,
      }),
    ).rejects.toMatchObject({ code: 'LOYALTY_GRANT_EXPIRED' });
    expect(db.loyaltyGrant.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: LoyaltyGrantStatus.EXPIRED } }),
    );
  });

  it('turns a concurrent redemption into an idempotent replay', async () => {
    const code = 'ABCDEF123456';
    vi.mocked(db.loyaltyGrant.findFirst)
      .mockResolvedValueOnce(grantRow({ codeHash: codeHash(code) }) as never)
      .mockResolvedValueOnce(grantRow({ status: LoyaltyGrantStatus.REDEEMED }) as never);
    vi.mocked(db.loyaltyGrant.updateMany).mockResolvedValue({ count: 0 } as never);

    const result = await redeemLoyaltyGrant({
      restaurantId: RESTAURANT_ID,
      grantId: GRANT_ID,
      code,
      actor: 'user-1',
      now: NOW,
    });

    expect(result).toMatchObject({ replayed: true, status: LoyaltyGrantStatus.REDEEMED });
  });

  it('voids an issued grant and records the operator note', async () => {
    vi.mocked(db.loyaltyGrant.updateMany).mockResolvedValue({ count: 1 } as never);
    vi.mocked(db.loyaltyGrant.findFirst).mockResolvedValue(
      grantRow({
        status: LoyaltyGrantStatus.VOID,
        voidedAt: NOW,
        redemptionNote: 'Client absent',
      }) as never,
    );

    const result = await voidLoyaltyGrant({
      restaurantId: RESTAURANT_ID,
      grantId: GRANT_ID,
      actor: 'user-1',
      note: 'Client absent',
      now: NOW,
    });

    expect(result).toMatchObject({
      status: LoyaltyGrantStatus.VOID,
      redemptionNote: 'Client absent',
    });
  });

  it('expires only bounded issued grants', async () => {
    vi.mocked(db.loyaltyGrant.findMany).mockResolvedValue([
      { id: 'grant-1' },
      { id: 'grant-2' },
    ] as never);
    vi.mocked(db.loyaltyGrant.updateMany).mockResolvedValue({ count: 2 } as never);

    await expect(expireLoyaltyGrants({ now: NOW, limit: 2_000 })).resolves.toBe(2);
    expect(db.loyaltyGrant.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        take: 1_000,
        where: expect.objectContaining({ status: LoyaltyGrantStatus.ISSUED }),
      }),
    );
  });

  it('does not allow an unknown grant to be voided', async () => {
    vi.mocked(db.loyaltyGrant.updateMany).mockResolvedValue({ count: 0 } as never);
    vi.mocked(db.loyaltyGrant.findFirst).mockResolvedValue(null);

    await expect(
      voidLoyaltyGrant({ restaurantId: RESTAURANT_ID, grantId: GRANT_ID, actor: 'user-1' }),
    ).rejects.toMatchObject({ code: 'LOYALTY_GRANT_NOT_FOUND' });
  });

  it('exposes the state error type for already redeemed grants', () => {
    expect(new LoyaltyGrantStateError('LOYALTY_GRANT_ALREADY_REDEEMED')).toBeInstanceOf(Error);
    expect(new LoyaltyGrantConflictError('LOYALTY_GRANT_LIMIT_REACHED')).toBeInstanceOf(Error);
  });
});
