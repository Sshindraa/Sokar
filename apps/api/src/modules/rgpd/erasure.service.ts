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
import { observeReservationMutation } from '../../shared/observability/reservation-contract';
import { normalizeCustomerPhone } from '../customers/customer-crm.service';

export class ErasureSubjectNotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ErasureSubjectNotFoundError';
  }
}

export type ErasureResult = {
  subjectHash: string;
  reservationsAnonymized: number;
  experienceReservationsDetached: number;
  eventOrdersDetached: number;
  eventWaitlistEntriesDetached: number;
  consentsRetained: number;
  callsAnonymized: number;
  crmProfilesAnonymized: number;
  crmIdentitiesRemoved: number;
  crmPreferencesRemoved: number;
  crmTagsRemoved: number;
  marketingPermissionsRemoved: number;
  marketingPermissionEventsRemoved: number;
  marketingSuppressionsRemoved: number;
  campaignAudienceMembersRemoved: number;
  campaignMessagesRemoved: number;
  marketingConversionsRemoved: number;
  marketingFrequencyWindowsRemoved: number;
  marketingAttributionLinksRemoved: number;
  marketingAutomationDispatchesRemoved: number;
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

    // CRM projections may not exist on a pre-migration worker. When present,
    // include both the legacy phone and its normalized identity in the erasure
    // subject so a profile created through a formatted number is covered.
    const normalizedPhone = normalizeCustomerPhone(args.subject);
    const crmCustomers = this.prisma.customer
      ? ((await this.prisma.customer.findMany({
          where: normalizedPhone
            ? {
                OR: [
                  { phone: args.subject },
                  { identities: { some: { type: 'PHONE', normalizedValue: normalizedPhone } } },
                ],
              }
            : { phone: args.subject },
          select: { id: true, phone: true },
        })) ?? [])
      : [];
    const crmCustomerIds = crmCustomers.map((customer) => customer.id);

    if (!sampleReservation && !sampleConsent && crmCustomers.length === 0) {
      throw new ErasureSubjectNotFoundError(
        `No data found for subject hash ${subjectHash.slice(0, 8)}…`,
      );
    }

    // 2. Anonymiser les résas (en transaction pour atomicité)
    let crmProfilesAnonymized = 0;
    let crmIdentitiesRemoved = 0;
    let crmPreferencesRemoved = 0;
    let crmTagsRemoved = 0;
    let marketingPermissionsRemoved = 0;
    let marketingPermissionEventsRemoved = 0;
    let marketingSuppressionsRemoved = 0;
    let campaignAudienceMembersRemoved = 0;
    let campaignMessagesRemoved = 0;
    let marketingConversionsRemoved = 0;
    let marketingFrequencyWindowsRemoved = 0;
    let marketingAttributionLinksRemoved = 0;
    let marketingAutomationDispatchesRemoved = 0;
    let experienceReservationsDetached = 0;
    let eventOrdersDetached = 0;
    let eventWaitlistEntriesDetached = 0;
    const reservationsAnonymized = await this.prisma.$transaction(async (tx) => {
      const reservationWhere = crmCustomerIds.length
        ? { OR: [{ customerPhone: args.subject }, { customerId: { in: crmCustomerIds } }] }
        : { customerPhone: args.subject };
      const result = await tx.reservation.updateMany({
        where: reservationWhere,
        data: {
          customerName: 'ANON',
          customerPhone: null,
          customerId: null,
          specialRequests: null,
        },
      });

      // Keep aggregate timeline/metrics rows for auditability, but remove every
      // direct identity and preference before archiving the customer profile.
      const txWithCrm = tx as typeof tx & {
        customer?: {
          update: (args: unknown) => Promise<unknown>;
        };
        customerIdentity?: { deleteMany: (args: unknown) => Promise<{ count: number }> };
        customerPreference?: { deleteMany: (args: unknown) => Promise<{ count: number }> };
        customerTagAssignment?: { deleteMany: (args: unknown) => Promise<{ count: number }> };
        marketingPermission?: { deleteMany: (args: unknown) => Promise<{ count: number }> };
        marketingPermissionEvent?: { deleteMany: (args: unknown) => Promise<{ count: number }> };
        marketingSuppression?: { deleteMany: (args: unknown) => Promise<{ count: number }> };
        campaignAudienceMember?: { deleteMany: (args: unknown) => Promise<{ count: number }> };
        campaignMessage?: { deleteMany: (args: unknown) => Promise<{ count: number }> };
        marketingConversion?: { deleteMany: (args: unknown) => Promise<{ count: number }> };
        marketingFrequencyWindow?: { deleteMany: (args: unknown) => Promise<{ count: number }> };
        marketingAttributionLink?: { deleteMany: (args: unknown) => Promise<{ count: number }> };
        marketingAutomationDispatch?: { deleteMany: (args: unknown) => Promise<{ count: number }> };
        experienceReservation?: {
          updateMany: (args: unknown) => Promise<{ count: number }>;
        };
        eventOrder?: { updateMany: (args: unknown) => Promise<{ count: number }> };
        eventWaitlistEntry?: { updateMany: (args: unknown) => Promise<{ count: number }> };
      };
      if (crmCustomerIds.length > 0 && txWithCrm.customer) {
        for (const customer of crmCustomers) {
          await txWithCrm.customer.update({
            where: { id: customer.id },
            data: {
              phone: `erased:${subjectHash.slice(0, 12)}:${customer.id.slice(-16)}`,
              emailNormalized: null,
              birthMonth: null,
              birthDay: null,
              preferredLocale: null,
              name: 'ANON',
              notes: null,
              specialOccasion: null,
              archivedAt: erasedAt,
            },
          });
          crmProfilesAnonymized += 1;
        }
      }
      if (crmCustomerIds.length > 0 && txWithCrm.customerIdentity) {
        crmIdentitiesRemoved = (
          await txWithCrm.customerIdentity.deleteMany({
            where: { customerId: { in: crmCustomerIds } },
          })
        ).count;
      }
      if (crmCustomerIds.length > 0 && txWithCrm.customerPreference) {
        crmPreferencesRemoved = (
          await txWithCrm.customerPreference.deleteMany({
            where: { customerId: { in: crmCustomerIds } },
          })
        ).count;
      }
      if (crmCustomerIds.length > 0 && txWithCrm.customerTagAssignment) {
        crmTagsRemoved = (
          await txWithCrm.customerTagAssignment.deleteMany({
            where: { customerId: { in: crmCustomerIds } },
          })
        ).count;
      }
      if (crmCustomerIds.length > 0 && txWithCrm.campaignMessage) {
        campaignMessagesRemoved = (
          await txWithCrm.campaignMessage.deleteMany({
            where: { customerId: { in: crmCustomerIds } },
          })
        ).count;
      }
      if (crmCustomerIds.length > 0 && txWithCrm.campaignAudienceMember) {
        campaignAudienceMembersRemoved = (
          await txWithCrm.campaignAudienceMember.deleteMany({
            where: { customerId: { in: crmCustomerIds } },
          })
        ).count;
      }
      if (crmCustomerIds.length > 0 && txWithCrm.marketingConversion) {
        marketingConversionsRemoved = (
          await txWithCrm.marketingConversion.deleteMany({
            where: { customerId: { in: crmCustomerIds } },
          })
        ).count;
      }
      if (crmCustomerIds.length > 0 && txWithCrm.marketingPermissionEvent) {
        marketingPermissionEventsRemoved = (
          await txWithCrm.marketingPermissionEvent.deleteMany({
            where: { customerId: { in: crmCustomerIds } },
          })
        ).count;
      }
      if (crmCustomerIds.length > 0 && txWithCrm.marketingPermission) {
        marketingPermissionsRemoved = (
          await txWithCrm.marketingPermission.deleteMany({
            where: { customerId: { in: crmCustomerIds } },
          })
        ).count;
      }
      if (crmCustomerIds.length > 0 && txWithCrm.marketingSuppression) {
        marketingSuppressionsRemoved = (
          await txWithCrm.marketingSuppression.deleteMany({
            where: { customerId: { in: crmCustomerIds } },
          })
        ).count;
      }
      if (crmCustomerIds.length > 0 && txWithCrm.marketingFrequencyWindow) {
        marketingFrequencyWindowsRemoved = (
          await txWithCrm.marketingFrequencyWindow.deleteMany({
            where: { customerId: { in: crmCustomerIds } },
          })
        ).count;
      }
      if (crmCustomerIds.length > 0 && txWithCrm.marketingAttributionLink) {
        marketingAttributionLinksRemoved = (
          await txWithCrm.marketingAttributionLink.deleteMany({
            where: { customerId: { in: crmCustomerIds } },
          })
        ).count;
      }
      if (crmCustomerIds.length > 0 && txWithCrm.marketingAutomationDispatch) {
        marketingAutomationDispatchesRemoved = (
          await txWithCrm.marketingAutomationDispatch.deleteMany({
            where: { customerId: { in: crmCustomerIds } },
          })
        ).count;
      }
      if (txWithCrm.experienceReservation) {
        const experienceReservationWhere = {
          OR: [
            ...(crmCustomerIds.length > 0 ? [{ customerId: { in: crmCustomerIds } }] : []),
            { customer: { phone: args.subject } },
            { reservation: { customerPhone: args.subject } },
          ],
        };
        experienceReservationsDetached = (
          await txWithCrm.experienceReservation.updateMany({
            where: experienceReservationWhere,
            data: { customerId: null, reservationId: null },
          })
        ).count;
      }
      if (crmCustomerIds.length > 0 && txWithCrm.eventOrder) {
        eventOrdersDetached = (
          await txWithCrm.eventOrder.updateMany({
            where: { customerId: { in: crmCustomerIds } },
            data: { customerId: null },
          })
        ).count;
      }
      if (crmCustomerIds.length > 0 && txWithCrm.eventWaitlistEntry) {
        eventWaitlistEntriesDetached = (
          await txWithCrm.eventWaitlistEntry.updateMany({
            where: { customerId: { in: crmCustomerIds } },
            data: { customerId: null },
          })
        ).count;
      }
      return result.count;
    }, LONG_TRANSACTION_OPTIONS);
    if (reservationsAnonymized > 0) {
      observeReservationMutation({
        source: 'rgpd',
        operation: 'anonymize',
        idempotency: 'not_applicable',
        audit: 'written',
        notification: 'not_sent',
        capacity: 'unchanged',
      });
    }

    // 3. Anonymiser les messages d'appels (Message contient customerPhone/customerName).
    //    La table Call n'a pas de colonne customerPhone directe.
    let callsAnonymized = 0;
    try {
      const messageResult = await this.prisma.message.updateMany({
        where: { customerPhone: args.subject },
        data: { customerPhone: null, customerName: 'ANON' },
      });
      callsAnonymized = messageResult.count;
    } catch (err) {
      logger.debug({ err }, 'Message table does not have customerPhone field, skipping');
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
        crmProfilesAnonymized,
        crmIdentitiesRemoved,
        crmPreferencesRemoved,
        crmTagsRemoved,
        marketingPermissionsRemoved,
        marketingPermissionEventsRemoved,
        marketingSuppressionsRemoved,
        campaignAudienceMembersRemoved,
        campaignMessagesRemoved,
        marketingConversionsRemoved,
        marketingFrequencyWindowsRemoved,
        marketingAttributionLinksRemoved,
        marketingAutomationDispatchesRemoved,
        experienceReservationsDetached,
        eventOrdersDetached,
        eventWaitlistEntriesDetached,
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
        crmProfilesAnonymized,
        crmIdentitiesRemoved,
        crmPreferencesRemoved,
        crmTagsRemoved,
        marketingPermissionsRemoved,
        marketingPermissionEventsRemoved,
        marketingSuppressionsRemoved,
        campaignAudienceMembersRemoved,
        campaignMessagesRemoved,
        marketingConversionsRemoved,
        marketingFrequencyWindowsRemoved,
        marketingAttributionLinksRemoved,
        marketingAutomationDispatchesRemoved,
        experienceReservationsDetached,
        eventOrdersDetached,
        eventWaitlistEntriesDetached,
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
      crmProfilesAnonymized,
      crmIdentitiesRemoved,
      crmPreferencesRemoved,
      crmTagsRemoved,
      marketingPermissionsRemoved,
      marketingPermissionEventsRemoved,
      marketingSuppressionsRemoved,
      campaignAudienceMembersRemoved,
      campaignMessagesRemoved,
      marketingConversionsRemoved,
      marketingFrequencyWindowsRemoved,
      marketingAttributionLinksRemoved,
      marketingAutomationDispatchesRemoved,
      experienceReservationsDetached,
      eventOrdersDetached,
      eventWaitlistEntriesDetached,
      erasedAt,
    };
  }
}
