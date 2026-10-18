import type { Prisma } from '@prisma/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { enqueueReservationConfirmation } from '../reservation-confirmation';
import { enqueue } from '../outbox.service';

vi.mock('../outbox.service', () => ({ enqueue: vi.fn().mockResolvedValue({ created: true }) }));

describe('transactional reservation confirmation intent', () => {
  beforeEach(() => vi.clearAllMocks());
  const reservation = {
    channel: 'WEB',
    id: 'res-1',
    restaurantId: 'rest-1',
    state: 'CONFIRMED',
    customerPhone: '+33600000000',
  };
  function transaction(enabled = true) {
    return {
      restaurant: { findUnique: vi.fn().mockResolvedValue({ smsConfirmEnabled: enabled }) },
    } as unknown as Prisma.TransactionClient;
  }
  it('writes an ID-only intent through the caller transaction and deterministic key', async () => {
    const tx = transaction();
    await enqueueReservationConfirmation(tx, reservation);
    expect(enqueue).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({
        topic: 'reservation-confirmation',
        idempotencyKey: 'reservation-confirmation:res-1',
        payload: { reservationId: 'res-1' },
      }),
    );
    expect(JSON.stringify(vi.mocked(enqueue).mock.calls)).not.toContain('+336');
  });
  it.each(['PENDING', 'CANCELLED', 'SEATED'])(
    'never queues before confirmation or for terminal state %s',
    async (state) => {
      await enqueueReservationConfirmation(transaction(), { ...reservation, state });
      expect(enqueue).not.toHaveBeenCalled();
    },
  );
  it('respects disabled confirmations and missing phones', async () => {
    await enqueueReservationConfirmation(transaction(false), reservation);
    await enqueueReservationConfirmation(transaction(), { ...reservation, customerPhone: null });
    expect(enqueue).not.toHaveBeenCalled();
  });

  it.each(['MCP', 'PHONE'])(
    'does not change the existing notification contract of %s',
    async (channel) => {
      await enqueueReservationConfirmation(transaction(), { ...reservation, channel });
      expect(enqueue).not.toHaveBeenCalled();
    },
  );
  it('propagates intent persistence failure so creation can roll back', async () => {
    vi.mocked(enqueue).mockRejectedValueOnce(new Error('outbox unavailable'));
    await expect(enqueueReservationConfirmation(transaction(), reservation)).rejects.toThrow(
      'outbox unavailable',
    );
  });
});
