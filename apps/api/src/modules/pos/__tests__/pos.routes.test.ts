import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { closeApp, getApp } from '../../../test/helpers';
import { db } from '../../../shared/db/client';

const AUTH = { authorization: 'Bearer test' };

describe('POS foundation routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('POS_CONNECTORS_ENABLED', 'false');
    vi.mocked(db.restaurant.findUnique).mockResolvedValue({ plan: 'PRO' } as never);
  });

  afterAll(async () => {
    vi.unstubAllEnvs();
    await closeApp();
  });

  it('keeps the provider-neutral routes disabled by default', async () => {
    const app = await getApp();
    const response = await app.inject({ method: 'GET', url: '/pos/connections', headers: AUTH });

    expect(response.statusCode).toBe(503);
    expect(response.json()).toMatchObject({ error: 'POS_CONNECTORS_DISABLED' });
  });

  it('enforces the Pro capability before the runtime flag', async () => {
    vi.mocked(db.restaurant.findUnique).mockResolvedValue({ plan: 'STARTER' } as never);
    vi.stubEnv('POS_CONNECTORS_ENABLED', 'true');
    const app = await getApp();
    const response = await app.inject({ method: 'GET', url: '/pos/connections', headers: AUTH });

    expect(response.statusCode).toBe(403);
    expect(response.json().error).toBe('CAPABILITY_NOT_INCLUDED');
  });

  it('creates a sanitized pending connection when explicitly enabled', async () => {
    vi.stubEnv('POS_CONNECTORS_ENABLED', 'true');
    vi.mocked(db.posConnection.findUnique).mockResolvedValue(null);
    vi.mocked(db.posConnection.create).mockResolvedValue({
      id: 'connection-1',
      provider: 'lightspeed',
      externalLocationId: 'location-1',
      credentialReference: 'vault://pos/lightspeed/location-1',
      status: 'PENDING',
      cursor: null,
      lastSuccessAt: null,
      lastAttemptAt: null,
      lastErrorCode: null,
    } as never);

    const app = await getApp();
    const response = await app.inject({
      method: 'POST',
      url: '/pos/connections',
      headers: AUTH,
      payload: {
        provider: 'LightSpeed',
        externalLocationId: 'location-1',
        credentialReference: 'vault://pos/lightspeed/location-1',
      },
    });

    expect(response.statusCode).toBe(201);
    expect(response.json()).toEqual({
      data: {
        id: 'connection-1',
        provider: 'lightspeed',
        externalLocationId: 'location-1',
        status: 'PENDING',
        hasCredentialReference: true,
        cursorPresent: false,
        lastSuccessAt: null,
        lastAttemptAt: null,
        lastErrorCode: null,
      },
    });
    expect(JSON.stringify(response.json())).not.toContain('vault://');
  });

  it('supports a dry-run import without writing checks', async () => {
    vi.stubEnv('POS_CONNECTORS_ENABLED', 'true');
    vi.mocked(db.posConnection.findFirst).mockResolvedValue({
      id: 'connection-1',
      status: 'PENDING',
    } as never);
    const app = await getApp();
    const response = await app.inject({
      method: 'POST',
      url: '/pos/connections/connection-1/checks/import',
      headers: AUTH,
      payload: {
        checks: [
          {
            externalId: 'ticket-1',
            openedAt: '2026-09-14T19:00:00.000Z',
            subtotal: '10.00',
            tax: '2.00',
            total: '12.00',
          },
        ],
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().data).toMatchObject({ dryRun: true, processedCount: 1 });
    expect(db.posCheck.upsert).not.toHaveBeenCalled();
  });

  it('rejects pasted provider tokens as credential references', async () => {
    vi.stubEnv('POS_CONNECTORS_ENABLED', 'true');
    vi.mocked(db.posConnection.findUnique).mockResolvedValue(null);
    const app = await getApp();
    const response = await app.inject({
      method: 'POST',
      url: '/pos/connections',
      headers: AUTH,
      payload: {
        provider: 'lightspeed',
        externalLocationId: 'location-1',
        credentialReference: ['sk', 'live', 'fixture'].join('_'),
      },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error).toBe('POS_CREDENTIAL_REFERENCE_INVALID');
    expect(db.posConnection.create).not.toHaveBeenCalled();
  });
});
