/**
 * Tool handler dispatch + exécution.
 *
 * Chaque tool expose une fonction `execute(args, ctx) → result`.
 * Ce module :
 *   1. valide l'input via Zod
 *   2. vérifie le rate limit
 *   3. sanitize specialRequests (anti prompt injection)
 *   4. appelle le service métier
 *   5. redacte la réponse (PII, secrets)
 *   6. log un audit event
 */

import type { PrismaClient } from '@prisma/client';
import { logger } from '../../../../shared/logger/pino';
import { AuditLogService } from '../../core/audit-log.service';
import { AvailabilityService } from '../../core/availability.service';
import { HoldService } from '../../core/hold.service';
import { IdempotencyService } from '../../core/idempotency.service';
import { PrismaIdempotencyStore } from '../../core/prisma-store';
import { ReservationService } from '../../core/reservation.service';
import { computeIdempotencyScope, hashPayload } from '../../core/idempotency.service';
import { redactResponse } from '../response-redaction';
import { McpRateLimiter } from '../rate-limit';
import { assertNoPiiLeak } from '../../../../shared/observability/pii-leak';
import {
  checkAvailabilityDuration,
  mcpToolCallsTotal,
} from '../../../../shared/observability/metrics';
import {
  CancelReservationInputSchema,
  CheckAvailabilityInputSchema,
  CreateReservationInputSchema,
  GetRestaurantDetailsInputSchema,
  GetReservationStatusInputSchema,
  SearchRestaurantsInputSchema,
  type CancelReservationInput,
  type CheckAvailabilityInput,
  type CreateReservationInput,
  type GetRestaurantDetailsInput,
  type GetReservationStatusInput,
  type SearchRestaurantsInput,
} from './schemas';

export type ToolContext = {
  clientId: string;
  clientName: string;
  restaurantId: string | null;
  scopes: string[];
  actor: string;
};

export type ToolResult<T = unknown> =
  | {
      ok: true;
      data: T;
    }
  | {
      ok: false;
      error: string;
      code: string;
    };

const INJECTION_PATTERNS = [
  /ignore (previous|above|all) instructions/i,
  /system\s*:/i,
  /<\s*script/i,
  /onerror=/i,
];

export function sanitizeSpecialRequests(input: string | undefined): string {
  if (!input) return '';
  let out = input;
  for (const pat of INJECTION_PATTERNS) {
    if (pat.test(out)) {
      out = out.replace(pat, '[FILTERED]');
    }
  }
  return out.slice(0, 500);
}

function toolError(error: string, code: string): ToolResult {
  return { ok: false, error, code };
}

function ok<T>(data: T): ToolResult<T> {
  return { ok: true, data };
}

type McpScope = 'mcp:read' | 'mcp:reserve' | 'mcp:cancel';

function hasScope(ctx: ToolContext, scope: McpScope): boolean {
  if (ctx.scopes.includes(scope) || ctx.scopes.includes('mcp:*')) return true;
  if ((scope === 'mcp:reserve' || scope === 'mcp:cancel') && ctx.scopes.includes('mcp:write')) {
    return true;
  }
  return false;
}

function assertScope(ctx: ToolContext, scope: McpScope): ToolResult | null {
  return hasScope(ctx, scope) ? null : toolError(`Missing scope: ${scope}`, 'FORBIDDEN');
}

function localDayAndMinutes(date: Date, timeZone: string): { day: string; minutes: number } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(date);

  const weekday =
    parts
      .find((p) => p.type === 'weekday')
      ?.value.toLowerCase()
      .slice(0, 3) ?? '';
  const hour = Number(parts.find((p) => p.type === 'hour')?.value ?? 0);
  const minute = Number(parts.find((p) => p.type === 'minute')?.value ?? 0);
  return { day: weekday, minutes: hour * 60 + minute };
}

const DAY_INDEX_TO_NAME = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

function parseTimeToMinutes(value: unknown): number | null {
  if (typeof value !== 'string') return null;
  const match = value.match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
  return hour * 60 + minute;
}

function normalizeCreneauDay(value: unknown): string | null {
  if (typeof value === 'number') return DAY_INDEX_TO_NAME[value] ?? null;
  if (typeof value !== 'string') return null;
  const lower = value.toLowerCase();
  if (DAY_INDEX_TO_NAME.includes(lower)) return lower;
  return null;
}

function isWithinExposedCreneaux(args: {
  exposedCreneaux: unknown;
  startsAt: Date;
  endsAt: Date;
  timezone: string;
}): boolean {
  if (!Array.isArray(args.exposedCreneaux) || args.exposedCreneaux.length === 0) return true;

  const startLocal = localDayAndMinutes(args.startsAt, args.timezone);
  const endLocal = localDayAndMinutes(args.endsAt, args.timezone);
  if (startLocal.day !== endLocal.day) return false;

  return args.exposedCreneaux.some((raw) => {
    if (!raw || typeof raw !== 'object') return false;
    const item = raw as Record<string, unknown>;
    const day = normalizeCreneauDay(item.day);
    const from = parseTimeToMinutes(item.from ?? item.start);
    const to = parseTimeToMinutes(item.to ?? item.end);
    if (!day || from === null || to === null) return false;
    return day === startLocal.day && startLocal.minutes >= from && endLocal.minutes <= to;
  });
}

export class McpToolRegistry {
  private readonly reservationService: ReservationService;
  private readonly holdService: HoldService;
  private readonly availabilityService: AvailabilityService;
  private readonly audit: AuditLogService;
  private readonly idem: IdempotencyService;

  constructor(
    private readonly prisma: PrismaClient,
    private readonly rateLimiter: McpRateLimiter,
  ) {
    this.audit = new AuditLogService(prisma);
    this.holdService = new HoldService(prisma, this.audit);
    this.availabilityService = new AvailabilityService(prisma);
    const idemStore = new PrismaIdempotencyStore(prisma);
    this.idem = new IdempotencyService(idemStore);
    this.reservationService = new ReservationService(
      prisma,
      this.audit,
      this.holdService,
      this.idem,
    );
  }

  async searchRestaurants(rawInput: unknown, ctx: ToolContext): Promise<ToolResult> {
    const scopeError = assertScope(ctx, 'mcp:read');
    if (scopeError) return scopeError;

    const parsed = SearchRestaurantsInputSchema.safeParse(rawInput);
    if (!parsed.success) return toolError(parsed.error.message, 'INVALID_INPUT');
    const input: SearchRestaurantsInput = parsed.data;

    const rl = await this.rateLimiter.check(ctx.clientId, 'search_restaurants');
    if (!rl.allowed) return toolError('Rate limit exceeded', 'RATE_LIMITED');

    try {
      const slotStart = new Date(input.slotStart);
      const slotEnd = new Date(input.slotEnd);
      const results = await this.availabilityService.searchAvailableRestaurants({
        city: input.city,
        partySize: input.partySize,
        slotStart,
        slotEnd,
        cuisineType: input.cuisineType,
        maxResults: input.maxResults,
      });

      const exposedResults = [];
      for (const result of results) {
        const exposure = await this.getMcpExposure(result.restaurantId, ctx);
        if (!exposure.ok) continue;
        const violation = this.validateExposureConstraints(exposure.settings, {
          partySize: input.partySize,
          startsAt: slotStart,
          endsAt: slotEnd,
        });
        if (!violation) exposedResults.push(result);
      }

      await this.audit.record({
        event: 'state_transition',
        actor: ctx.actor,
        metadata: {
          tool: 'search_restaurants',
          city: input.city,
          partySize: input.partySize,
          count: exposedResults.length,
        },
      });

      // Pagination cursor: si on a exactement maxResults résultats,
      // on encode le dernier ID comme cursor pour la page suivante.
      const hasMore = exposedResults.length >= input.maxResults;
      const nextCursor =
        hasMore && exposedResults.length > 0
          ? Buffer.from(exposedResults[exposedResults.length - 1].restaurantId).toString(
              'base64url',
            )
          : undefined;

      return ok({
        restaurants: exposedResults.map((r) => ({
          id: r.restaurantId,
          name: r.name,
          slug: r.slug,
        })),
        nextCursor,
      });
    } catch (err: unknown) {
      logger.error({ err, clientId: ctx.clientId }, 'search_restaurants failed');
      return toolError('Internal error', 'INTERNAL');
    }
  }

  async getRestaurantDetails(rawInput: unknown, ctx: ToolContext): Promise<ToolResult> {
    const scopeError = assertScope(ctx, 'mcp:read');
    if (scopeError) return scopeError;

    const parsed = GetRestaurantDetailsInputSchema.safeParse(rawInput);
    if (!parsed.success) return toolError(parsed.error.message, 'INVALID_INPUT');
    const input: GetRestaurantDetailsInput = parsed.data;

    const rl = await this.rateLimiter.check(ctx.clientId, 'get_restaurant_details');
    if (!rl.allowed) return toolError('Rate limit exceeded', 'RATE_LIMITED');

    try {
      const exposure = await this.getMcpExposure(input.restaurantId, ctx);
      if (!exposure.ok) return exposure.error;

      const r = await this.prisma.restaurant.findUnique({
        where: { id: input.restaurantId },
        select: {
          id: true,
          name: true,
          slug: true,
          formattedAddress: true,
          websiteUrl: true,
          cuisineType: true,
          priceRange: true,
          ambiance: true,
          noiseLevel: true,
          dietary: true,
          openingHours: true,
        },
      });
      if (!r) return toolError('Restaurant not found', 'NOT_FOUND');

      return ok(r);
    } catch (err: unknown) {
      logger.error({ err, clientId: ctx.clientId }, 'get_restaurant_details failed');
      return toolError('Internal error', 'INTERNAL');
    }
  }

  async checkAvailability(rawInput: unknown, ctx: ToolContext): Promise<ToolResult> {
    const scopeError = assertScope(ctx, 'mcp:read');
    if (scopeError) return scopeError;

    const parsed = CheckAvailabilityInputSchema.safeParse(rawInput);
    if (!parsed.success) return toolError(parsed.error.message, 'INVALID_INPUT');
    const input: CheckAvailabilityInput = parsed.data;

    const rl = await this.rateLimiter.check(ctx.clientId, 'check_availability');
    if (!rl.allowed) return toolError('Rate limit exceeded', 'RATE_LIMITED');

    const start = performance.now();
    try {
      const exposure = await this.getMcpExposure(input.restaurantId, ctx);
      if (!exposure.ok) return exposure.error;

      const slotStart = new Date(input.slotStart);
      const slotEnd = new Date(input.slotEnd);
      const violation = this.validateExposureConstraints(exposure.settings, {
        partySize: input.partySize,
        startsAt: slotStart,
        endsAt: slotEnd,
      });
      if (violation) return violation;

      const result = await this.availabilityService.checkAvailability({
        restaurantId: input.restaurantId,
        partySize: input.partySize,
        slotStart,
        slotEnd,
      });

      return ok(result);
    } catch (err: unknown) {
      logger.error({ err, clientId: ctx.clientId }, 'check_availability failed');
      return toolError('Internal error', 'INTERNAL');
    } finally {
      checkAvailabilityDuration.observe(performance.now() - start);
    }
  }

  async createReservation(rawInput: unknown, ctx: ToolContext): Promise<ToolResult> {
    const scopeError = assertScope(ctx, 'mcp:reserve');
    if (scopeError) return scopeError;

    const parsed = CreateReservationInputSchema.safeParse(rawInput);
    if (!parsed.success) return toolError(parsed.error.message, 'INVALID_INPUT');
    const input: CreateReservationInput = parsed.data;

    const rl = await this.rateLimiter.check(ctx.clientId, 'create_reservation');
    if (!rl.allowed) return toolError('Rate limit exceeded', 'RATE_LIMITED');

    const cleanSpecialRequests = sanitizeSpecialRequests(input.specialRequests);

    try {
      const exposure = await this.getMcpExposure(input.restaurantId, ctx);
      if (!exposure.ok) return exposure.error;

      const startsAt = new Date(input.startsAt);
      const endsAt = new Date(input.endsAt);
      const violation = this.validateExposureConstraints(exposure.settings, {
        partySize: input.partySize,
        startsAt,
        endsAt,
      });
      if (violation) return violation;

      const { policy } = await this.availabilityService.getPolicyFor(input.restaurantId);

      const scope = computeIdempotencyScope({
        restaurantId: input.restaurantId,
        channel: 'MCP',
        clientId: ctx.clientId,
      });

      const payloadHash = hashPayload({
        ...input,
        specialRequests: cleanSpecialRequests,
      });

      const result = await this.reservationService.createReservation(
        {
          restaurantId: input.restaurantId,
          partySize: input.partySize,
          startsAt,
          endsAt,
          customerName: input.customerName,
          customerPhone: input.customerPhone,
          channel: 'MCP',
          policy,
          actor: ctx.actor,
          holdToken: input.holdToken,
          specialRequests: cleanSpecialRequests,
          consents: input.consents,
        },
        {
          scope,
          key: input.idempotencyKey,
          payloadHash,
          ttlSeconds: 24 * 60 * 60,
        },
      );

      return ok({
        reservationId: result.reservationId,
        state: result.state,
        reused: result.reused,
      });
    } catch (err: unknown) {
      logger.error({ err, clientId: ctx.clientId }, 'create_reservation failed');
      const errName = (err as { name?: string })?.name;
      const errMsg = err instanceof Error ? err.message : String(err);
      if (errName === 'InvalidStateTransitionError') return toolError(errMsg, 'INVALID_STATE');
      if (errName === 'PolicyValidationError') return toolError(errMsg, 'POLICY_VIOLATION');
      if (errName === 'IdempotencyConflictError') return toolError(errMsg, 'IDEMPOTENCY_CONFLICT');
      return toolError('Internal error', 'INTERNAL');
    }
  }

  async cancelReservation(rawInput: unknown, ctx: ToolContext): Promise<ToolResult> {
    const scopeError = assertScope(ctx, 'mcp:cancel');
    if (scopeError) return scopeError;

    const parsed = CancelReservationInputSchema.safeParse(rawInput);
    if (!parsed.success) return toolError(parsed.error.message, 'INVALID_INPUT');
    const input: CancelReservationInput = parsed.data;

    const rl = await this.rateLimiter.check(ctx.clientId, 'cancel_reservation');
    if (!rl.allowed) return toolError('Rate limit exceeded', 'RATE_LIMITED');

    try {
      const reservation = await this.prisma.reservation.findUnique({
        where: { id: input.reservationId },
        select: { restaurantId: true },
      });
      if (!reservation) return toolError('Reservation not found', 'NOT_FOUND');

      // IDOR protection: un client lié à un restaurant ne peut agir
      // que sur les réservations de SON restaurant.
      if (ctx.restaurantId && ctx.restaurantId !== reservation.restaurantId) {
        return toolError('Reservation not found', 'NOT_FOUND');
      }

      const exposure = await this.getMcpExposure(reservation.restaurantId, ctx);
      if (!exposure.ok) return exposure.error;

      await this.reservationService.cancelReservation({
        reservationId: input.reservationId,
        actor: ctx.actor,
        reason: input.reason,
      });
      return ok({ cancelled: true });
    } catch (err: unknown) {
      logger.error({ err, clientId: ctx.clientId }, 'cancel_reservation failed');
      const errName = (err as { name?: string })?.name;
      const errMsg = err instanceof Error ? err.message : String(err);
      if (errName === 'InvalidStateTransitionError') return toolError(errMsg, 'INVALID_STATE');
      if (errName === 'ReservationNotFoundError') return toolError(errMsg, 'NOT_FOUND');
      return toolError('Internal error', 'INTERNAL');
    }
  }

  async getReservationStatus(rawInput: unknown, ctx: ToolContext): Promise<ToolResult> {
    const scopeError = assertScope(ctx, 'mcp:read');
    if (scopeError) return scopeError;

    const parsed = GetReservationStatusInputSchema.safeParse(rawInput);
    if (!parsed.success) return toolError(parsed.error.message, 'INVALID_INPUT');
    const input: GetReservationStatusInput = parsed.data;

    const rl = await this.rateLimiter.check(ctx.clientId, 'get_reservation_status');
    if (!rl.allowed) return toolError('Rate limit exceeded', 'RATE_LIMITED');

    try {
      const reservation = await this.prisma.reservation.findUnique({
        where: { id: input.reservationId },
        select: {
          id: true,
          restaurantId: true,
          state: true,
          partySize: true,
          startsAt: true,
          endsAt: true,
          createdAt: true,
        },
      });
      if (!reservation) return toolError('Reservation not found', 'NOT_FOUND');

      // IDOR protection: même check que cancel_reservation
      if (ctx.restaurantId && ctx.restaurantId !== reservation.restaurantId) {
        return toolError('Reservation not found', 'NOT_FOUND');
      }

      const exposure = await this.getMcpExposure(reservation.restaurantId, ctx);
      if (!exposure.ok) return exposure.error;

      const { restaurantId: _restaurantId, ...publicReservation } = reservation;
      return ok(publicReservation);
    } catch (err: unknown) {
      logger.error({ err, clientId: ctx.clientId }, 'get_reservation_status failed');
      return toolError('Internal error', 'INTERNAL');
    }
  }

  private async getMcpExposure(
    restaurantId: string,
    ctx: ToolContext,
  ): Promise<
    | {
        ok: true;
        settings: {
          timezone: string;
          maxPartySize: number;
          minLeadTimeMinutes: number;
          exposedCreneaux: unknown;
        };
      }
    | { ok: false; error: ToolResult }
  > {
    if (ctx.restaurantId && ctx.restaurantId !== restaurantId) {
      return { ok: false, error: toolError('Restaurant not found', 'NOT_FOUND') };
    }

    const restaurant = await this.prisma.restaurant.findFirst({
      where: {
        id: restaurantId,
        agenticOptIn: true,
        exposureSettings: { is: { mcpEnabled: true } },
      },
      select: {
        timezone: true,
        exposureSettings: {
          select: {
            maxPartySize: true,
            minLeadTimeMinutes: true,
            exposedCreneaux: true,
          },
        },
      },
    });

    if (!restaurant?.exposureSettings) {
      return { ok: false, error: toolError('Restaurant not found', 'NOT_FOUND') };
    }

    return {
      ok: true,
      settings: {
        timezone: restaurant.timezone,
        maxPartySize: restaurant.exposureSettings.maxPartySize,
        minLeadTimeMinutes: restaurant.exposureSettings.minLeadTimeMinutes,
        exposedCreneaux: restaurant.exposureSettings.exposedCreneaux,
      },
    };
  }

  private validateExposureConstraints(
    settings: {
      timezone: string;
      maxPartySize: number;
      minLeadTimeMinutes: number;
      exposedCreneaux: unknown;
    },
    request: { partySize: number; startsAt: Date; endsAt: Date },
  ): ToolResult | null {
    if (request.partySize > settings.maxPartySize) {
      return toolError(
        `partySize ${request.partySize} dépasse maxPartySize ${settings.maxPartySize}`,
        'POLICY_VIOLATION',
      );
    }

    const minutesBefore = (request.startsAt.getTime() - Date.now()) / 60_000;
    if (minutesBefore < settings.minLeadTimeMinutes) {
      return toolError(
        `Insufficient lead time: minimum ${settings.minLeadTimeMinutes}min requis`,
        'POLICY_VIOLATION',
      );
    }

    if (
      !isWithinExposedCreneaux({
        exposedCreneaux: settings.exposedCreneaux,
        startsAt: request.startsAt,
        endsAt: request.endsAt,
        timezone: settings.timezone,
      })
    ) {
      return toolError('Slot is not exposed via MCP', 'POLICY_VIOLATION');
    }

    return null;
  }
}

/**
 * Helper : exécute un tool et redacte la réponse.
 */
export async function executeTool(
  registry: McpToolRegistry,
  toolName: string,
  rawInput: unknown,
  ctx: ToolContext,
): Promise<ToolResult> {
  let result: ToolResult;
  switch (toolName) {
    case 'search_restaurants':
      result = await registry.searchRestaurants(rawInput, ctx);
      break;
    case 'get_restaurant_details':
      result = await registry.getRestaurantDetails(rawInput, ctx);
      break;
    case 'check_availability':
      result = await registry.checkAvailability(rawInput, ctx);
      break;
    case 'create_reservation':
      result = await registry.createReservation(rawInput, ctx);
      break;
    case 'cancel_reservation':
      result = await registry.cancelReservation(rawInput, ctx);
      break;
    case 'get_reservation_status':
      result = await registry.getReservationStatus(rawInput, ctx);
      break;
    default:
      mcpToolCallsTotal.inc({ tool: toolName, status: 'error' });
      return toolError(`Unknown tool: ${toolName}`, 'UNKNOWN_TOOL');
  }

  // Metric : tracker quels tools MCP sont réellement utilisés
  mcpToolCallsTotal.inc({ tool: toolName, status: result.ok ? 'success' : 'error' });

  // Redacte la réponse avant retour
  if (result.ok) {
    const data = redactResponse(result.data);
    assertNoPiiLeak(data, toolName);
    return { ...result, data };
  }
  return result;
}
