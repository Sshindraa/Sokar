/**
 * Identity verification for RGPD requests: a one-time SMS code proves control
 * of the phone number before an action token is issued. Legacy email links
 * are refused because their destination was not bound to the subject.
 */

import type { PrismaClient } from '@prisma/client';
import crypto from 'crypto';
import type Redis from 'ioredis';
import { logger } from '../../shared/logger/pino';
import { sendSms } from '../../shared/telnyx/client';
import { env } from '../../env';

const TURNSTILE_VERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

const OTP_LENGTH = 6;
const OTP_TTL_MINUTES = 10;
const OTP_MAX_ATTEMPTS = 5;

const RATE_LIMIT_WINDOW_MIN = 15;
const RATE_LIMIT_MAX_REQUESTS = 5;

export type VerificationChannel = 'sms' | 'email';

export type RequestVerificationInput = {
  subject: string; // téléphone à vérifier
  intent: 'erase' | 'export';
  email?: string; // accepté pour compatibilité ; la preuve reste un SMS
  ip?: string; // IP client pour le rate-limit (SEC-009)
  captchaToken?: string; // Captcha Cloudflare Turnstile (optionnel, validé si configuré)
};

export type RequestVerificationResult = {
  channel: VerificationChannel;
  // On NE retourne PAS l'OTP ni le token ici — ils sont envoyés au user.
  expiresAt: string;
  rateLimitRemaining: number;
  captchaRequired: boolean; // indique si le captcha est activé sur le serveur
};

export type ConfirmVerificationInput = {
  subject: string;
  intent: 'erase' | 'export';
  code?: string; // OTP SMS
  token?: string; // token signé pour email
};

type VerificationTokenPayload = {
  sub: string;
  intent: string;
  jti: string;
  exp: number;
};

export class IdentityVerificationError extends Error {
  constructor(
    public code:
      | 'EXPIRED'
      | 'INVALID_CAPTCHA'
      | 'INVALID_CODE'
      | 'MAX_ATTEMPTS'
      | 'NOT_FOUND'
      | 'RATE_LIMITED',
    message: string,
  ) {
    super(message);
    this.name = 'IdentityVerificationError';
  }
}

export class IdentityVerificationService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly redis: Redis, // OBLIGATOIRE (rate-limit runtime)
  ) {}

  /**
   * Initie une vérification d'identité.
   * Choisit le canal (SMS ou email) et envoie le code/lien.
   */
  async requestVerification(input: RequestVerificationInput): Promise<RequestVerificationResult> {
    verificationSecret();
    // 0. Captcha (optionnel, validé seulement si TURNSTILE_SECRET_KEY est configuré)
    const captchaRequired = this.isCaptchaRequired();
    if (captchaRequired) {
      await this.verifyTurnstileToken(input.captchaToken);
    }

    // 1. Rate-limit check (par IP + subject, SEC-009)
    const rateLimitRemaining = await this.checkRateLimit(input.subject, input.ip, input.intent);

    // 2. Choisir le canal
    const channel: VerificationChannel = 'sms';
    const destination = input.subject;

    // 3. Générer et stocker
    const expiresAt = new Date(Date.now() + OTP_TTL_MINUTES * 60 * 1000);
    const otp = generateOtp(OTP_LENGTH);
    const otpHash = hashOtp(otp);

    // Upsert : on remplace tout OTP existant pour le même (subject, intent)
    // (un user ne devrait pas avoir 50 OTP actifs en parallèle)
    await this.prisma.identityVerificationOtp.upsert({
      where: {
        subject_intent: { subject: input.subject, intent: input.intent },
      },
      create: {
        subject: input.subject,
        intent: input.intent,
        otpHash,
        channel,
        destination,
        attempts: 0,
        expiresAt,
      },
      update: {
        otpHash,
        channel,
        destination,
        attempts: 0,
        expiresAt,
        consumedAt: null,
      },
    });

    // 4. Envoyer
    await this.sendOtpSms(destination, otp, input.intent);

    return {
      channel,
      expiresAt: expiresAt.toISOString(),
      rateLimitRemaining,
      captchaRequired,
    };
  }

  /**
   * Confirme une vérification (code OTP ou token signé).
   * Renvoie `true` si valide, throw IdentityVerificationError sinon.
   *
   * Effet de bord : l'OTP est marqué consumedAt, le token est marqué used.
   * Après confirmation, l'appelant peut appeler /erase ou /export avec un
   * `verificationToken` (one-shot, expire dans 10 min) pour prouver l'identité.
   */
  async confirmVerification(
    input: ConfirmVerificationInput,
  ): Promise<{ verificationToken: string }> {
    if (input.code) {
      return this.confirmOtp(input);
    }
    if (input.token) {
      throw new IdentityVerificationError('INVALID_CODE', 'SMS verification required');
    }
    throw new IdentityVerificationError('INVALID_CODE', 'Either code or token is required');
  }

  // ─── OTP SMS ──────────────────────────────────────────────

  private async confirmOtp(
    input: ConfirmVerificationInput,
  ): Promise<{ verificationToken: string }> {
    const record = await this.prisma.identityVerificationOtp.findUnique({
      where: { subject_intent: { subject: input.subject, intent: input.intent } },
    });
    if (!record) {
      throw new IdentityVerificationError('NOT_FOUND', 'No verification pending for this subject');
    }
    if (record.consumedAt) {
      throw new IdentityVerificationError('EXPIRED', 'Code already consumed');
    }
    if (record.expiresAt < new Date()) {
      throw new IdentityVerificationError('EXPIRED', 'Code expired');
    }
    if (record.attempts >= OTP_MAX_ATTEMPTS) {
      throw new IdentityVerificationError('MAX_ATTEMPTS', 'Too many attempts');
    }

    const inputHash = hashOtp(input.code!);
    if (inputHash !== record.otpHash) {
      // Incrémente attempts
      await this.prisma.identityVerificationOtp.updateMany({
        where: {
          id: record.id,
          otpHash: record.otpHash,
          consumedAt: null,
          attempts: { lt: OTP_MAX_ATTEMPTS },
          expiresAt: { gt: new Date() },
        },
        data: { attempts: { increment: 1 } },
      });
      throw new IdentityVerificationError('INVALID_CODE', 'Invalid code');
    }

    // OK : consomme et génère un verificationToken one-shot
    const consumed = await this.prisma.identityVerificationOtp.updateMany({
      where: {
        id: record.id,
        otpHash: inputHash,
        channel: 'sms',
        consumedAt: null,
        attempts: { lt: OTP_MAX_ATTEMPTS },
        expiresAt: { gt: new Date() },
      },
      data: { consumedAt: new Date() },
    });
    if (consumed.count !== 1)
      throw new IdentityVerificationError('EXPIRED', 'Code already consumed or expired');
    const verificationToken = await this.generateVerificationToken(input.subject, input.intent);
    return { verificationToken };
  }

  // ─── Signed link (email) ──────────────────────────────────

  async confirmSignedLinkToken(
    _token: string,
  ): Promise<{ verificationToken: string; subject: string; intent: string }> {
    throw new IdentityVerificationError('INVALID_CODE', 'SMS verification required');
  }

  // ─── Verification token (one-shot) ────────────────────────
  // Généré après OTP/signed token confirmé, utilisé pour /erase + /export.
  // ONE-SHOT : chaque jti est tracké dans signedTokenUsage. Un token déjà
  // consommé → INVALID_CODE. Empêche le replay.

  async generateVerificationToken(subject: string, intent: string): Promise<string> {
    const secret = verificationSecret();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 min
    const jti = crypto.randomUUID();
    const payload = {
      sub: subject,
      intent,
      jti,
      exp: Math.floor(expiresAt.getTime() / 1000),
      proof: 'sms',
    };
    const sig = signHmac(JSON.stringify(payload), secret);
    return Buffer.from(JSON.stringify(payload)).toString('base64url') + '.' + sig;
  }

  async verifyVerificationToken(
    token: string,
    expectedIntent: string,
  ): Promise<{ subject: string }> {
    const parts = token.split('.');
    if (parts.length !== 2) throw new IdentityVerificationError('INVALID_CODE', 'Malformed token');
    const [b64, sig] = parts;
    let payload: VerificationTokenPayload;
    try {
      const parsed: unknown = JSON.parse(Buffer.from(b64, 'base64url').toString('utf8'));
      if (!isVerificationTokenPayload(parsed)) {
        throw new Error('Invalid payload shape');
      }
      payload = parsed;
    } catch {
      throw new IdentityVerificationError('INVALID_CODE', 'Malformed token payload');
    }
    const secret = verificationSecret();
    const expectedSig = signHmac(
      JSON.stringify({
        sub: payload.sub,
        intent: payload.intent,
        jti: payload.jti,
        exp: payload.exp,
        proof: 'sms',
      }),
      secret,
    );
    if (sig !== expectedSig) {
      throw new IdentityVerificationError('INVALID_CODE', 'Bad signature');
    }
    if (payload.exp * 1000 < Date.now()) {
      throw new IdentityVerificationError('EXPIRED', 'Token expired');
    }
    if (payload.intent !== expectedIntent) {
      throw new IdentityVerificationError('INVALID_CODE', 'Token intent mismatch');
    }
    await this.consumeTokenJti(payload.jti, payload.sub, payload.intent);
    return { subject: payload.sub };
  }

  private async consumeTokenJti(jti: string, subject: string, intent: string): Promise<void> {
    try {
      await this.prisma.signedTokenUsage.create({
        data: {
          jti,
          usedAt: new Date(),
          subject,
          intent,
        },
      });
    } catch (err: unknown) {
      if (isPrismaUniqueError(err)) {
        throw new IdentityVerificationError('EXPIRED', 'Token already used (replay detected)');
      }
      throw err;
    }
  }

  // ─── Captcha (Turnstile) ──────────────────────────────────

  private isCaptchaRequired(): boolean {
    return !!env.TURNSTILE_SECRET_KEY && env.TURNSTILE_SECRET_KEY.length >= 1;
  }

  private async verifyTurnstileToken(token?: string): Promise<void> {
    if (!token) {
      throw new IdentityVerificationError('INVALID_CAPTCHA', 'Captcha token is required');
    }
    const secret = env.TURNSTILE_SECRET_KEY;
    if (!secret) {
      return;
    }
    const res = await fetch(TURNSTILE_VERIFY_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ secret, response: token }),
    });
    if (!res.ok) {
      throw new IdentityVerificationError('INVALID_CAPTCHA', 'Captcha verification failed');
    }
    const data: unknown = await res.json();
    if (!isTurnstileSuccess(data)) {
      throw new IdentityVerificationError('INVALID_CAPTCHA', 'Captcha challenge failed');
    }
  }

  // ─── Rate limit ───────────────────────────────────────────

  private async checkRateLimit(
    subject: string,
    ip: string | undefined,
    _intent: string,
  ): Promise<number> {
    const rateLimitKey = ip ? `${ip}:${subject}` : `unknown:${subject}`;
    const key = `rgpd:verify:${rateLimitKey}`;
    const count = await this.redis.incr(key);
    if (count === 1) {
      await this.redis.expire(key, RATE_LIMIT_WINDOW_MIN * 60);
    }
    const remaining = Math.max(0, RATE_LIMIT_MAX_REQUESTS - count);
    if (count > RATE_LIMIT_MAX_REQUESTS) {
      throw new IdentityVerificationError(
        'RATE_LIMITED',
        `Too many verification requests. Try again in ${RATE_LIMIT_WINDOW_MIN} minutes.`,
      );
    }
    return remaining;
  }

  // ─── Send helpers ─────────────────────────────────────────

  private async sendOtpSms(phone: string, otp: string, intent: string): Promise<void> {
    const message =
      intent === 'erase'
        ? `[Sokar] Code RGPD effacement : ${otp}. Valide 10 min. Pas demandé ? Ignorez.`
        : `[Sokar] Code RGPD export : ${otp}. Valide 10 min. Pas demandé ? Ignorez.`;
    try {
      await sendSms(phone, message);
    } catch (err) {
      logger.error({ err, phone, intent }, 'Failed to send OTP SMS');
      throw err;
    }
  }
}

// ─── Helpers ───────────────────────────────────────────────

function generateOtp(length: number): string {
  const max = Math.pow(10, length);
  const n = crypto.randomInt(0, max);
  return n.toString().padStart(length, '0');
}

function hashOtp(otp: string): string {
  return crypto.createHash('sha256').update(otp).digest('hex');
}

function signHmac(data: string, secret: string): string {
  return crypto.createHmac('sha256', secret).update(data).digest('base64url');
}

function isVerificationTokenPayload(value: unknown): value is VerificationTokenPayload {
  if (!value || typeof value !== 'object') return false;
  const payload = value as Record<string, unknown>;
  return (
    typeof payload.sub === 'string' &&
    typeof payload.intent === 'string' &&
    typeof payload.jti === 'string' &&
    typeof payload.exp === 'number' &&
    payload.proof === 'sms'
  );
}

function verificationSecret(): string {
  const secret =
    process.env.VERIFICATION_TOKEN_SECRET?.trim() || process.env.CLERK_SECRET_KEY?.trim();
  if (!secret || secret.length < 16) throw new Error('RGPD verification secret is not configured');
  return secret;
}

function isPrismaUniqueError(value: unknown): value is { code: 'P2002' } {
  return (
    value !== null &&
    typeof value === 'object' &&
    'code' in value &&
    (value as { code?: unknown }).code === 'P2002'
  );
}

function isTurnstileSuccess(value: unknown): value is { success: true } {
  return (
    typeof value === 'object' && value !== null && (value as { success?: unknown }).success === true
  );
}
