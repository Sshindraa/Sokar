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

## Deuxième transcription (expérience, hors production)

Question : quand Scribe batch (B) n'est pas d'accord avec Scribe Realtime (A) sur
une valeur, cette valeur est-elle fausse ? Le désaccord détecte-t-il mieux les
erreurs que la confiance ?

```bash
# Sur le serveur (crédits Cartesia + Scribe Realtime + Scribe batch : demander l'accord).
# L'audio dégradé est écrit une fois dans audio-dir puis relu pour les deux moteurs.
node --env-file=.env scripts/voice-stt-bench/second-opinion.cjs \
  scripts/voice-stt-bench/.data/hard-validation-phrases.json \
  scripts/voice-stt-bench/.data/audio/hard-validation > hard-validation-second-opinion.json

# En local (gratuit) : précision A / B, accord, rappel et fausses alertes du
# désaccord, confiance à fausses alertes égales, délai p50 / p95 du batch.
pnpm exec tsx scripts/voice-stt-bench/second-opinion-eval.ts \
  .data/hard-validation-phrases.json .data/hard-validation-second-opinion.json
```

B : `POST /v1/speech-to-text`, `model_id=scribe_v2` (`BENCH_BATCH_MODEL` pour
changer), `language_code=fr`, mêmes `keyterms` que la production
(`buildSttKeyterms('Chez Sokar')`, +20 % sur le prix du batch), WAV PCM 8 kHz.
L'audio reste sur le serveur, jamais commité.

## Banc narrowband — ce que coûte G.711 (phase 1)

Mesure ce que la chaîne téléphonique narrowband coûte en précision de
transcription, **sans toucher à la prod**. Six conditions sur **exactement
les mêmes clips et les mêmes seeds** :

| Condition | Chaîne audio                                              | Scribe      | Chunks |
| --------- | --------------------------------------------------------- | ----------- | ------ |
| `A`       | 16 kHz PCM16 natif                                        | `pcm_16000` | 20 ms  |
| `B`       | 300–3400 Hz → 8 kHz → A-law → PCM16 8 kHz (prod actuelle) | `pcm_8000`  | 20 ms  |
| `C`       | comme `B` puis upsample 16 kHz                            | `pcm_16000` | 20 ms  |
| `D`       | comme `B`                                                 | `pcm_8000`  | 100 ms |
| `E`       | comme `B`, langue forcée `fr`                             | `pcm_8000`  | 20 ms  |
| `F`       | comme `B`, `filter_background_audio=true`                 | `pcm_8000`  | 20 ms  |

Tous les paramètres Scribe (langues, `keyterms`, VAD, `commit_strategy`) sont
lus depuis `stt-bridge.ts` via son build compilé : seuls `audio_format` et la
taille de chunk changent, sauf E (langue) et F (filtre), dont le nom décrit
l'unique réglage de modèle modifié. ElevenLabs interdit de combiner le filtre
avec `include_timestamps`; F omet donc ce paramètre explicite tout en gardant
`include_language_detection=true`. L'URL du chemin par défaut reste inchangée.

### Corpus

`nb-corpus.ts` : 31 phrases FR de réservation à informations critiques
normalisées (couverts, pièges six/dix et deux/douze, heures `vingt heures
trente` et `19h45`, dates, noms propres dont deux épellations, téléphones
**fictifs** 06 39 98 xx xx). Une variante propre et une variante bruitée
(souffle + ronflement + bouffées, seeds fixes à 15/10/7 dB) ; 3 répétitions par
condition et par variante.

### Usage

```bash
cd apps/api

# ELEVENLABS_BENCH_API_KEY doit déjà être présent dans le shell ou apps/api/.env.
# Le script refuse une clé absente ou identique à ELEVENLABS_API_KEY.
pnpm --filter api build

# F réduit : 8 phrases, propre/bruit, plus 3 contrôles bruit-seul B/F
# (54 sessions au total). Les seeds et masques de pertes sont appariés à B.
BENCH_TTS_PROVIDER=say BENCH_CONDITIONS=F BENCH_VARIANTS=clean,noisy \
BENCH_LIMIT=8 BENCH_CONCURRENCY=4 \
node --env-file=.env --import tsx scripts/voice-stt-bench/nb-run.ts \
  > scripts/voice-stt-bench/.data/nb-results-F-reduced.json

# F complet : 31 phrases, plus 3 contrôles bruit-seul pour B et F
# (192 sessions au total). L'estimation utilise le tarif API public en USD.
BENCH_TTS_PROVIDER=say BENCH_CONDITIONS=F BENCH_VARIANTS=clean,noisy \
BENCH_LIMIT=31 BENCH_CONFIRM=1 BENCH_CONCURRENCY=4 \
node --env-file=.env --import tsx scripts/voice-stt-bench/nb-run.ts \
  > scripts/voice-stt-bench/.data/nb-results-F.json

# Scoring F et faux déclenchements B/F sur bruit seul.
pnpm exec tsx scripts/voice-stt-bench/nb-score.ts \
  scripts/voice-stt-bench/.data/nb-results.json \
  scripts/voice-stt-bench/.data/nb-results-F.json

# Run historique A-D réduit : 2 clips, 4 conditions.
BENCH_LIMIT=2 BENCH_CONCURRENCY=4 \
node --env-file=.env --import tsx scripts/voice-stt-bench/nb-run.ts \
  > scripts/voice-stt-bench/.data/nb-results-reduced.json

# Run complet : 31 clips, 744 sessions (~43 min d'audio). BENCH_CONFIRM=1 obligatoire.
BENCH_CONFIRM=1 node --env-file=.env --import tsx scripts/voice-stt-bench/nb-run.ts \
  > scripts/voice-stt-bench/.data/nb-results.json

# Scoring local (gratuit) : critiques par catégorie, WER, latence, messages.
pnpm exec tsx scripts/voice-stt-bench/nb-score.ts scripts/voice-stt-bench/.data/nb-results.json

# Condition E seulement : B avec language_code=fr, TTS local say (186 sessions).
BENCH_TTS_PROVIDER=say BENCH_CONDITIONS=E BENCH_VARIANTS=clean,noisy \
  BENCH_LIMIT=31 BENCH_CONFIRM=1 BENCH_CONCURRENCY=4 \
  node --env-file=.env --import tsx scripts/voice-stt-bench/nb-run.ts \
  > scripts/voice-stt-bench/.data/nb-results-E.json

# Rescore hors ligne des slots récupérables après verrou FR, sans transcript en sortie.
pnpm exec tsx scripts/voice-stt-bench/nb-language-rescore.ts \
  scripts/voice-stt-bench/.data/nb-results.json \
  scripts/voice-stt-bench/.data/nb-results-E.json
```

Leviers : `BENCH_LIMIT`, `BENCH_CONCURRENCY`, `BENCH_CONDITIONS=A,B`,
`BENCH_VARIANTS=clean,noisy`, `BENCH_STT_MODEL`, `BENCH_TTS_PROVIDER`.

Le script affiche avant tout appel les sessions, secondes d'audio, coût Scribe
indicatif en USD et caractères TTS. L'estimation utilise le tarif public de
[Scribe Realtime ($0.39/heure)](https://elevenlabs.io/pricing/api), majoré de
20 % pour les keyterms selon la [référence Realtime](https://elevenlabs.io/docs/api-reference/speech-to-text/v-1-speech-to-text-realtime) ;
le montant réellement facturé dépend du forfait. `say` est local et ne facture
pas de TTS. `BENCH_CONFIRM=1` est obligatoire au-delà de 8 clips.

### Sources audio

`BENCH_TTS_PROVIDER` = `cartesia` (défaut, 16 kHz) ou `elevenlabs`
(`pcm_16000`), ou `say` (voix macOS, hors ligne, plusieurs voix FR). L'audio
16 kHz est mis en cache dans `.data/audio16/` : les quatre conditions relisent
le même signal.

### Vérification hors ligne (sans crédit)

`nb-mock-scribe.ts` est un faux Scribe Realtime qui reconnaît les clips non
dégradés et renvoie un texte de repli pour les autres. Il valide la plomberie
(conditions, chunks, latence, messages, scoring) **sans consommer de crédit** ;
ce n'est pas une mesure.

```bash
# Valeur factice locale uniquement, jamais une clé fournisseur; rien ne part sur le réseau.
read -rs ELEVENLABS_BENCH_API_KEY
export ELEVENLABS_BENCH_API_KEY
node --import tsx scripts/voice-stt-bench/nb-mock-scribe.ts &
BENCH_TTS_PROVIDER=say BENCH_STT_URL=ws://127.0.0.1:8799 BENCH_LIMIT=2 \
  node --env-file=.env --import tsx scripts/voice-stt-bench/nb-run.ts \
  > scripts/voice-stt-bench/.data/nb-offline.json
pnpm exec tsx scripts/voice-stt-bench/nb-score.ts scripts/voice-stt-bench/.data/nb-offline.json
```

### Coût et garde-fous

Run complet A-D : 31 clips × 4 conditions × 6 sessions = **744 sessions**, ~2 600 s
d'audio streamé (~43 min) silence final compris. Au tarif observé du compte
gratuit ElevenLabs (~1 crédit/seconde), cela représente ~2 600 crédits, soit
environ un quart du quota mensuel de 10 000. Le banc **ne doit pas** tourner sur
la clé de production : le 24/09, un run sur ce compte a épuisé le quota partagé
prod/staging. Prévoir une clé dédiée `ELEVENLABS_BENCH_API_KEY`.

Le run F complet envoie 186 sessions parlées et 6 contrôles bruit-seul B/F,
soit **192 sessions Scribe**. `say` est local et gratuit côté TTS. L'estimation
des secondes d'audio streamé, silence final inclus, est affichée avant le run.
