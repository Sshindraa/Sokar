import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ReputationFeedbackChannel,
  ReputationFeedbackRequestStatus,
  ReputationRecoveryPriority,
  ReputationRecoveryTaskStatus,
  ReservationState,
} from '@prisma/client';
import { db } from '../../../shared/db/client';
import {
  createReputationFeedbackRequest,
  expireReputationFeedbackRequests,
  ReputationFeedbackStateError,
  ReputationInputError,
  ReputationReservationNotFoundError,
  submitReputationFeedback,
  updateReputationRecoveryTask,
} from '../reputation.service';

const RESTAURANT_ID = 'restaurant-1';
const RESERVATION_ID = 'reservation-1';
const CUSTOMER_ID = 'customer-1';
const NOW = new Date('2026-09-14T10:00:00.000Z');

function requestRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'feedback-request-1',
    restaurantId: RESTAURANT_ID,
    reservationId: RESERVATION_ID,
    customerId: CUSTOMER_ID,
    channel: ReputationFeedbackChannel.EMAIL,
    status: ReputationFeedbackRequestStatus.PENDING,
    expiresAt: new Date('2026-09-21T10:00:00.000Z'),
    requestedAt: NOW,
    sentAt: null,
    submittedAt: null,
    createdAt: NOW,
    updatedAt: NOW,
    feedback: null,
    ...overrides,
  };
}

function feedbackRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'feedback-1',
    requestId: 'feedback-request-1',
    restaurantId: RESTAURANT_ID,
    reservationId: RESERVATION_ID,
    customerId: CUSTOMER_ID,
    score: 2,
    comment: 'Le service était trop long.',
    submittedAt: NOW,
    createdAt: NOW,
    ...overrides,
  };
}

function recoveryRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'recovery-1',
    feedbackId: 'feedback-1',
    restaurantId: RESTAURANT_ID,
    reservationId: RESERVATION_ID,
    customerId: CUSTOMER_ID,
    status: ReputationRecoveryTaskStatus.OPEN,
    priority: ReputationRecoveryPriority.NORMAL,
    assignedToHash: null,
    resolutionCode: null,
    resolutionNote: null,
    resolvedAt: null,
    createdAt: NOW,
    updatedAt: NOW,
    feedback: {
      id: 'feedback-1',
      score: 2,
      comment: 'Le service était trop long.',
      submittedAt: NOW,
    },
    ...overrides,
  };
}

describe('reputation feedback foundation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(db.restaurant.findUnique).mockResolvedValue({
      id: RESTAURANT_ID,
      siteStatus: 'ACTIVE',
    } as never);
  });

  it('creates one opaque request only for an honoured reservation', async () => {
    vi.mocked(db.reservation.findFirst).mockResolvedValue({
      id: RESERVATION_ID,
      state: ReservationState.HONORED,
      customerId: CUSTOMER_ID,
    } as never);
    vi.mocked(db.customer.findFirst).mockResolvedValue({ id: CUSTOMER_ID } as never);
    vi.mocked(db.reputationFeedbackRequest.create).mockResolvedValue(requestRow() as never);

    const result = await createReputationFeedbackRequest({
      restaurantId: RESTAURANT_ID,
      reservationId: RESERVATION_ID,
      channel: 'EMAIL',
      now: NOW,
    });

    expect(result).toMatchObject({
      id: 'feedback-request-1',
      token: expect.stringMatching(/^[A-Za-z0-9_-]{43}$/),
      providerContacted: false,
      dryRun: true,
      replayed: false,
    });
    expect(db.reputationFeedbackRequest.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          restaurantId: RESTAURANT_ID,
          reservationId: RESERVATION_ID,
          customerId: CUSTOMER_ID,
          channel: ReputationFeedbackChannel.EMAIL,
          tokenHash: expect.stringMatching(/^[a-f0-9]{64}$/),
        }),
      }),
    );
    expect(JSON.stringify(result)).not.toContain('tokenHash');
  });

  it('refuses a reservation that is not honoured', async () => {
    vi.mocked(db.reservation.findFirst).mockResolvedValue({
      id: RESERVATION_ID,
      state: ReservationState.CONFIRMED,
      customerId: CUSTOMER_ID,
    } as never);

    await expect(
      createReputationFeedbackRequest({
        restaurantId: RESTAURANT_ID,
        reservationId: RESERVATION_ID,
        channel: 'SMS',
        now: NOW,
      }),
    ).rejects.toBeInstanceOf(ReputationReservationNotFoundError);
    expect(db.customer.findFirst).not.toHaveBeenCalled();
  });

  it('replays the existing request without recovering its raw token', async () => {
    vi.mocked(db.reservation.findFirst).mockResolvedValue({
      id: RESERVATION_ID,
      state: ReservationState.HONORED,
      customerId: CUSTOMER_ID,
    } as never);
    vi.mocked(db.customer.findFirst).mockResolvedValue({ id: CUSTOMER_ID } as never);
    vi.mocked(db.reputationFeedbackRequest.findUnique).mockResolvedValue(requestRow() as never);

    const result = await createReputationFeedbackRequest({
      restaurantId: RESTAURANT_ID,
      reservationId: RESERVATION_ID,
      channel: 'SMS',
      now: NOW,
    });

    expect(result).toMatchObject({
      replayed: true,
      token: null,
      channel: ReputationFeedbackChannel.EMAIL,
    });
    expect(db.reputationFeedbackRequest.create).not.toHaveBeenCalled();
  });

  it('submits low feedback atomically and opens a high-priority recovery task', async () => {
    vi.mocked(db.reputationFeedbackRequest.findUnique).mockResolvedValue(requestRow() as never);
    vi.mocked(db.reputationFeedback.create).mockResolvedValue(
      feedbackRow({ score: 1, comment: 'Aïe' }) as never,
    );
    vi.mocked(db.reputationFeedbackRequest.update).mockResolvedValue(
      requestRow({ status: ReputationFeedbackRequestStatus.SUBMITTED, submittedAt: NOW }) as never,
    );
    vi.mocked(db.reputationRecoveryTask.create).mockResolvedValue(
      recoveryRow({
        priority: ReputationRecoveryPriority.HIGH,
        feedback: { id: 'feedback-1', score: 1, comment: 'Aïe', submittedAt: NOW },
      }) as never,
    );

    const result = await submitReputationFeedback({
      token: 'a'.repeat(43),
      score: 1,
      comment: 'Aïe',
      now: NOW,
    });

    expect(result).toMatchObject({
      replayed: false,
      feedback: { score: 1, comment: 'Aïe' },
      recoveryTask: {
        priority: ReputationRecoveryPriority.HIGH,
        status: ReputationRecoveryTaskStatus.OPEN,
      },
    });
    expect(db.reputationFeedbackRequest.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { status: ReputationFeedbackRequestStatus.SUBMITTED, submittedAt: NOW },
      }),
    );
  });

  it('returns the previous response when the public token is replayed', async () => {
    vi.mocked(db.reputationFeedbackRequest.findUnique).mockResolvedValue(
      requestRow({
        status: ReputationFeedbackRequestStatus.SUBMITTED,
        submittedAt: NOW,
        feedback: { id: 'feedback-1', score: 4, comment: null, submittedAt: NOW },
      }) as never,
    );
    vi.mocked(db.reputationFeedback.findUnique).mockResolvedValue(
      feedbackRow({ score: 4, comment: null }) as never,
    );
    vi.mocked(db.reputationRecoveryTask.findUnique).mockResolvedValue(null);

    const result = await submitReputationFeedback({ token: 'b'.repeat(43), score: 1, now: NOW });
    expect(result).toMatchObject({
      replayed: true,
      feedback: { score: 4, comment: null },
      recoveryTask: null,
    });
    expect(db.reputationFeedback.create).not.toHaveBeenCalled();
  });

  it('expires pending requests and rejects expired submissions', async () => {
    const expired = requestRow({ expiresAt: new Date('2026-09-13T10:00:00.000Z') });
    vi.mocked(db.reputationFeedbackRequest.findUnique).mockResolvedValue(expired as never);
    vi.mocked(db.reputationFeedbackRequest.updateMany).mockResolvedValue({ count: 1 } as never);

    await expect(
      submitReputationFeedback({ token: 'c'.repeat(43), score: 5, now: NOW }),
    ).rejects.toMatchObject({ code: 'REPUTATION_FEEDBACK_EXPIRED' });
    expect(db.reputationFeedbackRequest.updateMany).toHaveBeenCalled();

    vi.mocked(db.reputationFeedbackRequest.findMany).mockResolvedValue([
      { id: 'request-1' },
      { id: 'request-2' },
    ] as never);
    vi.mocked(db.reputationFeedbackRequest.updateMany).mockResolvedValue({ count: 2 } as never);
    await expect(expireReputationFeedbackRequests({ now: NOW })).resolves.toBe(2);
  });

  it('requires a resolution code and keeps recovery transitions tenant-scoped', async () => {
    const current = recoveryRow();
    vi.mocked(db.reputationRecoveryTask.findFirst).mockResolvedValue(current as never);
    vi.mocked(db.reputationRecoveryTask.update).mockResolvedValue(
      recoveryRow({
        status: ReputationRecoveryTaskStatus.RESOLVED,
        resolutionCode: 'CONTACTED',
        resolutionNote: 'Appel effectué',
        resolvedAt: NOW,
      }) as never,
    );

    await expect(
      updateReputationRecoveryTask({
        restaurantId: RESTAURANT_ID,
        taskId: 'recovery-1',
        status: 'RESOLVED',
        now: NOW,
      }),
    ).rejects.toBeInstanceOf(ReputationInputError);

    const result = await updateReputationRecoveryTask({
      restaurantId: RESTAURANT_ID,
      taskId: 'recovery-1',
      status: 'RESOLVED',
      resolutionCode: 'contacted',
      resolutionNote: 'Appel effectué',
      actor: 'manager-1',
      now: NOW,
    });
    expect(result).toMatchObject({
      status: ReputationRecoveryTaskStatus.RESOLVED,
      resolutionCode: 'CONTACTED',
    });
  });
});
