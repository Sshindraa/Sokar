import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  EventOrderStatus,
  EventSessionStatus,
  EventStatus,
  EventTicketStatus,
  EventTicketTypeStatus,
} from '@prisma/client';
import { closeApp, getApp } from '../../../test/helpers';
import { db } from '../../../shared/db/client';

const AUTH = { authorization: 'Bearer test' };
const NOW = new Date('2026-09-14T10:00:00.000Z');

function eventRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'event-1',
    restaurantId: 'test-rest-1',
    key: 'wine-night',
    name: 'Soirée dégustation',
    description: null,
    timezone: 'Europe/Paris',
    status: EventStatus.ACTIVE,
    createdAt: NOW,
    updatedAt: NOW,
    _count: { sessions: 1, ticketTypes: 1, orders: 0, waitlistEntries: 0 },
    ...overrides,
  };
}
function sessionRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'session-1',
    restaurantId: 'test-rest-1',
    eventId: 'event-1',
    startsAt: new Date('2026-09-20T18:00:00Z'),
    endsAt: new Date('2026-09-20T21:00:00Z'),
    capacity: 20,
    status: EventSessionStatus.OPEN,
    createdAt: NOW,
    updatedAt: NOW,
    event: { key: 'wine-night', name: 'Soirée dégustation', status: EventStatus.ACTIVE },
    _count: { orders: 0, tickets: 0, waitlistEntries: 0 },
    ...overrides,
  };
}
function ticketTypeRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'ticket-type-1',
    restaurantId: 'test-rest-1',
    eventId: 'event-1',
    key: 'standard',
    name: 'Entrée standard',
    priceCents: 2500,
    currency: 'EUR',
    maxPerOrder: 5,
    status: EventTicketTypeStatus.ACTIVE,
    createdAt: NOW,
    updatedAt: NOW,
    _count: { orders: 0, tickets: 0 },
    ...overrides,
  };
}
function orderRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'order-1',
    restaurantId: 'test-rest-1',
    eventId: 'event-1',
    sessionId: 'session-1',
    ticketTypeId: 'ticket-type-1',
    customerId: null,
    reservationId: null,
    idempotencyKey: 'a'.repeat(64),
    refundIdempotencyKey: null,
    quantity: 2,
    unitPriceCents: 2500,
    totalPriceCents: 5000,
    currency: 'EUR',
    status: EventOrderStatus.CONFIRMED,
    invoiceNumber: null,
    invoicedAt: null,
    refundReason: null,
    refundedAt: null,
    cancelledAt: null,
    createdByHash: 'c'.repeat(64),
    createdAt: NOW,
    updatedAt: NOW,
    event: { key: 'wine-night', name: 'Soirée dégustation' },
    session: { startsAt: sessionRow().startsAt, endsAt: sessionRow().endsAt },
    ticketType: { key: 'standard', name: 'Entrée standard', priceCents: 2500, currency: 'EUR' },
    customer: null,
    _count: { tickets: 2 },
    ...overrides,
  };
}
function ticketRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'ticket-1',
    restaurantId: 'test-rest-1',
    eventId: 'event-1',
    sessionId: 'session-1',
    orderId: 'order-1',
    ticketTypeId: 'ticket-type-1',
    codeLast4: 'ABCD',
    status: EventTicketStatus.ISSUED,
    checkedInAt: null,
    createdAt: NOW,
    updatedAt: NOW,
    event: { key: 'wine-night', name: 'Soirée dégustation' },
    session: { startsAt: sessionRow().startsAt, endsAt: sessionRow().endsAt },
    ticketType: { key: 'standard', name: 'Entrée standard' },
    order: { customer: null },
    ...overrides,
  };
}

describe('event routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.setSystemTime(NOW);
    vi.stubEnv('EVENTS_ENABLED', 'false');
    vi.mocked(db.restaurant.findUnique).mockResolvedValue({
      id: 'test-rest-1',
      plan: 'PRO',
      siteStatus: 'ACTIVE',
    } as never);
    vi.mocked(db.restaurant.findFirst).mockResolvedValue({ id: 'test-rest-1' } as never);
  });
  afterAll(async () => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
    await closeApp();
  });

  it('keeps event ticketing disabled during the freeze', async () => {
    const app = await getApp();
    const response = await app.inject({ method: 'GET', url: '/events', headers: AUTH });
    expect(response.statusCode).toBe(503);
    expect(response.json()).toMatchObject({ error: 'EVENTS_DISABLED' });
    expect(db.event.findMany).not.toHaveBeenCalled();
  });

  it('enforces the Pro entitlement before the runtime flag', async () => {
    vi.stubEnv('EVENTS_ENABLED', 'true');
    vi.mocked(db.restaurant.findUnique).mockResolvedValue({
      id: 'test-rest-1',
      plan: 'ESSENTIAL',
      siteStatus: 'ACTIVE',
    } as never);
    const app = await getApp();
    const response = await app.inject({ method: 'GET', url: '/events', headers: AUTH });
    expect(response.statusCode).toBe(403);
    expect(response.json()).toMatchObject({
      error: 'CAPABILITY_NOT_INCLUDED',
      capability: 'events.manage',
    });
  });

  it('creates an event, tariff and session for an enabled Pro restaurant', async () => {
    vi.stubEnv('EVENTS_ENABLED', 'true');
    vi.mocked(db.event.create).mockResolvedValue(eventRow() as never);
    vi.mocked(db.eventTicketType.create).mockResolvedValue(ticketTypeRow() as never);
    vi.mocked(db.event.findFirst).mockResolvedValue(eventRow() as never);
    vi.mocked(db.eventSession.create).mockResolvedValue(sessionRow() as never);
    const app = await getApp();
    const created = await app.inject({
      method: 'POST',
      url: '/events',
      headers: AUTH,
      payload: { key: 'wine-night', name: 'Soirée dégustation' },
    });
    expect(created.statusCode).toBe(201);
    const type = await app.inject({
      method: 'POST',
      url: '/events/event-1/ticket-types',
      headers: AUTH,
      payload: { key: 'standard', name: 'Entrée standard', priceCents: 2500 },
    });
    expect(type.statusCode).toBe(201);
    const session = await app.inject({
      method: 'POST',
      url: '/events/event-1/sessions',
      headers: AUTH,
      payload: { startsAt: '2026-09-20T18:00:00Z', endsAt: '2026-09-20T21:00:00Z', capacity: 20 },
    });
    expect(session.statusCode).toBe(201);
  });

  it('lets staff issue orders and check in tickets while writes stay manager-only', async () => {
    vi.stubEnv('EVENTS_ENABLED', 'true');
    vi.mocked(db.event.create).mockResolvedValue(eventRow() as never);
    vi.mocked(db.eventOrder.findUnique).mockResolvedValue(null);
    vi.mocked(db.eventSession.findFirst).mockResolvedValue(sessionRow() as never);
    vi.mocked(db.eventTicketType.findFirst).mockResolvedValue(ticketTypeRow() as never);
    vi.mocked(db.eventOrder.aggregate).mockResolvedValue({ _sum: { quantity: 0 } } as never);
    vi.mocked(db.eventOrder.create).mockResolvedValue(orderRow() as never);
    vi.mocked(db.eventTicket.create).mockResolvedValue({ id: 'ticket-1' } as never);
    vi.mocked(db.eventTicket.findFirst).mockResolvedValue(ticketRow() as never);
    vi.mocked(db.eventTicket.updateMany).mockResolvedValue({ count: 1 } as never);
    const app = await getApp();
    const denied = await app.inject({
      method: 'POST',
      url: '/events',
      headers: { ...AUTH, 'x-test-site-role': 'STAFF' },
      payload: { key: 'wine-night', name: 'Soirée dégustation' },
    });
    expect(denied.statusCode).toBe(403);
    const order = await app.inject({
      method: 'POST',
      url: '/events/event-1/sessions/session-1/orders',
      headers: { ...AUTH, 'x-test-site-role': 'STAFF', 'idempotency-key': 'order-0001' },
      payload: { ticketTypeId: 'ticket-type-1', quantity: 2 },
    });
    expect(order.statusCode).toBe(201);
    const checkIn = await app.inject({
      method: 'POST',
      url: '/event-tickets/ticket-1/check-in',
      headers: { ...AUTH, 'x-test-site-role': 'STAFF' },
      payload: { code: '00000000ABCD' },
    });
    expect(checkIn.statusCode).toBe(200);
    const codeOnlyCheckIn = await app.inject({
      method: 'POST',
      url: '/event-tickets/check-in',
      headers: { ...AUTH, 'x-test-site-role': 'STAFF' },
      payload: { code: '00000000ABCD' },
    });
    expect(codeOnlyCheckIn.statusCode).toBe(200);
  });

  it('returns 200 on an idempotent order replay', async () => {
    vi.stubEnv('EVENTS_ENABLED', 'true');
    vi.mocked(db.eventOrder.findUnique)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(orderRow());
    vi.mocked(db.eventSession.findFirst).mockResolvedValue(sessionRow() as never);
    vi.mocked(db.eventTicketType.findFirst).mockResolvedValue(ticketTypeRow() as never);
    vi.mocked(db.eventOrder.aggregate).mockResolvedValue({ _sum: { quantity: 0 } } as never);
    vi.mocked(db.eventOrder.create).mockResolvedValue(orderRow() as never);
    vi.mocked(db.eventTicket.create).mockResolvedValue({ id: 'ticket-1' } as never);
    const app = await getApp();
    const first = await app.inject({
      method: 'POST',
      url: '/events/event-1/sessions/session-1/orders',
      headers: { ...AUTH, 'idempotency-key': 'order-0001' },
      payload: { ticketTypeId: 'ticket-type-1', quantity: 2 },
    });
    const replay = await app.inject({
      method: 'POST',
      url: '/events/event-1/sessions/session-1/orders',
      headers: { ...AUTH, 'idempotency-key': 'order-0001' },
      payload: { ticketTypeId: 'ticket-type-1', quantity: 2 },
    });
    expect(first.statusCode).toBe(201);
    expect(replay.statusCode).toBe(200);
    expect(replay.json().data).toMatchObject({ replayed: true, ticketCodes: null });
  });

  it('requires an idempotency key for refunds and returns validation errors', async () => {
    vi.stubEnv('EVENTS_ENABLED', 'true');
    const app = await getApp();
    const response = await app.inject({
      method: 'POST',
      url: '/event-orders/order-1/refund',
      headers: AUTH,
      payload: {},
    });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ error: 'EVENT_IDEMPOTENCY_INVALID' });
  });

  it('lists orders, tickets and waitlist through tenant-scoped routes', async () => {
    vi.stubEnv('EVENTS_ENABLED', 'true');
    vi.mocked(db.eventOrder.findMany).mockResolvedValue([orderRow()] as never);
    vi.mocked(db.eventTicket.findMany).mockResolvedValue([ticketRow()] as never);
    vi.mocked(db.eventWaitlistEntry.findMany).mockResolvedValue([] as never);
    const app = await getApp();
    expect(
      (await app.inject({ method: 'GET', url: '/event-orders', headers: AUTH })).statusCode,
    ).toBe(200);
    expect(
      (await app.inject({ method: 'GET', url: '/event-tickets', headers: AUTH })).statusCode,
    ).toBe(200);
    expect(
      (await app.inject({ method: 'GET', url: '/event-waitlist', headers: AUTH })).statusCode,
    ).toBe(200);
  });
});
