import { beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '../../../shared/db/client';

const sendEmail = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
vi.mock('../../../shared/email', () => ({ sendEmail }));

const billingMocks = vi.hoisted(() => ({
  getBillingStatus: vi.fn(),
  subscriptionHasPaymentMethod: vi.fn().mockResolvedValue(false),
}));
vi.mock('../billing.service', () => billingMocks);

const resolveAccountOwnerEmail = vi.hoisted(() => vi.fn().mockResolvedValue(null));
vi.mock('../../restaurants/account-email.service', () => ({ resolveAccountOwnerEmail }));

import { processBillingNotification } from '../billing-notification.worker';

const trialJob = {
  kind: 'trial-ending' as const,
  restaurantId: 'rest-1',
  subscriptionId: 'sub_1',
  since: '2026-10-16T10:00:00.000Z',
  trialEndsAt: '2026-10-30T10:00:00.000Z',
};
const suspendedJob = {
  kind: 'service-suspended' as const,
  restaurantId: 'rest-1',
  subscriptionId: 'sub_1',
  since: '2026-10-16T10:00:00.000Z',
  endedFromTrial: true,
};

describe('processBillingNotification', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.DASHBOARD_URL = 'https://sokar.tech';
    vi.mocked(db.restaurant.findUnique).mockResolvedValue({
      id: 'rest-1',
      name: 'Le Bistrot',
      managerEmail: 'gerant@example.com',
      accountId: null,
    } as never);
    vi.mocked(db.call.count).mockResolvedValue(12);
    (db.reservation as unknown as { aggregate: unknown }).aggregate = vi
      .fn()
      .mockResolvedValue({ _count: { _all: 5 }, _sum: { partySize: 14 } });
    vi.mocked(db.reservation.count).mockResolvedValue(4);
  });

  it('envoie le rappel de fin d’essai avec le bilan, sans carte enregistrée', async () => {
    billingMocks.getBillingStatus.mockResolvedValue({ subscriptionStatus: 'trialing' });

    const outcome = await processBillingNotification(trialJob, 'job-1');

    expect(outcome).toBe('sent');
    expect(sendEmail).toHaveBeenCalledTimes(1);
    const sent = sendEmail.mock.calls[0][0];
    expect(sent.to).toBe('gerant@example.com');
    expect(sent.html).toContain('Sokar a décroché 12 appels et pris 5 réservations');
    expect(sent.usage).toEqual(
      expect.objectContaining({ sourceType: 'billing_notification', restaurantId: 'rest-1' }),
    );
  });

  it('n’envoie rien quand la carte est déjà enregistrée', async () => {
    billingMocks.getBillingStatus.mockResolvedValue({ subscriptionStatus: 'trialing' });
    billingMocks.subscriptionHasPaymentMethod.mockResolvedValueOnce(true);

    expect(await processBillingNotification(trialJob, 'job-1')).toBe('card-on-file');
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it('n’envoie rien quand l’essai est déjà converti', async () => {
    billingMocks.getBillingStatus.mockResolvedValue({ subscriptionStatus: 'active' });

    expect(await processBillingNotification(trialJob, 'job-1')).toBe('no-longer-trialing');
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it('prévient de la coupure tant que le compte reste suspendu', async () => {
    billingMocks.getBillingStatus.mockResolvedValue({ suspended: true });

    expect(await processBillingNotification(suspendedJob, 'job-2')).toBe('sent');
    expect(sendEmail.mock.calls[0][0].subject).toBe(
      'Le Bistrot : votre assistant Sokar ne répond plus',
    );
  });

  it('n’envoie pas l’avis de coupure si le compte a été réactivé entre-temps', async () => {
    billingMocks.getBillingStatus.mockResolvedValue({ suspended: false });

    expect(await processBillingNotification(suspendedJob, 'job-2')).toBe('no-longer-suspended');
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it('se rabat sur l’adresse du propriétaire du compte', async () => {
    billingMocks.getBillingStatus.mockResolvedValue({ suspended: true });
    vi.mocked(db.restaurant.findUnique).mockResolvedValue({
      id: 'rest-1',
      name: 'Le Bistrot',
      managerEmail: '',
      accountId: 'acc-1',
    } as never);
    resolveAccountOwnerEmail.mockResolvedValueOnce('owner@example.com');

    expect(await processBillingNotification(suspendedJob, 'job-2')).toBe('sent');
    expect(sendEmail.mock.calls[0][0].to).toBe('owner@example.com');
  });
});
