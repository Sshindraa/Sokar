import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  EventOrderStatus,
  EventSessionStatus,
  EventStatus,
  EventTicketStatus,
  EventTicketTypeStatus,
  EventWaitlistStatus,
  Prisma,
} from '@prisma/client';
import { db } from '../../../shared/db/client';
import {
  cancelEventOrder,
  checkInEventTicket,
  createEvent,
  createEventOrder,
  createEventSession,
  createEventTicketType,
  EventConflictError,
  EventInputError,
  expireEventSessions,
  issueEventOrderInvoice,
  joinEventWaitlist,
  promoteEventWaitlist,
  refundEventOrder,
} from '../event.service';

const RESTAURANT_ID = 'restaurant-1';
const EVENT_ID = 'event-1';
const SESSION_ID = 'session-1';
const TICKET_TYPE_ID = 'ticket-type-1';
const ORDER_ID = 'order-1';
const TICKET_ID = 'ticket-1';
const WAITLIST_ID = 'waitlist-1';
const NOW = new Date('2026-09-14T10:00:00.000Z');

function eventRow(overrides: Record<string, unknown> = {}) {
  return {
    id: EVENT_ID,
    restaurantId: RESTAURANT_ID,
    key: 'wine-night',
    name: 'Soirée dégustation',
    description: 'Une soirée.',
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
    id: SESSION_ID,
    restaurantId: RESTAURANT_ID,
    eventId: EVENT_ID,
    startsAt: new Date('2026-09-20T18:00:00.000Z'),
    endsAt: new Date('2026-09-20T21:00:00.000Z'),
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
    id: TICKET_TYPE_ID,
    restaurantId: RESTAURANT_ID,
    eventId: EVENT_ID,
    key: 'standard',
    name: 'Entrée standard',
    priceCents: 2_500,
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
    id: ORDER_ID,
    restaurantId: RESTAURANT_ID,
    eventId: EVENT_ID,
    sessionId: SESSION_ID,
    ticketTypeId: TICKET_TYPE_ID,
    customerId: null,
    reservationId: null,
    idempotencyKey: 'a'.repeat(64),
    refundIdempotencyKey: null,
    quantity: 2,
    unitPriceCents: 2_500,
    totalPriceCents: 5_000,
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
    ticketType: { key: 'standard', name: 'Entrée standard', priceCents: 2_500, currency: 'EUR' },
    customer: null,
    _count: { tickets: 2 },
    ...overrides,
  };
}

function ticketRow(overrides: Record<string, unknown> = {}) {
  return {
    id: TICKET_ID,
    restaurantId: RESTAURANT_ID,
    eventId: EVENT_ID,
    sessionId: SESSION_ID,
    orderId: ORDER_ID,
    ticketTypeId: TICKET_TYPE_ID,
    codeHash: 'd'.repeat(64),
    codeLast4: 'ABCD',
    status: EventTicketStatus.ISSUED,
    checkedInAt: null,
    checkedInByHash: null,
    createdAt: NOW,
    updatedAt: NOW,
    event: { key: 'wine-night', name: 'Soirée dégustation' },
    session: { startsAt: sessionRow().startsAt, endsAt: sessionRow().endsAt },
    ticketType: { key: 'standard', name: 'Entrée standard' },
    order: { customer: null },
    ...overrides,
  };
}

function waitlistRow(overrides: Record<string, unknown> = {}) {
  return {
    id: WAITLIST_ID,
    restaurantId: RESTAURANT_ID,
    eventId: EVENT_ID,
    sessionId: SESSION_ID,
    customerId: null,
    quantity: 2,
    idempotencyKey: 'b'.repeat(64),
    status: EventWaitlistStatus.WAITING,
    promotedAt: null,
    createdAt: NOW,
    updatedAt: NOW,
    event: { key: 'wine-night', name: 'Soirée dégustation' },
    session: { startsAt: sessionRow().startsAt, endsAt: sessionRow().endsAt },
    customer: null,
    ...overrides,
  };
}

describe('event service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(db.restaurant.findFirst).mockResolvedValue({ id: RESTAURANT_ID } as never);
  });

  it('normalizes event keys and records an actor hash', async () => {
    vi.mocked(db.event.create).mockResolvedValue(eventRow() as never);
    const result = await createEvent({
      restaurantId: RESTAURANT_ID,
      key: ' Wine-Night ',
      name: ' Soirée dégustation ',
      actor: 'user-1',
    });
    expect(result).toMatchObject({ key: 'wine-night', name: 'Soirée dégustation' });
    expect(db.event.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          key: 'wine-night',
          createdByHash: expect.stringMatching(/^[a-f0-9]{64}$/),
        }),
      }),
    );
  });

  it('rejects unsafe event input before persistence', async () => {
    await expect(
      createEvent({
        restaurantId: RESTAURANT_ID,
        key: 'bad key',
        name: 'Événement',
        actor: 'user-1',
      }),
    ).rejects.toMatchObject({ code: 'EVENT_KEY_INVALID' });
    expect(db.event.create).not.toHaveBeenCalled();
  });

  it('maps duplicate event keys to a stable conflict', async () => {
    vi.mocked(db.event.create).mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('Unique', { code: 'P2002', clientVersion: 'test' }),
    );
    await expect(
      createEvent({
        restaurantId: RESTAURANT_ID,
        key: 'wine-night',
        name: 'Soirée',
        actor: 'user-1',
      }),
    ).rejects.toMatchObject({ code: 'EVENT_KEY_CONFLICT' });
  });

  it('creates a bounded session and rejects inverted dates', async () => {
    vi.mocked(db.event.findFirst).mockResolvedValue({ id: EVENT_ID } as never);
    vi.mocked(db.eventSession.create).mockResolvedValue(sessionRow() as never);
    const result = await createEventSession({
      restaurantId: RESTAURANT_ID,
      eventId: EVENT_ID,
      startsAt: '2026-09-20T18:00:00Z',
      endsAt: '2026-09-20T21:00:00Z',
      capacity: 20,
    });
    expect(result).toMatchObject({ id: SESSION_ID, capacity: 20 });
    await expect(
      createEventSession({
        restaurantId: RESTAURANT_ID,
        eventId: EVENT_ID,
        startsAt: '2026-09-20T21:00:00Z',
        endsAt: '2026-09-20T18:00:00Z',
        capacity: 20,
      }),
    ).rejects.toBeInstanceOf(EventInputError);
  });

  it('creates a tariff and rejects non-EUR prices', async () => {
    vi.mocked(db.event.findFirst).mockResolvedValue({ id: EVENT_ID } as never);
    vi.mocked(db.eventTicketType.create).mockResolvedValue(ticketTypeRow() as never);
    const result = await createEventTicketType({
      restaurantId: RESTAURANT_ID,
      eventId: EVENT_ID,
      key: ' Standard ',
      name: 'Entrée standard',
      priceCents: 2_500,
    });
    expect(result).toMatchObject({ key: 'standard', priceCents: 2_500, currency: 'EUR' });
    await expect(
      createEventTicketType({
        restaurantId: RESTAURANT_ID,
        eventId: EVENT_ID,
        key: 'vip',
        name: 'VIP',
        priceCents: 2_500,
        currency: 'USD',
      }),
    ).rejects.toMatchObject({ code: 'EVENT_TICKET_CURRENCY_INVALID' });
  });

  it('issues opaque ticket codes, snapshots the price and replays idempotently', async () => {
    vi.mocked(db.eventOrder.findUnique).mockResolvedValue(null);
    vi.mocked(db.eventSession.findFirst).mockResolvedValue(sessionRow() as never);
    vi.mocked(db.eventTicketType.findFirst).mockResolvedValue(ticketTypeRow() as never);
    vi.mocked(db.eventOrder.aggregate).mockResolvedValue({ _sum: { quantity: 0 } } as never);
    vi.mocked(db.eventOrder.create).mockResolvedValue(orderRow() as never);
    vi.mocked(db.eventTicket.create).mockResolvedValue({ id: TICKET_ID } as never);
    const first = await createEventOrder({
      restaurantId: RESTAURANT_ID,
      eventId: EVENT_ID,
      sessionId: SESSION_ID,
      ticketTypeId: TICKET_TYPE_ID,
      quantity: 2,
      idempotencyKey: 'order-0001',
      actor: 'user-1',
      now: NOW,
    });
    expect(first).toMatchObject({
      replayed: false,
      totalPriceCents: 5_000,
      providerContacted: false,
      dryRun: true,
    });
    expect(first.ticketCodes).toHaveLength(2);
    expect(first.ticketCodes?.[0]).toMatch(/^[A-F0-9]{12}$/);
    vi.mocked(db.eventOrder.findUnique).mockResolvedValue(orderRow() as never);
    const replay = await createEventOrder({
      restaurantId: RESTAURANT_ID,
      eventId: EVENT_ID,
      sessionId: SESSION_ID,
      ticketTypeId: TICKET_TYPE_ID,
      quantity: 2,
      idempotencyKey: 'order-0001',
      actor: 'user-1',
      now: NOW,
    });
    expect(replay).toMatchObject({ replayed: true, id: ORDER_ID, ticketCodes: null });
    expect(db.eventTicket.create).toHaveBeenCalledTimes(2);
  });

  it('protects shared session capacity under the transaction lock', async () => {
    vi.mocked(db.eventOrder.findUnique).mockResolvedValue(null);
    vi.mocked(db.eventSession.findFirst).mockResolvedValue(sessionRow({ capacity: 3 }) as never);
    vi.mocked(db.eventTicketType.findFirst).mockResolvedValue(ticketTypeRow() as never);
    vi.mocked(db.eventOrder.aggregate).mockResolvedValue({ _sum: { quantity: 2 } } as never);
    await expect(
      createEventOrder({
        restaurantId: RESTAURANT_ID,
        eventId: EVENT_ID,
        sessionId: SESSION_ID,
        ticketTypeId: TICKET_TYPE_ID,
        quantity: 2,
        actor: 'user-1',
        now: NOW,
      }),
    ).rejects.toMatchObject({ code: 'EVENT_CAPACITY_EXCEEDED' });
    expect(db.eventOrder.create).not.toHaveBeenCalled();
    expect(db.$executeRaw).toHaveBeenCalledTimes(1);
  });

  it('refuses inactive, closed or past sessions', async () => {
    vi.mocked(db.eventOrder.findUnique).mockResolvedValue(null);
    vi.mocked(db.eventSession.findFirst).mockResolvedValue(
      sessionRow({ status: EventSessionStatus.CLOSED }) as never,
    );
    await expect(
      createEventOrder({
        restaurantId: RESTAURANT_ID,
        eventId: EVENT_ID,
        sessionId: SESSION_ID,
        ticketTypeId: TICKET_TYPE_ID,
        quantity: 1,
        actor: 'user-1',
        now: NOW,
      }),
    ).rejects.toMatchObject({ code: 'EVENT_SESSION_CLOSED' });
    vi.mocked(db.eventSession.findFirst).mockResolvedValue(
      sessionRow({ event: { ...sessionRow().event, status: EventStatus.DRAFT } }) as never,
    );
    await expect(
      createEventOrder({
        restaurantId: RESTAURANT_ID,
        eventId: EVENT_ID,
        sessionId: SESSION_ID,
        ticketTypeId: TICKET_TYPE_ID,
        quantity: 1,
        actor: 'user-1',
        now: NOW,
      }),
    ).rejects.toMatchObject({ code: 'EVENT_NOT_ACTIVE' });
  });

  it('cancels an order and replays repeated cancellation', async () => {
    vi.mocked(db.eventOrder.updateMany).mockResolvedValue({ count: 1 } as never);
    vi.mocked(db.eventTicket.updateMany).mockResolvedValue({ count: 2 } as never);
    vi.mocked(db.eventOrder.findFirst).mockResolvedValue(
      orderRow({ status: EventOrderStatus.CANCELLED, cancelledAt: NOW }) as never,
    );
    const cancelled = await cancelEventOrder({
      restaurantId: RESTAURANT_ID,
      orderId: ORDER_ID,
      now: NOW,
    });
    expect(cancelled).toMatchObject({ status: EventOrderStatus.CANCELLED, replayed: false });
    vi.mocked(db.eventOrder.updateMany).mockResolvedValue({ count: 0 } as never);
    const replay = await cancelEventOrder({
      restaurantId: RESTAURANT_ID,
      orderId: ORDER_ID,
      now: NOW,
    });
    expect(replay).toMatchObject({ replayed: true });
  });

  it('issues a deterministic local invoice and rejects a conflicting number', async () => {
    vi.mocked(db.eventOrder.findFirst).mockResolvedValue(orderRow() as never);
    vi.mocked(db.eventOrder.update).mockResolvedValue(
      orderRow({ invoiceNumber: 'SOKAR-EVT-ORDER1', invoicedAt: NOW }) as never,
    );
    const issued = await issueEventOrderInvoice({
      restaurantId: RESTAURANT_ID,
      orderId: ORDER_ID,
      invoiceNumber: 'SOKAR-EVT-ORDER1',
      now: NOW,
    });
    expect(issued).toMatchObject({ invoiceNumber: 'SOKAR-EVT-ORDER1', replayed: false });
    vi.mocked(db.eventOrder.findFirst).mockResolvedValue(
      orderRow({ invoiceNumber: 'OTHER' }) as never,
    );
    await expect(
      issueEventOrderInvoice({
        restaurantId: RESTAURANT_ID,
        orderId: ORDER_ID,
        invoiceNumber: 'SOKAR-EVT-ORDER1',
        now: NOW,
      }),
    ).rejects.toMatchObject({ code: 'EVENT_ORDER_INVOICE_CONFLICT' });
  });

  it('marks a refund once, propagates it to issued tickets and replays its key', async () => {
    vi.mocked(db.eventOrder.findFirst).mockResolvedValue(
      orderRow({ status: EventOrderStatus.CANCELLED }) as never,
    );
    vi.mocked(db.eventOrder.findUnique).mockResolvedValue(null);
    vi.mocked(db.eventOrder.update).mockResolvedValue(
      orderRow({
        status: EventOrderStatus.REFUNDED,
        refundedAt: NOW,
        refundReason: 'Client',
      }) as never,
    );
    vi.mocked(db.eventTicket.updateMany).mockResolvedValue({ count: 2 } as never);
    const result = await refundEventOrder({
      restaurantId: RESTAURANT_ID,
      orderId: ORDER_ID,
      idempotencyKey: 'refund-0001',
      reason: ' Client ',
      now: NOW,
    });
    expect(result).toMatchObject({
      status: EventOrderStatus.REFUNDED,
      replayed: false,
      refundReason: 'Client',
    });
    vi.mocked(db.eventOrder.findUnique).mockResolvedValue(
      orderRow({ status: EventOrderStatus.REFUNDED }) as never,
    );
    const replay = await refundEventOrder({
      restaurantId: RESTAURANT_ID,
      orderId: ORDER_ID,
      idempotencyKey: 'refund-0001',
      now: NOW,
    });
    expect(replay).toMatchObject({ replayed: true });
  });

  it('checks in a ticket exactly once and refuses malformed codes', async () => {
    vi.mocked(db.eventTicket.findFirst).mockResolvedValue(ticketRow() as never);
    vi.mocked(db.eventTicket.updateMany).mockResolvedValue({ count: 1 } as never);
    vi.mocked(db.eventTicket.findFirst)
      .mockResolvedValueOnce(ticketRow())
      .mockResolvedValueOnce(ticketRow({ status: EventTicketStatus.CHECKED_IN, checkedInAt: NOW }));
    const result = await checkInEventTicket({
      restaurantId: RESTAURANT_ID,
      code: '00000000ABCD',
      actor: 'staff-1',
      now: NOW,
    });
    expect(result).toMatchObject({ status: EventTicketStatus.CHECKED_IN, replayed: false });
    await expect(
      checkInEventTicket({ restaurantId: RESTAURANT_ID, code: 'bad', actor: 'staff-1' }),
    ).rejects.toMatchObject({ code: 'EVENT_TICKET_CODE_INVALID' });
  });

  it('joins and promotes a waitlist entry with a stable order key', async () => {
    vi.mocked(db.eventWaitlistEntry.findUnique).mockResolvedValue(null);
    vi.mocked(db.eventSession.findFirst).mockResolvedValue(sessionRow({ capacity: 1 }) as never);
    vi.mocked(db.eventWaitlistEntry.create).mockResolvedValue(waitlistRow() as never);
    const joined = await joinEventWaitlist({
      restaurantId: RESTAURANT_ID,
      eventId: EVENT_ID,
      sessionId: SESSION_ID,
      quantity: 2,
      idempotencyKey: 'wait-0001',
      actor: 'user-1',
      now: NOW,
    });
    expect(joined).toMatchObject({ status: EventWaitlistStatus.WAITING, replayed: false });
    vi.mocked(db.eventWaitlistEntry.findFirst).mockResolvedValue(waitlistRow() as never);
    vi.mocked(db.eventOrder.findUnique).mockResolvedValue(null);
    vi.mocked(db.eventSession.findFirst).mockResolvedValue(sessionRow() as never);
    vi.mocked(db.eventTicketType.findFirst).mockResolvedValue(ticketTypeRow() as never);
    vi.mocked(db.eventOrder.aggregate).mockResolvedValue({ _sum: { quantity: 0 } } as never);
    vi.mocked(db.eventOrder.create).mockResolvedValue(orderRow() as never);
    vi.mocked(db.eventTicket.create).mockResolvedValue({ id: TICKET_ID } as never);
    vi.mocked(db.eventWaitlistEntry.updateMany).mockResolvedValue({ count: 1 } as never);
    const promoted = await promoteEventWaitlist({
      restaurantId: RESTAURANT_ID,
      entryId: WAITLIST_ID,
      ticketTypeId: TICKET_TYPE_ID,
      actor: 'user-1',
      now: NOW,
    });
    expect(promoted).toMatchObject({ id: ORDER_ID, replayed: false });
    expect(db.eventWaitlistEntry.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: EventWaitlistStatus.PROMOTED }),
      }),
    );
  });

  it('expires closed sessions and their pending waitlist entries', async () => {
    vi.mocked(db.eventSession.findMany).mockResolvedValue([{ id: SESSION_ID }] as never);
    vi.mocked(db.eventSession.updateMany).mockResolvedValue({ count: 1 } as never);
    vi.mocked(db.eventWaitlistEntry.updateMany).mockResolvedValue({ count: 2 } as never);
    const closed = await expireEventSessions({ now: NOW, limit: 10 });
    expect(closed).toBe(1);
    expect(db.eventWaitlistEntry.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: EventWaitlistStatus.EXPIRED } }),
    );
  });

  it('exports a typed conflict for a mismatched replay', async () => {
    vi.mocked(db.eventOrder.findUnique).mockResolvedValue(orderRow({ quantity: 1 }) as never);
    await expect(
      createEventOrder({
        restaurantId: RESTAURANT_ID,
        eventId: EVENT_ID,
        sessionId: SESSION_ID,
        ticketTypeId: TICKET_TYPE_ID,
        quantity: 2,
        idempotencyKey: 'order-0001',
        actor: 'user-1',
        now: NOW,
      }),
    ).rejects.toBeInstanceOf(EventConflictError);
  });
});
