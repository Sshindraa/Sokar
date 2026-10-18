import { test } from 'node:test';
import assert from 'node:assert/strict';
import { summarizeReceipt } from '../reservation-sms-receipt.mjs';

for (const status of [
  'queued',
  'sending',
  'sent',
  'delivery_failed',
  'delivery_unconfirmed',
  'sending_failed',
  'expired',
  'delivered',
]) {
  test(`${status} only counts as delivered for an explicit delivery receipt`, () => {
    const receipt = summarizeReceipt(
      {
        id: 'receipt-1',
        to: [{ status, phone_number: 'PRIVATE_PHONE' }],
        text: 'PRIVATE_BODY',
        parts: 1,
      },
      'receipt-1',
    );
    assert.equal(receipt.deliveryConfirmed, status === 'delivered');
    assert.equal(receipt.deliveryStatus, status);
    assert.equal(receipt.parts, 1);
    assert.ok(!JSON.stringify(receipt).includes('PRIVATE'));
  });
}
test('missing status is unknown and a wrong message ID is rejected', () => {
  assert.equal(summarizeReceipt({ id: 'receipt-1' }, 'receipt-1').deliveryConfirmed, false);
  assert.equal(summarizeReceipt({ id: 'receipt-1' }, 'receipt-1').deliveryStatus, 'unknown');
  assert.throws(() => summarizeReceipt({ id: 'receipt-2' }, 'receipt-1'), /mismatch/);
});
