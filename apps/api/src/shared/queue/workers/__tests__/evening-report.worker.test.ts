import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Job } from 'bullmq';

const mocks = vi.hoisted(() => ({
  processor: undefined as unknown,
  findCalls: vi.fn(),
  findReservations: vi.fn(),
  findRestaurant: vi.fn(),
  sendEmail: vi.fn(),
  logInfo: vi.fn(),
  logWarn: vi.fn(),
  logError: vi.fn(),
}));

vi.mock('bullmq', () => ({
  Worker: class {
    constructor(_queueName: string, processor: unknown) {
      mocks.processor = processor;
    }
  },
}));
vi.mock('../../../../env', () => ({ env: { EVENING_REPORTS_ENABLED: false } }));
vi.mock('../../../redis/client', () => ({ redisQueue: {} }));
vi.mock('../../../db/client', () => ({
  db: {
    call: { findMany: mocks.findCalls },
    reservation: { findMany: mocks.findReservations },
    restaurant: { findUnique: mocks.findRestaurant },
  },
}));
vi.mock('../../../email', () => ({ sendEmail: mocks.sendEmail }));
vi.mock('../../../../modules/analytics/report.service', () => ({
  buildReportEmail: vi.fn(),
}));
vi.mock('../helper', () => ({
  setupWorkerListeners: vi.fn(),
  jobLogger: () => ({ info: mocks.logInfo, warn: mocks.logWarn, error: mocks.logError }),
}));

import '../evening-report.worker';

function makeJob(): Job {
  return {
    id: 'nightly-report-test',
    name: 'nightly',
    data: { restaurantId: 'restaurant-test' },
  } as unknown as Job;
}

describe('evening-report.worker', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('skips queued reports without querying data or sending email when disabled', async () => {
    const processor = mocks.processor as (job: Job) => Promise<void>;

    await processor(makeJob());

    expect(mocks.logInfo).toHaveBeenCalledWith(
      'evening report skipped because email reports are disabled in this environment',
    );
    expect(mocks.findCalls).not.toHaveBeenCalled();
    expect(mocks.findReservations).not.toHaveBeenCalled();
    expect(mocks.findRestaurant).not.toHaveBeenCalled();
    expect(mocks.sendEmail).not.toHaveBeenCalled();
  });
});
