import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';
import { z } from 'zod';
import {
  CEREBRAS_BASE_URL,
  GROQ_BASE_URL,
  VOICE_LLM_MODEL_DEFAULT,
  VOICE_LLM_PROVIDERS,
} from '@sokar/config';
import { sttChunkMsSchema } from './shared/stt-chunking';
import { telnyxCodecSchema } from './modules/voice/stream/telnyx-codec';

function isValidCorsOrigins(val: string): boolean {
  return val
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .every((origin) => {
      try {
        const { protocol } = new URL(origin);
        return protocol === 'http:' || protocol === 'https:';
      } catch {
        return false;
      }
    });
}

// En production (PM2 --env-file=.env), le fichier app-local est la source de
// vérité. En dev, on fallback sur le .env du repo root puis .env.local.
// L'ancien code chargeait toujours ../../../.env (repo root), ce qui divergeait
// silencieusement du fichier chargé par PM2 (apps/api/.env).
const appEnv = path.resolve(__dirname, '../.env');
const rootEnv = path.resolve(__dirname, '../../../.env');
const localEnv = path.resolve(__dirname, '../../../.env.local');

const envFile = fs.existsSync(appEnv) ? appEnv : fs.existsSync(rootEnv) ? rootEnv : localEnv;

dotenv.config({ path: envFile });

// ─── Defaults dev (ergonomie out-of-the-box) ─────────────────────────────
// En dev/test, si les 4 vars URL ne sont pas positionnées (pas de apps/api/.env
// ni .env.local complet), on injecte des valeurs localhost avant le parse Zod.
// Cela restaure le confort "pnpm dev marche sans .env dédié" qui existait avant
// la validation centralisée, sans réintroduire le risque en prod (où le refine
// sur l'allowlist s'applique et où ces defaults ne sont jamais injectés).
const nodeEnv = process.env.NODE_ENV ?? 'development';
if (nodeEnv !== 'production') {
  process.env.PUBLIC_URL ??= 'http://localhost:4000';
  process.env.SITE_URL ??= 'http://localhost:4002';
  process.env.DASHBOARD_URL ??= 'http://localhost:3000';
  process.env.API_URL ??= 'http://localhost:4000';
}

// ─── Validation centralisée (fail-fast au démarrage) ─────────────────────
// Remplace les fallbacks dispersés `process.env.X ?? 'https://...'` qui ont
// causé plusieurs bugs de domaine en prod (commits d8849c3, c6d4ebe, 5bf1137,
// fb89267, ed16dfe). En production, un host hors allowlist fait échouer le
// démarrage plutôt que d'utiliser silencieusement une mauvaise valeur.

const PROD_HOST_ALLOWLIST = [
  'sokar.tech',
  'api.sokar.tech',
  'app.sokar.tech',
  'widget.sokar.tech',
  // Staging — mêmes contraintes que la prod (NODE_ENV=production).
  'staging.sokar.tech',
  'api-staging.sokar.tech',
];

const DEFAULT_VOICE_LLM_TIMEOUT_MS = 8000;

export const voiceSttBooleanFlagSchema = z.enum(['true', 'false']).default('false');

/**
 * Stripe live secret keys must never be used by a local/test process.
 * Production mode is deliberately the only environment where they are
 * accepted; staging runs with NODE_ENV=production but uses sk_test_* keys.
 */
export function isLiveStripeSecretKey(value: string | undefined): boolean {
  return value?.trim().startsWith('sk_live_') ?? false;
}

// Même compatibilité que manager.ts avant centralisation : une valeur absente,
// invalide, non positive ou non finie retombe sur 8 secondes.
const voiceLlmTimeoutSchema = z.preprocess((value) => {
  if (value === undefined) return DEFAULT_VOICE_LLM_TIMEOUT_MS;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_VOICE_LLM_TIMEOUT_MS;
}, z.number().positive());

/**
 * Une variable d'environnement vide n'est pas absente : `pm2` transmet à ses
 * process l'environnement du shell qui l'a lancé, donc un secret de workflow
 * non renseigné arrive en chaîne vide et fait échouer `z.string().url()` —
 * `.optional()` ne protège pas, puisque la valeur existe. Le 2026-09-22,
 * `ALERT_WEBHOOK_URL=''` a fait boucler le process de workers en crash et
 * bloqué la promotion staging → production. Une valeur vide doit se lire
 * « non configuré », pas « invalide ».
 */
export const optionalUrlSchema = z.preprocess((value) => {
  if (typeof value !== 'string') return value;
  // Le trim évite qu'un espace invisible dans un secret GitHub produise une
  // URL « valide » en apparence mais refusée par `new URL()`.
  const trimmed = value.trim();
  return trimmed === '' ? undefined : trimmed;
}, z.string().url().optional());

export const VoiceDeepgramConfigSchema = z.object({
  VOICE_DEEPGRAM_ENDPOINTING_MS: z.coerce.number().int().min(100).max(1_000).default(300),
  VOICE_DEEPGRAM_UTTERANCE_END_MS: z.coerce.number().int().min(500).max(3_000).default(1_000),
  VOICE_DEEPGRAM_SPELLING_SILENCE_MS: z.coerce.number().int().min(400).max(2_000).default(800),
  VOICE_DEEPGRAM_MODEL: z.enum(['nova-3', 'flux-general-multi']).default('nova-3'),
  VOICE_DEEPGRAM_MODEL_RESTAURANT_IDS: z.string().optional(),
  VOICE_DEEPGRAM_NUMERALS: z.enum(['true', 'false']).default('true'),
  VOICE_DEEPGRAM_NUMERALS_RESTAURANT_IDS: z.string().optional(),
  VOICE_DEEPGRAM_PUNCTUATE: z.enum(['true', 'false']).default('false'),
  VOICE_DEEPGRAM_PUNCTUATE_RESTAURANT_IDS: z.string().optional(),
  VOICE_DEEPGRAM_KEYTERMS_RESTAURANT_IDS: z.string().optional(),
  VOICE_DEEPGRAM_MIP_OPT_OUT: z.enum(['true', 'false']).default('true'),
});

/** Configuration voice issue des variables d'environnement validées. */
export const VoiceConfigSchema = z
  .object({
    VOICE_LLM_MODEL: z.string().default(VOICE_LLM_MODEL_DEFAULT),
    VOICE_LLM_TIMEOUT_MS: voiceLlmTimeoutSchema,
    VOICE_LLM_PROVIDER: z.enum(VOICE_LLM_PROVIDERS).default('groq'),
    VOICE_LLM_HEDGE_DELAY_MS: z.coerce.number().int().min(100).max(5_000).default(1_000),
    VOICE_LLM_HEDGE_TIMEOUT_MS: z.coerce.number().int().min(500).max(10_000).default(3_000),
    VOICE_LLM_HEDGE_MODEL: z.string().default('qwen/qwen3.8-27b'),
    VOICE_LLM_FILLER_DELAY_MS: z.coerce.number().int().min(100).max(5_000).default(1_200),
    GROQ_BASE_URL: z.string().url().default(GROQ_BASE_URL),
    GROQ_API_KEY: z.string().optional(),
    CEREBRAS_BASE_URL: z.string().url().default(CEREBRAS_BASE_URL),
    CEREBRAS_API_KEY: z.string().optional(),
  })
  .merge(VoiceDeepgramConfigSchema);

export type VoiceConfig = z.infer<typeof VoiceConfigSchema>;

const EnvSchema = z
  .object({
    DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
    REDIS_URL: z.string().min(1, 'REDIS_URL is required'),
    NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
    PUBLIC_URL: z.string().url('PUBLIC_URL must be a valid URL'),
    SITE_URL: z.string().url('SITE_URL must be a valid URL'),
    DASHBOARD_URL: z.string().url('DASHBOARD_URL must be a valid URL'),
    API_URL: z.string().url('API_URL must be a valid URL'),
    // CORS — allowlist explicite des origins navigateur (comma-separated)
    CORS_ORIGINS: z
      .string()
      .refine(isValidCorsOrigins, {
        message:
          'CORS_ORIGINS must be a comma-separated list of http(s) URLs (e.g. https://sokar.tech,https://www.sokar.tech)',
      })
      .optional(),
    // Reverse proxy IPs (Nginx) — comma-separated, accepte CIDR et IPv6.
    // Defaut loopback ; ajouter l'IP publique du VPS si Nginx n'est pas local.
    TRUSTED_PROXY_IPS: z.string().default('127.0.0.1, ::1'),
    // Routes /api/test (simulation d'appel). DOIT être explicitement true, même en dev/test.
    // En production, doit rester false (SEC-005).
    ENABLE_TEST_ROUTES: z.enum(['true', 'false']).default('false'),
    // Authentification /metrics (SEC-006). Si user+password sont définis, auth basique requise.
    // Sinon, allowlist d'IPs exactes (défaut loopback). Prometheus doit être dans la liste.
    METRICS_BASIC_AUTH_USER: z.string().optional(),
    METRICS_BASIC_AUTH_PASSWORD: z.string().min(1).optional(),
    METRICS_ALLOWLIST_IPS: z.string().default('127.0.0.1, ::1'),
    // Endpoint de métriques du process worker (R1-6). Loopback par défaut :
    // seul Prometheus, sur le même hôte, doit pouvoir le lire.
    METRICS_PORT: z.coerce.number().int().positive().default(4001),
    METRICS_BIND_HOST: z.string().default('127.0.0.1'),
    // IDs Clerk des opérateurs Sokar autorisés à utiliser les routes globales
    // de provisioning et de santé. CSV, obligatoire dans l'environnement de
    // déploiement avant d'ouvrir l'administration multi-restaurant.
    SOKAR_OPERATOR_USER_IDS: z.string().optional(),
    // Jeton du endpoint legacy POST /reservations. Le pipeline vocal appelle
    // le service directement ; cette clé ne doit jamais être exposée au client.
    RESERVATION_SERVICE_TOKEN: z.string().min(32).optional(),
    // Auth MCP dev (SEC-007). ENABLE_DEV_AUTH doit être explicitement true pour activer AGENT_DEV_KEY.
    // En production, rester false. AGENT_DEV_KEY doit faire ≥32 caractères si défini.
    ENABLE_DEV_AUTH: z.enum(['true', 'false']).default('false'),
    AGENT_DEV_KEY: z.string().min(32).optional(),
    // HMAC partagé pour le feed OpenAI Reserve (RES-007). Si défini, /v1/businesses
    // exige un ?signature=... valide. Clé ≥ 32 chars, ne pas commiter.
    OPENAI_RESERVE_HMAC_KEY: z.string().min(32).optional(),
    // HMAC des événements de qualité Service Copilot. Le navigateur ne peut
    // pas déclarer une recommandation arbitraire : il ne renvoie qu’un token signé.
    SERVICE_COPILOT_TELEMETRY_SECRET: z.string().min(32).optional(),
    // Clés API critiques — validées au démarrage en production
    TELNYX_API_KEY: z.string().optional(),
    TELNYX_PUBLIC_KEY: z.string().optional(),
    TELNYX_FROM_NUMBER: z.string().optional(),
    // Profil Telnyx utilisé pour les SMS transactionnels et leurs webhooks.
    // Le numéro expéditeur doit aussi être affecté à ce profil côté Telnyx.
    TELNYX_MESSAGING_PROFILE_ID: z.string().optional(),
    // Numéro WhatsApp Business affecté au profil de messagerie Telnyx.
    TELNYX_WHATSAPP_FROM: z.string().optional(),
    // Base URL Telnyx pour les appels fetch directs — défaut US.
    // Le SDK Telnyx utilise TELNYX_API_BASE (sans https://).
    // Pour Frankfurt : TELNYX_API_URL=https://api.telnyx.eu + TELNYX_API_BASE=api.telnyx.eu
    TELNYX_API_URL: z.string().default('https://api.telnyx.com'),
    // Enregistrements d'appels : opt-in explicite, stockage S3-compatible privé.
    CALL_RECORDING_ENABLED: z.enum(['true', 'false']).default('false'),
    // Topologie d'exécution : en développement l'API porte aussi les workers
    // pour que `pnpm dev` reste utilisable seul. En production, l'écosystème PM2
    // force `false` sur `sokar-api` et les workers tournent dans `dist/worker.js`
    // (PM2 `sokar-workers`). Cf. docs/PROJECT_MAP.md.
    RUN_WORKERS_IN_PROCESS: z.enum(['true', 'false']).default('true'),
    // Anonymisation RGPD (rétention 2 ans) : opération destructive, jamais
    // exécutée en production. Le worker et son scheduler existent, mais le job
    // sort immédiatement tant que ce flag n'est pas explicitement activé.
    RGPD_ANONYMIZATION_ENABLED: z.enum(['true', 'false']).default('false'),
    // Liste CSV des seuls restaurants de test autorisés à lancer un enregistrement.
    CALL_RECORDING_TEST_RESTAURANT_IDS: z.string().optional(),
    CALL_RECORDINGS_BUCKET: z.string().min(1).optional(),
    CALL_RECORDINGS_REGION: z.string().default('eu-west-3'),
    CALL_RECORDINGS_ENDPOINT: optionalUrlSchema,
    CALL_RECORDINGS_ACCESS_KEY_ID: z.string().optional(),
    CALL_RECORDINGS_SECRET_ACCESS_KEY: z.string().optional(),
    CALL_RECORDINGS_RETENTION_DAYS: z.coerce.number().int().min(1).max(30).default(30),
    CALL_RECORDINGS_MAX_BYTES: z.coerce
      .number()
      .int()
      .min(1_000_000)
      .max(200_000_000)
      .default(50_000_000),
    ELEVENLABS_API_KEY: z.string().optional(),
    DEEPGRAM_API_KEY: z.string().optional(),
    // Endpoint STT temps réel ElevenLabs — surchargeable pour les tests.
    ELEVENLABS_STT_HOST: z.string().default('api.elevenlabs.io'),
    ELEVENLABS_STT_MODEL: z.string().default('scribe_v2_realtime'),
    // Langues Scribe autorisées pour la détection automatique (CSV ISO-639-1/3).
    ELEVENLABS_STT_LANGUAGES: z.string().default('fr,en,es,it,de,pt,nl'),
    ELEVENLABS_STT_ALL_LANGUAGES: z.enum(['true', 'false']).default('false'),
    CARTESIA_API_KEY: z.string().optional(),
    // Dictionnaire Cartesia global de secours ; une personnalité peut en
    // définir un différent pour un restaurant donné.
    CARTESIA_PRONUNCIATION_DICT_ID: z.string().optional(),
    // Canary TTS : contexte WebSocket par réponse LLM. Désactivé par défaut,
    // le chemin /tts/bytes reste la référence tant que la mesure audio manque.
    VOICE_TTS_CONTEXT_V2_ENABLED: z.enum(['true', 'false']).default('false'),
    // Regroupement des trames audio avant envoi à Scribe : 20 (défaut, envoi
    // immédiat trame par trame) ou un multiple de 20 entre 40 et 200.
    VOICE_STT_CHUNK_MS: sttChunkMsSchema,
    // Filtrage du bruit de fond Scribe et verrou français au premier tour FR.
    // Les deux restent strictement inactifs par défaut.
    VOICE_STT_FILTER_BACKGROUND: voiceSttBooleanFlagSchema,
    VOICE_STT_LANGUAGE_LOCK: voiceSttBooleanFlagSchema,
    // Routage conversationnel strict : seul un slot direct et non ambigu reste déterministe.
    VOICE_DIALOGUE_LISTENING_V2: voiceSttBooleanFlagSchema,
    // Activation ciblée du routage strict ; s'ajoute au flag global.
    VOICE_DIALOGUE_LISTENING_V2_RESTAURANT_IDS: z.string().optional(),
    // Provider choisi avant ouverture de session ; Deepgram requiert aussi une allowlist.
    VOICE_STT_PROVIDER: z.enum(['scribe', 'deepgram']).default('scribe'),
    VOICE_STT_PROVIDER_RESTAURANT_IDS: z.string().optional(),
    // Codec Telnyx Media Stream. `PCMA` (défaut) = G.711 A-law 8 kHz, chemin
    // de production historique. `L16` = PCM 16 bits 16 kHz (bande large).
    VOICE_TELNYX_CODEC: telnyxCodecSchema,
    // Allowlist optionnelle pour limiter le mode L16 aux restaurants ciblés.
    VOICE_TELNYX_CODEC_RESTAURANT_IDS: z.string().optional(),
    STRIPE_SECRET_KEY: z.string().optional(),
    STRIPE_WEBHOOK_SECRET: z.string().optional(),
    // Stripe Billing — recurring base prices plus Multi-site establishment add-ons.
    // They remain optional so the API can start before Billing is configured;
    // the checkout endpoint returns a sanitized 503 until they are present.
    STRIPE_PRICE_ESSENTIAL_MONTHLY: z.string().optional(),
    STRIPE_PRICE_ESSENTIAL_ANNUAL: z.string().optional(),
    STRIPE_PRICE_PRO_MONTHLY: z.string().optional(),
    STRIPE_PRICE_PRO_ANNUAL: z.string().optional(),
    STRIPE_PRICE_MULTI_SITE_MONTHLY: z.string().optional(),
    STRIPE_PRICE_MULTI_SITE_ANNUAL: z.string().optional(),
    STRIPE_PRICE_MULTI_SITE_ADDON_MONTHLY: z.string().optional(),
    STRIPE_PRICE_MULTI_SITE_ADDON_ANNUAL: z.string().optional(),
    // Captcha Cloudflare Turnstile pour les flux sensibles (SEC-009). Optionnel ; si défini, /api/rgpd/request-verification exige un token Turnstile.
    TURNSTILE_SECRET_KEY: z.string().optional(),
    // Resend HTTP API pour l'envoi des emails transactionnels (port 443,
    // bypass SMTP block sur Frankfurt VPS). L'ancienne config SMTP_* est
    // dépréciée — RESEND_API_KEY est la seule clé nécessaire.
    RESEND_API_KEY: z.string().optional(),
    // Secret Svix/Resend utilisé pour vérifier les callbacks de livraison.
    // Il reste optionnel tant que les envois marketing sont gelés.
    RESEND_WEBHOOK_SECRET: z.string().min(16).optional(),
    EMAIL_FROM: z.string().optional(),
    // Les rapports récurrents envoient un email aux gestionnaires. Staging les
    // désactive explicitement tant qu'il n'existe pas de canal d'envoi isolé.
    EVENING_REPORTS_ENABLED: z
      .enum(['true', 'false'])
      .default('true')
      .transform((v) => v === 'true'),
    // Canaux d'alerte ops (monitoring pilote). Tous optionnels ; si aucun n'est
    // défini, les alertes ne partent que dans les logs + Sentry.
    //   ALERT_EMAIL_TO    : destinataires email des alertes, séparés par des virgules.
    //   ALERT_WEBHOOK_URL : webhook Slack/Discord ({ "text": "..." }).
    //   ALERT_SMS_TO      : numéro E.164 recevant un SMS pour les alertes critiques.
    ALERT_EMAIL_TO: z.string().optional(),
    ALERT_WEBHOOK_URL: optionalUrlSchema,
    ALERT_SMS_TO: z.string().optional(),
    // Jeton séparé pour le feed interne de marge (jamais exposé au dashboard client).
    SOKAR_INTERNAL_USAGE_TOKEN: z.string().optional(),
    // Rôles autorisés à lire les notes CRM sensibles. CSV ; le défaut applique
    // le moindre privilège (Owner + Manager), sans exposer la valeur au client.
    CRM_SENSITIVE_NOTE_ROLES: z.string().default('OWNER,MANAGER'),
    // Seuils de suivi opérationnel 70/90/100 %. Aucun quota client n'est
    // appliqué ; ce worker reste optionnel et désactivé par défaut.
    USAGE_ALERTS_ENABLED: z.enum(['true', 'false']).default('false'),
    // Budgets mensuels de cost-watch opérateur, jamais communiqués au client
    // et sans effet sur l'acceptation d'un appel, SMS ou réservation.
    USAGE_ALERT_VOICE_BUDGET_MINUTES: z.coerce.number().positive().optional(),
    USAGE_ALERT_SMS_BUDGET_SEGMENTS: z.coerce.number().positive().optional(),
    // Jeton séparé pour la réconciliation interne des callbacks marketing.
    SOKAR_INTERNAL_MARKETING_TOKEN: z.string().optional(),
    // Les envois marketing restent verrouillés par défaut, même si les clés
    // provider sont présentes. Ces flags sont lus aussi par les workers.
    // Le checkout d'abonnement reste désactivé en production tant que les
    // prix Stripe et le pilote Essential ne sont pas clôturés.
    BILLING_CHECKOUT_ENABLED: z.enum(['true', 'false']).default('false'),
    // Les fonctions CRM avancées et le control plane marketing restent
    // désactivés en production tant que les preuves P2/P3 ne sont pas closes.
    CRM_ADVANCED_ENABLED: z.enum(['true', 'false']).default('false'),
    MARKETING_FEATURES_ENABLED: z.enum(['true', 'false']).default('false'),
    MARKETING_SENDS_ENABLED: z.enum(['true', 'false']).default('false'),
    MARKETING_WHATSAPP_ENABLED: z.enum(['true', 'false']).default('false'),
    // POS connectors remain disabled until a provider sandbox and pilot are
    // qualified. The adapter and import endpoints are still available locally
    // when explicitly enabled in a non-production environment.
    POS_CONNECTORS_ENABLED: z.enum(['true', 'false']).default('false'),
    // Reservation payment protection remains disabled until the merchant model,
    // Stripe Connect account and legal policy are validated with a pilot.
    RESERVATION_PAYMENTS_ENABLED: z.enum(['true', 'false']).default('false'),
    // Shared CRM identity is limited to qualified multi-site pilots.
    CUSTOMER_GROUPS_ENABLED: z.enum(['true', 'false']).default('false'),
    // Feedback and benefits remain local-only until channels, rules and a
    // restaurant pilot are qualified.
    REPUTATION_ENABLED: z.enum(['true', 'false']).default('false'),
    LOYALTY_ENABLED: z.enum(['true', 'false']).default('false'),
    // Experiences remain local-only until capacity, pricing and pilot
    // procedures are validated; no payment or distribution provider is called.
    EXPERIENCES_ENABLED: z.enum(['true', 'false']).default('false'),
    // Event ticketing remains local-only until payment, refund and distribution
    // contracts are qualified with a pilot.
    EVENTS_ENABLED: z.enum(['true', 'false']).default('false'),
    // Partner channels remain local-only until signed provider contracts,
    // health checks and bidirectional sync are qualified with a pilot.
    DISTRIBUTION_ENABLED: z.enum(['true', 'false']).default('false'),
  })
  .merge(VoiceConfigSchema)
  .refine((data) => data.CALL_RECORDING_ENABLED !== 'true' || !!data.CALL_RECORDINGS_BUCKET, {
    message: 'CALL_RECORDINGS_BUCKET is required when CALL_RECORDING_ENABLED=true',
    path: ['CALL_RECORDINGS_BUCKET'],
  })
  .refine(
    (data) =>
      (!!data.CALL_RECORDINGS_ACCESS_KEY_ID && !!data.CALL_RECORDINGS_SECRET_ACCESS_KEY) ||
      (!data.CALL_RECORDINGS_ACCESS_KEY_ID && !data.CALL_RECORDINGS_SECRET_ACCESS_KEY),
    {
      message: 'CALL_RECORDINGS_ACCESS_KEY_ID and SECRET_ACCESS_KEY must be set together',
      path: ['CALL_RECORDINGS_ACCESS_KEY_ID'],
    },
  )
  .refine(
    (data) => {
      if (data.NODE_ENV !== 'production') return true;
      // En production, tous les hosts URL doivent être dans l'allowlist
      const urls = [data.PUBLIC_URL, data.SITE_URL, data.DASHBOARD_URL, data.API_URL];
      return urls.every((url) => {
        try {
          const host = new URL(url).hostname;
          return PROD_HOST_ALLOWLIST.includes(host);
        } catch {
          return false;
        }
      });
    },
    {
      message: `En production, les hosts URL doivent être dans l'allowlist: ${PROD_HOST_ALLOWLIST.join(', ')}`,
      path: ['PUBLIC_URL'],
    },
  )
  .refine(
    (data) => {
      if (data.NODE_ENV !== 'production') return true;
      return !!data.SERVICE_COPILOT_TELEMETRY_SECRET;
    },
    {
      message: 'SERVICE_COPILOT_TELEMETRY_SECRET doit être défini en production (≥32 caractères).',
      path: ['SERVICE_COPILOT_TELEMETRY_SECRET'],
    },
  )
  .refine(
    (data) => {
      if (data.NODE_ENV !== 'production') return true;
      // En production, CORS_ORIGINS doit être défini explicitement
      // (pas de fallback hardcoded — cf. audit sécurité Phase 1)
      return !!data.CORS_ORIGINS;
    },
    {
      message:
        'En production, CORS_ORIGINS doit être défini explicitement (ex: "https://sokar.tech,https://www.sokar.tech"). Aucun fallback hardcoded.',
      path: ['CORS_ORIGINS'],
    },
  )
  .refine(
    (data) => {
      if (data.NODE_ENV !== 'production') return true;
      return Boolean(
        data.SOKAR_OPERATOR_USER_IDS?.split(',')
          .map((id) => id.trim())
          .filter(Boolean).length,
      );
    },
    {
      message:
        'SOKAR_OPERATOR_USER_IDS doit contenir au moins un ID Clerk en production pour protéger les routes globales.',
      path: ['SOKAR_OPERATOR_USER_IDS'],
    },
  )
  .refine(
    (data) => {
      if (data.NODE_ENV !== 'production') return true;
      // En production, les clés API voice doivent être présentes
      // (sauf si la voice est explicitement désactivée — staging)
      const voiceDisabled = process.env.VOICE_DISABLED === 'true';
      if (voiceDisabled) return true;
      return !!data.TELNYX_API_KEY && data.TELNYX_API_KEY.length >= 20;
    },
    {
      message:
        'En production, TELNYX_API_KEY doit être définie (≥20 chars). Pour désactiver la voice (staging), set VOICE_DISABLED=true.',
      path: ['TELNYX_API_KEY'],
    },
  )
  .refine(
    (data) => {
      if (data.NODE_ENV !== 'production') return true;
      const voiceDisabled = process.env.VOICE_DISABLED === 'true';
      if (voiceDisabled) return true;
      return !!data.ELEVENLABS_API_KEY && data.ELEVENLABS_API_KEY.length >= 20;
    },
    {
      message:
        'En production, ELEVENLABS_API_KEY doit être définie (≥20 chars). Pour désactiver la voice (staging), set VOICE_DISABLED=true.',
      path: ['ELEVENLABS_API_KEY'],
    },
  )
  .refine(
    (data) => {
      if (data.NODE_ENV !== 'production') return true;
      const voiceDisabled = process.env.VOICE_DISABLED === 'true';
      if (voiceDisabled) return true;
      return !!data.CARTESIA_API_KEY && data.CARTESIA_API_KEY.length >= 20;
    },
    {
      message:
        'En production, CARTESIA_API_KEY doit être définie (≥20 chars). Pour désactiver la voice (staging), set VOICE_DISABLED=true.',
      path: ['CARTESIA_API_KEY'],
    },
  )
  .refine(
    (data) => {
      if (data.NODE_ENV !== 'production' || process.env.VOICE_DISABLED === 'true') return true;
      const key =
        data.VOICE_LLM_PROVIDER === 'cerebras' ? data.CEREBRAS_API_KEY : data.GROQ_API_KEY;
      return !!key && key.length >= 20;
    },
    (data) => {
      const keyName = data.VOICE_LLM_PROVIDER === 'cerebras' ? 'CEREBRAS_API_KEY' : 'GROQ_API_KEY';
      return {
        message: `${keyName} doit être définie en production (≥20 caractères) : c’est la clé du provider LLM vocal actif (${data.VOICE_LLM_PROVIDER}).`,
        path: [keyName],
      };
    },
  )
  .refine(
    (data) => {
      // Si une clé Stripe est configurée, le secret de webhook est obligatoire
      // (indépendamment de l'environnement, pour éviter les webhooks non vérifiés).
      if (!data.STRIPE_SECRET_KEY) return true;
      return !!data.STRIPE_WEBHOOK_SECRET;
    },
    {
      message: 'STRIPE_WEBHOOK_SECRET doit être défini quand STRIPE_SECRET_KEY est configuré.',
      path: ['STRIPE_WEBHOOK_SECRET'],
    },
  )
  .refine(
    (data) => {
      if (data.NODE_ENV === 'production') return true;
      return !isLiveStripeSecretKey(data.STRIPE_SECRET_KEY);
    },
    {
      message:
        'Une clé Stripe live (sk_live_*) est interdite hors production. Utilisez une clé sk_test_* en local ou en test.',
      path: ['STRIPE_SECRET_KEY'],
    },
  )
  .refine(
    (data) => {
      if (data.NODE_ENV !== 'production') return true;
      // En production, on ne valide que le préfixe Stripe (pas le webhook secret,
      // déjà contrôlé par le refine précédent).
      if (!data.STRIPE_SECRET_KEY) return true;
      return data.STRIPE_SECRET_KEY.startsWith('sk_');
    },
    {
      message:
        'En production, STRIPE_SECRET_KEY doit être une clé Stripe valide (format sk_*) et STRIPE_WEBHOOK_SECRET doit être défini.',
      path: ['STRIPE_SECRET_KEY'],
    },
  );

function parseEnv() {
  const result = EnvSchema.safeParse(process.env);
  if (!result.success) {
    console.error("\n❌ Validation des variables d'environnement échouée:\n");
    for (const issue of result.error.issues) {
      const field = issue.path.join('.');
      console.error(`  • ${field || '(root)'}: ${issue.message}`);
    }
    console.error('\nLe démarrage est interrompu. Corrigez les variables ci-dessus.\n');
    process.exit(1);
  }
  return result.data;
}

export const env = parseEnv();

// Vue typée dédiée au pipeline voice. Elle référence le même objet validé que
// `env` afin d'éviter une seconde source de vérité ou une copie de secrets.
export const voiceConfig: VoiceConfig = env;
