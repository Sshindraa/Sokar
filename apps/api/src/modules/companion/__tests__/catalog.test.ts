import { describe, it, expect, vi, beforeEach } from 'vitest';
import { db } from '../../../shared/db/client';
import { evaluateCapability } from '../../entitlements/entitlement.service';
import { SOURCES } from '../catalog';
import { computeQueryData } from '../query-data';

vi.mock('../../../shared/db/client', () => ({
  db: {
    reservation: { findMany: vi.fn() },
    call: { findMany: vi.fn() },
    restaurant: { findUniqueOrThrow: vi.fn() },
    waitingListEntry: { findMany: vi.fn() },
    reputationFeedback: { findMany: vi.fn() },
    restaurantExposureSettings: { findUnique: vi.fn() },
  },
}));
vi.mock('../../entitlements/entitlement.service', () => ({ evaluateCapability: vi.fn() }));

const PERSONAL_FIELDS = [
  'customerName',
  'customerPhone',
  'customerEmail',
  'customerId',
  'callerPhone',
  'notes',
  'comment',
  'specialRequests',
  'transcript',
];

describe('catalogue : champs lus', () => {
  it.each(Object.entries(SOURCES))('la fiche %s ne lit aucun champ personnel', (_, source) => {
    const fields = Object.keys(source.select);
    for (const field of PERSONAL_FIELDS) expect(fields).not.toContain(field);
  });
});

describe('computeQueryData : liste d’attente et avis', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renvoie unavailable plan sans la formule Avis, sans rien lire', async () => {
    vi.mocked(evaluateCapability).mockResolvedValue({ allowed: false } as never);

    const result = await computeQueryData('r1', {
      entity: 'feedback',
      metric: 'count',
      from: '2026-10-01',
      to: '2026-10-31',
    });

    expect(result).toEqual({ unavailable: 'plan' });
    expect(db.reputationFeedback.findMany).not.toHaveBeenCalled();
  });

  it('renvoie unavailable disabled quand la liste d’attente est désactivée', async () => {
    vi.mocked(db.restaurantExposureSettings.findUnique).mockResolvedValue({
      capacitySpecials: {},
    } as never);

    const result = await computeQueryData('r1', {
      entity: 'waitlist',
      metric: 'count',
      date_field: 'service',
      from: '2026-10-01',
      to: '2026-10-31',
    });

    expect(result).toEqual({ unavailable: 'disabled' });
    expect(db.waitingListEntry.findMany).not.toHaveBeenCalled();
  });

  it('compte les couverts de la liste d’attente par statut', async () => {
    vi.mocked(db.restaurantExposureSettings.findUnique).mockResolvedValue({
      capacitySpecials: { waitingListEnabled: true },
    } as never);
    const entry = (status: string, partySize: number) => ({
      slotStart: new Date('2026-10-24T19:00:00Z'),
      createdAt: new Date('2026-10-20T10:00:00Z'),
      status,
      partySize,
    });
    vi.mocked(db.waitingListEntry.findMany).mockResolvedValue([
      entry('PROMOTED', 2),
      entry('EXPIRED', 4),
      entry('PROMOTED', 3),
    ] as never);

    const result = await computeQueryData('r1', {
      entity: 'waitlist',
      metric: 'covers',
      date_field: 'service',
      group_by: 'status',
      from: '2026-10-24',
      to: '2026-10-24',
    });

    expect(result).toMatchObject({
      total: 9,
      groups: [
        { key: 'PROMOTED', value: 5 },
        { key: 'EXPIRED', value: 4 },
      ],
    });
  });

  it('donne la note moyenne à 0,1 près', async () => {
    vi.mocked(evaluateCapability).mockResolvedValue({ allowed: true } as never);
    const feedback = (score: number) => ({
      score,
      submittedAt: new Date('2026-10-24T19:00:00Z'),
      recoveryTask: null,
    });
    vi.mocked(db.reputationFeedback.findMany).mockResolvedValue([
      feedback(4),
      feedback(4),
      feedback(5),
    ] as never);

    const result = await computeQueryData('r1', {
      entity: 'feedback',
      metric: 'avg_score',
      from: '2026-10-24',
      to: '2026-10-24',
    });

    expect(result).toMatchObject({ total: 4.3 });
  });
});
