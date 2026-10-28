import { randomBytes } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const tx = {
    $executeRaw: vi.fn(),
    $queryRaw: vi.fn(),
    customer: { findFirst: vi.fn(), update: vi.fn() },
    reputationFeedbackRequest: { findUnique: vi.fn(), create: vi.fn(), updateMany: vi.fn() },
    reputationEmailAttempt: { count: vi.fn(), create: vi.fn() },
  };
  return {
    tx,
    db: {
      ...tx,
      reservation: { findFirst: vi.fn() },
      $transaction: vi.fn(async (fn: (writer: typeof tx) => unknown) => fn(tx)),
    },
    sendEmail: vi.fn(),
    evaluateCapability: vi.fn(),
    acquire: vi.fn(),
    record: vi.fn(),
    reconcile: vi.fn(),
  };
});
vi.mock('../../../shared/db/client', () => ({ db: mocks.db }));
vi.mock('../../../shared/email', () => ({ sendEmail: mocks.sendEmail }));
vi.mock('../../../shared/redis/client', () => ({ redisQueue: {} }));
vi.mock('../../../shared/queue/queues', () => ({ queues: { reconciliation: {} } }));
vi.mock('../../entitlements/entitlement.service', () => ({
  evaluateCapability: mocks.evaluateCapability,
}));
vi.mock('../../../shared/queue/notification-idempotency', async (original) => ({
  ...(await original<typeof import('../../../shared/queue/notification-idempotency')>()),
  acquireNotificationClaim: mocks.acquire,
  recordNotificationResult: mocks.record,
  enqueueNotificationReconciliation: mocks.reconcile,
}));

import {
  buildReputationEmail,
  sendReputationFeedbackEmail,
  unsubscribeReputationEmail,
} from '../reputation-email.service';

const args = { restaurantId: 'restaurant-1', reservationId: 'reservation-1' };
const customer = { id: 'customer-1', feedbackEmailOptOutAt: null, feedbackEmailRequestedAt: null };
const booking = {
  ...args,
  id: args.reservationId,
  customerId: customer.id,
  customerEmail: 'test@example.invalid',
  state: 'HONORED',
  isTest: false,
  restaurant: { name: 'Bistrot', siteStatus: 'ACTIVE' },
};

describe('private reputation email', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('REPUTATION_EMAIL_SECRET', randomBytes(32).toString('hex'));
    vi.stubEnv('API_URL', 'https://api.example.invalid');
    mocks.db.reservation.findFirst.mockResolvedValue(booking);
    mocks.evaluateCapability.mockResolvedValue({ allowed: true });
    mocks.acquire.mockResolvedValue({ acquired: true, token: 'claim' });
    mocks.record.mockResolvedValue(true);
    mocks.tx.customer.findFirst.mockResolvedValue(customer);
    mocks.tx.reputationFeedbackRequest.findUnique.mockResolvedValue(null);
    mocks.tx.reputationFeedbackRequest.create.mockResolvedValue({ id: 'request-1' });
    mocks.tx.reputationEmailAttempt.count.mockResolvedValue(0);
    mocks.tx.reputationEmailAttempt.create.mockResolvedValue({});
    mocks.sendEmail.mockResolvedValue({ outcome: 'success', provider: 'resend', channel: 'email' });
  });

  it('sends private service email, uses the shared usage ledger and marks it sent', async () => {
    expect(await sendReputationFeedbackEmail(args)).toBe('sent');
    const message = mocks.sendEmail.mock.calls[0][0];
    expect(message.from).toBeUndefined();
    expect(message.usage.sourceType).toBe('reputation_feedback_email');
    expect(message.html).toContain('/reputation/respond#');
    expect(message.html).toContain('/reputation/unsubscribe#');
    expect(message.html).not.toMatch(/google|tripadvisor|offre|promotion/i);
    expect(mocks.tx.reputationEmailAttempt.create).toHaveBeenCalledTimes(1);
    expect(mocks.tx.reputationFeedbackRequest.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'SENT' }) }),
    );
  });

  it('rejects a recent request and a customer who opted out', async () => {
    mocks.tx.customer.findFirst.mockResolvedValueOnce({
      ...customer,
      feedbackEmailRequestedAt: new Date(Date.now() - 89 * 86_400_000),
    });
    expect(await sendReputationFeedbackEmail(args)).toBe('skip');
    expect(mocks.sendEmail).not.toHaveBeenCalled();
    mocks.tx.customer.findFirst.mockResolvedValueOnce({
      ...customer,
      feedbackEmailOptOutAt: new Date(),
    });
    expect(await sendReputationFeedbackEmail(args)).toBe('skip');
    expect(mocks.sendEmail).not.toHaveBeenCalled();
  });

  it('defers when the shared daily limit is reached', async () => {
    mocks.tx.reputationEmailAttempt.count.mockResolvedValue(10);
    expect(await sendReputationFeedbackEmail(args)).toBe('defer');
    expect(mocks.sendEmail).not.toHaveBeenCalled();
    expect(mocks.tx.reputationFeedbackRequest.create).not.toHaveBeenCalled();
  });

  it('does not retry an uncertain provider outcome', async () => {
    mocks.sendEmail.mockRejectedValue(new Error('network timeout'));
    expect(await sendReputationFeedbackEmail(args)).toBe('unknown');
    expect(mocks.reconcile).toHaveBeenCalled();
    expect(mocks.tx.reputationFeedbackRequest.updateMany).not.toHaveBeenCalled();
  });

  it('does not send for Essential, an ineligible visit or a test booking', async () => {
    mocks.evaluateCapability.mockResolvedValue({ allowed: false });
    expect(await sendReputationFeedbackEmail(args)).toBe('skip');
    mocks.db.reservation.findFirst.mockResolvedValue({ ...booking, state: 'CANCELLED' });
    expect(await sendReputationFeedbackEmail(args)).toBe('skip');
    mocks.db.reservation.findFirst.mockResolvedValue({ ...booking, isTest: true });
    expect(await sendReputationFeedbackEmail(args)).toBe('skip');
    expect(mocks.sendEmail).not.toHaveBeenCalled();
  });

  it('escapes restaurant names and keeps tokens out of query strings', () => {
    const email = buildReputationEmail('<Bistrot>', 'a'.repeat(43));
    expect(email.html).toContain('&lt;Bistrot&gt;');
    expect(email.html).not.toContain('?token=');
  });

  it('applies a withdrawal through merged customer profiles', async () => {
    mocks.tx.reputationFeedbackRequest.findUnique.mockResolvedValue({
      customerId: 'old',
      restaurantId: 'restaurant-1',
    });
    mocks.tx.customer.findFirst
      .mockResolvedValueOnce({ id: 'old', mergedIntoId: 'new' })
      .mockResolvedValueOnce({ id: 'new', mergedIntoId: null });
    await unsubscribeReputationEmail('a'.repeat(43));
    expect(mocks.tx.customer.update).toHaveBeenCalledTimes(2);
    expect(mocks.tx.customer.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'new', restaurantId: 'restaurant-1' },
        data: { feedbackEmailOptOutAt: expect.any(Date) },
      }),
    );
  });
});
