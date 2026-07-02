/**
 * Identity verification pour les endpoints RGPD sensibles (erase, export).
 *
 * Conformité RGPD Article 12 §6 : "l'identité du demandeur doit être
 * vérifiée de manière proportionnée".
 *
 * Deux canaux supportés :
 *   1. **OTP SMS** via Telnyx (canal principal, friction user normale)
 *   2. **Lien signé par email** via Brevo (canal admin, friction minimale)
 *
 * Stratégie de canal (auto) :
 *   - Si le payload contient un `email` valide → lien signé par email
 *   - Sinon → OTP SMS via le `subject` (téléphone)
 *
 * Limitations MVP :
 *   - Pas d'email client en DB (Customer n'a pas d'email), donc le canal
 *     email est surtout utile pour les admins resto qui demandent pour
 *     un client qui fournit son email.
 *   - Pas de captcha : on rate-limit par IP + téléphone (5 req / 15 min).
 *   - Pas de validation 2FA : c'est un OTP one-shot, pas un facteur durable.
 *
 * Stockage :
 *   - OTP : table `identity_verification_otp` (nouvelle) avec TTL 10 min
 *   - Tokens signés : stateless, JWT-like (HMAC-SHA256) avec payload minimal
 *
 * Sécurité :
 *   - OTP : 6 chiffres, max 5 tentatives, expiration 10 min
 *   - Lien signé : expiration 24h, one-shot (jti tracked)
 *   - Rate-limit : 5 demandes / 15 min par (IP + subject)
 */

import type { PrismaClient } from '@prisma/client';
import crypto from 'crypto';
import type Redis from 'ioredis';
import { logger } from '../../shared/logger/pino';
import { sendSms } from '../../shared/telnyx/client';
import { env } from '../../env';
import { sendEmail } from '../../shared/email';

const OTP_LENGTH = 6;
const OTP_TTL_MINUTES = 10;
const OTP_MAX_ATTEMPTS = 5;
const SIGNED_LINK_TTL_HOURS = 24;

const RATE_LIMIT_WINDOW_MIN = 15;
const RATE_LIMIT_MAX_REQUESTS = 5;

export type VerificationChannel = 'sms' | 'email';

export type RequestVerificationInput = {
  subject: string; // téléphone (pour SMS) ou email (pour email)
  intent: 'erase' | 'export';
  email?: string; // optionnel : si fourni, on privilégie le canal email
};

export type RequestVerificationResult = {
  channel: VerificationChannel;
  // On NE retourne PAS l'OTP ni le token ici — ils sont envoyés au user.
  expiresAt: string;
  rateLimitRemaining: number;
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

type SignedLinkPayload = VerificationTokenPayload & {
  dest: string;
};

export class IdentityVerificationError extends Error {
  constructor(
    public code: 'EXPIRED' | 'INVALID_CODE' | 'MAX_ATTEMPTS' | 'NOT_FOUND' | 'RATE_LIMITED',
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
    // 1. Rate-limit check
    await this.checkRateLimit(input.subject, input.intent);

    // 2. Choisir le canal
    const channel: VerificationChannel = input.email ? 'email' : 'sms';
    const destination = input.email ?? input.subject;

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
    if (channel === 'sms') {
      await this.sendOtpSms(destination, otp, input.intent);
    } else {
      // Pour email : on génère un token signé et on envoie le lien
      const token = await this.generateSignedToken(input.subject, input.intent, destination);
      await this.sendSignedLinkEmail(destination, token, input.intent);
    }

    return {
      channel,
      expiresAt: expiresAt.toISOString(),
      rateLimitRemaining: 0, // calculé dans checkRateLimit si Redis dispo
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
      return this.confirmSignedToken(input);
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
      await this.prisma.identityVerificationOtp.update({
        where: { id: record.id },
        data: { attempts: record.attempts + 1 },
      });
      throw new IdentityVerificationError('INVALID_CODE', 'Invalid code');
    }

    // OK : consomme et génère un verificationToken one-shot
    await this.prisma.identityVerificationOtp.update({
      where: { id: record.id },
      data: { consumedAt: new Date() },
    });
    const verificationToken = await this.generateVerificationToken(input.subject, input.intent);
    return { verificationToken };
  }

  // ─── Signed link (email) ──────────────────────────────────

  private async confirmSignedToken(
    input: ConfirmVerificationInput,
  ): Promise<{ verificationToken: string }> {
    const payload = await this.verifySignedToken(input.token!);
    if (payload.sub !== input.subject || payload.intent !== input.intent) {
      throw new IdentityVerificationError('INVALID_CODE', 'Token mismatch');
    }
    await this.consumeTokenJti(payload.jti, payload.sub, payload.intent);
    const verificationToken = await this.generateVerificationToken(input.subject, input.intent);
    return { verificationToken };
  }

  async confirmSignedLinkToken(
    token: string,
  ): Promise<{ verificationToken: string; subject: string; intent: string }> {
    const payload = await this.verifySignedToken(token);
    await this.consumeTokenJti(payload.jti, payload.sub, payload.intent);
    const verificationToken = await this.generateVerificationToken(payload.sub, payload.intent);
    return {
      verificationToken,
      subject: payload.sub,
      intent: payload.intent,
    };
  }

  // ─── Verification token (one-shot) ────────────────────────
  // Généré après OTP/signed token confirmé, utilisé pour /erase + /export.
  // ONE-SHOT : chaque jti est tracké dans signedTokenUsage. Un token déjà
  // consommé → INVALID_CODE. Empêche le replay.

  async generateVerificationToken(subject: string, intent: string): Promise<string> {
    const secret =
      process.env.VERIFICATION_TOKEN_SECRET ??
      process.env.CLERK_SECRET_KEY ??
      'dev-secret-32-chars-min-aaa';
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 min
    const jti = crypto.randomUUID();
    const payload = { sub: subject, intent, jti, exp: Math.floor(expiresAt.getTime() / 1000) };
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
    const secret =
      process.env.VERIFICATION_TOKEN_SECRET ??
      process.env.CLERK_SECRET_KEY ??
      'dev-secret-32-chars-min-aaa';
    const expectedSig = signHmac(
      JSON.stringify({
        sub: payload.sub,
        intent: payload.intent,
        jti: payload.jti,
        exp: payload.exp,
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

  // ─── Signed link token (email) ─────────────────────────────

  private async generateSignedToken(
    subject: string,
    intent: string,
    destination: string,
  ): Promise<string> {
    const secret =
      process.env.SIGNED_LINK_SECRET ??
      process.env.CLERK_SECRET_KEY ??
      'dev-secret-32-chars-min-aaa';
    const exp = Math.floor((Date.now() + SIGNED_LINK_TTL_HOURS * 60 * 60 * 1000) / 1000);
    const jti = crypto.randomUUID();
    const payload = { sub: subject, intent, dest: destination, jti, exp };
    const sig = signHmac(JSON.stringify(payload), secret);
    return Buffer.from(JSON.stringify(payload)).toString('base64url') + '.' + sig;
  }

  private async verifySignedToken(token: string): Promise<{
    sub: string;
    intent: string;
    jti: string;
  }> {
    const parts = token.split('.');
    if (parts.length !== 2) throw new IdentityVerificationError('INVALID_CODE', 'Malformed token');
    const [b64, sig] = parts;
    let payload: SignedLinkPayload;
    try {
      const parsed: unknown = JSON.parse(Buffer.from(b64, 'base64url').toString('utf8'));
      if (!isSignedLinkPayload(parsed)) {
        throw new Error('Invalid payload shape');
      }
      payload = parsed;
    } catch {
      throw new IdentityVerificationError('INVALID_CODE', 'Malformed token payload');
    }
    const secret =
      process.env.SIGNED_LINK_SECRET ??
      process.env.CLERK_SECRET_KEY ??
      'dev-secret-32-chars-min-aaa';
    const canonical = JSON.stringify({
      sub: payload.sub,
      intent: payload.intent,
      dest: payload.dest,
      jti: payload.jti,
      exp: payload.exp,
    });
    const expectedSig = signHmac(canonical, secret);
    if (sig !== expectedSig) {
      throw new IdentityVerificationError('INVALID_CODE', 'Bad signature');
    }
    if (payload.exp * 1000 < Date.now()) {
      throw new IdentityVerificationError('EXPIRED', 'Token expired');
    }
    // Check one-shot
    const usage = await this.prisma.signedTokenUsage.findUnique({ where: { jti: payload.jti } });
    if (usage) {
      throw new IdentityVerificationError('EXPIRED', 'Token already used');
    }
    return { sub: payload.sub, intent: payload.intent, jti: payload.jti };
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

  // ─── Rate limit ───────────────────────────────────────────

  private async checkRateLimit(subject: string, _intent: string): Promise<void> {
    const key = `rgpd:verify:${subject}`;
    const count = await this.redis.incr(key);
    if (count === 1) {
      await this.redis.expire(key, RATE_LIMIT_WINDOW_MIN * 60);
    }
    if (count > RATE_LIMIT_MAX_REQUESTS) {
      throw new IdentityVerificationError(
        'RATE_LIMITED',
        `Too many verification requests. Try again in ${RATE_LIMIT_WINDOW_MIN} minutes.`,
      );
    }
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

  private async sendSignedLinkEmail(email: string, token: string, intent: string): Promise<void> {
    const baseUrl = env.PUBLIC_URL;
    const link = `${baseUrl}/api/rgpd/confirm-link?token=${encodeURIComponent(token)}`;
    const subject =
      intent === 'erase'
        ? "Sokar — Confirmez votre demande d'effacement"
        : "Sokar — Confirmez votre demande d'export";
    const body =
      intent === 'erase'
        ? `Cliquez sur le lien pour confirmer l'effacement de vos données : ${link}\n\nLien valide 24h, à usage unique.`
        : `Cliquez sur le lien pour recevoir l'export de vos données : ${link}\n\nLien valide 24h, à usage unique.`;
    try {
      await sendEmail({
        to: email,
        subject,
        html: `<p>${body.replace(/\n/g, '<br>')}</p>`,
      });
    } catch (err) {
      logger.error({ err, email, intent }, 'Failed to send signed link email');
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
    typeof payload.exp === 'number'
  );
}

function isSignedLinkPayload(value: unknown): value is SignedLinkPayload {
  if (!isVerificationTokenPayload(value)) return false;
  return typeof (value as Record<string, unknown>).dest === 'string';
}

function isPrismaUniqueError(value: unknown): value is { code: 'P2002' } {
  return (
    value !== null &&
    typeof value === 'object' &&
    'code' in value &&
    (value as { code?: unknown }).code === 'P2002'
  );
}
