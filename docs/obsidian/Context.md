# Contexte Sokar

## Dernière activité

2026-05-21 11:28 — [api] Fix build errors + 28/28 tests verts. Clerk mocké en test, telnyx guard mocké. Routes reservation test adaptées au nouveau pipeline Telnyx.

## Décisions récentes

- **2026-05-21** — Crof AI `deepseek-v4-pro` ne fonctionne pas comme provider `custom` pour les subagents Hermes (`delegate_task`). Le provider normalise le model name en ajoutant `deepseek/` prefix (ex: `deepseek-v4-pro` → `deepseek/deepseek-v4-pro`), que Crof AI rejette en 404. Solution : le config est `provider: custom` + `base_url: https://crof.ai/v1` + `model: deepseek-v4-pro` — à tester dans une nouvelle session Hermes.
- **2026-05-21** — Clerk mocké dans les tests via `helpers.ts` (requireOrg/requireAuth vérifient l'en-tête `Authorization`). Telnyx webhook guard mocké dans `reservation.test.ts`.
- **2026-05-20** — Remplacer ElevenLabs par Cartesia Sonic 3.5 comme unique provider TTS. Modèle `sonic-3.5` (stable), voix Katie (multilingue, français OK). Colonne DB renommée `voice_id_el` → `voice_id_ca`.

## TODOs actifs

- [ ] Sprint 1 MVP

## Liens rapides

[[README]] [[Architecture]] [[Sprint 1]] [[Journal]]
