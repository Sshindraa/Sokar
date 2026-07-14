import type { PrismaClient } from '@prisma/client';
import type Redis from 'ioredis';
import { describe, expect, it, beforeEach, vi } from 'vitest';
import {
  IdentityVerificationService,
  IdentityVerificationError,
} from '../identity-verification.service';

// Mocks Telnyx et Brevo
vi.mock('../../../shared/telnyx/client', () => ({
  sendSms: vi.fn().mockResolvedValue(undefined),
  default: {},
}));
vi.mock('../../../shared/email', () => ({
  sendEmail: vi.fn().mockResolvedValue(undefined),
}));

// Mock Redis in-memory (Map-based, supporte incr/expire)
function makeMockRedis() {
  const store = new Map<string, { value: number; expireAt?: number }>();
  return {
    incr: vi.fn(async (key: string) => {
      const entry = store.get(key);
      if (!entry) {
        store.set(key, { value: 1 });
        return 1;
      }
      entry.value += 1;
      return entry.value;
    }),
    expire: vi.fn(async (key: string, sec: number) => {
      const entry = store.get(key);
      if (entry) entry.expireAt = Date.now() + sec * 1000;
    }),
    get: vi.fn(async (key: string) => store.get(key)?.value.toString() ?? null),
    del: vi.fn(async (key: string) => store.delete(key)),
    store, // exposed for tests
  } as unknown as Redis & { store: Map<string, { value: number; expireAt?: number }> };
}

function makeMockPrisma() {
  const otpStore = new Map<string, Record<string, unknown>>();
  const signedTokenStore = new Map<string, Record<string, unknown>>();
  return {
    identityVerificationOtp: {
      upsert: vi.fn(async ({ where, create, update }) => {
        const key = `${where.subject_intent.subject}|${where.subject_intent.intent}`;
        const existing = otpStore.get(key);
        const merged = { ...(existing || create), ...update, attempts: 0, consumedAt: null };
        otpStore.set(key, merged);
        return merged;
      }),
      findUnique: vi.fn(async ({ where }) => {
        const key = `${where.subject_intent.subject}|${where.subject_intent.intent}`;
        return otpStore.get(key) || null;
      }),
      update: vi.fn(async ({ where, data }) => {
        const entry = otpStore.get(`${where.id}`);
        // We can't easily map id to key here, so we'll use a workaround:
        // Find by id in store
        for (const [k, v] of otpStore.entries()) {
          if (v.id === where.id) {
            Object.assign(v, data);
            otpStore.set(k, v);
            return v;
          }
        }
        return null;
      }),
    },
    signedTokenUsage: {
      create: vi.fn(async ({ data }) => {
        if (signedTokenStore.has(data.jti)) {
          const err = new Error('Unique constraint failed') as Error & { code: string };
          err.code = 'P2002';
          throw err;
        }
        signedTokenStore.set(data.jti, data);
        return data;
      }),
      upsert: vi.fn(async ({ where, create, update }) => {
        const existing = signedTokenStore.get(where.jti);
        const merged = { ...(existing || create), ...update };
        signedTokenStore.set(where.jti, merged);
        return merged;
      }),
      findUnique: vi.fn(async ({ where }) => signedTokenStore.get(where.jti) || null),
    },
  } as unknown as PrismaClient;
}

describe('IdentityVerificationService', () => {
  let prisma: PrismaClient;
  let redis: ReturnType<typeof makeMockRedis>;
  let service: IdentityVerificationService;

  beforeEach(() => {
    vi.clearAllMocks();
    prisma = makeMockPrisma();
    redis = makeMockRedis();
    service = new IdentityVerificationService(prisma, redis);
  });

  describe('requestVerification', () => {
    it("canal SMS par défaut (pas d'email fourni)", async () => {
      const result = await service.requestVerification({
        subject: '+33****0000',
        intent: 'erase',
      });
      expect(result.channel).toBe('sms');
      expect(result.expiresAt).toBeDefined();
    });

    it('canal email si email fourni', async () => {
      const result = await service.requestVerification({
        subject: '+33****0000',
        intent: 'export',
        email: 'user@example.com',
      });
      expect(result.channel).toBe('email');
    });
  });

  describe('confirmVerification (OTP)', () => {
    it('valide un OTP correct et génère un verificationToken', async () => {
      // Request d'abord
      const { sendSms } = await import('../../../shared/telnyx/client');
      await service.requestVerification({ subject: '+33****0001', intent: 'erase' });
      // Le service hash l'OTP, donc on doit le récupérer depuis l'appel à sendSms
      const smsCall = vi.mocked(sendSms).mock.calls[0];
      const otp = smsCall[1].match(/\d{6}/)?.[0];
      expect(otp).toBeDefined();

      // Confirm
      const result = await service.confirmVerification({
        subject: '+33****0001',
        intent: 'erase',
        code: otp,
      });
      expect(result.verificationToken).toBeDefined();
      expect(result.verificationToken.split('.').length).toBe(2);
    });

    it('rejette un OTP incorrect', async () => {
      const { sendSms } = await import('../../../shared/telnyx/client');
      await service.requestVerification({ subject: '+33****0002', intent: 'erase' });
      await expect(
        service.confirmVerification({
          subject: '+33****0002',
          intent: 'erase',
          code: '000000',
        }),
      ).rejects.toThrow(IdentityVerificationError);
    });

    it('incrémente attempts sur OTP incorrect', async () => {
      const { sendSms } = await import('../../../shared/telnyx/client');
      await service.requestVerification({ subject: '+33****0003', intent: 'erase' });
      await expect(
        service.confirmVerification({
          subject: '+33****0003',
          intent: 'erase',
          code: '000000',
        }),
      ).rejects.toThrow();
      // Check attempts incremented
      const record = await prisma.identityVerificationOtp.findUnique({
        where: { subject_intent: { subject: '+33****0003', intent: 'erase' } },
      });
      expect(record?.attempts).toBe(1);
    });

    it('rejette après 5 tentatives (MAX_ATTEMPTS)', async () => {
      const { sendSms } = await import('../../../shared/telnyx/client');
      await service.requestVerification({ subject: '+33****0004', intent: 'erase' });
      for (let i = 0; i < 5; i++) {
        await expect(
          service.confirmVerification({
            subject: '+33****0004',
            intent: 'erase',
            code: '000000',
          }),
        ).rejects.toThrow();
      }
      // 6ème tentative devrait throw MAX_ATTEMPTS
      await expect(
        service.confirmVerification({
          subject: '+33****0004',
          intent: 'erase',
          code: '000000',
        }),
      ).rejects.toThrow(/Too many attempts|MAX_ATTEMPTS/);
    });

    it('rejette si aucun OTP pending (NOT_FOUND)', async () => {
      await expect(
        service.confirmVerification({
          subject: '+33****0099',
          intent: 'erase',
          code: '123456',
        }),
      ).rejects.toThrow(/No verification pending|NOT_FOUND/);
    });
  });

  describe('verifyVerificationToken', () => {
    it('valide un token valide', async () => {
      const { sendSms } = await import('../../../shared/telnyx/client');
      await service.requestVerification({ subject: '+33****0010', intent: 'export' });
      const smsCall = vi.mocked(sendSms).mock.calls[0];
      const otp = smsCall[1].match(/\d{6}/)?.[0];
      const { verificationToken } = await service.confirmVerification({
        subject: '+33****0010',
        intent: 'export',
        code: otp,
      });
      const result = await service.verifyVerificationToken(verificationToken, 'export');
      expect(result.subject).toBe('+33****0010');
    });

    it('rejette un token malformé', async () => {
      await expect(service.verifyVerificationToken('not-a-token', 'export')).rejects.toThrow(
        IdentityVerificationError,
      );
    });

    it('rejette un token avec mauvaise signature', async () => {
      const { sendSms } = await import('../../../shared/telnyx/client');
      await service.requestVerification({ subject: '+33****0011', intent: 'export' });
      const smsCall = vi.mocked(sendSms).mock.calls[0];
      const otp = smsCall[1].match(/\d{6}/)?.[0];
      const { verificationToken } = await service.confirmVerification({
        subject: '+33****0011',
        intent: 'export',
        code: otp,
      });
      // Tamper signature
      const tampered = verificationToken.replace(/[^.]$/, 'X');
      await expect(service.verifyVerificationToken(tampered, 'export')).rejects.toThrow();
    });

    it('rejette un token avec mauvais intent', async () => {
      const { sendSms } = await import('../../../shared/telnyx/client');
      await service.requestVerification({ subject: '+33****0012', intent: 'export' });
      const smsCall = vi.mocked(sendSms).mock.calls[0];
      const otp = smsCall[1].match(/\d{6}/)?.[0];
      const { verificationToken } = await service.confirmVerification({
        subject: '+33****0012',
        intent: 'export',
        code: otp,
      });
      await expect(service.verifyVerificationToken(verificationToken, 'erase')).rejects.toThrow();
    });
  });

  describe('rate-limit (Redis)', () => {
    it('incrémente le compteur à chaque request', async () => {
      await service.requestVerification({ subject: '+33****0050', intent: 'erase' });
      await service.requestVerification({ subject: '+33****0050', intent: 'erase' });
      expect(redis.incr).toHaveBeenCalledTimes(2);
      expect(redis.incr).toHaveBeenCalledWith('rgpd:verify:unknown:+33****0050');
    });

    it('rate-limite par IP + subject', async () => {
      await service.requestVerification({
        subject: '+33****0050',
        intent: 'erase',
        ip: '1.2.3.4',
      });
      expect(redis.incr).toHaveBeenCalledWith('rgpd:verify:1.2.3.4:+33****0050');
    });

    it('rejette la 6ème request avec RATE_LIMITED (max 5/15min)', async () => {
      // Les 5 premières passent
      for (let i = 0; i < 5; i++) {
        await service.requestVerification({ subject: '+33****0051', intent: 'erase' });
      }
      // 6ème doit throw avec code RATE_LIMITED
      await expect(
        service.requestVerification({ subject: '+33****0051', intent: 'erase' }),
      ).rejects.toMatchObject({ code: 'RATE_LIMITED' });
    });

    it('reset le compteur après expiration (TTL)', async () => {
      // On simule l'expiration en clearant le store
      redis.store.clear();
      // Après expiration, une nouvelle request doit passer
      await expect(
        service.requestVerification({ subject: '+33****0052', intent: 'erase' }),
      ).resolves.toBeDefined();
    });
  });

  describe('replay protection (verificationToken one-shot)', () => {
    it("rejette la 2ème utilisation d'un même verificationToken", async () => {
      const { sendSms } = await import('../../../shared/telnyx/client');
      await service.requestVerification({ subject: '+33****0060', intent: 'erase' });
      const smsCall = vi.mocked(sendSms).mock.calls[0];
      const otp = smsCall[1].match(/\d{6}/)?.[0];
      const { verificationToken } = await service.confirmVerification({
        subject: '+33****0060',
        intent: 'erase',
        code: otp,
      });
      // 1ère utilisation : OK
      await expect(service.verifyVerificationToken(verificationToken, 'erase')).resolves.toEqual({
        subject: '+33****0060',
      });
      // 2ème utilisation (replay) : doit throw EXPIRED
      await expect(
        service.verifyVerificationToken(verificationToken, 'erase'),
      ).rejects.toMatchObject({ code: 'EXPIRED' });
    });

    it('verificationTokens distincts pour 2 users différents', async () => {
      const { sendSms } = await import('../../../shared/telnyx/client');
      await service.requestVerification({ subject: '+33****0061', intent: 'erase' });
      const otp1 = vi.mocked(sendSms).mock.calls[0][1].match(/\d{6}/)?.[0];
      const { verificationToken: token1 } = await service.confirmVerification({
        subject: '+33****0061',
        intent: 'erase',
        code: otp1,
      });
      await service.requestVerification({ subject: '+33****0062', intent: 'erase' });
      const otp2 = vi.mocked(sendSms).mock.calls[1][1].match(/\d{6}/)?.[0];
      const { verificationToken: token2 } = await service.confirmVerification({
        subject: '+33****0062',
        intent: 'erase',
        code: otp2,
      });
      expect(token1).not.toBe(token2);
      // Les 2 sont indépendamment valides
      await expect(service.verifyVerificationToken(token1, 'erase')).resolves.toEqual({
        subject: '+33****0061',
      });
      await expect(service.verifyVerificationToken(token2, 'erase')).resolves.toEqual({
        subject: '+33****0062',
      });
    });
  });

  describe('email link flow (canal email)', () => {
    it('envoie un email avec un lien contenant le token signé', async () => {
      const { sendEmail } = await import('../../../shared/email');
      await service.requestVerification({
        subject: '+33****0070',
        intent: 'export',
        email: 'user@example.com',
      });
      expect(sendEmail).toHaveBeenCalledTimes(1);
      const [opts] = vi.mocked(sendEmail).mock.calls[0];
      expect(opts.to).toBe('user@example.com');
      expect(opts.html).toContain('/api/rgpd/confirm-link?token=');
      // Le token est dans le body
      const tokenMatch = opts.html.match(/token=([^"<&]+)/);
      expect(tokenMatch).toBeDefined();
    });

    it('confirm-link valide le token, vérifie le subject, et renvoie un verificationToken', async () => {
      const { sendEmail } = await import('../../../shared/email');
      await service.requestVerification({
        subject: '+33****0071',
        intent: 'export',
        email: 'user@example.com',
      });
      const [opts] = vi.mocked(sendEmail).mock.calls[0];
      const tokenMatch = opts.html.match(/token=([^"<&]+)/);
      const signedToken = decodeURIComponent(tokenMatch![1]);

      // Le subject est dans le token, pas dans l'URL
      const payload = await (
        service as unknown as {
          verifySignedToken: (token: string) => Promise<{ sub: string; intent: string }>;
        }
      ).verifySignedToken(signedToken);
      expect(payload.sub).toBe('+33****0071');
      expect(payload.intent).toBe('export');

      // Génère un verificationToken one-shot
      const verificationToken = await service.generateVerificationToken(
        payload.sub,
        payload.intent,
      );
      expect(verificationToken).toBeDefined();
    });

    it('confirm-link refuse un token déjà consommé (replay)', async () => {
      const { sendEmail } = await import('../../../shared/email');
      await service.requestVerification({
        subject: '+33****0072',
        intent: 'export',
        email: 'user@example.com',
      });
      const [opts] = vi.mocked(sendEmail).mock.calls[0];
      const tokenMatch = opts.html.match(/token=([^"<&]+)/);
      const signedToken = decodeURIComponent(tokenMatch![1]);

      // 1ère confirmation : OK
      const result1 = await service.confirmVerification({
        subject: '+33****0072',
        intent: 'export',
        token: signedToken,
      });
      expect(result1.verificationToken).toBeDefined();

      // 2ème confirmation du MÊME token signé : doit throw EXPIRED
      await expect(
        service.confirmVerification({
          subject: '+33****0072',
          intent: 'export',
          token: signedToken,
        }),
      ).rejects.toMatchObject({ code: 'EXPIRED' });
    });
  });
});
