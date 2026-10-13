import { beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '../../../db/client';
import { processReengagement } from '../reengagement.worker';

const sendEmail = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
vi.mock('../../../email', () => ({ sendEmail }));

const loadFloorStats = vi.hoisted(() =>
  vi.fn().mockResolvedValue({ tableCount: 0, seatCount: 0, largestTableCapacity: 0 }),
);
vi.mock('../../../../modules/restaurants/onboarding-floor.service', () => ({ loadFloorStats }));

type Task =
  | 'restaurant'
  | 'hours'
  | 'floor'
  | 'knowledge'
  | 'phone'
  | 'connect-identity'
  | 'connect-activation';

function restaurant(
  completed: Task[],
  overrides: Record<string, unknown> = {},
): Awaited<ReturnType<typeof db.restaurant.findUnique>> {
  return {
    id: 'rest-1',
    name: 'Chez Sokar',
    managerEmail: 'gerant@example.com',
    phoneNumber: '+33451221999',
    firstCallAt: null,
    onboardingLastSeenAt: null,
    onboardingTasks: Object.fromEntries(completed.map((key) => [key, { status: 'completed' }])),
    ...overrides,
  } as never;
}

const ROOM: Task[] = ['restaurant', 'hours', 'floor'];
const ALL: Task[] = [...ROOM, 'knowledge', 'phone', 'connect-identity', 'connect-activation'];

describe('processReengagement', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.DASHBOARD_URL = 'https://sokar.tech';
  });

  it('relance un restaurateur dont la salle est prête et qui a un numéro', async () => {
    vi.mocked(db.restaurant.findUnique).mockResolvedValue(restaurant(ROOM));

    const outcome = await processReengagement({ restaurantId: 'rest-1', type: 'stalled' }, '42');

    expect(outcome).toBe('sent');
    expect(sendEmail).toHaveBeenCalledTimes(1);
    const sent = sendEmail.mock.calls[0][0];
    expect(sent.to).toBe('gerant@example.com');
    expect(sent.subject).toBe('Chez Sokar : il vous reste deux canaux à activer');
    expect(sent.usage).toMatchObject({
      restaurantId: 'rest-1',
      sourceType: 'onboarding_reengagement',
      sourceId: 'rest-1:stalled:42',
    });
  });

  it('ne relance pas un restaurant qui attend son numéro Sokar', async () => {
    vi.mocked(db.restaurant.findUnique).mockResolvedValue(
      restaurant(ROOM, { phoneNumber: '+000chez-sokar' }),
    );

    const outcome = await processReengagement({ restaurantId: 'rest-1', type: 'stalled' }, '42');

    expect(outcome).toBe('waiting-number');
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it('ne relance pas sans adresse e-mail, et ne fait pas échouer le job', async () => {
    vi.mocked(db.restaurant.findUnique).mockResolvedValue(restaurant([], { managerEmail: '' }));

    await expect(
      processReengagement({ restaurantId: 'rest-1', type: 'stalled' }, '42'),
    ).resolves.toBe('no-email');
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it('ne relance pas quelqu’un revenu depuis moins de 24 h', async () => {
    vi.mocked(db.restaurant.findUnique).mockResolvedValue(
      restaurant(ROOM, { onboardingLastSeenAt: new Date(Date.now() - 60 * 60 * 1000) }),
    );

    expect(await processReengagement({ restaurantId: 'rest-1', type: 'stalled' }, '42')).toBe(
      'recently-active',
    );
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it('ne relance pas quand tout est terminé (stalled)', async () => {
    vi.mocked(db.restaurant.findUnique).mockResolvedValue(restaurant(ALL));

    expect(await processReengagement({ restaurantId: 'rest-1', type: 'stalled' }, '42')).toBe(
      'already-complete',
    );
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it('inactive : parcours terminé sans appel test validé, le numéro est dans l’e-mail', async () => {
    vi.mocked(db.restaurant.findUnique).mockResolvedValue(restaurant(ALL));

    expect(await processReengagement({ restaurantId: 'rest-1', type: 'inactive' }, '43')).toBe(
      'sent',
    );
    const sent = sendEmail.mock.calls[0][0];
    expect(sent.subject).toBe('Chez Sokar : entendez votre assistant');
    expect(sent.html).toContain('04 51 22 19 99');
  });

  it('inactive : ne relance pas si l’appel test a déjà été validé', async () => {
    vi.mocked(db.restaurant.findUnique).mockResolvedValue(
      restaurant(ALL, { firstCallAt: new Date() }),
    );

    expect(await processReengagement({ restaurantId: 'rest-1', type: 'inactive' }, '43')).toBe(
      'already-complete',
    );
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it('inactive : un parcours resté incomplet reçoit la relance de ce qui reste', async () => {
    vi.mocked(db.restaurant.findUnique).mockResolvedValue(restaurant([...ROOM, 'knowledge']));

    expect(await processReengagement({ restaurantId: 'rest-1', type: 'inactive' }, '43')).toBe(
      'sent',
    );
    expect(sendEmail.mock.calls[0][0].subject).toBe(
      'Chez Sokar : il vous reste un canal à activer',
    );
  });

  it('ignore un restaurant supprimé', async () => {
    vi.mocked(db.restaurant.findUnique).mockResolvedValue(null);

    expect(await processReengagement({ restaurantId: 'rest-1', type: 'stalled' }, '42')).toBe(
      'restaurant-not-found',
    );
    expect(sendEmail).not.toHaveBeenCalled();
  });
});
