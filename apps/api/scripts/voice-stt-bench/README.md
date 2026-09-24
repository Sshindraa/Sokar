# Banc STT vocal

Mesure ce que la réservation vocale retient réellement d'une réponse d'appelant :
synthèse Cartesia → dégradation téléphonique → transcription Scribe de production →
dialogue réel (`recordUserTurn`), flag `VOICE_EXPECTED_ANSWER_ENABLED` coupé puis actif.

## Jeux de phrases

| Jeu           | Graine   | Voix                                    | Rôle                                                                                                                                             |
| ------------- | -------- | --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `calibration` | 20260924 | Henri, Josette, Fabien, Léonie          | régler `EXPECTED_ANSWER_THRESHOLDS` ; transcriptions du 24/09 réutilisées                                                                        |
| `validation`  | 20261001 | + Étienne, Inès (jamais en calibration) | seuls chiffres rapportés ; 304 phrases dont 60 hors sujet et les paires pièges six/dix, deux/douze, trois/treize, seize/six, 20 h/22 h, 8 h/20 h |

Jeux « difficiles » (phase 2) : `hard-calibration` (graine 20261101, voix de
calibration) et `hard-validation` (graine 20261115, + Mathis et Jade réservées),
344 phrases chacun dont 70 demandes à plusieurs valeurs (heure donnée en premier),
bruit 5–10 dB, 3–5 % de paquets perdus, une phrase sur deux au débit rapide. Les
transcriptions gardent les mots Scribe avec `logprob` et les partielles ; les seuils
de `SLOT_CONFIDENCE_THRESHOLDS` se règlent sur `hard-calibration` uniquement.

## Usage

```bash
cd apps/api
# 1. Phrases (local, gratuit)
pnpm exec tsx scripts/voice-stt-bench/phrases.ts validation > scripts/voice-stt-bench/.data/validation-phrases.json

# 2. Transcription (sur le serveur, consomme des crédits Cartesia et Scribe : demander l'accord)
node --env-file=.env scripts/voice-stt-bench/transcribe.cjs validation-phrases.json > validation-transcripts.json

# 3. Évaluation (local, gratuit) : tableau flag coupé / actif, IC de Wilson à 95 %
BENCH_VERBOSE=1 pnpm exec tsx scripts/voice-stt-bench/evaluate.ts \
  scripts/voice-stt-bench/.data/validation-phrases.json scripts/voice-stt-bench/.data/validation-transcripts.json
```

Tout ce que produisent les étapes 1 et 2 va dans `.data/`, ignoré par git. Seul un
résumé chiffré est commité (journal, description de PR).

## Limites

- Voix de synthèse, plus propres que de vrais appelants (accent, débit, bruit réel,
  micro de mauvaise qualité). Le banc **compare des variantes** ; il n'annonce pas le
  taux de réussite en production.
- La dégradation (bruit blanc, pertes de paquets de 20 ms, codec A-law) approxime un
  appel ; elle ne reproduit ni l'écho ni les coupures longues.
- Une seule réponse par phrase, sans le contexte d'un vrai dialogue (pas de relance).
- Au-delà de 7 personnes, la réservation vocale ne retient pas le nombre : ces phrases
  sont mesurées à part (`groupe > 7`).

## Garde-fous fournisseur

Les scripts de banc utilisent des clés dédiées (`ELEVENLABS_BENCH_API_KEY` et
`CARTESIA_BENCH_API_KEY`) et exigent un plafond `BENCH_MAX_CREDITS` avant toute requête.
Ils refusent les clés de production. Les étapes de synthèse et transcription consomment
les fournisseurs ; `evaluate.ts` reste hors ligne. Aucun banc ne doit être lancé sans
validation explicite du budget et du compte dédié.
