/**
 * Service d'effacement RGPD (Article 17 — droit à l'effacement).
 *
 * Stratégie Phase 5 MVP : on NE supprime PAS les résas (sinon on casse
 * les stats et les obligations comptables). On anonymise :
 *   - customerName → "ANON"
 *   - customerPhone → null
 *   - customerId → null
 *   - specialRequests → null
 *
 * Les customer_consents sont conservés (preuve de consentement) mais
 * le subjectHash est conservé tel quel (déjà hashé).
 *
 * Le client est marqué via un flag dans une nouvelle table OU via
 * une convention : tous les enregistrements du sujet sont effacés
 * OU on ajoute un champ erasedAt. MVP : on n'ajoute pas de colonne,
 * on note juste un erasure_request dans un log structuré.
 *
 * Si le client a des appels associés, on anonymise aussi le numéro
 * de téléphone dans Call (s'il existe en clair).
 */

import type { PrismaClient } from '@prisma/client';
import { logger } from '../../shared/logger/pino';
import { LONG_TRANSACTION_OPTIONS } from '../../shared/db/transaction-options';
import { ConsentService } from './consent.service';
import { AuditLogService } from '../agentic-reservations/core/audit-log.service';
import { trackRgpdEvent } from '../analytics/events.service';

export class ErasureSubjectNotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ErasureSubjectNotFoundError';
  }
}

export type ErasureResult = {
  subjectHash: string;
  reservationsAnonymized: number;
  consentsRetained: number;
  callsAnonymized: number;
  erasedAt: Date;
};

export class ErasureService {
  private readonly audit: AuditLogService;

  constructor(private readonly prisma: PrismaClient) {
    this.audit = new AuditLogService(prisma);
  }

  /**
   * Anonymise toutes les données d'un sujet identifié par son téléphone.
   * Le sujet doit prouver son identité en fournissant le téléphone
   * exact utilisé lors des résas.
   */
  async eraseSubject(args: {
    subject: string;
    reason: string;
    actor: string;
  }): Promise<ErasureResult> {
    const subjectHash = ConsentService.hashSubject(args.subject);
    const erasedAt = new Date();

    // 1. Vérifier qu'on a au moins une trace du sujet (sinon 404).
    // On matche par téléphone car Reservation n'a pas de colonne subjectHash
    // (le hash vit dans CustomerConsent).
    const sampleReservation = await this.prisma.reservation.findFirst({
      where: { customerPhone: args.subject },
      select: { id: true },
    });
    const sampleConsent = await this.prisma.customerConsent.findFirst({
      where: { subjectHash },
      select: { id: true },
    });

    if (!sampleReservation && !sampleConsent) {
      throw new ErasureSubjectNotFoundError(
        `No data found for subject hash ${subjectHash.slice(0, 8)}…`,
      );
    }

    // 2. Anonymiser les résas (en transaction pour atomicité)
    const reservationsAnonymized = await this.prisma.$transaction(async (tx) => {
      const result = await tx.reservation.updateMany({
        where: { customerPhone: args.subject },
        data: {
          customerName: 'ANON',
          customerPhone: null,
          customerId: null,
          specialRequests: null,
        },
      });
      return result.count;
    }, LONG_TRANSACTION_OPTIONS);

    // 3. Anonymiser les appels (best-effort : la table Call peut ne pas
    //    avoir de customerPhone selon le schéma).
    let callsAnonymized = 0;
    try {
      const callResult = await this.prisma.call.updateMany({
        // @ts-expect-error -- Call can lack customerPhone depending on schema
        where: { customerPhone: args.subject },
        // @ts-expect-error -- see above
        data: { customerPhone: null },
      });
      callsAnonymized = callResult.count;
    } catch (err) {
      logger.debug({ err }, 'Call table does not have customerPhone field, skipping');
    }

    // 4. Conserver les consents (preuve légale) — pas d'anonymisation
    const consentsRetained = await this.prisma.customerConsent.count({
      where: { subjectHash },
    });

    // 5. Audit log
    await this.audit.record({
      event: 'rgpd_erasure',
      actor: args.actor,
      metadata: {
        subjectHashPrefix: subjectHash.slice(0, 8),
        reason: args.reason,
        reservationsAnonymized,
        callsAnonymized,
        consentsRetained,
      },
    });

    // 6. Analytics event (rgpd_erasure obligatoire).
    // L'audit log reste la preuve légale ; l'event sert à l'observabilité
    // (dashboard pilot, alertes, comptage SLA). On ne stocke AUCUN PII.
    // On best-effort : si la queue est down, l'erasure a déjà eu lieu
    // (étapes 1-5), donc on ne fait pas échouer la réponse.
    await trackRgpdEvent({
      event: 'rgpd_erasure',
      intent: 'erase',
      subjectHashPrefix: subjectHash.slice(0, 8),
      actor: args.actor,
      metadata: {
        reason: args.reason,
        reservationsAnonymized,
        callsAnonymized,
        consentsRetained,
      },
    });

    logger.info(
      {
        subjectHash: subjectHash.slice(0, 8),
        reservationsAnonymized,
        callsAnonymized,
        actor: args.actor,
      },
      'RGPD erasure executed',
    );

    return {
      subjectHash,
      reservationsAnonymized,
      consentsRetained,
      callsAnonymized,
      erasedAt,
    };
  }
}
