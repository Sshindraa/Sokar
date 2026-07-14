/**
 * Tests for the audit log service (ReservationAuditLog).
 *
 * The audit log is append-only: every reservation mutation is traced here
 * with event + actor + IDs (never raw PII). The SQL trigger refuses updates
 * and deletes at the DB level.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import { AuditLogService } from '../core/audit-log.service';

function makePrisma() {
  const create = vi.fn().mockResolvedValue({});
  return {
    prisma: { reservationAuditLog: { create } } as unknown as PrismaClient,
    create,
  };
}

describe('AuditLogService.record', () => {
  let create: ReturnType<typeof vi.fn>;
  let service: AuditLogService;

  beforeEach(() => {
    const mocks = makePrisma();
    create = mocks.create;
    service = new AuditLogService(mocks.prisma);
  });

  it('insert un log avec event + actor (champs minimum)', async () => {
    await service.record({ event: 'reservation_created', actor: 'agent:openai:session-1' });
    expect(create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        event: 'reservation_created',
        actor: 'agent:openai:session-1',
        reservationId: null,
        holdId: null,
        actorHash: null,
        fromState: null,
        toState: null,
        correlationId: null,
        metadata: {},
      }),
    });
  });

  it('passe les IDs (reservationId, holdId) au log', async () => {
    await service.record({
      event: 'state_transition',
      actor: 'system',
      reservationId: 'res-1',
      holdId: 'hold-1',
      fromState: 'PENDING',
      toState: 'CONFIRMED',
    });
    expect(create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        event: 'state_transition',
        actor: 'system',
        reservationId: 'res-1',
        holdId: 'hold-1',
        fromState: 'PENDING',
        toState: 'CONFIRMED',
      }),
    });
  });

  it('accepte les metadata arbitraires (snapshot minimalisé)', async () => {
    await service.record({
      event: 'rgpd_erasure',
      actor: 'user:abc',
      metadata: {
        subjectHashPrefix: 'abcd1234',
        reason: 'Article 17',
        reservationsAnonymized: 5,
      },
    });
    expect(create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        event: 'rgpd_erasure',
        metadata: {
          subjectHashPrefix: 'abcd1234',
          reason: 'Article 17',
          reservationsAnonymized: 5,
        },
      }),
    });
  });

  it('utilise un objet vide comme défaut pour metadata', async () => {
    await service.record({ event: 'consent_recorded', actor: 'web' });
    const call = create.mock.calls[0]?.[0] as { data: { metadata: unknown } };
    expect(call.data.metadata).toEqual({});
  });

  it('passe correlationId au log', async () => {
    await service.record({
      event: 'reservation_created',
      actor: 'agent:openai:session-1',
      correlationId: 'corr-abc-123',
    });
    expect(create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        event: 'reservation_created',
        actor: 'agent:openai:session-1',
        correlationId: 'corr-abc-123',
      }),
    });
  });

  it('convertit explicitement les undefined en null (cohérence SQL)', async () => {
    await service.record({ event: 'quote_created', actor: 'agent' });
    const call = create.mock.calls[0]?.[0] as { data: Record<string, unknown> };
    expect(call.data.reservationId).toBeNull();
    expect(call.data.holdId).toBeNull();
    expect(call.data.actorHash).toBeNull();
    expect(call.data.fromState).toBeNull();
    expect(call.data.toState).toBeNull();
    expect(call.data.correlationId).toBeNull();
  });
});

describe('AuditLogService.hashActor', () => {
  it('produit un hash hexadécimal 8 caractères (FNV-1a 32 bits)', () => {
    const hash = AuditLogService.hashActor('agent:openai:session-abc');
    expect(hash).toMatch(/^[0-9a-f]{8}$/);
  });

  it('est déterministe (même input → même output)', () => {
    const a = AuditLogService.hashActor('agent:foo');
    const b = AuditLogService.hashActor('agent:foo');
    expect(a).toBe(b);
  });

  it('produit des hashes différents pour des actors distincts', () => {
    const a = AuditLogService.hashActor('agent:foo');
    const b = AuditLogService.hashActor('agent:bar');
    const c = AuditLogService.hashActor('user:12345');
    // FNV-1a n'est pas cryptographique mais les collisions sur 3 inputs courts sont improbables.
    expect(new Set([a, b, c]).size).toBe(3);
  });

  it('gère un actor vide', () => {
    const hash = AuditLogService.hashActor('');
    expect(hash).toMatch(/^[0-9a-f]{8}$/);
  });
});
