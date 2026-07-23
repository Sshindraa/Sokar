export const PLANS = {
  ESSENTIAL: { label: 'Essential', price: 149 },
  PRO: { label: 'Pro', price: 249 },
  MULTI_SITE: { label: 'Multi-site', price: 249 },
} as const;

// Legacy mapping — DB still uses STARTER / PREMIUM until migration
export const PLAN_LABEL_MAP: Record<string, string> = {
  STARTER: 'Essential',
  PRO: 'Pro',
  PREMIUM: 'Multi-site',
};

export const PLAN_PRICE_MAP: Record<string, number> = {
  STARTER: 149,
  PRO: 249,
  PREMIUM: 249, // Multi-site base price
};

export const INTERNAL_CALL_ALERT_THRESHOLD = 3000;
export const CIRCUIT_BREAKER_HOURLY_LIMIT = 200;
export const REDIS_CTX_TTL_SECONDS = 300;
export const SMS_RATE_LIMIT_SECONDS = 900;

export const CARTESIA_MODEL = 'sonic-3.5';
export const DEFAULT_CARTESIA_VOICE_ID = 'f786b574-daa5-4673-aa0c-cbe3e8534c02';

// ─── Phase 2 — TTS Cache ─────────────────────────────────────────────────
export const TTS_CACHE_TTL_SECONDS = 86_400 * 7; // 7 jours
export const TTS_CACHE_MIN_LENGTH = 8;

// ─── Filler Cache (persistant en Redis) ────────────────────────────────────
// Les fillers audio sont pré-générés au boot et cachés 30 jours pour éviter
// de payer Cartesia à chaque restart pm2. 13 fillers × ~200 bytes = ~5 KB total.
export const FILLER_CACHE_TTL_SECONDS = 86_400 * 30; // 30 jours

// ─── Phase 2 — ROI / TheFork ──────────────────────────────────────────────
export const THEFORK_COMMISSION_PER_PAX = 3;
export const DEFAULT_AVERAGE_TICKET = 35; // € par personne — fallback si pas de estimatedRevenue en DB

// ─── Phase 2 — VIP / LLM ──────────────────────────────────────────────────
export const VIP_PARTY_SIZE_THRESHOLD = 6;
export const SPECULATIVE_MISS_THRESHOLD = 0.6;
export const LLM_VIP_TURN_THRESHOLD = 5;

// Modèle LLM utilisé dans le pipeline vocal (pas le modèle Hermes).
// Benchmark 2026-07-22 : Gemini 3.5 Flash-Lite retenu comme challenger live :
//  - 36/36 appels d'outils strictement valides sur les scénarios Sokar assainis
//  - phrase prête pour le TTS : p50 990ms, p95 1615ms
//  - Mistral Small 3.2 : p50 1146ms, p95 2099ms sur le même protocole
//  - coût observé environ 4,3x supérieur, mais inférieur à $0.001 par scénario benchmark
//
// Configurable via VOICE_LLM_MODEL env var (résolu dans manager.ts au runtime)
// pour A/B test sans redeploiement de code.
export const VOICE_LLM_MODEL_DEFAULT = 'google/gemini-3.5-flash-lite';

export const TTS_PROVIDERS = ['cartesia', 'deepgram-aura'] as const;
export type TtsProvider = (typeof TTS_PROVIDERS)[number];

// ─── Phase 2 — Carrier ────────────────────────────────────────────────────
export const CARRIER_PROVIDERS = ['telnyx'] as const;
export type CarrierProvider = (typeof CARRIER_PROVIDERS)[number];
