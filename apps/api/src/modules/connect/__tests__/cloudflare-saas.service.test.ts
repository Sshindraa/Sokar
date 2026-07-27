import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock fetch globally
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

// Mock logger
vi.mock('../../../shared/logger/pino', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

// Mock child_process for verifyCname
vi.mock('node:child_process', () => ({
  execSync: vi.fn(),
}));

import { execSync } from 'node:child_process';
import {
  createCustomHostname,
  getCustomHostname,
  deleteCustomHostname,
  verifyCname,
  isCloudflareSaaSEnabled,
  mapStatus,
} from '../cloudflare-saas.service';

describe('cloudflare-saas.service', () => {
  beforeEach(() => {
    vi.resetModules();
    mockFetch.mockReset();
    vi.mocked(execSync).mockReset();
    // Set env vars for most tests (values are fake test fixtures, not real secrets)
    process.env.CLOUDFLARE_API_TOKEN = 'cf-test';
    process.env.CLOUDFLARE_ZONE_ID = 'zone-test';
    process.env.CLOUDFLARE_SAAS_FALLBACK_ORIGIN = 'sokar.tech';
  });

  afterEach(() => {
    delete process.env.CLOUDFLARE_API_TOKEN;
    delete process.env.CLOUDFLARE_ZONE_ID;
    delete process.env.CLOUDFLARE_SAAS_FALLBACK_ORIGIN;
  });

  describe('isCloudflareSaaSEnabled', () => {
    it('returns true when env vars are set', () => {
      expect(isCloudflareSaaSEnabled()).toBe(true);
    });

    it('returns false when API token is missing', () => {
      delete process.env.CLOUDFLARE_API_TOKEN;
      expect(isCloudflareSaaSEnabled()).toBe(false);
    });

    it('returns false when zone ID is missing', () => {
      delete process.env.CLOUDFLARE_ZONE_ID;
      expect(isCloudflareSaaSEnabled()).toBe(false);
    });
  });

  describe('createCustomHostname', () => {
    it('creates a custom hostname and returns pending status', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          success: true,
          errors: [],
          result: {
            id: 'cf-id-123',
            hostname: 'reserve.chezmario.fr',
            status: 'pending',
            ssl: { status: 'pending_validation' },
          },
        }),
      });

      const result = await createCustomHostname('reserve.chezmario.fr');

      expect(result.id).toBe('cf-id-123');
      expect(result.hostname).toBe('reserve.chezmario.fr');
      expect(result.status).toBe('dns_validated');
      expect(result.sslStatus).toBe('pending_validation');
      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.cloudflare.com/client/v4/zones/zone-test/custom_hostnames',
        expect.objectContaining({ method: 'POST' }),
      );
    });

    it('returns active status when CF + SSL are active', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          success: true,
          errors: [],
          result: {
            id: 'cf-id-123',
            hostname: 'reserve.chezmario.fr',
            status: 'active',
            ssl: { status: 'active' },
          },
        }),
      });

      const result = await createCustomHostname('reserve.chezmario.fr');
      expect(result.status).toBe('active');
    });

    it('throws on API error', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        json: async () => ({
          success: false,
          errors: [{ message: 'Invalid hostname' }],
          result: null,
        }),
      });

      await expect(createCustomHostname('invalid')).rejects.toThrow(
        'Cloudflare API error: Invalid hostname',
      );
    });

    it('throws when Cloudflare is not configured', async () => {
      delete process.env.CLOUDFLARE_API_TOKEN;
      await expect(createCustomHostname('test.fr')).rejects.toThrow(
        'Cloudflare for SaaS is not configured',
      );
    });
  });

  describe('getCustomHostname', () => {
    it('fetches the status of an existing custom hostname', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          success: true,
          errors: [],
          result: {
            id: 'cf-id-123',
            hostname: 'reserve.chezmario.fr',
            status: 'active',
            ssl: { status: 'active' },
          },
        }),
      });

      const result = await getCustomHostname('cf-id-123');
      expect(result.status).toBe('active');
      expect(result.id).toBe('cf-id-123');
    });
  });

  describe('deleteCustomHostname', () => {
    it('deletes a custom hostname', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true, errors: [], result: null }),
      });

      await expect(deleteCustomHostname('cf-id-123')).resolves.not.toThrow();
    });
  });

  describe('verifyCname', () => {
    it('returns valid when CNAME points to sokar.tech', async () => {
      vi.mocked(execSync).mockReturnValue('sokar.tech.\n');

      const result = await verifyCname('reserve.chezmario.fr');

      expect(result.valid).toBe(true);
      expect(result.target).toBe('sokar.tech');
      expect(result.message).toContain('correctement configuré');
    });

    it('returns valid when CNAME points to a subdomain of sokar.tech', async () => {
      vi.mocked(execSync).mockReturnValue('sokar.tech.\n');

      const result = await verifyCname('reserve.chezmario.fr');

      expect(result.valid).toBe(true);
    });

    it('returns invalid when CNAME points elsewhere', async () => {
      vi.mocked(execSync).mockReturnValue('other-domain.com.\n');

      const result = await verifyCname('reserve.chezmario.fr');

      expect(result.valid).toBe(false);
      expect(result.target).toBe('other-domain.com');
      expect(result.message).toContain('other-domain.com');
    });

    it('returns invalid when no DNS record found', async () => {
      vi.mocked(execSync).mockReturnValue('');

      // Also mock A record lookup (second call)
      vi.mocked(execSync)
        .mockReturnValueOnce('') // CNAME
        .mockReturnValueOnce(''); // A

      const result = await verifyCname('reserve.chezmario.fr');

      expect(result.valid).toBe(false);
      expect(result.target).toBeNull();
      expect(result.message).toContain('Aucun enregistrement DNS');
    });

    it('returns invalid with IP message when A record found', async () => {
      vi.mocked(execSync)
        .mockReturnValueOnce('') // CNAME empty
        .mockReturnValueOnce('1.2.3.4\n'); // A record

      const result = await verifyCname('reserve.chezmario.fr');

      expect(result.valid).toBe(false);
      expect(result.message).toContain('adresse IP');
    });

    it('handles dig errors gracefully', async () => {
      vi.mocked(execSync).mockImplementation(() => {
        throw new Error('dig command not found');
      });

      const result = await verifyCname('reserve.chezmario.fr');

      expect(result.valid).toBe(false);
      expect(result.message).toContain('Impossible de vérifier');
    });
  });
});
