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
// Benchmark 2026-07-24 : Gemma 4 31B sur Cerebras retenu comme primaire :
//  - Modèle 2026 (avril), plus intelligent que Llama 3.3 70B
//  - 6/6 appels d'outils valides, function calling natif
//  - TTFT 403ms (Cerebras WSE-3), 1442 tok/s throughput
//  - $2.15/$2.70 per M tokens sur Cerebras
//
// Fallback : Llama 3.3 70B sur Groq via OpenRouter (plus rapide) :
//  - 6/6 appels d'outils valides
//  - TTFT 151ms (Groq LPU), avg tool call 339ms
//  - $0.59/$0.79 per M tokens sur Groq
//  - Déclenchement : erreur primaire (429, 5xx, timeout)
//
// Architecture bidirectionnelle : VOICE_LLM_PROVIDER détermine le primaire.
// - "cerebras" (défaut) : Gemma 4 primaire, Llama fallback
// - "openrouter"        : Llama primaire, Gemma fallback
//
// Configurable via VOICE_LLM_MODEL / VOICE_LLM_FALLBACK_MODEL / VOICE_LLM_PROVIDER
// env vars (résolu dans manager.ts au runtime) pour A/B test sans redeploiement.
export const VOICE_LLM_MODEL_DEFAULT = 'gemma-4-31b';
export const VOICE_LLM_FALLBACK_MODEL_DEFAULT = 'meta-llama/llama-3.3-70b-instruct';
export const CEREBRAS_BASE_URL = 'https://api.cerebras.ai/v1';

export const TTS_PROVIDERS = ['cartesia', 'deepgram-aura'] as const;
export type TtsProvider = (typeof TTS_PROVIDERS)[number];

// ─── Phase 2 — Carrier ────────────────────────────────────────────────────
export const CARRIER_PROVIDERS = ['telnyx'] as const;
export type CarrierProvider = (typeof CARRIER_PROVIDERS)[number];
