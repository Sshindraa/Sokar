export const PLANS = {
  ESSENTIAL:  { label: 'Essential', price: 149 },
  PRO:        { label: 'Pro',       price: 249 },
  MULTI_SITE: { label: 'Multi-site', price: 249 },
} as const;

// Legacy mapping — DB still uses STARTER / PREMIUM until migration
export const PLAN_LABEL_MAP: Record<string, string> = {
  STARTER:  'Essential',
  PRO:      'Pro',
  PREMIUM:  'Multi-site',
};

export const PLAN_PRICE_MAP: Record<string, number> = {
  STARTER:  149,
  PRO:      249,
  PREMIUM:  249, // Multi-site base price
};

export const INTERNAL_CALL_ALERT_THRESHOLD = 3000;
export const CIRCUIT_BREAKER_HOURLY_LIMIT  = 200;
export const REDIS_CTX_TTL_SECONDS         = 300;
export const SMS_RATE_LIMIT_SECONDS        = 900;

export const CARTESIA_MODEL = 'sonic-3.5';
export const DEFAULT_CARTESIA_VOICE_ID = 'f786b574-daa5-4673-aa0c-cbe3e8534c02';

// ─── Sprint 2 — TTS Cache ─────────────────────────────────────────────────
export const TTS_CACHE_TTL_SECONDS      = 86_400 * 7;  // 7 jours
export const TTS_CACHE_MIN_LENGTH       = 8;

// ─── Filler Cache (persistant en Redis) ────────────────────────────────────
// Les fillers audio sont pré-générés au boot et cachés 30 jours pour éviter
// de payer Cartesia à chaque restart pm2. 13 fillers × ~200 bytes = ~5 KB total.
export const FILLER_CACHE_TTL_SECONDS   = 86_400 * 30;  // 30 jours

// ─── Sprint 2 — ROI / TheFork ──────────────────────────────────────────────
export const THEFORK_COMMISSION_PER_PAX = 3;
export const DEFAULT_AVERAGE_TICKET      = 35; // € par personne — fallback si pas de estimatedRevenue en DB

// ─── Sprint 2 — VIP / LLM ──────────────────────────────────────────────────
export const VIP_PARTY_SIZE_THRESHOLD   = 6;
export const SPECULATIVE_MISS_THRESHOLD = 0.60;
export const LLM_VIP_TURN_THRESHOLD     = 5;

// Modèle LLM unique
export const LLM_MODEL = 'mistralai/ministral-3b-2512';

export const TTS_PROVIDERS = ['cartesia', 'deepgram-aura'] as const;
export type  TtsProvider   = typeof TTS_PROVIDERS[number];

// ─── Sprint 2 — Carrier ────────────────────────────────────────────────────
export const CARRIER_PROVIDERS = ['vapi', 'telnyx'] as const;
export type  CarrierProvider   = typeof CARRIER_PROVIDERS[number];
