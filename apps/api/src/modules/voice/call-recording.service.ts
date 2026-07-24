import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { db } from '../../shared/db/client';
import { logger } from '../../shared/logger/pino';
import { telnyxFetch, telnyxAgent } from '../../shared/telnyx/http-agent';
import type { CallSession } from './stream/types';

const RECORDING_FORMAT = 'mp3';

export function isCallRecordingEnabled(): boolean {
  return process.env.CALL_RECORDING_ENABLED === 'true';
}

export function isTestCallRecordingEnabled(restaurantId: string): boolean {
  if (!isCallRecordingEnabled()) return false;

  const allowedRestaurantIds = new Set(
    (process.env.CALL_RECORDING_TEST_RESTAURANT_IDS ?? '')
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean),
  );
  return allowedRestaurantIds.has(restaurantId);
}

function bucket(): string {
  const value = process.env.CALL_RECORDINGS_BUCKET;
  if (!value) throw new Error('CALL_RECORDINGS_BUCKET not configured');
  return value;
}

function retentionDays(): number {
  const parsed = Number(process.env.CALL_RECORDINGS_RETENTION_DAYS ?? 30);
  return Number.isInteger(parsed) && parsed >= 1 && parsed <= 30 ? parsed : 30;
}

function maxBytes(): number {
  const parsed = Number(process.env.CALL_RECORDINGS_MAX_BYTES ?? 50_000_000);
  return Number.isInteger(parsed) && parsed >= 1_000_000 ? parsed : 50_000_000;
}

function recordingClient(): S3Client {
  const accessKeyId = process.env.CALL_RECORDINGS_ACCESS_KEY_ID;
  const secretAccessKey = process.env.CALL_RECORDINGS_SECRET_ACCESS_KEY;
  const endpoint = process.env.CALL_RECORDINGS_ENDPOINT;

  return new S3Client({
    region: process.env.CALL_RECORDINGS_REGION ?? 'eu-west-3',
    ...(endpoint ? { endpoint, forcePathStyle: true } : {}),
    ...(accessKeyId && secretAccessKey ? { credentials: { accessKeyId, secretAccessKey } } : {}),
  });
}

export interface SavedRecordingJobData {
  readonly callLegId: string;
  readonly recordingId: string;
  readonly downloadUrl: string;
  readonly startedAt?: string;
  readonly endedAt?: string;
}

export interface RecoverRecordingJobData {
  readonly callLegId: string;
}

interface TelnyxRecordingListItem {
  id?: string;
  status?: string;
  download_urls?: { mp3?: string };
  recording_started_at?: string;
  recording_ended_at?: string;
}

interface TelnyxRecordingListResponse {
  data?: TelnyxRecordingListItem[];
}

export async function startTestCallRecording(session: CallSession): Promise<void> {
  if (!isTestCallRecordingEnabled(session.restaurantId)) return;

  const apiKey = process.env.TELNYX_API_KEY;
  if (!apiKey) throw new Error('TELNYX_API_KEY not configured');

  const response = await telnyxFetch(
    `/v2/calls/${encodeURIComponent(session.callControlId)}/actions/record_start`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ format: RECORDING_FORMAT, channels: 'dual' }),
    },
  );

  if (!response.ok) {
    const detail = (await response.text()).slice(0, 300);
    await db.call.updateMany({
      where: { callSid: session.callLegId },
      data: {
        recordingStatus: 'FAILED',
        recordingError: `Telnyx record_start ${response.status}: ${detail}`.slice(0, 500),
      },
    });
    throw new Error(`Telnyx record_start failed: ${response.status}`);
  }

  await db.call.updateMany({
    where: { callSid: session.callLegId },
    data: {
      recordingStatus: 'PENDING',
      recordingError: null,
    },
  });
}

export async function storeSavedRecording(data: SavedRecordingJobData): Promise<void> {
  if (!isCallRecordingEnabled()) return;

  const call = await db.call.findUnique({
    where: { callSid: data.callLegId },
    select: { id: true, restaurantId: true },
  });
  if (!call) throw new Error(`Call not found for recording ${data.recordingId}`);

  const url = new URL(data.downloadUrl);
  if (url.protocol !== 'https:') throw new Error('Recording download URL must use HTTPS');

  const response = await fetch(url, { signal: AbortSignal.timeout(30_000) });
  if (!response.ok) throw new Error(`Recording download failed: ${response.status}`);

  const declaredLength = Number(response.headers.get('content-length') ?? 0);
  if (declaredLength > maxBytes()) throw new Error('Recording exceeds configured maximum size');

  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength > maxBytes()) throw new Error('Recording exceeds configured maximum size');

  const storageKey = `call-recordings/${call.restaurantId}/${call.id}/${data.recordingId}.mp3`;
  const contentType = response.headers.get('content-type')?.split(';')[0] || 'audio/mpeg';
  const expiresAt = new Date(Date.now() + retentionDays() * 24 * 60 * 60 * 1000);
  const client = recordingClient();

  await client.send(
    new PutObjectCommand({
      Bucket: bucket(),
      Key: storageKey,
      Body: bytes,
      ContentType: contentType,
      CacheControl: 'private, no-store',
      ServerSideEncryption: 'AES256',
      Metadata: { call_id: call.id, expires_at: expiresAt.toISOString() },
    }),
  );

  await db.call.update({
    where: { id: call.id },
    data: {
      recordingStatus: 'AVAILABLE',
      recordingProviderId: data.recordingId,
      recordingStorageKey: storageKey,
      recordingContentType: contentType,
      recordingSizeBytes: bytes.byteLength,
      recordingStartedAt: data.startedAt ? new Date(data.startedAt) : undefined,
      recordingEndedAt: data.endedAt ? new Date(data.endedAt) : undefined,
      recordingExpiresAt: expiresAt,
      recordingError: null,
    },
  });
}

/**
 * Filet de sécurité si Telnyx ne livre pas le webhook `call.recording.saved`.
 * La lecture est limitée à l'appel en attente : aucun enregistrement hors
 * allowlist ne peut être créé car seuls les appels PENDING y arrivent.
 */
export async function recoverPendingRecording(data: RecoverRecordingJobData): Promise<void> {
  if (!isCallRecordingEnabled()) return;

  const call = await db.call.findUnique({
    where: { callSid: data.callLegId },
    select: { recordingStatus: true },
  });
  if (!call || call.recordingStatus !== 'PENDING') return;

  const apiKey = process.env.TELNYX_API_KEY;
  if (!apiKey) throw new Error('TELNYX_API_KEY not configured');

  const url = new URL(`${process.env.TELNYX_API_URL ?? 'https://api.telnyx.com'}/v2/recordings`);
  url.searchParams.set('filter[call_leg_id]', data.callLegId);
  url.searchParams.set('page[size]', '10');
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${apiKey}` },
    // @ts-expect-error — dispatcher is an undici extension
    dispatcher: telnyxAgent,
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(`Telnyx recordings lookup failed: ${response.status}`);

  const body = (await response.json()) as TelnyxRecordingListResponse;
  const recording = body.data?.find(
    (item) => item.status === 'completed' && item.id && item.download_urls?.mp3,
  );
  if (!recording?.id || !recording.download_urls?.mp3) {
    throw new Error('Telnyx recording is not available yet');
  }

  await storeSavedRecording({
    callLegId: data.callLegId,
    recordingId: recording.id,
    downloadUrl: recording.download_urls.mp3,
    startedAt: recording.recording_started_at,
    endedAt: recording.recording_ended_at,
  });
}

export async function getPrivateRecording(storageKey: string, range?: string) {
  return recordingClient().send(
    new GetObjectCommand({ Bucket: bucket(), Key: storageKey, ...(range ? { Range: range } : {}) }),
  );
}

export async function deletePrivateRecording(storageKey: string): Promise<void> {
  await recordingClient().send(new DeleteObjectCommand({ Bucket: bucket(), Key: storageKey }));
}

export async function purgeExpiredRecordings(): Promise<number> {
  if (!isCallRecordingEnabled()) return 0;

  let deleted = 0;
  while (true) {
    const expired = await db.call.findMany({
      where: { recordingStatus: 'AVAILABLE', recordingExpiresAt: { lte: new Date() } },
      select: { id: true, recordingStorageKey: true },
      take: 100,
    });

    for (const call of expired) {
      if (call.recordingStorageKey) await deletePrivateRecording(call.recordingStorageKey);
      await db.call.update({
        where: { id: call.id },
        data: {
          recordingStatus: 'DELETED',
          recordingStorageKey: null,
          recordingError: null,
        },
      });
      deleted++;
    }

    if (expired.length < 100) break;
  }

  logger.info({ deleted }, 'Expired call recordings purged');
  return deleted;
}
