export const PLANS = {
  STARTER:  { label: 'Starter' },
  PRO:      { label: 'Pro' },
  PREMIUM:  { label: 'Premium' },
} as const;

export const INTERNAL_CALL_ALERT_THRESHOLD = 3000;
export const CIRCUIT_BREAKER_HOURLY_LIMIT  = 200;
export const REDIS_CTX_TTL_SECONDS         = 300;
export const SMS_RATE_LIMIT_SECONDS        = 900;

export const CARTESIA_MODEL = 'sonic-3.5';
export const DEFAULT_CARTESIA_VOICE_ID = 'f786b574-daa5-4673-aa0c-cbe3e8534c02';

// ─── Sprint 2 — TTS Cache ─────────────────────────────────────────────────
export const TTS_CACHE_TTL_SECONDS      = 86_400 * 7;  // 7 jours
export const TTS_CACHE_MIN_LENGTH       = 8;

// ─── Sprint 2 — ROI / TheFork ──────────────────────────────────────────────
export const THEFORK_COMMISSION_PER_PAX = 3;

// ─── Sprint 2 — VIP / LLM ──────────────────────────────────────────────────
export const VIP_PARTY_SIZE_THRESHOLD   = 6;
export const SPECULATIVE_MISS_THRESHOLD = 0.60;
export const LLM_VIP_TURN_THRESHOLD     = 5;

// Slugs OpenRouter — alignés avec l'architecture consolidée Sprint 1
export const LLM_MODELS = {
  FLASH:    'deepseek/deepseek-v4-flash',
  PRO:      'deepseek/deepseek-v4-pro',
  FALLBACK: 'x-ai/grok-4.1-fast',
} as const;

export const TTS_PROVIDERS = ['cartesia', 'deepgram-aura'] as const;
export type  TtsProvider   = typeof TTS_PROVIDERS[number];

// ─── Sprint 2 — Carrier ────────────────────────────────────────────────────
export const CARRIER_PROVIDERS = ['vapi', 'telnyx'] as const;
export type  CarrierProvider   = typeof CARRIER_PROVIDERS[number];
