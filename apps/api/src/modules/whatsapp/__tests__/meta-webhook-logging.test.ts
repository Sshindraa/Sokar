import { randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { closeApp, getApp } from '../../../test/helpers';

describe('Meta webhook request logger', () => {
  afterEach(async () => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    await closeApp();
  });
  it('honors the silent route option through the production child logger factory', async () => {
    const token = randomUUID();
    vi.stubEnv('META_WHATSAPP_WEBHOOK_ENABLED', 'true');
    vi.stubEnv('META_WHATSAPP_VERIFY_TOKEN', token);
    const app = await getApp();
    const child = vi.spyOn(app.log, 'child');
    const response = await app.inject({
      url: `/webhooks/meta/whatsapp?hub.mode=subscribe&hub.verify_token=${token}&hub.challenge=12345`,
    });
    expect(response.statusCode).toBe(200);
    expect(response.body).toBe('12345');
    expect(child).toHaveBeenCalledWith(
      expect.objectContaining({ request_id: expect.any(String) }),
      expect.objectContaining({ level: 'silent' }),
    );
  });
});
