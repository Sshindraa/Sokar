import { db } from '../../shared/db/client';
import { getCachedContext, setCachedContext, redisCache } from '../../shared/redis/client';
import { logger } from '../../shared/logger/pino';
import {
  appendCustomerTimelineEvent,
  buildCustomerTimelineDedupeKey,
  normalizeCustomerPhone,
  rebuildCustomerMetricSnapshot,
  upsertCustomerIdentity,
} from './customer-crm.service';
import { loadCustomerVoiceProfile, type CustomerVoiceProfile } from './customer-voice-profile';

const VOICE_PREFERENCE_LABELS: Record<CustomerVoiceProfile['preferences'][number]['key'], string> =
  {
    preferred_section: 'zone préférée',
    preferred_table: 'table préférée',
    dietary_restrictions: 'régime alimentaire',
    accessibility_needs: 'accessibilité',
    preferred_language: 'langue préférée',
    occasion_type: 'occasion habituelle',
    service_preference: 'service préféré',
    group_pattern: 'groupe habituel',
  };

export interface CustomerContext {
  id: string;
  name: string | null;
  visitCount: number;
  isVip: boolean;
  specialOccasion: string | null;
  notes: string | null;
  lastCallAt: Date | null;
  partySizeTypical: number | null;
  /** Real visit history and confirmed CRM data, loaded for voice calls only. */
  voiceProfile?: CustomerVoiceProfile;
}

export class CustomerService {
  static async lookupOrCreate(
    restaurantId: string,
    phone: string,
    name?: string,
  ): Promise<CustomerContext> {
    const normalizedPhone = normalizeCustomerPhone(phone);
    const cachePhone = normalizedPhone ?? phone;
    const cacheKey = `customer:${restaurantId}:${cachePhone}`;
    const cached = await getCachedContext(cacheKey);
    if (cached) return cached;

    const identityCandidate = normalizedPhone
      ? await db.customerIdentity.findUnique({
          where: {
            restaurantId_type_normalizedValue: {
              restaurantId,
              type: 'PHONE',
              normalizedValue: normalizedPhone,
            },
          },
          include: {
            customer: {
              select: { id: true, restaurantId: true, archivedAt: true, mergedIntoId: true },
            },
          },
        })
      : null;
    const identity =
      identityCandidate &&
      identityCandidate.customer.restaurantId === restaurantId &&
      identityCandidate.customer.archivedAt === null &&
      identityCandidate.customer.mergedIntoId === null
        ? identityCandidate
        : null;

    const customer = identity
      ? await db.customer.update({
          where: { id: identity.customerId, restaurantId },
          data: name ? { name, lastSeenAt: new Date() } : { lastSeenAt: new Date() },
        })
      : await db.customer.upsert({
          where: { restaurantId_phone: { restaurantId, phone } },
          create: { restaurantId, phone, name: name ?? null, visitCount: 0 },
          update: name ? { name, lastSeenAt: new Date() } : { lastSeenAt: new Date() },
        });

    if (normalizedPhone) {
      try {
        await upsertCustomerIdentity({
          restaurantId,
          customerId: customer.id,
          type: 'PHONE',
          value: phone,
          source: 'VOICE',
        });
      } catch {
        // Identity dual-write is additive. A legacy lookup must remain
        // available while a backfill or another worker repairs the identity.
      }
    }

    const ctx: CustomerContext = {
      id: customer.id,
      name: customer.name,
      visitCount: customer.visitCount,
      isVip: customer.isVip,
      specialOccasion: customer.specialOccasion,
      notes: customer.notes,
      lastCallAt: customer.lastCallAt,
      partySizeTypical:
        customer.partySizeTypical !== null ? Number(customer.partySizeTypical) : null,
    };

    await setCachedContext(cacheKey, ctx, 300);
    return ctx;
  }

  static async incrementVisit(
    restaurantId: string,
    phone: string,
    options?: { reservationId?: string; occurredAt?: Date },
  ): Promise<void> {
    await db.customer.updateMany({
      where: { restaurantId, phone },
      data: { visitCount: { increment: 1 }, lastSeenAt: new Date() },
    });
    const normalizedPhone = normalizeCustomerPhone(phone);
    await redisCache.del(`customer:${restaurantId}:${normalizedPhone ?? phone}`);

    if (options?.reservationId) {
      try {
        await CustomerService.recordReservationEvent({
          restaurantId,
          phone,
          reservationId: options.reservationId,
          eventType: 'RESERVATION_CREATED',
          occurredAt: options.occurredAt,
        });
      } catch (error) {
        // CRM projections are repairable. Never make an accepted reservation
        // or a completed call retry because a projection write is unavailable.
        logger.warn(
          {
            err: error instanceof Error ? error.message : String(error),
            restaurantId,
            reservationId: options.reservationId,
          },
          '[crm] reservation timeline projection failed',
        );
      }
    }
  }

  /**
   * Append a reservation lifecycle event and refresh the deterministic
   * customer metrics projection. All callers treat this as best effort so a
   * repairable CRM outage cannot change reservation semantics.
   */
  static async recordReservationEvent(input: {
    restaurantId: string;
    reservationId: string;
    eventType:
      | 'RESERVATION_CREATED'
      | 'RESERVATION_CANCELLED'
      | 'RESERVATION_HONORED'
      | 'RESERVATION_NO_SHOW';
    customerId?: string | null;
    phone?: string | null;
    name?: string | null;
    occurredAt?: Date;
  }): Promise<void> {
    const normalizedPhone = input.phone ? normalizeCustomerPhone(input.phone) : null;
    let customerId = input.customerId ?? null;
    if (!customerId && input.phone) {
      const existing = await findCustomerForPhone(input.restaurantId, input.phone, normalizedPhone);
      customerId = existing?.id ?? null;
    }
    if (!customerId && input.phone) {
      const created = await CustomerService.lookupOrCreate(
        input.restaurantId,
        input.phone,
        input.name ?? undefined,
      );
      customerId = created.id;
    }
    if (!customerId) return;

    await appendCustomerTimelineEvent({
      restaurantId: input.restaurantId,
      customerId,
      eventType: input.eventType,
      sourceType: 'reservation',
      sourceId: input.reservationId,
      dedupeKey: buildCustomerTimelineDedupeKey({
        restaurantId: input.restaurantId,
        customerId,
        eventType: input.eventType,
        sourceType: 'reservation',
        sourceId: input.reservationId,
      }),
      occurredAt: input.occurredAt,
      summaryCode: `reservation.${input.eventType.slice('RESERVATION_'.length).toLowerCase()}`,
    });
    await rebuildCustomerMetricSnapshot({
      restaurantId: input.restaurantId,
      customerId,
      now: input.occurredAt,
    });
  }

  /**
   * Called on every inbound call (hangup or not). Cheap — touches only the
   * customer row and invalidates the 5-min lookup cache so the next call sees
   * the fresh lastCallAt.
   */
  static async recordCallActivity(
    restaurantId: string,
    phone: string,
    partySize: number | null,
    options?: { callId?: string; occurredAt?: Date },
  ): Promise<void> {
    const data: Record<string, unknown> = { lastCallAt: new Date() };
    if (partySize && partySize > 0) {
      // 70% recent weight, 30% prior — let pattern emerge over time without
      // overwriting the first few samples. Falls back to prior if no history.
      const existing = await db.customer.findUnique({
        where: { restaurantId_phone: { restaurantId, phone } },
        select: { partySizeTypical: true },
      });
      const prior = existing?.partySizeTypical ? Number(existing.partySizeTypical) : null;
      if (prior && prior > 0) {
        data.partySizeTypical = Math.round(0.7 * partySize + 0.3 * prior);
      } else {
        data.partySizeTypical = partySize;
      }
    }

    await db.customer.updateMany({
      where: { restaurantId, phone },
      data,
    });
    const normalizedPhone = normalizeCustomerPhone(phone);
    await redisCache.del(`customer:${restaurantId}:${normalizedPhone ?? phone}`);

    if (options?.callId) {
      try {
        const customer = await findCustomerForPhone(restaurantId, phone, normalizedPhone);
        if (customer) {
          await appendCustomerTimelineEvent({
            restaurantId,
            customerId: customer.id,
            eventType: 'CALL_RECEIVED',
            sourceType: 'call',
            sourceId: options.callId,
            dedupeKey: buildCustomerTimelineDedupeKey({
              restaurantId,
              customerId: customer.id,
              eventType: 'CALL_RECEIVED',
              sourceType: 'call',
              sourceId: options.callId,
            }),
            occurredAt: options.occurredAt,
            summaryCode: 'call.received',
            metadata: partySize && partySize > 0 ? { partySize } : undefined,
          });
        }
      } catch (error) {
        // See incrementVisit: timeline projection failures are repairable and
        // must not make the Telnyx webhook retry.
        logger.warn(
          {
            err: error instanceof Error ? error.message : String(error),
            restaurantId,
            callId: options.callId,
          },
          '[crm] call timeline projection failed',
        );
      }
    }
  }

  /**
   * Customer context used before the CRM voice profile (restaurants outside
   * `VOICE_CRM_PROFILE_RESTAURANT_IDS`). Kept verbatim so the prompt stays
   * identical until a restaurant is listed.
   */
  static buildLegacyVipPromptExtra(customer: CustomerContext): string {
    if (!customer.name) return '';
    const lines: string[] = [`Le client s'appelle ${customer.name}.`];
    if (customer.visitCount > 0) lines.push(`C'est sa ${customer.visitCount + 1}e visite.`);
    if (customer.isVip) lines.push('⭐ Client VIP — sois particulièrement attentionné.');
    if (customer.specialOccasion) lines.push(`Occasion spéciale : ${customer.specialOccasion}.`);
    if (customer.notes) lines.push(`Note gérant : ${customer.notes}`);
    if (customer.partySizeTypical && customer.partySizeTypical > 0) {
      lines.push(`Taille de groupe habituelle : ${customer.partySizeTypical} pers.`);
    }
    return lines.join(' ');
  }

  /** Greeting fragment used before the CRM voice profile; see buildLegacyVipPromptExtra. */
  static buildLegacyReturningGreeting(customer: CustomerContext): string {
    if (!customer.name) return '';
    if (customer.isVip) return `, content de vous revoir M. ${customer.name.split(' ')[0]}`;
    if (customer.visitCount >= 1) {
      return `, ravi de vous revoir ${customer.name.split(' ')[0]}`;
    }
    return '';
  }

  /**
   * Adds the real visit history and the confirmed CRM data to a caller. Best
   * effort: a CRM read failure leaves the call on the basic customer context.
   */
  static async withVoiceProfile(
    restaurantId: string,
    customer: CustomerContext,
    now = new Date(),
  ): Promise<CustomerContext> {
    try {
      const voiceProfile = await loadCustomerVoiceProfile(restaurantId, customer.id, now);
      return { ...customer, voiceProfile };
    } catch (error) {
      logger.warn(
        { err: error instanceof Error ? error.message : String(error), restaurantId },
        '[crm] voice profile unavailable',
      );
      return customer;
    }
  }

  static buildVipPromptExtra(
    customer: CustomerContext,
    options: { timezone?: string } = {},
  ): string {
    if (!customer.name) return '';
    const timezone = options.timezone ?? 'Europe/Paris';
    const profile = customer.voiceProfile;
    const lines: string[] = [`- Nom : ${customer.name}.`];

    if (profile) {
      if (profile.pastVisits > 0) {
        const last = profile.lastVisitAt
          ? ` ; dernière visite le ${formatVoiceDate(profile.lastVisitAt, timezone, false)}`
          : '';
        lines.push(`- Déjà venu ${profile.pastVisits} fois${last}.`);
      } else {
        lines.push('- Aucune visite passée connue.');
      }
      if (profile.upcomingReservation) {
        const { startsAt, partySize } = profile.upcomingReservation;
        lines.push(
          `- Réservation à venir : ${formatVoiceDate(startsAt, timezone, true)}, ${partySize} pers.`,
        );
      }
    }
    const typicalPartySize = profile ? profile.typicalPartySize : customer.partySizeTypical;
    if (typicalPartySize && typicalPartySize > 0) {
      lines.push(`- Taille de groupe habituelle : ${typicalPartySize} pers.`);
    }
    if (profile && profile.preferences.length > 0) {
      const preferences = profile.preferences
        .map((preference) => `${VOICE_PREFERENCE_LABELS[preference.key]} : ${preference.value}`)
        .join(' ; ');
      lines.push(`- Préférences notées par l'équipe : ${preferences}.`);
    }
    if (profile && profile.tags.length > 0) {
      lines.push(`- Étiquettes de l'équipe : ${profile.tags.join(', ')}.`);
    }
    if (customer.isVip) lines.push("- Client VIP : soigne particulièrement l'échange.");
    if (customer.specialOccasion) lines.push(`- Occasion spéciale : ${customer.specialOccasion}.`);
    if (customer.notes) lines.push(`- Note du gérant : ${customer.notes}`);

    return [
      'CLIENT RECONNU PAR SON NUMÉRO (fiche du restaurant) :',
      ...lines,
      "Ces informations t'aident à mieux le servir : tu ne les récites pas, tu t'en sers au moment où elles servent (sa zone ou sa table habituelle quand vous choisissez, sa réservation à venir s'il appelle à son sujet). Un régime alimentaire ou un besoin d'accessibilité se confirme avec lui plutôt que d'être supposé, et ne s'étend pas aux autres convives. Si l'appelant dit être une autre personne, ne t'en sers pas.",
    ].join('\n');
  }

  /**
   * First name of a caller the restaurant knows (a past visit, or marked VIP by
   * the team), for the agent to acknowledge in its own words. Empty otherwise.
   */
  static returningCustomerFirstName(customer: CustomerContext): string {
    if (!customer.name) return '';
    const pastVisits = customer.voiceProfile?.pastVisits ?? 0;
    if (pastVisits < 1 && !customer.isVip) return '';
    return customer.name.trim().split(/\s+/)[0] ?? '';
  }
}

function formatVoiceDate(iso: string, timezone: string, withTime: boolean): string {
  return new Intl.DateTimeFormat('fr-FR', {
    weekday: withTime ? 'long' : undefined,
    day: 'numeric',
    month: 'long',
    year: withTime ? undefined : 'numeric',
    hour: withTime ? '2-digit' : undefined,
    minute: withTime ? '2-digit' : undefined,
    timeZone: timezone,
  }).format(new Date(iso));
}

async function findCustomerForPhone(
  restaurantId: string,
  phone: string,
  normalizedPhone: string | null,
): Promise<{ id: string } | null> {
  if (normalizedPhone) {
    const identity = await db.customerIdentity.findUnique({
      where: {
        restaurantId_type_normalizedValue: {
          restaurantId,
          type: 'PHONE',
          normalizedValue: normalizedPhone,
        },
      },
      include: {
        customer: {
          select: { id: true, restaurantId: true, archivedAt: true, mergedIntoId: true },
        },
      },
    });
    if (
      identity?.customer.restaurantId === restaurantId &&
      identity.customer.archivedAt === null &&
      identity.customer.mergedIntoId === null
    ) {
      return { id: identity.customer.id };
    }
  }
  return db.customer
    .findUnique({
      where: { restaurantId_phone: { restaurantId, phone } },
      select: { id: true, archivedAt: true, mergedIntoId: true },
    })
    .then((customer) =>
      customer && customer.archivedAt === null && customer.mergedIntoId === null
        ? { id: customer.id }
        : null,
    );
}
