import type { DelayImpactSimulation } from './service-copilot-delay-impact.service';
import { formatCustomerFacingTime, toCustomerFacingTime } from './customer-facing-time';

export interface ServiceCommunicationDraft {
  recipient: 'delayed-reservation' | 'waiting-list';
  customerName: string;
  message: string;
  delivery: 'review-required';
  reason: string;
  confidence: 'medium';
}

/** Génère des brouillons factuels. Ne lit aucun contact et n'envoie jamais rien. */
export class ServiceCopilotCommunicationService {
  buildDrafts(impact: DelayImpactSimulation): ServiceCommunicationDraft[] {
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
    return [
      {
        recipient: 'delayed-reservation',
        customerName: impact.delayedReservation.customerName,
        message: `Bonjour ${impact.delayedReservation.customerName}, nous prenons en compte votre arrivée vers ${delayedTime}. Votre réservation reste bien prévue.`,
        delivery: 'review-required',
        reason: 'Retard annoncé et plan de salle faisable.',
        confidence: 'medium',
      },
      {
        recipient: 'waiting-list',
        customerName: impact.waitingListEntry.customerName,
        message: `Bonjour ${impact.waitingListEntry.customerName}, une table devrait être disponible vers ${waitingTime}. Souhaitez-vous que nous vous la proposions ?`,
        delivery: 'review-required',
        reason: 'Promotion possible après validation du plan de salle.',
        confidence: 'medium',
      },
    ];
  }
}
