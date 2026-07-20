/**
 * Service d'export RGPD (Article 15 — droit d'accès, Article 20 — portabilité).
 *
 * Retourne toutes les données personnelles d'un sujet dans un format
 * JSON portable et lisible (pour que le client puisse les transmettre
 * à un autre service).
 *
 * Le payload contient :
 *   - Profil (ce qu'on sait du sujet)
 *   - Réservations (avec PII, jamais anonymisées pour l'export)
 *   - Consentements (preuve de ce qui a été consenti)
 *   - Appels (si applicable, anonymisés en PII si besoin)
 */

import type { PrismaClient } from '@prisma/client';
import { ConsentService } from './consent.service';
import { CURRENT_PRIVACY_POLICY_VERSION } from './privacy-policy';

export class ExportSubjectNotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ExportSubjectNotFoundError';
  }
}

export type ExportPayload = {
  exportedAt: string;
  privacyPolicyVersion: string;
  subject: {
    hashPrefix: string;
    // On ne stocke pas le téléphone en clair dans l'export final
    // sauf si le caller l'a explicitement demandé.
  };
  profile: {
    customerName: string | null;
    customerPhone: string | null;
    customerEmail: string | null;
  } | null;
  reservations: Array<{
    id: string;
    restaurantId: string;
    restaurantName: string | null;
    startsAt: string;
    endsAt: string;
    partySize: number;
    state: string;
    channel: string;
    customerName: string;
    customerPhone: string | null;
    specialRequests: string | null;
    createdAt: string;
  }>;
  consents: Array<{
    id: string;
    restaurantId: string;
    channel: string;
    context: string;
    reservationProcessing: boolean;
    transactionalSms: boolean;
    transactionalEmail: boolean;
    marketingOptIn: boolean;
    privacyPolicyVersion: string;
    consentedAt: string;
  }>;
};

export class ExportService {
  constructor(private readonly prisma: PrismaClient) {}

  async exportSubject(args: { subject: string }): Promise<ExportPayload> {
    const subjectHash = ConsentService.hashSubject(args.subject);

    // Récupérer les résas (toutes les résas avec ce téléphone)
    const reservations = await this.prisma.reservation.findMany({
      where: { customerPhone: args.subject },
      select: {
        id: true,
        restaurantId: true,
        startsAt: true,
        endsAt: true,
        partySize: true,
        state: true,
        channel: true,
        customerName: true,
        customerPhone: true,
        customerEmail: true,
        specialRequests: true,
        createdAt: true,
        restaurant: { select: { name: true } },
      },
      orderBy: { startsAt: 'desc' },
    });

    // Récupérer les consents
    const consents = await this.prisma.customerConsent.findMany({
      where: { subjectHash },
      orderBy: { consentedAt: 'desc' },
    });

    if (reservations.length === 0 && consents.length === 0) {
      throw new ExportSubjectNotFoundError(
        `No data found for subject hash ${subjectHash.slice(0, 8)}…`,
      );
    }

    // Profile : on prend la première résa comme référence
    const first = reservations[0];
    const profile = first
      ? {
          customerName: first.customerName,
          customerPhone: first.customerPhone,
          customerEmail: first.customerEmail ?? null,
        }
      : null;

    return {
      exportedAt: new Date().toISOString(),
      privacyPolicyVersion: CURRENT_PRIVACY_POLICY_VERSION,
      subject: { hashPrefix: subjectHash.slice(0, 8) },
      profile,
      reservations: reservations.map((r) => ({
        id: r.id,
        restaurantId: r.restaurantId,
        restaurantName: r.restaurant?.name ?? null,
        startsAt: (r.startsAt ?? r.createdAt).toISOString(),
        endsAt: (r.endsAt ?? r.createdAt).toISOString(),
        partySize: r.partySize,
        state: r.state,
        channel: r.channel,
        customerName: r.customerName,
        customerPhone: r.customerPhone,
        specialRequests: r.specialRequests,
        createdAt: r.createdAt.toISOString(),
      })),
      consents: consents.map((c) => ({
        id: c.id,
        restaurantId: c.restaurantId,
        channel: c.channel,
        context: c.context,
        reservationProcessing: c.reservationProcessing,
        transactionalSms: c.transactionalSms,
        transactionalEmail: c.transactionalEmail,
        marketingOptIn: c.marketingOptIn,
        privacyPolicyVersion: c.privacyPolicyVersion,
        consentedAt: c.consentedAt.toISOString(),
      })),
    };
  }
}
