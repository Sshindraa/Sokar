export declare const PLANS: {
    readonly STARTER: {
        readonly label: "Starter";
    };
    readonly PRO: {
        readonly label: "Pro";
    };
    readonly PREMIUM: {
        readonly label: "Premium";
    };
};
export declare const INTERNAL_CALL_ALERT_THRESHOLD = 3000;
export declare const CIRCUIT_BREAKER_HOURLY_LIMIT = 200;
export declare const REDIS_CTX_TTL_SECONDS = 300;
export declare const SMS_RATE_LIMIT_SECONDS = 900;
export declare const DEFAULT_VOICE_ID = "21m00Tcm4TlvDq8ikWAM";
export declare const TTS_CACHE_TTL_SECONDS: number;
export declare const TTS_CACHE_MIN_LENGTH = 8;
export declare const THEFORK_COMMISSION_PER_PAX = 3;
export declare const VIP_PARTY_SIZE_THRESHOLD = 6;
export declare const SPECULATIVE_MISS_THRESHOLD = 0.6;
export declare const LLM_VIP_TURN_THRESHOLD = 5;
// Modèle LLM unique
export declare const LLM_MODEL = "mistralai/ministral-3b-2512";
export declare const TTS_PROVIDERS: readonly ["cartesia", "deepgram-aura"];
export type TtsProvider = typeof TTS_PROVIDERS[number];
export declare const CARRIER_PROVIDERS: readonly ["vapi", "telnyx"];
export type CarrierProvider = typeof CARRIER_PROVIDERS[number];
//# sourceMappingURL=constants.d.ts.map