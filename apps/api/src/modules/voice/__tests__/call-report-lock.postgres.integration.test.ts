import { afterAll, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';

vi.unmock('@prisma/client');
vi.unmock('../../../shared/db/client');
const { writeObject } = vi.hoisted(() => ({ writeObject: vi.fn() }));
vi.mock('../call-recording.service', async (load) => ({
  ...(await load<typeof import('../call-recording.service')>()),
  putPrivateObject: writeObject,
}));

import { db } from '../../../shared/db/client';
import { createReportJobDeps } from '../call-report/job-runtime';
import type { ReportCallRow } from '../call-report/job';

const url = process.env.RGPD_ERASURE_TEST_DATABASE_URL;
if (url) {
  const target = new URL(url);
  if (
    !['localhost', '127.0.0.1'].includes(target.hostname) ||
    !/^\/sokar_rgpd_erasure_[a-z0-9_]+$/.test(target.pathname) ||
    process.env.DATABASE_URL !== url
  ) {
    throw new Error('Report locking tests require the dedicated local database');
  }
}

describe.skipIf(!url)('report storage coordination on PostgreSQL', () => {
  afterAll(async () => db.$disconnect());
  it('waits for a report write before deletion and rejects later writes', async () => {
    const tag = randomUUID();
    const restaurant = await db.restaurant.create({
      data: {
        name: 'Report lock test',
        managerPhone: '',
        managerEmail: '',
        phoneNumber: tag,
        openingHours: {},
      },
    });
    const row = await db.call.create({
      data: {
        restaurantId: restaurant.id,
        callSid: tag,
        recordingStatus: 'AVAILABLE',
        recordingStorageKey: `test/${tag}/audio.mp3`,
      },
    });
    const call: ReportCallRow = {
      ...row,
      recordingStatus: row.recordingStatus,
      intent: row.intent,
      outcome: row.outcome,
    };
    let release!: () => void;
    let started!: () => void;
    const startedPromise = new Promise<void>((resolve) => {
      started = resolve;
    });
    const releasePromise = new Promise<void>((resolve) => {
      release = resolve;
    });
    writeObject.mockImplementationOnce(async () => {
      started();
      await releasePromise;
    });
    const store = createReportJobDeps().store;
    const writing = store(`test/${tag}/report.json`, '{}', 'application/json', call);
    await startedPromise;
    let changed = false;
    const deleting = db.call
      .updateMany({
        where: { id: call.id, restaurantId: restaurant.id },
        data: { recordingStatus: 'DELETED' },
      })
      .then(() => {
        changed = true;
      });
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(changed).toBe(false);
    release();
    await Promise.all([writing, deleting]);
    await expect(store(`test/${tag}/report.md`, '# test', 'text/markdown', call)).rejects.toThrow(
      'CALL_RECORDING_NO_LONGER_AVAILABLE',
    );
    expect(writeObject).toHaveBeenCalledOnce();
  });
});
