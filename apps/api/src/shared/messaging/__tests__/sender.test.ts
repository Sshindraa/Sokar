import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../telnyx/client', () => ({
  sendSms: vi.fn(),
}));
vi.mock('../../whatsapp/client', () => ({
  isWhatsAppConfigured: vi.fn(),
  sendWhatsAppTemplate: vi.fn(),
}));
vi.mock('../../../modules/analytics/events.service', () => ({
  trackMessagingEvent: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../../logger/pino', () => ({
  logger: {
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

import { trackMessagingEvent } from '../../../modules/analytics/events.service';
import { logger } from '../../logger/pino';
import { sendReminder } from '../sender';
import { isWhatsAppConfigured, sendWhatsAppTemplate } from '../../whatsapp/client';
import { sendSms } from '../../telnyx/client';
import {
  buildNotificationClaimKey,
  getNotificationClaim,
  type NotificationClaimStore,
  type NotificationReconciliationQueue,
} from '../../queue/notification-idempotency';

function makeClaimStore() {
  const values = new Map<string, string>();
  const store: NotificationClaimStore = {
    async set(key, value, _expirationMode, _expirationSeconds, existenceMode) {
      if (existenceMode === 'NX' && values.has(key)) return null;
      values.set(key, value);
      return 'OK';
    },
    async get(key) {
      return values.get(key) ?? null;
    },
    async del(key) {
      values.delete(key);
      return 1;
    },
    async eval(_script, _numberOfKeys, key, token, nextValue) {
      const raw = values.get(key);
      if (!raw || !(JSON.parse(raw) as { token?: string }).token) return 0;
      if ((JSON.parse(raw) as { token?: string }).token !== token) return 0;
      if (nextValue === '__DELETE__') values.delete(key);
      else values.set(key, nextValue);
      return 1;
    },
  };
  return { store, values };
}

function makeReconciliationQueue() {
  const jobIds = new Set<string>();
  const jobs: Array<{ name: string; data: unknown; jobId: string }> = [];
  const queue: NotificationReconciliationQueue = {
    async add(name, data, options) {
      if (jobIds.has(options.jobId)) return;
      jobIds.add(options.jobId);
      jobs.push({ name, data, jobId: options.jobId });
    },
  };
  return { queue, jobs };
}

const params = {
  to: '+33612345678',
  restaurantName: 'Chez Sokar',
  restaurantId: 'rest-1',
  reservationId: 'res-1',
  customerId: 'customer-1',
  date: 'jeudi 2 juillet 2026',
  time: '19:00',
  partySize: 2,
};

describe('messaging sender notification outcomes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(isWhatsAppConfigured).mockReturnValue(false);
    vi.mocked(sendSms).mockResolvedValue({
      outcome: 'success',
      provider: 'telnyx',
      channel: 'sms',
      providerMessageId: 'sms-1',
    });
    vi.mocked(sendWhatsAppTemplate).mockResolvedValue({
      outcome: 'success',
      provider: 'telnyx',
      channel: 'whatsapp',
      providerMessageId: 'whatsapp-1',
    });
  });

  it('conserve le claim SMS après succès et ne double pas l’appel', async () => {
    const { store } = makeClaimStore();
    const { queue, jobs } = makeReconciliationQueue();

    const first = await sendReminder(params, { claimStore: store, reconciliationQueue: queue });
    const second = await sendReminder(params, { claimStore: store, reconciliationQueue: queue });

    expect(first).toMatchObject({ channel: 'sms', success: true, outcome: 'success' });
    expect(second).toMatchObject({ channel: 'sms', success: true, outcome: 'success' });
    expect(sendSms).toHaveBeenCalledTimes(1);
    expect(jobs).toHaveLength(0);
    expect(
      await getNotificationClaim(
        store,
        buildNotificationClaimKey('reservation-reminder-sms', 'res-1'),
      ),
    ).toMatchObject({
      status: 'success',
      providerMessageId: 'sms-1',
    });
  });

  it('autorise le fallback SMS après un échec certain WhatsApp', async () => {
    vi.mocked(isWhatsAppConfigured).mockReturnValue(true);
    vi.mocked(sendWhatsAppTemplate).mockResolvedValue({
      outcome: 'failure_certain',
      provider: 'telnyx',
      channel: 'whatsapp',
    });
    const { store } = makeClaimStore();
    const { queue } = makeReconciliationQueue();

    const result = await sendReminder(params, { claimStore: store, reconciliationQueue: queue });

    expect(result).toMatchObject({ channel: 'sms', success: true, outcome: 'success' });
    expect(sendWhatsAppTemplate).toHaveBeenCalledTimes(1);
    expect(sendSms).toHaveBeenCalledTimes(1);
    expect(
      await getNotificationClaim(
        store,
        buildNotificationClaimKey('reservation-reminder-whatsapp', 'res-1'),
      ),
    ).toBeNull();
    expect(
      await getNotificationClaim(
        store,
        buildNotificationClaimKey('reservation-reminder-sms', 'res-1'),
      ),
    ).toMatchObject({ status: 'success' });
  });

  it('ne bascule pas vers SMS après un résultat WhatsApp unknown', async () => {
    vi.mocked(isWhatsAppConfigured).mockReturnValue(true);
    vi.mocked(sendWhatsAppTemplate).mockResolvedValue({
      outcome: 'unknown',
      provider: 'telnyx',
      channel: 'whatsapp',
      providerMessageId: 'whatsapp-unknown',
    });
    const { store } = makeClaimStore();
    const { queue, jobs } = makeReconciliationQueue();

    const first = await sendReminder(params, { claimStore: store, reconciliationQueue: queue });
    const second = await sendReminder(params, { claimStore: store, reconciliationQueue: queue });

    expect(first).toMatchObject({ channel: 'whatsapp', outcome: 'unknown', success: false });
    expect(second).toMatchObject({ channel: 'whatsapp', outcome: 'unknown', success: false });
    expect(sendWhatsAppTemplate).toHaveBeenCalledTimes(1);
    expect(sendSms).not.toHaveBeenCalled();
    expect(jobs).toHaveLength(1);
    expect(
      await getNotificationClaim(
        store,
        buildNotificationClaimKey('reservation-reminder-whatsapp', 'res-1'),
      ),
    ).toMatchObject({
      status: 'unknown',
      providerMessageId: 'whatsapp-unknown',
    });
  });

  it('conserve le claim SMS et bloque le renvoi après reset réseau', async () => {
    vi.mocked(sendSms).mockRejectedValueOnce(
      Object.assign(new Error('socket reset'), { code: 'ECONNRESET' }),
    );
    const { store } = makeClaimStore();
    const { queue, jobs } = makeReconciliationQueue();

    const first = await sendReminder(params, { claimStore: store, reconciliationQueue: queue });
    const second = await sendReminder(params, { claimStore: store, reconciliationQueue: queue });

    expect(first).toMatchObject({ channel: 'sms', outcome: 'unknown', success: false });
    expect(second).toMatchObject({ channel: 'sms', outcome: 'unknown', success: false });
    expect(sendSms).toHaveBeenCalledTimes(1);
    expect(jobs).toHaveLength(1);
    expect(logger.error).not.toHaveBeenCalled();
  });

  it('libère le claim SMS après un refus certain et permet un retry', async () => {
    vi.mocked(sendSms).mockResolvedValueOnce({
      outcome: 'failure_certain',
      provider: 'telnyx',
      channel: 'sms',
    });
    const { store } = makeClaimStore();
    const { queue } = makeReconciliationQueue();

    const first = await sendReminder(params, { claimStore: store, reconciliationQueue: queue });
    const second = await sendReminder(params, { claimStore: store, reconciliationQueue: queue });

    expect(first).toMatchObject({ channel: 'sms', outcome: 'failure_certain', success: false });
    expect(second).toMatchObject({ channel: 'sms', outcome: 'success', success: true });
    expect(sendSms).toHaveBeenCalledTimes(2);
  });

  it('conserve des clés distinctes pour WhatsApp et SMS', async () => {
    const { store } = makeClaimStore();
    const { queue } = makeReconciliationQueue();

    await sendReminder(params, { claimStore: store, reconciliationQueue: queue });

    expect(
      await getNotificationClaim(
        store,
        buildNotificationClaimKey('reservation-reminder-whatsapp', 'res-1'),
      ),
    ).toBeNull();
    expect(
      await getNotificationClaim(
        store,
        buildNotificationClaimKey('reservation-reminder-sms', 'res-1'),
      ),
    ).toMatchObject({ channel: 'sms' });
    expect(trackMessagingEvent).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'reminder_sent', channel: 'sms', success: true }),
    );
  });
});
