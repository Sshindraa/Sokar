import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { DistributionConnectionStatus } from '@prisma/client';
import { closeApp, getApp } from '../../../test/helpers';
import { db } from '../../../shared/db/client';

const AUTH = { authorization: 'Bearer test' };
const NOW = new Date('2026-09-14T10:00:00.000Z');

function connectionRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'connection-1',
    provider: 'GOOGLE_RESERVE',
    externalAccountHash: 'a'.repeat(64),
    externalAccountLast4: '1234',
    credentialRef: 'vault/distribution/google',
    configHash: 'b'.repeat(64),
    status: DistributionConnectionStatus.PENDING,
    cursor: null,
    lastSyncAt: null,
    lastErrorCode: null,
    connectedAt: null,
    disconnectedAt: null,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

describe('distribution routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('DISTRIBUTION_ENABLED', 'false');
    vi.mocked(db.restaurant.findUnique).mockResolvedValue({
      id: 'test-rest-1',
      plan: 'PRO',
      siteStatus: 'ACTIVE',
    } as never);
    vi.mocked(db.restaurant.findFirst).mockResolvedValue({ id: 'test-rest-1' } as never);
  });

  afterAll(async () => {
    vi.unstubAllEnvs();
    await closeApp();
  });

  it('keeps partner channels disabled during the production freeze', async () => {
    const app = await getApp();
    const response = await app.inject({
      method: 'GET',
      url: '/distribution/connections',
      headers: AUTH,
    });
    expect(response.statusCode).toBe(503);
    expect(response.json()).toMatchObject({ error: 'DISTRIBUTION_DISABLED' });
    expect(db.distributionConnection.findMany).not.toHaveBeenCalled();
  });

  it('checks the Pro entitlement before allowing an enabled channel', async () => {
    vi.stubEnv('DISTRIBUTION_ENABLED', 'true');
    vi.mocked(db.restaurant.findUnique).mockResolvedValue({
      id: 'test-rest-1',
      plan: 'ESSENTIAL',
      siteStatus: 'ACTIVE',
    } as never);
    const app = await getApp();
    const response = await app.inject({
      method: 'GET',
      url: '/distribution/connections',
      headers: AUTH,
    });
    expect(response.statusCode).toBe(403);
    expect(response.json()).toMatchObject({
      error: 'CAPABILITY_NOT_INCLUDED',
      capability: 'distribution.manage',
    });
  });

  it('allows managers to create a provider-neutral connection without exposing secrets', async () => {
    vi.stubEnv('DISTRIBUTION_ENABLED', 'true');
    vi.mocked(db.distributionConnection.findUnique).mockResolvedValue(null);
    vi.mocked(db.distributionConnection.create).mockResolvedValue(connectionRow() as never);
    const app = await getApp();
    const response = await app.inject({
      method: 'POST',
      url: '/distribution/connections',
      headers: { ...AUTH, 'x-test-site-role': 'MANAGER' },
      payload: {
        provider: 'GOOGLE_RESERVE',
        externalAccountId: 'location-1234',
        credentialReference: 'vault/distribution/google',
        configFingerprint: { mode: 'dry-run' },
      },
    });
    expect(response.statusCode).toBe(201);
    expect(response.json().data).toMatchObject({
      provider: 'GOOGLE_RESERVE',
      externalAccountLast4: '1234',
      credentialReferencePresent: true,
    });
    expect(JSON.stringify(response.json())).not.toContain('location-1234');
    expect(JSON.stringify(response.json())).not.toContain('vault/distribution/google');
  });

  it('keeps connection writes manager-only while staff can read', async () => {
    vi.stubEnv('DISTRIBUTION_ENABLED', 'true');
    vi.mocked(db.distributionConnection.findMany).mockResolvedValue([connectionRow()] as never);
    const app = await getApp();
    const read = await app.inject({
      method: 'GET',
      url: '/distribution/connections',
      headers: { ...AUTH, 'x-test-site-role': 'STAFF' },
    });
    expect(read.statusCode).toBe(200);
    expect(read.json().data[0]).toMatchObject({ id: 'connection-1' });

    const write = await app.inject({
      method: 'POST',
      url: '/distribution/connections',
      headers: { ...AUTH, 'x-test-site-role': 'STAFF' },
      payload: { provider: 'PUBLIC_API' },
    });
    expect(write.statusCode).toBe(403);
    expect(write.json()).toMatchObject({ error: 'DISTRIBUTION_ROLE_REQUIRED' });
  });

  it('requires an idempotency key for sync runs and validates payloads', async () => {
    vi.stubEnv('DISTRIBUTION_ENABLED', 'true');
    vi.mocked(db.distributionConnection.findFirst).mockResolvedValue(connectionRow() as never);
    const app = await getApp();
    const missingKey = await app.inject({
      method: 'POST',
      url: '/distribution/connections/connection-1/sync-runs',
      headers: AUTH,
      payload: { direction: 'PUSH' },
    });
    expect(missingKey.statusCode).toBe(400);
    expect(missingKey.json()).toMatchObject({ error: 'DISTRIBUTION_IDEMPOTENCY_INVALID' });

    const invalidBody = await app.inject({
      method: 'POST',
      url: '/distribution/connections/connection-1/sync-runs',
      headers: { ...AUTH, 'idempotency-key': 'sync-0001' },
      payload: { direction: 'INVALID' },
    });
    expect(invalidBody.statusCode).toBe(400);
  });
});
