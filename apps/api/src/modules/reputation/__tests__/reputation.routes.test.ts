import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ReputationFeedbackChannel,
  ReputationFeedbackRequestStatus,
  ReputationRecoveryPriority,
  ReputationRecoveryTaskStatus,
  ReservationState,
} from '@prisma/client';
import { closeApp, getApp } from '../../../test/helpers';
import { db } from '../../../shared/db/client';

const AUTH = { authorization: 'Bearer test' };
const NOW = new Date('2026-09-14T10:00:00.000Z');

function requestRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'request-1',
    restaurantId: 'test-rest-1',
    reservationId: 'reservation-1',
    customerId: 'customer-1',
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
    requestId: 'request-1',
    restaurantId: 'test-rest-1',
    reservationId: 'reservation-1',
    customerId: 'customer-1',
    score: 2,
    comment: 'Trop long',
    submittedAt: NOW,
    createdAt: NOW,
    ...overrides,
  };
}

function recoveryRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'task-1',
    feedbackId: 'feedback-1',
    restaurantId: 'test-rest-1',
    reservationId: 'reservation-1',
    customerId: 'customer-1',
    status: ReputationRecoveryTaskStatus.OPEN,
    priority: ReputationRecoveryPriority.NORMAL,
    assignedToHash: null,
    resolutionCode: null,
    resolutionNote: null,
    resolvedAt: null,
    createdAt: NOW,
    updatedAt: NOW,
    feedback: { id: 'feedback-1', score: 2, comment: 'Trop long', submittedAt: NOW },
    ...overrides,
  };
}

describe('reputation foundation routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('REPUTATION_ENABLED', 'false');
    vi.mocked(db.restaurant.findUnique).mockResolvedValue({
      id: 'test-rest-1',
      plan: 'PRO',
      siteStatus: 'ACTIVE',
    } as never);
  });

  afterAll(async () => {
    vi.unstubAllEnvs();
    await closeApp();
  });

  it('keeps feedback disabled during the production freeze', async () => {
    const app = await getApp();
    const response = await app.inject({
      method: 'GET',
      url: '/reputation/feedback',
      headers: AUTH,
    });
    expect(response.statusCode).toBe(503);
    expect(response.json()).toMatchObject({ error: 'REPUTATION_DISABLED' });
    expect(db.reputationFeedback.findMany).not.toHaveBeenCalled();
  });

  it('enforces the Pro entitlement before the runtime flag', async () => {
    vi.stubEnv('REPUTATION_ENABLED', 'true');
    vi.mocked(db.restaurant.findUnique).mockResolvedValue({
      id: 'test-rest-1',
      plan: 'ESSENTIAL',
      siteStatus: 'ACTIVE',
    } as never);
    const app = await getApp();
    const response = await app.inject({
      method: 'GET',
      url: '/reputation/feedback',
      headers: AUTH,
    });
    expect(response.statusCode).toBe(403);
    expect(response.json()).toMatchObject({
      error: 'CAPABILITY_NOT_INCLUDED',
      capability: 'reputation.feedback',
    });
  });

  it('creates a dry-run request only from an honoured reservation', async () => {
    vi.stubEnv('REPUTATION_ENABLED', 'true');
    vi.mocked(db.reservation.findFirst).mockResolvedValue({
      id: 'reservation-1',
      state: ReservationState.HONORED,
      customerId: 'customer-1',
    } as never);
    vi.mocked(db.customer.findFirst).mockResolvedValue({ id: 'customer-1' } as never);
    vi.mocked(db.reputationFeedbackRequest.create).mockResolvedValue(requestRow() as never);
    const app = await getApp();
    const response = await app.inject({
      method: 'POST',
      url: '/reputation/feedback-requests',
      headers: AUTH,
      payload: { reservationId: 'reservation-1', channel: 'EMAIL' },
    });
    expect(response.statusCode).toBe(201);
    expect(response.json().data).toMatchObject({
      id: 'request-1',
      token: expect.stringMatching(/^[A-Za-z0-9_-]{43}$/),
      providerContacted: false,
      dryRun: true,
    });
    expect(JSON.stringify(response.json())).not.toContain('tokenHash');
  });

  it('hides non-honoured reservations behind a generic not-found error', async () => {
    vi.stubEnv('REPUTATION_ENABLED', 'true');
    vi.mocked(db.reservation.findFirst).mockResolvedValue({
      id: 'reservation-1',
      state: ReservationState.CONFIRMED,
      customerId: 'customer-1',
    } as never);
    const app = await getApp();
    const response = await app.inject({
      method: 'POST',
      url: '/reputation/feedback-requests',
      headers: AUTH,
      payload: { reservationId: 'reservation-1', channel: 'SMS' },
    });
    expect(response.statusCode).toBe(404);
    expect(response.json()).toMatchObject({ error: 'REPUTATION_RESERVATION_NOT_FOUND' });
  });

  it('accepts one public low score and opens a recovery task without PII in the response', async () => {
    vi.stubEnv('REPUTATION_ENABLED', 'true');
    vi.mocked(db.reputationFeedbackRequest.findUnique).mockResolvedValue(requestRow() as never);
    vi.mocked(db.reputationFeedback.create).mockResolvedValue(feedbackRow({ score: 1 }) as never);
    vi.mocked(db.reputationFeedbackRequest.update).mockResolvedValue(
      requestRow({ status: ReputationFeedbackRequestStatus.SUBMITTED, submittedAt: NOW }) as never,
    );
    vi.mocked(db.reputationRecoveryTask.create).mockResolvedValue(
      recoveryRow({
        priority: ReputationRecoveryPriority.HIGH,
        feedback: { id: 'feedback-1', score: 1, comment: 'Trop long', submittedAt: NOW },
      }) as never,
    );
    const app = await getApp();
    const response = await app.inject({
      method: 'POST',
      url: '/reputation/feedback/submit',
      payload: { token: 'a'.repeat(43), score: 1, comment: 'Trop long' },
    });
    expect(response.statusCode).toBe(201);
    expect(response.json()).toMatchObject({
      data: { feedbackId: 'feedback-1', recoveryTaskCreated: true, replayed: false },
    });
    expect(JSON.stringify(response.json())).not.toContain('Trop long');
  });

  it('returns a generic 404 for an invalid public token', async () => {
    vi.stubEnv('REPUTATION_ENABLED', 'true');
    vi.mocked(db.reputationFeedbackRequest.findUnique).mockResolvedValue(null);
    const app = await getApp();
    const response = await app.inject({
      method: 'POST',
      url: '/reputation/feedback/submit',
      payload: { token: 'b'.repeat(43), score: 5 },
    });
    expect(response.statusCode).toBe(404);
    expect(response.json()).toMatchObject({ error: 'REPUTATION_FEEDBACK_NOT_FOUND' });
  });

  it('allows a manager to close a recovery task with an explicit resolution', async () => {
    vi.stubEnv('REPUTATION_ENABLED', 'true');
    vi.mocked(db.reputationRecoveryTask.findFirst).mockResolvedValue(recoveryRow() as never);
    vi.mocked(db.reputationRecoveryTask.update).mockResolvedValue(
      recoveryRow({
        status: ReputationRecoveryTaskStatus.RESOLVED,
        resolutionCode: 'CONTACTED',
        resolutionNote: 'Appel effectué',
        resolvedAt: NOW,
      }) as never,
    );
    const app = await getApp();
    const response = await app.inject({
      method: 'PATCH',
      url: '/reputation/recovery-tasks/task-1',
      headers: { ...AUTH, 'x-test-site-role': 'MANAGER' },
      payload: {
        status: 'RESOLVED',
        resolutionCode: 'CONTACTED',
        resolutionNote: 'Appel effectué',
      },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().data).toMatchObject({
      id: 'task-1',
      status: ReputationRecoveryTaskStatus.RESOLVED,
      resolutionCode: 'CONTACTED',
    });
  });
});
