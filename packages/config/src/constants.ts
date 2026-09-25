export const PLANS = {
  ESSENTIAL: { label: 'Essential', price: 199 },
  PRO: { label: 'Pro', price: 299 },
  MULTI_SITE: { label: 'Multi-site', price: 249 },
} as const;

// Legacy mapping — DB still uses STARTER / PREMIUM until migration
export const PLAN_LABEL_MAP: Record<string, string> = {
  STARTER: 'Essential',
  PRO: 'Pro',
  PREMIUM: 'Multi-site',
};

export const PLAN_PRICE_MAP: Record<string, number> = {
  ESSENTIAL: 199,
  STARTER: 199,
  PRO: 299,
  PREMIUM: 249, // Multi-site base price remains 249€ + 99€/site
};

export const INTERNAL_CALL_ALERT_THRESHOLD = 3000;
export const CIRCUIT_BREAKER_HOURLY_LIMIT = 200;
export const REDIS_CTX_TTL_SECONDS = 300;
export const SMS_RATE_LIMIT_SECONDS = 900;
/** Default maximum group size shared by online and phone reservations. */
export const DEFAULT_MAX_PARTY_SIZE = 7;

// Follow Cartesia's latest stable Sonic 3.6 snapshot automatically.
// Change this deliberately if reproducible voice behavior becomes a release gate.
export const CARTESIA_MODEL = 'sonic-3.6';
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
//
// Provider par défaut : Groq en direct, endpoint OpenAI-compatible.
//  - identifiant : qwen/qwen3.8-27b (Cerebras : qwen-3.8-27b)
//  - tool use + streaming supportés, mode instruct (raisonnement désactivé)
//  - TTFT ~151 ms (LPU), $0.59/$0.79 par million de tokens
//
// Le modèle reste configurable par environnement (`VOICE_LLM_MODEL`) pour un
// canary sans changement de code. Le provider est choisi par
// `VOICE_LLM_PROVIDER` ; il n'y a pas de repli de l'un vers l'autre : une panne
// dégrade l'appel vers une réponse parlée déterministe.
export const VOICE_LLM_MODEL_DEFAULT = 'qwen/qwen3.8-27b';
export const GROQ_BASE_URL = 'https://api.groq.com/openai/v1';
export const CEREBRAS_BASE_URL = 'https://api.cerebras.ai/v1';
/** Providers LLM vocaux (API OpenAI-compatible). Un seul est actif à la fois, sans repli. */
export const VOICE_LLM_PROVIDERS = ['groq', 'cerebras'] as const;
export type VoiceLlmProviderName = (typeof VOICE_LLM_PROVIDERS)[number];

export const TTS_PROVIDERS = ['cartesia'] as const;
export type TtsProvider = (typeof TTS_PROVIDERS)[number];

// ─── Phase 2 — Carrier ────────────────────────────────────────────────────
export const CARRIER_PROVIDERS = ['telnyx'] as const;
export type CarrierProvider = (typeof CARRIER_PROVIDERS)[number];

export * from './entitlements';
