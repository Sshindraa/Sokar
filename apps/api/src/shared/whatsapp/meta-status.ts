import { createHash } from 'node:crypto';
import type { NotificationProviderResult } from '../queue/notification-idempotency';

export type MetaDeliveryStatus = 'sent' | 'failed' | 'delivered' | 'read';
export interface MetaStatusStore {
  eval: (script: string, numberOfKeys: number, ...args: (string | number)[]) => Promise<unknown>;
  get(key: string): Promise<string | null>;
}

const RANK: Record<MetaDeliveryStatus, number> = { sent: 1, failed: 2, delivered: 3, read: 4 };
const TTL = 7 * 24 * 60 * 60;
// A delayed failure must never erase a delivery/read receipt. Duplicates do not extend retention.
const STORE_STATUS = `
local current = tonumber(redis.call('GET', KEYS[1]) or '0')
local incoming = tonumber(ARGV[1])
if incoming > current then
  redis.call('SET', KEYS[1], ARGV[1], 'EX', ARGV[2])
end
return 1
`;

function statusKey(phoneId: string, messageId: string): string {
  const digest = createHash('sha256').update(`${phoneId}:${messageId}`).digest('hex');
  return `whatsapp:meta:status:${digest}`;
}

export async function readMetaDeliveryStatus(
  store: MetaStatusStore,
  phoneId: string,
  messageId: string,
): Promise<MetaDeliveryStatus | undefined> {
  const rank = await store.get(statusKey(phoneId, messageId));
  return ({ '1': 'sent', '2': 'failed', '3': 'delivered', '4': 'read' } as const)[
    rank as '1' | '2' | '3' | '4'
  ];
}

export async function storeMetaStatus(
  store: MetaStatusStore,
  phoneId: string,
  messageId: string,
  status: MetaDeliveryStatus,
): Promise<void> {
  await store.eval(STORE_STATUS, 1, statusKey(phoneId, messageId), RANK[status], TTL);
}

export async function lookupMetaStatus(
  store: MetaStatusStore,
  messageId: string,
): Promise<NotificationProviderResult> {
  const phoneId = process.env.META_WHATSAPP_PHONE_NUMBER_ID;
  if (!phoneId || process.env.META_WHATSAPP_WEBHOOK_ENABLED !== 'true') return 'unknown';
  const rank = await store.get(statusKey(phoneId, messageId));
  // Delivery failure is not a certain send refusal: keep the claim for manual review, never retry.
  return rank === '1' || rank === '3' || rank === '4' ? 'success' : 'unknown';
}
