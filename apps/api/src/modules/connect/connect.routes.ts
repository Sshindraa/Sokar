/**
 * Sokar Connect — Routes publiques Fastify.
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
import type { Table } from '@prisma/client';
import { z } from 'zod';
import { createHash } from 'node:crypto';
import { slugifyCity, slugifyCuisine } from '@sokar/shared';
import { db } from '../../shared/db/client';
import { redisCache } from '../../shared/redis/client';
import { logger } from '../../shared/logger/pino';
import { ConnectService, hashPhone } from './connect.service';
import { CapacityAwareAvailabilityService } from '../floor-plan/availability-capacity-aware.service';
import { TableAllocationService } from '../floor-plan/table-allocation.service';
import { resolveServiceDurationMinutes } from '../floor-plan/floor-plan.types';
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
  normalizeConnectSource,
  type Source,
} from './connect.types';
import { emitConnectEvent } from './connect-analytics';
import { canConfirm, recordFailedConfirm } from './connect-rate-limit';
import { connectRequestDuration } from '../../shared/observability/metrics';
import {
  RATE_LIMIT_PREVIEW_MAX,
  RATE_LIMIT_SITEMAP_MAX,
  RATE_LIMIT_RESTAURANTS_MAX,
  RATE_LIMIT_CITIES_MAX,
  RATE_LIMIT_CITY_DETAIL_MAX,
  RATE_LIMIT_ANALYTICS_MAX,
  RATE_LIMIT_AVAILABILITY_MAX,
  RATE_LIMIT_HOLD_MAX,
  RATE_LIMIT_CONFIRM_MAX,
  PAGINATION_DEFAULT_LIMIT,
  PAGINATION_MAX_LIMIT,
} from './constants';

/**
 * Map une URL vers un nom de route lisible pour les labels Prometheus.
 * Évite la cardinalité infinie (pas de slug dans le label).
 */
function routeLabel(url: string): string {
  if (url.startsWith('/public/r/') && url.endsWith('/availability')) return 'availability';
  if (url.startsWith('/public/r/') && url.endsWith('/hold')) return 'hold';
  if (url.startsWith('/public/r/') && url.endsWith('/confirm')) return 'confirm';
  if (url.startsWith('/public/r/')) return 'slug';
  if (url.startsWith('/public/cities/')) return 'city';
  if (url === '/public/cities') return 'cities';
  if (url === '/public/sitemap-data') return 'sitemap-data';
  if (url === '/public/analytics/events') return 'analytics-events';
  if (url.startsWith('/public/restaurants')) return 'restaurants';
  return 'other';
}

function statusClass(code: number): string {
  if (code < 400) return '2xx';
  if (code < 500) return '4xx';
  return '5xx';
}

export async function connectRoutes(app: FastifyInstance): Promise<void> {
  const canal = new ConnectService(db, redisCache);
  const availability = new CapacityAwareAvailabilityService(db);
  const tableAllocation = new TableAllocationService(db);
  const audit = new AuditLogService(db);
  const holds = new HoldService(db, audit);
  const idempotency = new IdempotencyService(new PrismaIdempotencyStore(db));
  const reservations = new ReservationService(db, audit, holds, idempotency);
  const consents = new ConsentService(db);

  // ─── Versioning : /public/v1/* → alias de /public/* (Phase 6) ───
  // La réécriture se fait au niveau du serveur (rewriteUrl dans main.ts),
  // exécutée AVANT le routing Fastify. Un hook onRequest ici serait trop tard
  // (le routing a déjà matché la route /public/v1/foo → 404).
  // Les anciens chemins /public/* restent fonctionnels (transition).

  // ─── Hook latence : enregistre la durée de chaque requête Connect ───
  // Spec v1.1 §11.2 : p95 < 500ms cible pour le pilote P1.
  app.addHook('onResponse', async (req, reply) => {
    const route = routeLabel(req.url);
    if (route === 'other') return; // ignore les routes non-Connect
    const durationMs = reply.elapsedTime;
    connectRequestDuration.observe({ route, status: statusClass(reply.statusCode) }, durationMs);
  });

  // ─── 1. GET /public/r/:slug ─────────────────────────────────

  const PreviewQuerySchema = z.object({
    preview: z.enum(['1', '0']).optional(),
  });

  app.get(
    '/public/r/:slug',
    {
      config: { rateLimit: { max: RATE_LIMIT_PREVIEW_MAX, timeWindow: '1 minute' } },
    },
    async (req, reply) => {
      const parse = SlugParamSchema.safeParse(req.params);
      if (!parse.success) {
        return reply.status(400).send({ error: 'Invalid slug', details: parse.error.format() });
      }

      const query = PreviewQuerySchema.safeParse(req.query ?? {});
      if (!query.success) {
        return reply.status(400).send({ error: 'Invalid query', details: query.error.format() });
      }
      const isPreview = query.data.preview === '1';

      const restaurant = await canal.getPublishedBySlug(parse.data.slug, { preview: isPreview });
      if (!restaurant) {
        return reply.status(404).send({ error: 'Restaurant not found or not published' });
      }

      return reply.send(restaurant);
    },
  );

  // ─── 1b. GET /public/sitemap-data ────────────────────────────
  // Liste minimale (slug + updatedAt + publishedAt) des restaurants publiés.
  // Utilisé par apps/connect/src/app/sitemap.ts (cf. spec v1.1 §6.6).
  // Pas de PII, pas de description : juste ce qu'il faut pour le sitemap XML.

  app.get(
    '/public/sitemap-data',
    { config: { rateLimit: { max: RATE_LIMIT_SITEMAP_MAX, timeWindow: '1 minute' } } },
    async (_req, reply) => {
      const rows = await db.restaurant.findMany({
        where: {
          exposureSettings: { connectPublished: true },
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
    },
  );

  // ─── 1b.ter GET /public/restaurants (Phase 6 — pagination) ───
  // Liste paginée des restaurants publiés (DTO complet pour la grille homepage).
  // Pagination réelle en DB (skip/take), pas en mémoire.
  // Query params : page (default 1), limit (default 12, max 50).

  const RestaurantsQuerySchema = z.object({
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce
      .number()
      .int()
      .min(1)
      .max(PAGINATION_MAX_LIMIT)
      .default(PAGINATION_DEFAULT_LIMIT),
  });

  app.get(
    '/public/restaurants',
    { config: { rateLimit: { max: RATE_LIMIT_RESTAURANTS_MAX, timeWindow: '1 minute' } } },
    async (req, reply) => {
      const query = RestaurantsQuerySchema.safeParse(req.query ?? {});
      if (!query.success) {
        return reply.status(400).send({ error: 'Invalid query', details: query.error.format() });
      }
      const result = await canal.getPublishedRestaurants(query.data.page, query.data.limit);
      return reply.send(result);
    },
  );

  // ─── 1b.bis GET /public/cities (T7) ─────────────────────────
  // Liste des villes avec compteurs + cuisines (règle 5/10/20 §3.3)

  app.get(
    '/public/cities',
    { config: { rateLimit: { max: RATE_LIMIT_CITIES_MAX, timeWindow: '1 minute' } } },
    async (_req, reply) => {
      const rows = await db.restaurant.findMany({
        where: {
          exposureSettings: { connectPublished: true },
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
    },
  );

  // ─── 1b.ter GET /public/cities/:slug (T7) ────────────────────
  // Restaurants d'une ville (avec filtre cuisine optionnel).
  // Renvoie shouldIndex=false si pas assez d'inventaire.

  app.get(
    '/public/cities/:slug',
    { config: { rateLimit: { max: RATE_LIMIT_CITY_DETAIL_MAX, timeWindow: '1 minute' } } },
    async (req, reply) => {
      const params = req.params as { slug: string };
      if (!isValidCitySlug(params.slug)) {
        return reply.status(400).send({ error: 'Invalid city slug' });
      }
      const queryParse = z.object({ cuisine: z.string().optional() }).safeParse(req.query);
      if (!queryParse.success) {
        return reply.status(400).send({ error: 'Invalid query' });
      }

      const allCities = await db.restaurant.findMany({
        where: { exposureSettings: { connectPublished: true }, city: { not: null } },
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
          exposureSettings: { connectPublished: true },
          publishedAt: { not: null },
          ...(cuisineFilter && cuisineName ? { cuisineType: { has: cuisineName } } : {}),
        },
        select: { slug: true },
      });
      const restaurantSlugs = restaurantsRaw.map((r) => r.slug).filter((s): s is string => !!s);
      const dtos = await canal.getPublishedBySlugs(restaurantSlugs);

      return reply.send({
        citySlug: params.slug,
        city: cityName,
        ...(cuisineFilter && cuisineName ? { cuisine: cuisineName, cuisineCount } : {}),
        totalInCity,
        restaurants: dtos,
        shouldIndex: cuisineFilter ? shouldIndexCuisine : shouldIndexCity,
      });
    },
  );

  // ─── 1c. POST /public/analytics/events ──────────────────────
  // Endpoint léger pour les events page_view / cta_clicked / etc.
  // En T8 (Phase 1), on push dans la queue BullMQ `connect-analytics`
  // qui incrémente les compteurs prom-client (cf. observability/metrics.ts).
  // Cf. spec v1.1 §16. Pas d'auth (events publics).
  // Best-effort : si la queue est down, on log et on renvoie 202 quand même.

  app.post(
    '/public/analytics/events',
    { config: { rateLimit: { max: RATE_LIMIT_ANALYTICS_MAX, timeWindow: '1 minute' } } },
    async (req, reply) => {
      const body = (req.body ?? {}) as { event?: string; [key: string]: unknown };
      if (!body.event || typeof body.event !== 'string') {
        return reply.status(400).send({ error: 'event field required' });
      }
      if (body.event.length > 64) {
        return reply.status(400).send({ error: 'event name too long' });
      }
      // Validation soft : on accepte les events inconnus (forward compat) mais
      // on log un warning. Le worker drop les events invalides.
      await emitConnectEvent(app.queues.connectAnalytics, {
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
      });
      return reply.status(202).send({ ok: true });
    },
  );

  // ─── 2. GET /public/r/:slug/availability ────────────────────

  app.get(
    '/public/r/:slug/availability',
    {
      config: { rateLimit: { max: RATE_LIMIT_AVAILABILITY_MAX, timeWindow: '1 minute' } },
    },
    async (req, reply) => {
      const slugParse = SlugParamSchema.safeParse(req.params);
      if (!slugParse.success) {
        return reply.status(400).send({ error: 'Invalid slug', details: slugParse.error.format() });
      }
      const queryParse = AvailabilityQuerySchema.safeParse(req.query);
      if (!queryParse.success) {
        return reply
          .status(400)
          .send({ error: 'Invalid query', details: queryParse.error.format() });
      }

      const restaurant = await canal.getPublishedBySlug(slugParse.data.slug);
      if (!restaurant) {
        return reply.status(404).send({ error: 'Restaurant not found or not published' });
      }

      const dto = await availability.getAvailability({
        restaurantId: restaurant.id,
        date: queryParse.data.date,
        partySize: queryParse.data.partySize,
        preferredSectionId: queryParse.data.preferredSectionId,
      });

      return reply.send(dto);
    },
  );

  // ─── 3. POST /public/r/:slug/hold ───────────────────────────
  // Crée un hold temporaire 5min (TTL via policies.holdTtlSeconds)
  // Rate limit : 11 holds/min/IP (cf. spec v1.1 §10 T2 + §8.3).

  app.post(
    '/public/r/:slug/hold',
    {
      config: {
        rateLimit: {
          max: RATE_LIMIT_HOLD_MAX,
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

      // Honeypot anti-bot : si le champ website est rempli, c'est un bot.
      // On retourne 202 (accepted) pour ne pas alerter le bot, mais on ne crée pas de hold.
      if (bodyParse.data.website) {
        logger.warn({ slug: slugParse.data.slug }, '[connect] Honeypot triggered on /hold');
        return reply
          .status(202)
          .send({ holdId: '', holdToken: '', expiresAt: '', status: 'pending' });
      }

      const restaurant = await canal.getPublishedBySlug(slugParse.data.slug);
      if (!restaurant) {
        return reply.status(404).send({ error: 'Restaurant not found or not published' });
      }

      // Source normalization (cf. spec v1.1 §5.9)
      // - Si connectAgentic=false, on neutralise chatgpt/perplexity/bing → 'web'
      // - On préserve google (organic SEO), instagram, qr_code, etc.
      const source: Source = normalizeConnectSource(
        bodyParse.data.source,
        restaurant.connectAgentic,
      );

      const policy = await loadPolicy(restaurant.id);
      if (!policy) {
        return reply.status(409).send({ error: 'No policy configured for this restaurant' });
      }
      if (bodyParse.data.partySize > policy.maxPartySize) {
        return reply.status(409).send({
          error: `Party size ${bodyParse.data.partySize} exceeds max (${policy.maxPartySize})`,
        });
      }

      const settings = await db.restaurantExposureSettings.findUnique({
        where: { restaurantId: restaurant.id },
      });
      const serviceDurationMinutes = resolveServiceDurationMinutes(
        settings?.capacitySpecials as Record<string, unknown> | undefined,
      );

      const slotStart = new Date(`${bodyParse.data.date}T${bodyParse.data.time}:00.000Z`);
      const slotEnd = new Date(slotStart.getTime() + serviceDurationMinutes * 60 * 1000);

      try {
        const hold = await holds.createHold({
          restaurantId: restaurant.id,
          partySize: bodyParse.data.partySize,
          slotStart,
          slotEnd,
          channel: 'WEB',
          policy,
          actor: 'connect:web',
          preferredSectionId: bodyParse.data.preferredSectionId,
        });

        // Émettre l'événement analytics reservation_hold_created (T9)
        await emitConnectEvent(app.queues.connectAnalytics, {
          event: 'reservation_hold_created',
          restaurantId: restaurant.id,
          restaurantSlug: restaurant.slug,
          city: restaurant.address.city,
          source,
          date: bodyParse.data.date,
          time: bodyParse.data.time,
          partySize: bodyParse.data.partySize,
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
        logger.error({ err, slug: slugParse.data.slug }, 'connect hold creation failed');
        await emitConnectEvent(app.queues.connectAnalytics, {
          event: 'reservation_failed',
          restaurantId: restaurant.id,
          restaurantSlug: restaurant.slug,
          city: restaurant.address.city,
          source,
          date: bodyParse.data.date,
          time: bodyParse.data.time,
          partySize: bodyParse.data.partySize,
        });
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
          max: RATE_LIMIT_CONFIRM_MAX,
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

      // Honeypot anti-bot : si le champ website est rempli, c'est un bot.
      // On retourne 202 (accepted) pour ne pas alerter le bot, mais on ne crée pas de résa.
      if (bodyParse.data.website) {
        logger.warn({ slug: slugParse.data.slug }, '[connect] Honeypot triggered on /confirm');
        return reply.status(202).send({ reservationId: '', status: 'confirmed' });
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
        // Analytics : émettre reservation_hold_expired si le hold existait (spec §8.5)
        if (hold) {
          await emitConnectEvent(app.queues.connectAnalytics, {
            event: 'reservation_hold_expired',
            restaurantId: restaurant.id,
            restaurantSlug: restaurant.slug,
            city: restaurant.address.city,
          });
        }
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

      // Table allocation : réutilise la table du hold si possible, sinon réalloue.
      let table: Table | null = null;

      if (hold.tableId) {
        const stillAvailable = await tableAllocation.isTableAvailable({
          tableId: hold.tableId,
          startsAt: hold.slotStart,
          endsAt: hold.slotEnd,
          excludeHoldId: hold.id,
        });
        if (stillAvailable) {
          table = await db.table.findUnique({ where: { id: hold.tableId } });
        }
      }

      if (!table) {
        table = await tableAllocation.allocate({
          restaurantId: restaurant.id,
          partySize: hold.partySize,
          startsAt: hold.slotStart,
          endsAt: hold.slotEnd,
        });
      }

      if (!table) {
        return reply.status(409).send({ error: 'Slot no longer available' });
      }

      // Source normalization (même logique que /hold, cf. spec v1.1 §5.9)
      const source: Source = normalizeConnectSource(
        bodyParse.data.source,
        restaurant.connectAgentic,
      );

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

      // Rate limit per-phone (spec §8.3: 5 confirmations/heure + anti-spam §8.6)
      const allowed = await canConfirm(phoneHash);
      if (!allowed) {
        return reply.status(429).send({
          error: 'Trop de tentatives. Réessayez plus tard ou appelez le restaurant.',
        });
      }

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
            actor: 'connect:web',
            holdToken: bodyParse.data.holdToken,
            specialRequests: bodyParse.data.specialRequests,
            tableId: table.id,
            giftCardCode: bodyParse.data.giftCardCode,
            giftCardReservationAmount: Number(restaurant.priceRange ?? 2) * 25 * hold.partySize,
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

        // Persister la source normalisée sur la réservation
        // (CreateReservationInput ne porte pas source, on patch direct)
        if (!result.reused) {
          await db.reservation.update({
            where: { id: result.reservationId },
            data: { source },
          });
        }

        // Émettre l'événement analytics reservation_confirmed (T9)
        // Best-effort : si la queue est down, on log un warning mais on ne fail pas.
        await emitConnectEvent(app.queues.connectAnalytics, {
          event: 'reservation_confirmed',
          restaurantId: restaurant.id,
          restaurantSlug: restaurant.slug,
          city: restaurant.address.city,
          source,
          date: hold.slotStart.toISOString().slice(0, 10),
          time: hold.slotStart.toISOString().slice(11, 16),
          partySize: hold.partySize,
          reservationId: result.reservationId,
        });

        return reply.send({
          reservationId: result.reservationId,
          status: 'confirmed',
          state: result.state,
          reused: result.reused,
          restaurantName: restaurant.name,
          date: hold.slotStart.toISOString().slice(0, 10),
          time: hold.slotStart.toISOString().slice(11, 16),
          partySize: hold.partySize,
          source,
          giftCardApplication: result.giftCardApplication,
        });
      } catch (err: unknown) {
        logger.error({ err, slug: slugParse.data.slug, holdId: hold.id }, 'connect confirm failed');
        // Anti-spam : enregistrer l'échec (spec §8.6)
        await recordFailedConfirm(phoneHash);
        // Analytics : émettre l'événement reservation_failed (spec §8.5)
        await emitConnectEvent(app.queues.connectAnalytics, {
          event: 'reservation_failed',
          restaurantId: restaurant.id,
          restaurantSlug: restaurant.slug,
          city: restaurant.address.city,
          source,
          date: hold.slotStart.toISOString().slice(0, 10),
          time: hold.slotStart.toISOString().slice(11, 16),
          partySize: hold.partySize,
        });
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
