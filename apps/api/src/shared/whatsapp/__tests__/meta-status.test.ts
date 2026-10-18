import { afterEach, describe, expect, it, vi } from 'vitest';
import { lookupMetaStatus, storeMetaStatus, type MetaStatusStore } from '../meta-status';

describe('Meta receipt reconciliation', () => {
  afterEach(() => vi.unstubAllEnvs());
  function store() {
    const data = new Map<string, string>();
    const expires = vi.fn();
    const client: MetaStatusStore = {
      get: async (key) => data.get(key) ?? null,
      eval: async (_script, _keys, key, rank, ttl) => {
        if (Number(rank) > Number(data.get(String(key)) ?? 0)) {
          data.set(String(key), String(rank));
          expires(ttl);
        }
        return 1;
      },
    };
    vi.stubEnv('META_WHATSAPP_WEBHOOK_ENABLED', 'true');
    vi.stubEnv('META_WHATSAPP_PHONE_NUMBER_ID', '123');
    return { client, expires };
  }

  it('does not turn absent receipts or delivery failures into permission to retry', async () => {
    const { client } = store();
    expect(await lookupMetaStatus(client, 'message')).toBe('unknown');
    await storeMetaStatus(client, '123', 'message', 'failed');
    expect(await lookupMetaStatus(client, 'message')).toBe('unknown');
  });

  it('keeps delivery/read proof despite duplicate and delayed failure/sent events', async () => {
    const { client, expires } = store();
    for (const status of ['delivered', 'delivered', 'failed', 'sent', 'read', 'failed'] as const) {
      await storeMetaStatus(client, '123', 'message', status);
    }
    expect(await lookupMetaStatus(client, 'message')).toBe('success');
    expect(expires).toHaveBeenCalledTimes(2);
    expect(expires).toHaveBeenCalledWith(604800);
  });

  it('isolates message IDs by sender and ignores receipts while disabled', async () => {
    const { client } = store();
    await storeMetaStatus(client, '999', 'message', 'read');
    expect(await lookupMetaStatus(client, 'message')).toBe('unknown');
    await storeMetaStatus(client, '123', 'message', 'sent');
    expect(await lookupMetaStatus(client, 'message')).toBe('success');
    vi.stubEnv('META_WHATSAPP_WEBHOOK_ENABLED', 'false');
    expect(await lookupMetaStatus(client, 'message')).toBe('unknown');
  });
});
