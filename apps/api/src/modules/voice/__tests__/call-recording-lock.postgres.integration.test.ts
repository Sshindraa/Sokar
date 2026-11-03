import { afterAll, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
vi.unmock('@prisma/client');
vi.unmock('../../../shared/db/client');
const { send } = vi.hoisted(() => ({ send: vi.fn() }));
vi.mock('@aws-sdk/client-s3', () => {
  class Command {
    constructor(public input: unknown) {}
  }
  return {
    S3Client: class {
      send = send;
    },
    PutObjectCommand: Command,
    GetObjectCommand: Command,
    DeleteObjectCommand: Command,
  };
});
import { db } from '../../../shared/db/client';
import { storeSavedRecording } from '../call-recording.service';
const url = process.env.RGPD_ERASURE_TEST_DATABASE_URL;
if (url) {
  const target = new URL(url);
  if (
    !['localhost', '127.0.0.1'].includes(target.hostname) ||
    !/^\/sokar_rgpd_erasure_[a-z0-9_]+$/.test(target.pathname) ||
    process.env.DATABASE_URL !== url
  )
    throw new Error('Recording locking tests require the dedicated local database');
}
describe.skipIf(!url)('recording storage coordination on PostgreSQL', () => {
  afterAll(async () => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    await db.$disconnect();
  });
  it('waits for the audio write and prevents later writes after deletion begins', async () => {
    const tag = randomUUID();
    const restaurant = await db.restaurant.create({
      data: {
        name: 'Recording lock test',
        managerPhone: '',
        managerEmail: '',
        phoneNumber: tag,
        openingHours: {},
      },
    });
    const call = await db.call.create({
      data: { restaurantId: restaurant.id, callSid: tag, recordingStatus: 'PENDING' },
    });
    vi.stubEnv('CALL_RECORDING_ENABLED', 'true');
    vi.stubEnv('CALL_RECORDING_TEST_RESTAURANT_IDS', restaurant.id);
    vi.stubEnv('CALL_RECORDINGS_BUCKET', 'synthetic');
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(async () => new Response(new Uint8Array([1, 2]), { status: 200 })),
    );
    let release!: () => void;
    let started!: () => void;
    const startedPromise = new Promise<void>((resolve) => {
      started = resolve;
    });
    const releasePromise = new Promise<void>((resolve) => {
      release = resolve;
    });
    send.mockImplementationOnce(async () => {
      started();
      await releasePromise;
    });
    const payload = {
      callLegId: tag,
      recordingId: 'synthetic',
      downloadUrl: 'https://recordings.invalid/audio',
    };
    const writing = storeSavedRecording(payload);
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
    await expect(storeSavedRecording(payload)).rejects.toThrow(
      'CALL_RECORDING_NO_LONGER_AVAILABLE',
    );
    expect(send).toHaveBeenCalledOnce();
    expect(
      (await db.call.findUniqueOrThrow({ where: { id: call.id } })).recordingStorageKey,
    ).toContain('synthetic.mp3');
  });
});
