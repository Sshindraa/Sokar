/**
 * Service de consentement RGPD.
 *
 * Enregistre chaque consentement collecté dans customer_consents.
 * Le subjectHash identifie le sujet (hash du téléphone) sans stocker
 * le téléphone en clair (déjà stocké dans Reservation.customerPhone).
 *
 * Le reservationProcessing est obligatoire pour créer une résa.
 * Le marketingOptIn est OPT-IN (jamais coché par défaut).
 */

import type { PrismaClient } from '@prisma/client';
import { createHash } from 'node:crypto';
import { CURRENT_PRIVACY_POLICY_VERSION } from './privacy-policy';

export type ConsentsInput = {
  reservationProcessing: boolean;
  transactionalSms?: boolean;
  transactionalEmail?: boolean;
  marketingOptIn?: boolean;
};

export class ConsentRequiredError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConsentRequiredError';
  }
}

export class ConsentService {
  constructor(private readonly prisma: PrismaClient) {}

  /**
   * Hash un subject (téléphone E.164) pour identifier le sujet RGPD
   * sans stocker le téléphone en clair. SHA-256 (suffisant pour
   * identification, pas pour password).
   */
  static hashSubject(subject: string): string {
    return createHash('sha256').update(subject.toLowerCase().trim()).digest('hex');
  }

  /**
   * Enregistre un consentement. Vérifie que reservationProcessing
   * est bien à true (sinon erreur, c'est obligatoire).
   */
  async recordConsent(args: {
    restaurantId: string;
    customerId: string | null;
    reservationId: string | null;
    subject: string;
    channel: 'MCP' | 'OPENAI_RESERVE' | 'PHONE' | 'WEB' | 'ADMIN' | 'API';
    context: string;
    consents: ConsentsInput;
    consentIpHash?: string;
  }): Promise<{ id: string; version: string }> {
    if (!args.consents.reservationProcessing) {
      throw new ConsentRequiredError(
        'reservationProcessing consent is mandatory to record a consent',
      );
    }

    const subjectHash = ConsentService.hashSubject(args.subject);
    const version = CURRENT_PRIVACY_POLICY_VERSION;

    const record = await this.prisma.customerConsent.create({
      data: {
        restaurantId: args.restaurantId,
        customerId: args.customerId,
        reservationId: args.reservationId,
        subjectHash,
        channel: args.channel,
        context: args.context,
        reservationProcessing: true,
        transactionalSms: args.consents.transactionalSms ?? false,
        transactionalEmail: args.consents.transactionalEmail ?? false,
        marketingOptIn: args.consents.marketingOptIn ?? false,
        privacyPolicyVersion: version,
        consentIpHash: args.consentIpHash,
        consentedAt: new Date(),
      },
    });

    return { id: record.id, version };
  }

  /**
   * Récupère le consentement le plus récent pour un sujet.
   */
  async getLatestConsent(subjectHash: string): Promise<{
    reservationProcessing: boolean;
    transactionalSms: boolean;
    transactionalEmail: boolean;
    marketingOptIn: boolean;
    privacyPolicyVersion: string;
    consentedAt: Date;
  } | null> {
    const record = await this.prisma.customerConsent.findFirst({
      where: { subjectHash },
      orderBy: { consentedAt: 'desc' },
    });
    if (!record) return null;
    return {
      reservationProcessing: record.reservationProcessing,
      transactionalSms: record.transactionalSms,
      transactionalEmail: record.transactionalEmail,
      marketingOptIn: record.marketingOptIn,
      privacyPolicyVersion: record.privacyPolicyVersion,
      consentedAt: record.consentedAt,
    };
  }

  /**
   * Retire le consentement marketing pour un sujet. Les autres
   * consentements (réservation, transactionnel) restent valides
   * tant que la résa est en cours.
   */
  async withdrawMarketingOptIn(subjectHash: string): Promise<{ count: number }> {
    const result = await this.prisma.customerConsent.updateMany({
      where: { subjectHash },
      data: { marketingOptIn: false },
    });
    return { count: result.count };
  }
}
