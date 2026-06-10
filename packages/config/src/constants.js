"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CARRIER_PROVIDERS = exports.TTS_PROVIDERS = exports.LLM_MODELS = exports.LLM_VIP_TURN_THRESHOLD = exports.SPECULATIVE_MISS_THRESHOLD = exports.VIP_PARTY_SIZE_THRESHOLD = exports.THEFORK_COMMISSION_PER_PAX = exports.TTS_CACHE_MIN_LENGTH = exports.TTS_CACHE_TTL_SECONDS = exports.DEFAULT_VOICE_ID = exports.SMS_RATE_LIMIT_SECONDS = exports.REDIS_CTX_TTL_SECONDS = exports.CIRCUIT_BREAKER_HOURLY_LIMIT = exports.INTERNAL_CALL_ALERT_THRESHOLD = exports.PLANS = void 0;
exports.PLANS = {
    ESSENTIAL: { label: 'Essential', price: 149 },
    PRO: { label: 'Pro', price: 249 },
    MULTI_SITE: { label: 'Multi-site', price: 249 },
};
exports.PLAN_LABEL_MAP = {
    STARTER: 'Essential',
    PRO: 'Pro',
    PREMIUM: 'Multi-site',
};
exports.PLAN_PRICE_MAP = {
    STARTER: 149,
    PRO: 249,
    PREMIUM: 249,
};
exports.INTERNAL_CALL_ALERT_THRESHOLD = 3000;
exports.CIRCUIT_BREAKER_HOURLY_LIMIT = 200;
exports.REDIS_CTX_TTL_SECONDS = 300;
exports.SMS_RATE_LIMIT_SECONDS = 900;
exports.DEFAULT_VOICE_ID = '21m00Tcm4TlvDq8ikWAM';
// ─── Sprint 2 — TTS Cache ─────────────────────────────────────────────────
exports.TTS_CACHE_TTL_SECONDS = 86_400 * 7; // 7 jours
exports.TTS_CACHE_MIN_LENGTH = 8;
// ─── Sprint 2 — ROI / TheFork ──────────────────────────────────────────────
exports.THEFORK_COMMISSION_PER_PAX = 3;
// ─── Sprint 2 — VIP / LLM ──────────────────────────────────────────────────
exports.VIP_PARTY_SIZE_THRESHOLD = 6;
exports.SPECULATIVE_MISS_THRESHOLD = 0.60;
exports.LLM_VIP_TURN_THRESHOLD = 5;
// Slugs OpenRouter — alignés avec l'architecture consolidée Sprint 1
exports.LLM_MODEL = 'mistralai/ministral-3b-2512';
exports.LLM_MODELS = {
    FLASH: 'deepseek/deepseek-v4-flash',
    PRO: 'deepseek/deepseek-v4-pro',
    FALLBACK: 'x-ai/grok-4.1-fast',
};
exports.TTS_PROVIDERS = ['elevenlabs', 'cartesia', 'deepgram-aura'];
// ─── Sprint 2 — Carrier ────────────────────────────────────────────────────
exports.CARRIER_PROVIDERS = ['vapi', 'telnyx'];
//# sourceMappingURL=constants.js.map