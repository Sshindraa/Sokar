import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  processor: null as null | ((job: unknown) => Promise<unknown>),
  findUnique: vi.fn(),
  sendEmail: vi.fn(),
}));

vi.mock('bullmq', () => ({
  Worker: class {
    on = vi.fn();
    constructor(_name: string, processor: (job: unknown) => Promise<unknown>) {
      mocks.processor = processor;
    }
  },
}));
vi.mock('../../../redis/client', () => ({ redisQueue: {} }));
vi.mock('../../../db/client', () => ({ db: { restaurant: { findUnique: mocks.findUnique } } }));
vi.mock('../../../email', () => ({ sendEmail: mocks.sendEmail }));
vi.mock('../helper', () => ({
  setupWorkerListeners: vi.fn(),
  jobLogger: () => ({ info: vi.fn(), warn: vi.fn() }),
}));

import {
  processPhoneAssignmentNeeded,
  type PhoneAssignmentAlertDependencies,
  type PhoneAssignmentRestaurant,
} from '../phone-assignment-alert.worker';

const JOB = { restaurantId: 'resto-1', floorCompletedAt: '2026-10-12T08:30:00.000Z' };
const RESTAURANT: PhoneAssignmentRestaurant = {
  id: 'resto-1',
  name: 'Chez <Émile>',
  city: 'Lyon',
  phoneNumber: '+000chez-emile',
};

function deps(overrides: Partial<PhoneAssignmentAlertDependencies> = {}) {
  const send = vi.fn().mockResolvedValue(undefined);
  return {
    send,
    deps: {
      recipient: 'ops@sokar.test',
      dashboardUrl: 'https://sokar.test/',
      findRestaurant: vi.fn().mockResolvedValue(RESTAURANT),
      send,
      log: { info: vi.fn(), warn: vi.fn() },
      ...overrides,
    } as PhoneAssignmentAlertDependencies,
  };
}

describe('worker phone-assignment-alert', () => {
  beforeEach(() => vi.clearAllMocks());

  it('envoie à l’équipe le restaurant, sa ville, son id, le lien admin et la fin de la salle', async () => {
    const { deps: d, send } = deps();
    expect(await processPhoneAssignmentNeeded(JOB, d)).toBe('sent');
    expect(send).toHaveBeenCalledTimes(1);
    const email = send.mock.calls[0][0];
    expect(email.to).toBe('ops@sokar.test');
    expect(email.subject).toBe('Numéro Sokar à attribuer : Chez <Émile>');
    expect(email.html).toContain('Chez &lt;Émile&gt;');
    expect(email.html).toContain('resto-1');
    expect(email.html).toContain('Lyon');
    expect(email.html).toContain('href="https://sokar.test/admin/provisioning"');
    expect(email.html).toContain('12 octobre 2026 à 10:30');
  });

  it('ne fait rien si un numéro a été attribué entre-temps', async () => {
    const { deps: d, send } = deps({
      findRestaurant: vi.fn().mockResolvedValue({ ...RESTAURANT, phoneNumber: '+33123456789' }),
    });
    expect(await processPhoneAssignmentNeeded(JOB, d)).toBe('already_assigned');
    expect(send).not.toHaveBeenCalled();
  });

  it('journalise et ne fait rien si SOKAR_OPS_ALERT_EMAIL est vide', async () => {
    const findRestaurant = vi.fn();
    const { deps: d, send } = deps({ recipient: '  ', findRestaurant });
    expect(await processPhoneAssignmentNeeded(JOB, d)).toBe('no_recipient');
    expect(d.log.info).toHaveBeenCalled();
    expect(findRestaurant).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  });

  it('ne lit ni n’envoie aucune donnée personnelle du gérant', async () => {
    vi.stubEnv('SOKAR_OPS_ALERT_EMAIL', 'ops@sokar.test');
    vi.stubEnv('DASHBOARD_URL', 'https://sokar.test');
    // Même si la base renvoyait plus que demandé, rien du gérant ne doit sortir.
    mocks.findUnique.mockResolvedValue({
      ...RESTAURANT,
      managerName: 'Émile Dupont',
      managerEmail: 'emile@gerant.test',
      managerPhone: '+33612345678',
      phoneE164: '+33478000000',
    });
    mocks.sendEmail.mockResolvedValue(undefined);

    await mocks.processor?.({ data: JOB });

    expect(mocks.findUnique).toHaveBeenCalledWith({
      where: { id: 'resto-1' },
      select: { id: true, name: true, city: true, phoneNumber: true },
    });
    const email = mocks.sendEmail.mock.calls[0][0];
    const content = `${email.subject}\n${email.html}`;
    for (const personal of ['Émile Dupont', 'emile@gerant.test', '+33612345678', '+33478000000']) {
      expect(content).not.toContain(personal);
    }
    vi.unstubAllEnvs();
  });
});
