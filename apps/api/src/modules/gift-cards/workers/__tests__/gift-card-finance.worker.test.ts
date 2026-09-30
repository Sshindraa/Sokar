import { beforeEach, describe, expect, it, vi } from 'vitest';
import '../../../../test/helpers';
import { db } from '../../../../shared/db/client';
import { reconcileGiftCardFinance } from '../gift-card-finance.worker';
import { GiftCardRefundService } from '../../gift-card-refund.service';
import { GiftCardCheckoutService } from '../../gift-card-checkout.service';
import { GiftCardPaymentService } from '../../gift-card-payment.service';
import { retrievePaymentIntent } from '../../stripe.service';

describe('gift card finance reconciliation', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
    vi.mocked(db.giftCardRefundRequest.findMany).mockResolvedValue([]);
    vi.mocked(db.giftCardCheckout.findMany).mockResolvedValue([]);
  });
  it('continues after a broken checkout and still closes a canceled intent', async () => {
    vi.mocked(db.giftCardCheckout.findMany).mockResolvedValue([
      { id: 'first', stripePaymentIntentId: null, stripeAccountId: 'acct_test' },
      { id: 'second', stripePaymentIntentId: 'pi_canceled', stripeAccountId: 'acct_test' },
    ] as never);
    vi.spyOn(GiftCardCheckoutService.prototype, 'ensurePaymentIntent').mockRejectedValue(
      new Error('CHECKOUT_RECOVERY_EXPIRED'),
    );
    vi.mocked(retrievePaymentIntent).mockResolvedValue({
      id: 'pi_canceled',
      status: 'canceled',
    } as never);
    await expect(reconcileGiftCardFinance()).rejects.toThrow('1 failures');
    expect(db.giftCardCheckout.update).toHaveBeenCalledWith({
      where: { id: 'first' },
      data: { status: 'RECOVERY_REQUIRED' },
    });
    expect(db.giftCardCheckout.update).toHaveBeenCalledWith({
      where: { id: 'second' },
      data: { status: 'CANCELLED' },
    });
    expect(db.giftCardCheckout.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ orderBy: { updatedAt: 'asc' } }),
    );
  });
  it('recovers a captured purchase and retries every persisted refund despite one failure', async () => {
    vi.mocked(db.giftCardRefundRequest.findMany).mockResolvedValue([
      { id: 'refund-1' },
      { id: 'refund-2' },
    ] as never);
    const process = vi
      .spyOn(GiftCardRefundService.prototype, 'process')
      .mockRejectedValueOnce(new Error('timeout'))
      .mockResolvedValueOnce(undefined);
    vi.mocked(db.giftCardCheckout.findMany).mockResolvedValue([
      {
        id: 'checkout',
        kind: 'PURCHASE',
        stripePaymentIntentId: 'pi_paid',
        stripeAccountId: 'acct_test',
      },
    ] as never);
    vi.mocked(retrievePaymentIntent).mockResolvedValue({
      id: 'pi_paid',
      status: 'succeeded',
      metadata: { checkoutId: 'checkout' },
    } as never);
    const fulfill = vi
      .spyOn(GiftCardPaymentService.prototype, 'handleStripeWebhook')
      .mockResolvedValue(null);
    await expect(reconcileGiftCardFinance()).rejects.toThrow('1 failures');
    expect(process).toHaveBeenCalledWith('refund-1');
    expect(process).toHaveBeenCalledWith('refund-2');
    expect(fulfill).toHaveBeenCalledWith('pi_paid', { checkoutId: 'checkout' }, 'acct_test');
  });
});
