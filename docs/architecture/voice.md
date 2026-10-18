# Voice Architecture

- **Routage dialogue V2** (`VOICE_DIALOGUE_LISTENING_V2`, défaut `false`) : le déterministe ne
  traite que la réponse directe, unique et non ambiguë à la question en attente. Une question, une
  correction/contradiction, une hésitation finale ou une boucle est confiée au LLM avec l'état utile ;
  les valeurs évoquées dans une question ne sont jamais enregistrées comme choix confirmé.
- Carrier: Telnyx Media Stream.
- STT: ElevenLabs Scribe Realtime (`scribe_v2_realtime`), détection ciblée `fr,en,es,it,de,pt,nl` par défaut ; les 44 langues Sonic 3.6 sont activables via `ELEVENLABS_STT_ALL_LANGUAGES=true`.
- Dialogue multilingue: le code de langue du segment final Scribe devient la langue active de la session ; le LLM reçoit une consigne de raisonnement et de réponse dans cette langue.
- TTS: Cartesia Sonic 3.6 (`sonic-3.6`) reçoit une locale BCP-47 (`fr-FR`, `en-US`, etc.), `normalization=auto` et les contrôles `generation_config` de la personnalité ; le cache est séparé par modèle, voix, locale, codec, réglages et dictionnaire de prononciation. Le fallback Telnyx adapte aussi la locale pour le français et l'anglais.
- **Démonstration en direct (onboarding)** : le navigateur joue le rôle de Telnyx sur `/voice/demo-stream/:ticket` (A-law 8 kHz, protocole `start`/`media`/`mark`/`clear` identique). Le ticket à usage unique est émis par `POST /restaurant/onboarding/live-demo` après authentification ; le WebSocket lui-même est public. La session porte `demo: true` : disponibilité et dialogue réels, mais réservation et message simulés, aucun transfert, aucun appel REST Telnyx, pas de finalisation d'appel. Un appel à la fois par restaurant, 180 s maximum, 20 essais par jour. Code : `apps/api/src/modules/voice/demo/`, client navigateur `apps/dashboard/src/features/onboarding/live-call/`. Prérequis infra : `PUBLIC_URL` joignable par le navigateur (ws/wss), upgrade WebSocket sur l'hôte API, `Permissions-Policy: microphone=(self)` sur l'hôte du dashboard.
- Pipeline: `apps/api/src/modules/voice/telnyx.pipeline.ts`.

For the full pipeline details, see `docs/obsidian/Telnyx Pipeline.md` and `docs/obsidian/Scribe Pipeline Media Stream.md`.
