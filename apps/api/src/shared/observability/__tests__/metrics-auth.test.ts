import { afterEach, describe, expect, it, vi } from 'vitest';
import { checkMetricsAuth, normalizeRemoteAddress } from '../metrics-auth';

describe('normalizeRemoteAddress', () => {
  it('déballe les adresses IPv4 mappées en IPv6', () => {
    expect(normalizeRemoteAddress('::ffff:127.0.0.1')).toBe('127.0.0.1');
    expect(normalizeRemoteAddress('127.0.0.1')).toBe('127.0.0.1');
    expect(normalizeRemoteAddress('::1')).toBe('::1');
    expect(normalizeRemoteAddress(undefined)).toBe('');
  });
});

describe('checkMetricsAuth — mode allowlist', () => {
  it('autorise la loopback et refuse le reste', () => {
    expect(checkMetricsAuth({ remoteAddress: '127.0.0.1' })).toEqual({ ok: true });
    expect(checkMetricsAuth({ remoteAddress: '::ffff:127.0.0.1' })).toEqual({ ok: true });
    expect(checkMetricsAuth({ remoteAddress: '::1' })).toEqual({ ok: true });
    expect(checkMetricsAuth({ remoteAddress: '203.0.113.9' })).toEqual({ ok: false, status: 403 });
    expect(checkMetricsAuth({})).toEqual({ ok: false, status: 403 });
  });
});

describe('checkMetricsAuth — mode auth basique', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  async function loadGuard() {
    vi.stubEnv('METRICS_BASIC_AUTH_USER', 'prometheus');
    vi.stubEnv('METRICS_BASIC_AUTH_PASSWORD', 's3cret-value');
    vi.resetModules();
    return import('../metrics-auth');
  }

  it('exige un en-tête Basic valide, même depuis la loopback', async () => {
    const guard = await loadGuard();
    const header = `Basic ${Buffer.from('prometheus:s3cret-value').toString('base64')}`;

    expect(guard.checkMetricsAuth({ authorization: header, remoteAddress: '127.0.0.1' })).toEqual({
      ok: true,
    });
    expect(guard.checkMetricsAuth({ remoteAddress: '127.0.0.1' })).toEqual({
      ok: false,
      status: 401,
    });
    expect(
      guard.checkMetricsAuth({
        authorization: `Basic ${Buffer.from('prometheus:wrong').toString('base64')}`,
        remoteAddress: '127.0.0.1',
      }),
    ).toEqual({ ok: false, status: 401 });
  });

  it('refuse un en-tête non Basic', async () => {
    const guard = await loadGuard();
    expect(
      guard.checkMetricsAuth({ authorization: 'Bearer abc', remoteAddress: '127.0.0.1' }),
    ).toEqual({ ok: false, status: 401 });
  });
});
