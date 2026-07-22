import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { s3Send } = vi.hoisted(() => ({ s3Send: vi.fn().mockResolvedValue({}) }));

vi.mock('@aws-sdk/client-s3', () => {
  class Command {
    input: unknown;
    constructor(input: unknown) {
      this.input = input;
    }
  }
  return {
    S3Client: class {
      send = s3Send;
    },
    PutObjectCommand: Command,
    GetObjectCommand: Command,
    DeleteObjectCommand: Command,
  };
});

import { db } from '../../../shared/db/client';
import { startCallRecordingAfterConsent, storeSavedRecording } from '../call-recording.service';
import type { CallSession } from '../stream/types';

const session = {
  callControlId: 'control-1',
  callLegId: 'leg-1',
} as CallSession;

describe('call recording service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.CALL_RECORDING_ENABLED = 'true';
    process.env.CALL_RECORDINGS_BUCKET = 'private-recordings';
    process.env.CALL_RECORDINGS_RETENTION_DAYS = '30';
    process.env.CALL_RECORDINGS_MAX_BYTES = '50000000';
    process.env.TELNYX_API_KEY = ['test', 'api', 'key'].join('-');
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.CALL_RECORDING_ENABLED;
    delete process.env.CALL_RECORDINGS_BUCKET;
    delete process.env.CALL_RECORDINGS_RETENTION_DAYS;
    delete process.env.CALL_RECORDINGS_MAX_BYTES;
  });

  it('starts a dual-channel MP3 recording and marks the call pending', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 200 })));

    await startCallRecordingAfterConsent(session);

    expect(fetch).toHaveBeenCalledWith(
      'https://api.telnyx.com/v2/calls/control-1/actions/record_start',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ format: 'mp3', channels: 'dual' }),
      }),
    );
    expect(db.call.updateMany).toHaveBeenCalledWith({
      where: { callSid: 'leg-1' },
      data: expect.objectContaining({ recordingStatus: 'PENDING' }),
    });
  });

  it('copies the short-lived Telnyx file into private storage with retention metadata', async () => {
    vi.mocked(db.call.findUnique).mockResolvedValue({
      id: 'call-1',
      restaurantId: 'rest-1',
    } as unknown as Awaited<ReturnType<typeof db.call.findUnique>>);
    const audio = new Uint8Array([1, 2, 3, 4]);
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(audio, {
          status: 200,
          headers: { 'content-type': 'audio/mpeg', 'content-length': '4' },
        }),
      ),
    );

    await storeSavedRecording({
      callLegId: 'leg-1',
      recordingId: 'rec-1',
      downloadUrl: 'https://recordings.telnyx.com/signed.mp3',
      startedAt: '2026-07-22T10:00:00.000Z',
      endedAt: '2026-07-22T10:01:00.000Z',
    });

    expect(s3Send).toHaveBeenCalledOnce();
    expect(s3Send.mock.calls[0][0].input).toEqual(
      expect.objectContaining({
        Bucket: 'private-recordings',
        Key: 'call-recordings/rest-1/call-1/rec-1.mp3',
        ContentType: 'audio/mpeg',
        CacheControl: 'private, no-store',
      }),
    );
    expect(db.call.update).toHaveBeenCalledWith({
      where: { id: 'call-1' },
      data: expect.objectContaining({
        recordingStatus: 'AVAILABLE',
        recordingStorageKey: 'call-recordings/rest-1/call-1/rec-1.mp3',
        recordingSizeBytes: 4,
      }),
    });
  });

  it('refuses a non-HTTPS provider URL', async () => {
    vi.mocked(db.call.findUnique).mockResolvedValue({
      id: 'call-1',
      restaurantId: 'rest-1',
    } as unknown as Awaited<ReturnType<typeof db.call.findUnique>>);

    await expect(
      storeSavedRecording({
        callLegId: 'leg-1',
        recordingId: 'rec-1',
        downloadUrl: 'http://example.test/recording.mp3',
      }),
    ).rejects.toThrow('must use HTTPS');
    expect(s3Send).not.toHaveBeenCalled();
  });
});
