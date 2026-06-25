/**
 * Canal A — Routes publiques Fastify.
 *
 * Préfixe : /public/r/:slug
 *
 * Endpoints (cf. spec v1.1 §6.2) :
 *   GET    /public/r/:slug
 *   GET    /public/r/:slug/availability
 *   POST   /public/r/:slug/hold
 *   POST   /public/r/:slug/confirm
 *
 * Pas de Clerk, pas de requireOrg.
 * CORS : origines sokar.tech (géré par plugins/cors.ts)
 */

import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { createHash } from 'node:crypto';
import { db } from '../../shared/db/client';
import { redisCache } from '../../shared/redis/client';
import { logger } from '../../shared/logger/pino';
import { CanalAService, hashPhone } from './canal-a.service';
import { CanalAAvailabilityService } from './availability.service';
import { HoldService } from '../agentic-reservations/core/hold.service';
import { ReservationService } from '../agentic-reservations/core/reservation.service';
import { AuditLogService } from '../agentic-reservations/core/audit-log.service';
import { IdempotencyService } from '../agentic-reservations/core/idempotency.service';
import { PrismaIdempotencyStore } from '../agentic-reservations/core/prisma-store';
import {
  buildPolicySnapshot,
  type PolicySnapshot,
} from '../agentic-reservations/core/policies.service';
import { ConsentService } from '../rgpd/consent.service';
import {
  computeIdempotencyScope,
  hashPayload,
} from '../agentic-reservations/core/idempotency.service';
import {
  AvailabilityQuerySchema,
  ConfirmInputSchema,
  HoldInputSchema,
  SlugParamSchema,
  type Source,
} from './canal-a.types';

export async function canalARoutes(app: FastifyInstance): Promise<void> {
  const canal = new CanalAService(db, redisCache);
  const availability = new CanalAAvailabilityService(db);
  const audit = new AuditLogService(db);
  const holds = new HoldService(db, audit);
  const idempotency = new IdempotencyService(new PrismaIdempotencyStore(db));
  const reservations = new ReservationService(db, audit, holds, idempotency);
  const consents = new ConsentService(db);

  // ─── 1. GET /public/r/:slug ─────────────────────────────────

  const PreviewQuerySchema = z.object({
    preview: z.string().optional(),
  });

  app.get('/public/r/:slug', async (req, reply) => {
    const parse = SlugParamSchema.safeParse(req.params);
    if (!parse.success) {
      return reply.status(400).send({ error: 'Invalid slug', details: parse.error.format() });
    }

    const query = PreviewQuerySchema.parse(req.query ?? {});
    const isPreview = query.preview === '1';

    const restaurant = await canal.getPublishedBySlug(parse.data.slug, { preview: isPreview });
    if (!restaurant) {
      return reply.status(404).send({ error: 'Restaurant not found or not published' });
    }

    return reply.send(restaurant);
  });

  // ─── 1b. GET /public/sitemap-data ────────────────────────────
  // Liste minimale (slug + updatedAt + publishedAt) des restaurants publiés.
  // Utilisé par apps/canal-a/src/app/sitemap.ts (cf. spec v1.1 §6.6).
  // Pas de PII, pas de description : juste ce qu'il faut pour le sitemap XML.

  app.get('/public/sitemap-data', async (_req, reply) => {
    const rows = await db.restaurant.findMany({
      where: {
        exposureSettings: { canalAPublished: true },
        publishedAt: { not: null },
      },
      select: {
        slug: true,
        updatedAt: true,
        publishedAt: true,
      },
      orderBy: { updatedAt: 'desc' },
    });
    const restaurants = rows
      .filter((r) => r.slug !== null)
      .map((r) => ({
        slug: r.slug!,
        updatedAt: (r.updatedAt ?? new Date()).toISOString(),
        publishedAt: (r.publishedAt ?? new Date()).toISOString(),
      }));
    return reply.send({ restaurants });
  });

  // ─── 1b.bis GET /public/cities (T7) ─────────────────────────
  // Liste des villes avec compteurs + cuisines (règle 5/10/20 §3.3)

  app.get('/public/cities', async (_req, reply) => {
    const rows = await db.restaurant.findMany({
      where: {
        exposureSettings: { canalAPublished: true },
        publishedAt: { not: null },
        city: { not: null },
      },
      select: { city: true, cuisineType: true },
    });

    const byCity = new Map<string, CityRow>();
    for (const r of rows) {
      if (!r.city) continue;
      const slug = slugifyCity(r.city);
      let entry = byCity.get(slug);
      if (!entry) {
        entry = { city: r.city, citySlug: slug, total: 0, cuisines: [] };
        byCity.set(slug, entry);
      }
      entry.total += 1;
      for (const cuisine of r.cuisineType) {
        const cSlug = slugifyCuisine(cuisine);
        const existing = entry.cuisines.find((c) => c.slug === cSlug);
        if (existing) {
          existing.count += 1;
        } else {
          entry.cuisines.push({ name: cuisine, slug: cSlug, count: 1 });
        }
      }
    }

    const cities = Array.from(byCity.values())
      .filter((c) => c.total >= 5)
      .sort((a, b) => b.total - a.total);

    return reply.send({ cities });
  });

  // ─── 1b.ter GET /public/cities/:slug (T7) ────────────────────
  // Restaurants d'une ville (avec filtre cuisine optionnel).
  // Renvoie shouldIndex=false si pas assez d'inventaire.

  app.get('/public/cities/:slug', async (req, reply) => {
    const params = req.params as { slug: string };
    if (!isValidCitySlug(params.slug)) {
      return reply.status(400).send({ error: 'Invalid city slug' });
    }
    const queryParse = z.object({ cuisine: z.string().optional() }).safeParse(req.query);
    if (!queryParse.success) {
      return reply.status(400).send({ error: 'Invalid query' });
    }

    const allCities = await db.restaurant.findMany({
      where: { exposureSettings: { canalAPublished: true }, city: { not: null } },
      select: { city: true, cuisineType: true },
    });
    const cityRow = allCities.find((r) => slugifyCity(r.city ?? '') === params.slug);
    if (!cityRow?.city) {
      return reply.status(404).send({ error: 'City not found' });
    }
    const cityName = cityRow.city;
    const cityRows = allCities.filter((r) => r.city === cityName);
    const totalInCity = cityRows.length;

    const cuisineFilter = queryParse.data.cuisine?.toLowerCase();
    let cuisineName: string | null = null;
    let cuisineCount = 0;
    if (cuisineFilter) {
      cuisineName =
        cityRows.flatMap((r) => r.cuisineType).find((c) => slugifyCuisine(c) === cuisineFilter) ??
        null;
      if (cuisineName) {
        cuisineCount = cityRows.filter((r) =>
          r.cuisineType.some((c) => slugifyCuisine(c) === cuisineFilter),
        ).length;
      }
    }

    const shouldIndexCity = totalInCity >= 5;
    const shouldIndexCuisine = !!cuisineFilter && totalInCity >= 10 && cuisineCount >= 5;

    if (cuisineFilter && !shouldIndexCuisine) {
      return reply.send({
        citySlug: params.slug,
        city: cityName,
        cuisine: cuisineName,
        totalInCity,
        cuisineCount,
        restaurants: [],
        shouldIndex: false,
        reason: 'not_enough_inventory',
      });
    }
    if (!cuisineFilter && !shouldIndexCity) {
      return reply.send({
        citySlug: params.slug,
        city: cityName,
        totalInCity,
        restaurants: [],
        shouldIndex: false,
        reason: 'not_enough_inventory',
      });
    }

    const restaurantsRaw = await db.restaurant.findMany({
      where: {
        city: cityName,
        exposureSettings: { canalAPublished: true },
        publishedAt: { not: null },
        ...(cuisineFilter && cuisineName ? { cuisineType: { has: cuisineName } } : {}),
      },
      select: { slug: true },
    });
    const restaurantSlugs = restaurantsRaw.map((r) => r.slug).filter((s): s is string => !!s);
    const dtos = (
      await Promise.all(restaurantSlugs.map((s) => canal.getPublishedBySlug(s)))
    ).filter((d): d is NonNullable<typeof d> => d !== null);

    return reply.send({
      citySlug: params.slug,
      city: cityName,
      ...(cuisineFilter && cuisineName ? { cuisine: cuisineName, cuisineCount } : {}),
      totalInCity,
      restaurants: dtos,
      shouldIndex: cuisineFilter ? shouldIndexCuisine : shouldIndexCity,
    });
  });

  // ─── 1c. POST /public/analytics/events ──────────────────────
  // Endpoint léger pour les events page_view / cta_clicked / etc.
  // En T8 (Phase 1), on push dans la queue BullMQ `canal-a-analytics`
  // qui incrémente les compteurs prom-client (cf. observability/metrics.ts).
  // Cf. spec v1.1 §16. Pas d'auth (events publics).
  // Best-effort : si la queue est down, on log et on renvoie 202 quand même.

  app.post('/public/analytics/events', async (req, reply) => {
    const body = (req.body ?? {}) as { event?: string; [key: string]: unknown };
    if (!body.event || typeof body.event !== 'string') {
      return reply.status(400).send({ error: 'event field required' });
    }
    if (body.event.length > 64) {
      return reply.status(400).send({ error: 'event name too long' });
    }
    // Validation soft : on accepte les events inconnus (forward compat) mais
    // on log un warning. Le worker drop les events invalides.
    try {
      await app.queues.canalAAnalytics.add(
        'canal-a-event',
        {
          event: body.event,
          restaurantId: body.restaurantId as string | undefined,
          restaurantSlug: body.restaurantSlug as string | undefined,
          city: body.city as string | undefined,
          source: (body.source as string | undefined) ?? 'web',
          utmSource: body.utmSource as string | undefined,
          utmMedium: body.utmMedium as string | undefined,
          utmCampaign: body.utmCampaign as string | undefined,
          date: body.date as string | undefined,
          time: body.time as string | undefined,
          partySize: body.partySize as number | undefined,
          reservationId: body.reservationId as string | undefined,
          sentAt: (body.sentAt as string | undefined) ?? new Date().toISOString(),
        },
        // Haute priorité pour les reservations_confirmed (tracking fin)
        { priority: body.event === 'reservation_confirmed' ? 1 : 5 },
      );
    } catch (err) {
      // Queue down : on log mais on renvoie 202 quand même (best-effort)
      logger.warn(
        { err: err instanceof Error ? err.message : err, event: body.event },
        'canal-a queue add failed',
      );
    }
    return reply.status(202).send({ ok: true });
  });

  // ─── 2. GET /public/r/:slug/availability ────────────────────

  app.get('/public/r/:slug/availability', async (req, reply) => {
    const slugParse = SlugParamSchema.safeParse(req.params);
    if (!slugParse.success) {
      return reply.status(400).send({ error: 'Invalid slug', details: slugParse.error.format() });
    }
    const queryParse = AvailabilityQuerySchema.safeParse(req.query);
    if (!queryParse.success) {
      return reply.status(400).send({ error: 'Invalid query', details: queryParse.error.format() });
    }

    const restaurant = await canal.getPublishedBySlug(slugParse.data.slug);
    if (!restaurant) {
      return reply.status(404).send({ error: 'Restaurant not found or not published' });
    }

    const dto = await availability.getAvailability({
      restaurantId: restaurant.id,
      date: queryParse.data.date,
      partySize: queryParse.data.partySize,
    });

    return reply.send(dto);
  });

  // ─── 3. POST /public/r/:slug/hold ───────────────────────────
  // Crée un hold temporaire 5min (TTL via policies.holdTtlSeconds)
  // Rate limit serré : 5 holds/min/IP pour éviter le squatting de créneaux.

  app.post(
    '/public/r/:slug/hold',
    {
      config: {
        rateLimit: {
          max: 5,
          timeWindow: '1 minute',
        },
      },
    },
    async (req, reply) => {
      const slugParse = SlugParamSchema.safeParse(req.params);
      if (!slugParse.success) {
        return reply.status(400).send({ error: 'Invalid slug', details: slugParse.error.format() });
      }
      const bodyParse = HoldInputSchema.safeParse(req.body);
      if (!bodyParse.success) {
        return reply.status(400).send({ error: 'Invalid body', details: bodyParse.error.format() });
      }

      const restaurant = await canal.getPublishedBySlug(slugParse.data.slug);
      if (!restaurant) {
        return reply.status(404).send({ error: 'Restaurant not found or not published' });
      }

      // Source normalization (cf. spec v1.1 §5.9 + feedback Hamza)
      // - Si canalAAgentic=false, on neutralise chatgpt/perplexity/bing/google(bing_ai)
      // - On garde google (organic SEO), instagram, qr_code, restaurant_website, direct
      // - Pour google spécifiquement, c'est un canal SEO normal, pas agentic
      const AGENTIC_NEUTRAL: ReadonlySet<Source> = new Set(['chatgpt', 'perplexity', 'bing']);
      const requestedSource: Source = bodyParse.data.source;
      const isAgenticNeutral = AGENTIC_NEUTRAL.has(requestedSource);
      const source: Source =
        !restaurant.canalAAgentic && isAgenticNeutral ? 'web' : requestedSource;

      const policy = await loadPolicy(restaurant.id);
      if (!policy) {
        return reply.status(409).send({ error: 'No policy configured for this restaurant' });
      }
      if (bodyParse.data.partySize > policy.maxPartySize) {
        return reply.status(409).send({
          error: `Party size ${bodyParse.data.partySize} exceeds max (${policy.maxPartySize})`,
        });
      }

      const slotStart = new Date(`${bodyParse.data.date}T${bodyParse.data.time}:00.000Z`);
      const slotEnd = new Date(slotStart.getTime() + 90 * 60 * 1000);

      try {
        const hold = await holds.createHold({
          restaurantId: restaurant.id,
          partySize: bodyParse.data.partySize,
          slotStart,
          slotEnd,
          channel: 'WEB',
          policy,
          actor: 'canal-a:web',
        });

        return reply.send({
          holdId: hold.id,
          holdToken: hold.holdToken,
          expiresAt: hold.expiresAt.toISOString(),
          status: 'pending',
          sourceNormalized: source,
        });
      } catch (err: unknown) {
        if (err instanceof Error && err.name === 'HoldConflictError') {
          return reply.status(409).send({ error: 'Slot already held or reserved' });
        }
        logger.error({ err, slug: slugParse.data.slug }, 'canal-a hold creation failed');
        return reply.status(500).send({ error: 'Internal error' });
      }
    },
  );

  // ─── 4. POST /public/r/:slug/confirm ────────────────────────

  app.post(
    '/public/r/:slug/confirm',
    {
      config: {
        rateLimit: {
          max: 10,
          timeWindow: '1 minute',
        },
      },
    },
    async (req, reply) => {
      const slugParse = SlugParamSchema.safeParse(req.params);
      if (!slugParse.success) {
        return reply.status(400).send({ error: 'Invalid slug', details: slugParse.error.format() });
      }
      const bodyParse = ConfirmInputSchema.safeParse(req.body);
      if (!bodyParse.success) {
        return reply.status(400).send({ error: 'Invalid body', details: bodyParse.error.format() });
      }

      const restaurant = await canal.getPublishedBySlug(slugParse.data.slug);
      if (!restaurant) {
        return reply.status(404).send({ error: 'Restaurant not found or not published' });
      }

      // Lookup hold
      const hold = await db.agenticHold.findFirst({
        where: { holdToken: bodyParse.data.holdToken, restaurantId: restaurant.id },
      });
      if (!hold || hold.status !== 'ACTIVE' || hold.expiresAt < new Date()) {
        return reply.status(410).send({ error: 'Hold expired or not found' });
      }

      const policy = await loadPolicy(restaurant.id);
      if (!policy) {
        return reply.status(409).send({ error: 'No policy configured for this restaurant' });
      }

      // Customer name
      const customerName = bodyParse.data.customer.lastName
        ? `${bodyParse.data.customer.firstName} ${bodyParse.data.customer.lastName}`.trim()
        : bodyParse.data.customer.firstName;

      // RGPD consent (channel=WEB, context=web_booking_intent)
      const ipHash = req.ip ? hashIp(req.ip) : undefined;
      await consents.recordConsent({
        restaurantId: restaurant.id,
        customerId: null,
        reservationId: null,
        subject: bodyParse.data.customer.phone,
        channel: 'WEB',
        context: 'web_booking_intent',
        consents: {
          reservationProcessing: true,
          transactionalSms: true,
          transactionalEmail: !!bodyParse.data.customer.email,
          marketingOptIn: false,
        },
        consentIpHash: ipHash,
      });

      // Idempotency: scope = web:{restaurantId}:{phoneHash}, key = holdId
      // (le hold est unique, donc 2 confirms du même hold = même réponse)
      const phoneHash = hashPhone(bodyParse.data.customer.phone);
      const idempotencyScope = computeIdempotencyScope({
        restaurantId: restaurant.id,
        channel: 'WEB',
        clientId: phoneHash,
      });
      const idempotencyKey = bodyParse.data.idempotencyKey ?? hold.id;
      const payloadHash = hashPayload({
        holdId: hold.id,
        customerPhone: bodyParse.data.customer.phone,
        customerName,
      });

      try {
        const result = await reservations.createReservation(
          {
            restaurantId: restaurant.id,
            partySize: hold.partySize,
            startsAt: hold.slotStart,
            endsAt: hold.slotEnd,
            customerName,
            customerPhone: bodyParse.data.customer.phone,
            channel: 'WEB',
            policy,
            actor: 'canal-a:web',
            holdToken: bodyParse.data.holdToken,
            specialRequests: bodyParse.data.specialRequests,
            consents: {
              reservationProcessing: true,
              transactionalSms: true,
              transactionalEmail: !!bodyParse.data.customer.email,
              marketingOptIn: false,
            },
          },
          {
            scope: idempotencyScope,
            key: idempotencyKey,
            payloadHash,
            ttlSeconds: 86400,
          },
        );

        // Update source separately (pas dans CreateReservationInput, on patch direct)
        // La source est déduite du ?source= URL → on la retrouve via le hold.actor
        // Pour P0, on enregistre 'web' par défaut. Source agentic = extension P2.
        // (Le tracking fin se fera côté T9 via Redis analytics)

        return reply.send({
          reservationId: result.reservationId,
          status: 'confirmed',
          state: result.state,
          reused: result.reused,
          restaurantName: restaurant.name,
          date: hold.slotStart.toISOString().slice(0, 10),
          time: hold.slotStart.toISOString().slice(11, 16),
          partySize: hold.partySize,
        });
      } catch (err: unknown) {
        logger.error({ err, slug: slugParse.data.slug, holdId: hold.id }, 'canal-a confirm failed');
        const message = err instanceof Error ? err.message : 'Internal error';
        if (message.toLowerCase().includes('idempot')) {
          return reply.status(409).send({ error: message });
        }
        if (message.toLowerCase().includes('hold')) {
          return reply.status(410).send({ error: message });
        }
        return reply.status(500).send({ error: message });
      }
    },
  );
}

/**
 * Charge le PolicySnapshot depuis `RestaurantExposureSettings`.
 * Renvoie null si pas configuré (très rare en pratique — seed met des défauts).
 */
async function loadPolicy(restaurantId: string): Promise<PolicySnapshot | null> {
  const settings = await db.restaurantExposureSettings.findUnique({
    where: { restaurantId },
  });
  if (!settings) return null;
  return buildPolicySnapshot({
    policyVersion: settings.quoteTtlSeconds ? '2026-06-20' : '2026-06-20',
    maxPartySize: settings.maxPartySize,
    minLeadTimeMinutes: settings.minLeadTimeMinutes,
    requireManualValidation: settings.requireManualValidation,
    quoteTtlSeconds: settings.quoteTtlSeconds,
    holdTtlSeconds: settings.holdTtlSeconds,
    noShowPolicy: settings.noShowPolicy,
    notificationChannels: settings.notificationChannels,
    capacitySpecials: settings.capacitySpecials as Record<string, unknown> | null,
  });
}

/** Hash IP (RGPD) — SHA-256 truncated */
function hashIp(ip: string): string {
  return createHash('sha256').update(ip).digest('hex').slice(0, 32);
}

// ─── Helpers T7 (pages locales) ───────────────────────────────

const CITY_SLUG_REGEX = /^[a-z0-9-]+$/;
function isValidCitySlug(s: string): boolean {
  return s.length >= 2 && s.length <= 80 && CITY_SLUG_REGEX.test(s);
}

type CityRow = {
  city: string;
  citySlug: string;
  total: number;
  cuisines: Array<{ name: string; slug: string; count: number }>;
};

function slugifyCity(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
}

function slugifyCuisine(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
}
