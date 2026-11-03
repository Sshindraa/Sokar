import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  findFirst: vi.fn(),
  findMany: vi.fn(),
  withdraw: vi.fn(),
  register: vi.fn(),
}));

vi.mock('../../../shared/db/client', () => ({
  db: {
    campaignMessage: { findFirst: state.findFirst },
    customer: { findMany: state.findMany },
  },
}));
vi.mock('../../marketing/marketing-permission.service', () => ({
  withdrawMarketingPermission: state.withdraw,
}));
vi.mock('../../marketing/marketing-opt-out.service', () => ({
  registerMarketingOptOut: state.register,
}));
vi.mock('../../../shared/logger/pino', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { applyMarketingSmsStop, isMarketingStopKeyword } from '../sms-marketing-stop';

const PHONE = '+33612345678';

describe('isMarketingStopKeyword', () => {
  it.each(['STOP', 'stop', 'STOP SMS', 'ARRET', 'ARRÊT', 'Arrêt', '  stop   sms  '])(
    'reconnaît « %s »',
    (text) => expect(isMarketingStopKeyword(text)).toBe(true),
  );

  it.each(['stop merci', 'STOPPER', 'je veux stop', 'arrêtez', 'OUI', 'NON', ''])(
    'ignore « %s »',
    (text) => expect(isMarketingStopKeyword(text)).toBe(false),
  );
});

describe('applyMarketingSmsStop', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.findFirst.mockResolvedValue({ campaign: { restaurantId: 'rest-1' } });
    state.findMany.mockResolvedValue([]);
    state.withdraw.mockResolvedValue({});
    state.register.mockResolvedValue('REGISTERED');
  });

  it('ne fait rien sans SMS marketing envoyé à ce numéro', async () => {
    state.findFirst.mockResolvedValueOnce(null);
    await expect(applyMarketingSmsStop(PHONE)).resolves.toBe(false);
    expect(state.findMany).not.toHaveBeenCalled();
    expect(state.withdraw).not.toHaveBeenCalled();
    expect(state.register).not.toHaveBeenCalled();
  });

  it('retire chaque fiche active du restaurant du dernier SMS marketing', async () => {
    state.findMany.mockResolvedValueOnce([{ id: 'cust-1' }, { id: 'cust-2' }]);
    await expect(applyMarketingSmsStop(PHONE)).resolves.toBe(true);
    expect(state.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ restaurantId: 'rest-1', phone: PHONE, archivedAt: null }),
      }),
    );
    expect(state.withdraw).toHaveBeenCalledTimes(2);
    expect(state.withdraw).toHaveBeenCalledWith({
      restaurantId: 'rest-1',
      customerId: 'cust-1',
      channel: 'SMS',
      source: 'SMS_STOP',
    });
    expect(state.register).not.toHaveBeenCalled();
  });

  it('écrit le registre seul quand les fiches sont déjà retirées (rejeu)', async () => {
    await expect(applyMarketingSmsStop(PHONE)).resolves.toBe(true);
    expect(state.withdraw).not.toHaveBeenCalled();
    expect(state.register).toHaveBeenCalledWith({
      restaurantId: 'rest-1',
      channel: 'SMS',
      address: PHONE,
      reason: 'UNSUBSCRIBE',
      source: 'SMS_STOP',
    });
  });

  it('rejoue sans erreur ni doublon de fiche', async () => {
    await applyMarketingSmsStop(PHONE);
    await applyMarketingSmsStop(PHONE);
    expect(state.withdraw).not.toHaveBeenCalled();
    expect(state.register).toHaveBeenCalledTimes(2);
  });

  it('signale un registre indisponible pour que Telnyx rejoue', async () => {
    state.register.mockResolvedValueOnce('SKIPPED_NO_KEY');
    await expect(applyMarketingSmsStop(PHONE)).rejects.toThrow(
      'MARKETING_OPTOUT_REGISTER_UNAVAILABLE',
    );
  });

  it('ignore un numéro qui ne se normalise pas', async () => {
    await expect(applyMarketingSmsStop('sender')).resolves.toBe(false);
    expect(state.findFirst).not.toHaveBeenCalled();
  });
});
