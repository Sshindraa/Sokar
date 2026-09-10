# Voice Architecture

- Carrier: Telnyx Media Stream.
- STT: ElevenLabs Scribe Realtime (`scribe_v2_realtime`), détection ciblée `fr,en,es,it,de,pt,nl` par défaut ; les 44 langues Sonic 3.6 sont activables via `ELEVENLABS_STT_ALL_LANGUAGES=true`.
- Dialogue multilingue: le code de langue du segment final Scribe devient la langue active de la session ; le LLM reçoit une consigne de raisonnement et de réponse dans cette langue.
- TTS: Cartesia Sonic 3.6 (`sonic-3.6`) reçoit une locale BCP-47 (`fr-FR`, `en-US`, etc.), `normalization=auto` et les contrôles `generation_config` de la personnalité ; le cache est séparé par modèle, voix, locale, codec, réglages et dictionnaire de prononciation. Le fallback Telnyx adapte aussi la locale pour le français et l'anglais.
- Pipeline: `apps/api/src/modules/voice/telnyx.pipeline.ts`.

For the full pipeline details, see `docs/obsidian/Telnyx Pipeline.md` and `docs/obsidian/Scribe Pipeline Media Stream.md`.
