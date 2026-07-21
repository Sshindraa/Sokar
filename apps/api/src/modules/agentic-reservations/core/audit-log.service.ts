/**
 * Audit log service pour l'agentic reservations.
 *
 * Toute mutation de réservation / hold doit être tracée dans
 * ReservationAuditLog via ce service. Le service est append-only :
 * - aucune méthode update() / delete()
 * - le trigger SQL `reservation_audit_log_append_only` refuse UPDATE/DELETE
 *
 * Le service n'insère JAMAIS de PII brute (pas de customerName, pas de
 * customerPhone, pas d'email). On stocke des IDs internes, des hashes, et
 * des snapshots minimisés via `metadata`.
 */

import { Prisma, type PrismaClient } from '@prisma/client';

export type AuditEvent =
  | 'hold_created'
  | 'hold_consumed'
  | 'hold_released'
  | 'hold_expired'
  | 'quote_created'
  | 'quote_expired'
  | 'reservation_created'
  | 'reservation_seated'
  | 'state_transition'
  | 'reservation_cancelled'
  | 'reservation_no_show'
  | 'reservation_honored'
  | 'reservation_delay_recovered'
  | 'reservation_failed'
  | 'consent_recorded'
  | 'opt_in_changed'
  | 'exposure_settings_changed'
  | 'rgpd_erasure'
  | 'waiting_list_created'
  | 'waiting_list_cancelled'
  | 'waiting_list_cancelled_by_staff'
  | 'waiting_list_promoted';

export class AuditLogService {
  constructor(private readonly prisma: PrismaClient) {}

  async record(
    args: {
      event: AuditEvent;
      reservationId?: string | null;
      holdId?: string | null;
      actor: string;
      actorHash?: string | null;
      fromState?: string | null;
      toState?: string | null;
      correlationId?: string | null;
      metadata?: Record<string, unknown>;
    },
    tx?: Prisma.TransactionClient,
  ): Promise<void> {
    const prisma = (tx ?? this.prisma) as PrismaClient;
    await prisma.reservationAuditLog.create({
      data: {
        event: args.event,
        reservationId: args.reservationId ?? null,
        holdId: args.holdId ?? null,
        actor: args.actor,
        actorHash: args.actorHash ?? null,
        fromState: args.fromState ?? null,
        toState: args.toState ?? null,
        correlationId: args.correlationId ?? null,
        metadata: (args.metadata ?? {}) as object,
      },
    });
  }

  /**
   * Hash un actor (ex: 'agent:openai:session-abc') pour la colonne actorHash.
   * Ne pas confondre avec l'anonymisation : ici c'est juste un identifiant
   * secondaire, l'actor reste lisible dans la colonne principale.
   */
  static hashActor(actor: string): string {
    // FNV-1a 32 bits, suffisant pour identifier un actor sans collision critique
    let hash = 2166136261;
    for (let i = 0; i < actor.length; i++) {
      hash ^= actor.charCodeAt(i);
      hash = (hash * 16777619) >>> 0;
    }
    return hash.toString(16).padStart(8, '0');
  }
}
