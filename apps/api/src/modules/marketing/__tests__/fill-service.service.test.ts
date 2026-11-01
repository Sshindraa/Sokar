import { beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '../../../shared/db/client';
import { CapacityAwareAvailabilityService } from '../../floor-plan/availability-capacity-aware.service';
import {
  buildAudience,
  createMarketingCampaign,
  ensureCampaignMessages,
  HOLDOUT_INCLUSION_REASON,
  type CampaignAudienceMemberDraft,
} from '../marketing-campaign.service';
import {
  createServiceFillDraft,
  isTargetServiceFull,
  planServiceFill,
  serviceWindow,
} from '../fill-service.service';

vi.mock('../../../shared/db/client', () => ({
  db: { reservation: { findMany: vi.fn(), aggregate: vi.fn() } },
}));
vi.mock('../../floor-plan/availability-capacity-aware.service', () => ({
  CapacityAwareAvailabilityService: vi.fn(),
}));
vi.mock('../marketing-campaign.service', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../marketing-campaign.service')>()),
  buildAudience: vi.fn(),
  createMarketingCampaign: vi.fn(),
}));

const NOW = new Date('2026-11-02T10:00:00.000Z');
// Mercredi 4 novembre 2026, heure de Paris (UTC+1).
const DATE = '2026-11-04';
const WEDNESDAY_LUNCH = new Date('2026-10-07T11:30:00.000Z'); // mercredi 13 h 30, Paris
const SATURDAY_DINNER = new Date('2026-10-10T17:00:00.000Z'); // samedi 19 h, Paris

function member(customerId: string): CampaignAudienceMemberDraft {
  return { customerId, inclusionReason: 'CHANNEL_OPT_IN', snapshot: { permissionSource: 'X' } };
}

function members(count: number): CampaignAudienceMemberDraft[] {
  return Array.from({ length: count }, (_, index) => member(`customer-${index}`));
}

function mockAudience(list: CampaignAudienceMemberDraft[]) {
  vi.mocked(buildAudience).mockResolvedValue({
    channel: 'SMS',
    audienceVersion: 1,
    candidateCount: list.length,
    eligibleCount: list.length,
    excludedByReason: {},
    sample: [],
    members: list,
  });
}

function mockFloor({
  tables,
  booked = 0,
  honored = [],
  busy = [],
}: {
  tables: Array<{ capacity: number; minCapacity: number }>;
  booked?: number;
  honored?: Array<{ customerId: string; reservedAt: Date }>;
  busy?: Array<{ customerId: string }>;
}) {
  // Une fonction (et non une flèche) : le service est instancié avec `new`.
  vi.mocked(CapacityAwareAvailabilityService).mockImplementation(function () {
    return { tableRanges: vi.fn().mockResolvedValue(tables) };
  } as never);
  vi.mocked(db.reservation.aggregate).mockImplementation(((args: { _sum?: unknown }) =>
    Promise.resolve(
      args._sum ? { _sum: { partySize: booked } } : { _avg: { partySize: 2 } },
    )) as never);
  // Lecture « état simple » = visites honorées ; lecture « états multiples » = réservations du jour.
  vi.mocked(db.reservation.findMany).mockImplementation(((args: { where: { state: unknown } }) =>
    Promise.resolve(typeof args.where.state === 'string' ? honored : busy)) as never);
}

describe('remplissage de service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('coupe le service à 16 h, heure de Paris', () => {
    expect(serviceWindow(DATE, 'midi').end.toISOString()).toBe('2026-11-04T15:00:00.000Z');
    expect(serviceWindow(DATE, 'soir').start.toISOString()).toBe('2026-11-04T15:00:00.000Z');
  });

  it('dit que la capacité est inconnue quand il n’y a pas de plan de salle, sans rien cibler', async () => {
    mockFloor({ tables: [] });
    const plan = await planServiceFill({
      restaurantId: 'r1',
      date: DATE,
      service: 'midi',
      channel: 'SMS',
      now: NOW,
    });
    expect(plan).toEqual({ status: 'CAPACITY_UNKNOWN' });
    expect(buildAudience).not.toHaveBeenCalled();
  });

  it('places libres = capacité des tables actives − couverts réservés', async () => {
    mockFloor({
      tables: [
        { capacity: 20, minCapacity: 2 },
        { capacity: 10, minCapacity: 1 },
      ],
      booked: 12,
    });
    mockAudience(members(3));
    const plan = await planServiceFill({
      restaurantId: 'r1',
      date: DATE,
      service: 'midi',
      channel: 'SMS',
      now: NOW,
    });
    expect(plan).toMatchObject({ status: 'PLANNED', capacity: 30, booked: 12, freePlaces: 18 });
  });

  it('service plein : aucune audience', async () => {
    mockFloor({ tables: [{ capacity: 30, minCapacity: 1 }], booked: 30 });
    const plan = await planServiceFill({
      restaurantId: 'r1',
      date: DATE,
      service: 'midi',
      channel: 'SMS',
      now: NOW,
    });
    expect(plan).toEqual({ status: 'NO_FREE_PLACES', capacity: 30, booked: 30 });
    expect(buildAudience).not.toHaveBeenCalled();
  });

  it('classe par affinité : même jour de semaine et même service d’abord', async () => {
    mockFloor({
      tables: [{ capacity: 100, minCapacity: 1 }],
      honored: [
        { customerId: 'b', reservedAt: SATURDAY_DINNER },
        { customerId: 'b', reservedAt: SATURDAY_DINNER },
        { customerId: 'b', reservedAt: SATURDAY_DINNER },
        { customerId: 'a', reservedAt: WEDNESDAY_LUNCH },
        { customerId: 'a', reservedAt: WEDNESDAY_LUNCH },
      ],
    });
    mockAudience([member('b'), member('a')]);
    const plan = await planServiceFill({
      restaurantId: 'r1',
      date: DATE,
      service: 'midi',
      channel: 'SMS',
      now: NOW,
      seed: 1,
    });
    expect(plan.status === 'PLANNED' && plan.members.map((m) => m.customerId)).toEqual(['a', 'b']);
    expect(plan.status === 'PLANNED' && plan.members[0].snapshot.affinity).toBe(2);
  });

  it('taille d’audience = ceil(places / taille de groupe / taux), plafonnée par les candidats', async () => {
    mockFloor({ tables: [{ capacity: 36, minCapacity: 1 }] });
    mockAudience(members(30));
    const plan = await planServiceFill({
      restaurantId: 'r1',
      date: DATE,
      service: 'midi',
      channel: 'SMS',
      now: NOW,
      seed: 7,
    });
    // 36 / 2 / 0,2 = 90 visés, mais 30 candidats seulement.
    expect(plan).toMatchObject({ targetSize: 90, candidateCount: 30, excludedSameDay: 0 });
    expect(plan.status === 'PLANNED' && plan.members).toHaveLength(30);
  });

  it('témoin : 10 % de l’audience, sans message, et reproductible avec la même graine', async () => {
    mockFloor({ tables: [{ capacity: 36, minCapacity: 1 }] });
    mockAudience(members(30));
    const args = {
      restaurantId: 'r1',
      date: DATE,
      service: 'midi' as const,
      channel: 'SMS' as const,
      now: NOW,
    };
    const first = await planServiceFill({ ...args, seed: 42 });
    const second = await planServiceFill({ ...args, seed: 42 });
    if (first.status !== 'PLANNED' || second.status !== 'PLANNED')
      throw new Error('expected a plan');
    const holdout = (plan: typeof first) =>
      plan.members
        .filter((m) => m.inclusionReason === HOLDOUT_INCLUSION_REASON)
        .map((m) => m.customerId);
    expect(first.holdoutCount).toBe(3);
    expect(holdout(first)).toHaveLength(3);
    expect(holdout(first)).toEqual(holdout(second));
    expect(first.members[0].snapshot.holdoutSeed).toBe(42);
  });

  it('exclut le client qui a déjà une réservation ce jour-là', async () => {
    mockFloor({ tables: [{ capacity: 36, minCapacity: 1 }], busy: [{ customerId: 'customer-0' }] });
    mockAudience(members(3));
    const plan = await planServiceFill({
      restaurantId: 'r1',
      date: DATE,
      service: 'midi',
      channel: 'SMS',
      now: NOW,
      seed: 3,
    });
    expect(plan).toMatchObject({ candidateCount: 2, excludedSameDay: 1 });
    expect(plan.status === 'PLANNED' && plan.members.map((m) => m.customerId)).not.toContain(
      'customer-0',
    );
  });

  it('brouillon : passe par la création de campagne avec les membres et le service visé', async () => {
    mockFloor({ tables: [{ capacity: 36, minCapacity: 1 }] });
    mockAudience(members(3));
    vi.mocked(createMarketingCampaign).mockResolvedValue({ id: 'campaign-1' } as never);
    const result = await createServiceFillDraft({
      restaurantId: 'r1',
      date: DATE,
      service: 'midi',
      channel: 'SMS',
      name: 'Midi calme',
      objective: 'Remplir le service',
      bodyTemplate: 'Bonjour {{customer.firstName}} {{unsubscribeUrl}}',
      now: NOW,
      seed: 5,
    });
    expect(result.campaign).toEqual({ id: 'campaign-1' });
    expect(createMarketingCampaign).toHaveBeenCalledWith(
      expect.objectContaining({
        members: expect.any(Array),
        targetServiceStart: serviceWindow(DATE, 'midi').start,
        targetServiceEnd: serviceWindow(DATE, 'midi').end,
      }),
    );
  });

  it('service visé complet : pause ; capacité inconnue : rien ne bloque', async () => {
    const window = serviceWindow(DATE, 'midi');
    mockFloor({ tables: [{ capacity: 10, minCapacity: 1 }], booked: 10 });
    await expect(isTargetServiceFull({ restaurantId: 'r1', ...window })).resolves.toBe(true);
    mockFloor({ tables: [] });
    await expect(isTargetServiceFull({ restaurantId: 'r1', ...window })).resolves.toBe(false);
  });

  it('le témoin ne reçoit aucune ligne de message', async () => {
    const writer = {
      campaignAudienceMember: {
        findMany: vi.fn(({ where }: { where: { inclusionReason: { not: string } } }) =>
          Promise.resolve(
            [
              { id: 'm1', customerId: 'c1', inclusionReason: 'CHANNEL_OPT_IN' },
              { id: 'm2', customerId: 'c2', inclusionReason: HOLDOUT_INCLUSION_REASON },
            ].filter((row) => row.inclusionReason !== where.inclusionReason.not),
          ),
        ),
      },
      campaignMessage: { createMany: vi.fn().mockResolvedValue({ count: 1 }) },
    };
    await ensureCampaignMessages('campaign-1', 'SMS', writer as never);
    expect(writer.campaignMessage.createMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: [expect.objectContaining({ audienceMemberId: 'm1', customerId: 'c1' })],
      }),
    );
  });
});
