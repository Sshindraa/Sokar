import type { DelayImpactSimulation } from './service-copilot-delay-impact.service';
import { formatCustomerFacingTime, toCustomerFacingTime } from './customer-facing-time';
import type { PrismaClient } from '@prisma/client';
import { ConsentService } from '../rgpd/consent.service';

export interface ServiceCommunicationDraft {
  recipient: 'delayed-reservation' | 'waiting-list';
  customerName: string;
  message: string;
  delivery: 'review-required';
  eligibleChannel: 'sms' | 'email' | null;
  deliveryBlocker?: 'no-contact' | 'no-transactional-consent';
  reason: string;
  confidence: 'medium';
}

/** Génère des brouillons factuels. Ne lit aucun contact et n'envoie jamais rien. */
export class ServiceCopilotCommunicationService {
  constructor(private readonly prisma: PrismaClient) {}

  async buildDrafts(
    restaurantId: string,
    impact: DelayImpactSimulation,
  ): Promise<ServiceCommunicationDraft[]> {
    if (!impact.feasible || !impact.delayedReservation || !impact.waitingListEntry) return [];
    const delayedAt = new Date(
      impact.delayedReservation.customerFacingProposedStartsAt ??
        toCustomerFacingTime(new Date(impact.delayedReservation.proposedStartsAt)),
    );
    const waitingAt = new Date(
      impact.waitingListEntry.customerFacingRequestedStartsAt ??
        toCustomerFacingTime(new Date(impact.waitingListEntry.requestedStartsAt)),
    );
    const delayedTime = formatCustomerFacingTime(delayedAt);
    const waitingTime = formatCustomerFacingTime(waitingAt);
    const [reservation, waitingEntry] = await Promise.all([
      this.prisma.reservation.findFirst({
        where: { id: impact.delayedReservation.id, restaurantId },
        select: { customerPhone: true, customerEmail: true },
      }),
      this.prisma.waitingListEntry.findFirst({
        where: { id: impact.waitingListEntry.id, restaurantId },
        select: { customerPhone: true, customerEmail: true },
      }),
    ]);
    const [delayedDelivery, waitingDelivery] = await Promise.all([
      this.resolveDelivery(restaurantId, reservation),
      this.resolveDelivery(restaurantId, waitingEntry),
    ]);
    return [
      {
        recipient: 'delayed-reservation',
        customerName: impact.delayedReservation.customerName,
        message: `Bonjour ${impact.delayedReservation.customerName}, nous prenons en compte votre arrivée vers ${delayedTime}. Votre réservation reste bien prévue.`,
        delivery: 'review-required',
        ...delayedDelivery,
        reason: 'Retard annoncé et plan de salle faisable.',
        confidence: 'medium',
      },
      {
        recipient: 'waiting-list',
        customerName: impact.waitingListEntry.customerName,
        message: `Bonjour ${impact.waitingListEntry.customerName}, une table devrait être disponible vers ${waitingTime}. Souhaitez-vous que nous vous la proposions ?`,
        delivery: 'review-required',
        ...waitingDelivery,
        reason: 'Promotion possible après validation du plan de salle.',
        confidence: 'medium',
      },
    ];
  }

  private async resolveDelivery(
    restaurantId: string,
    contact: { customerPhone: string | null; customerEmail: string | null } | null,
  ): Promise<Pick<ServiceCommunicationDraft, 'eligibleChannel' | 'deliveryBlocker'>> {
    if (!contact?.customerPhone && !contact?.customerEmail) {
      return { eligibleChannel: null, deliveryBlocker: 'no-contact' };
    }
    const consent = contact.customerPhone
      ? await this.prisma.customerConsent.findFirst({
          where: {
            restaurantId,
            subjectHash: ConsentService.hashSubject(contact.customerPhone),
          },
          orderBy: { consentedAt: 'desc' },
          select: { transactionalSms: true, transactionalEmail: true },
        })
      : null;
    if (contact.customerPhone && consent?.transactionalSms) return { eligibleChannel: 'sms' };
    if (contact.customerEmail && consent?.transactionalEmail) return { eligibleChannel: 'email' };
    return { eligibleChannel: null, deliveryBlocker: 'no-transactional-consent' };
  }
}
