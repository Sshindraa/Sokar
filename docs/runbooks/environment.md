# Runbook — Environment

> **Statut : ACTIF — audité le 13 septembre 2026.** Les versions locales sont indicatives ; lancer
> `node --version`, `pnpm --version` et `pnpm node:check` avant un diagnostic d'environnement. Voir
> [`../DOCUMENTATION_STATUS.md`](../DOCUMENTATION_STATUS.md).

## Node version

- Repo constraint: `>=20.0.0 <23.0.0` (root `package.json` engines).
- `.nvmrc` = `22`.
- `.npmrc` has `engine-strict=true` — `pnpm` refuses to run under Node 26+.
- Local Mac vérifié le 12 septembre 2026 : Node 22.23.2 est le défaut à `~/.local/bin/node`
  (symlink vers `~/.hermes/node/bin/node`). Aucun préfixe PATH n'est nécessaire pour `pnpm`.
- pnpm 10.33.3 installed via `npm i -g pnpm@10.33.3`, symlinked at `~/.local/bin/pnpm`.

## Convention

- One `.env` file per app, sourced at startup. No `.env.prod`.
- `NEXT_PUBLIC_*` is baked at build time — must be present during `next build`, not only at runtime.
- Deploy scripts fail-fast if a critical `.env` is missing (API, dashboard, connect).
- `packages/database/.env` is the only intentional duplicate: Prisma CLI does not follow symlinks and does not read `.env.local` from the root.

## MCP et OAuth

- `OAUTH_ISSUER_URL` est une URL validée au démarrage. En son absence, `API_URL` sert d'issuer ;
  les métadonnées OAuth ne retombent plus sur localhost en production.
- `MCP_ALLOWED_ORIGINS` est une liste facultative d'origines navigateur supplémentaires, séparées
  par des virgules et validées au démarrage. Les origines MCP connues sont déjà autorisées sur
  `/mcp`, y compris pour le preflight CORS. `CORS_ORIGINS` continue de protéger les autres routes.
- Les échecs d'authentification MCP sont limités à 30 par minute et par IP ; un token valide est
  ensuite soumis au budget partagé de 60 requêtes par minute et par client.

## Files

| File                         | Role                                                              |
| ---------------------------- | ----------------------------------------------------------------- |
| `.env.local` (root)          | `DATABASE_URL`, `REDIS_URL`, `POSTGRES_PASSWORD`                  |
| `packages/database/.env`     | `DATABASE_URL` for Prisma CLI (`db:push`, `db:seed`, `db:studio`) |
| `apps/connect/.env`          | Connect dev vars (`SITE_URL`, `API_URL`, `NEXT_PUBLIC_API_URL`)   |
| `apps/api/.env` (prod)       | All API vars (Telnyx, Deepgram, Cartesia, DB, Redis, etc.)        |
| `apps/dashboard/.env` (prod) | Clerk keys, `API_URL`, Sentry                                     |
| `apps/connect/.env` (prod)   | `SITE_URL`, `API_URL`, `NEXT_PUBLIC_API_URL`, `DASHBOARD_URL`     |

## Base de données locale

La base de dev (`sokar`) est gérée par `pnpm db:push`, pas par migrations : elle n'a **aucun
historique** dans `_prisma_migrations`. `prisma migrate status` liste donc les 78 migrations comme
« non appliquées » alors que le schéma est bien en place. C'est attendu, et il ne faut pas chercher
à corriger ce chiffre.

- Pour synchroniser le schéma local : `pnpm db:push`. Jamais `prisma migrate deploy` en local, qui
  tenterait de recréer toutes les tables par-dessus l'existant.
- `pnpm db:push` refuse toute cible non locale depuis le 21 septembre 2026
  (`scripts/quality/check-db-push-target.mjs`, chantier R1-5). Sur une base partagée, écrire une
  migration et la déployer. Le forçage existe pour une base de test distante jetable :
  `SOKAR_ALLOW_REMOTE_DB_PUSH=I-UNDERSTAND-DB-PUSH-IS-DESTRUCTIVE`. Voir
  [`migration.md`](./migration.md).
- `db:push` peut réclamer `--accept-data-loss` pour un simple index unique : vérifier le diff avant
  d'accepter avec
  `prisma migrate diff --from-url "$DATABASE_URL" --to-schema-datamodel prisma/schema.prisma --script`.
  Il doit être purement additif — aucun `DROP`, aucun `ALTER COLUMN ... TYPE`.
- `sokar_preview` suit la même logique ; elle était à jour au 21 septembre 2026.
- Sauvegarder avant toute synchro : `pg_dump` doit être en version 17
  (`/opt/homebrew/opt/postgresql@17/bin/pg_dump`). Le binaire 16 du `PATH` refuse de dumper un
  serveur 17 (« server version mismatch »).

### Clé Clerk staging

La clé Development est stockée dans le secret GitHub Actions `CLERK_SECRET_KEY`
(préfixe `sk_test_`). Le workflow `Deploy Staging` valide le préfixe, transfère
temporairement le secret vers le VPS avec des permissions strictes, puis appelle
`scripts/ops/sync-clerk-secret.sh`, qui met à jour atomiquement les deux fichiers
privés du VPS et supprime le fichier de transport :
`/opt/sokar-staging/apps/api/.env` et
`/opt/sokar-staging/apps/dashboard/.env`. Ces fichiers ne sont pas suivis par
Git et ne doivent jamais être créés dans le dépôt ou copiés dans le navigateur.
La production utilise un secret live séparé ; le workflow de production ne
réutilise pas la clé staging.

### Alerting de production

Les secrets GitHub de l’environnement `production` (et, si souhaité, `staging`)
peuvent fournir `SENTRY_DSN`, `ALERT_EMAIL_TO`, `ALERT_WEBHOOK_URL` et
`ALERT_SMS_TO`. Le workflow les synchronise vers `apps/api/.env` sans les
afficher. `ALERT_WEBHOOK` et `HEALTHCHECKS_PING_URL` alimentent le watchdog VPS
dans `/etc/sokar/watchdog.env`, fichier root lisible uniquement par le cron.
Si aucun secret n’est défini, le déploiement conserve la configuration existante.

Ces canaux servent au monitoring interne de Sokar. Ils ne constituent pas une
notification client et ne peuvent pas limiter la consommation d'un restaurant.
La promesse Essential/Pro reste sans quota ; le suivi visuel par établissement
se fait dans l'espace opérateur séparé `/admin/margin` (l'ancienne URL
`/dashboard/admin/margin` redirige les opérateurs vers cette surface). Les variables optionnelles
`USAGE_ALERT_VOICE_BUDGET_MINUTES` et `USAGE_ALERT_SMS_BUDGET_SEGMENTS` ne
définissent que des budgets de cost-watch opérateur.

### Espace opérateur Sokar

Le dashboard restaurant et l'espace opérateur ont des URLs et des layouts distincts :

- `https://sokar.tech/dashboard` pour un établissement ;
- `https://sokar.tech/admin` pour l'équipe Sokar.

Les pages `/admin/*` et les routes API `/admin/*` exigent un identifiant Clerk présent dans
`SOKAR_OPERATOR_USER_IDS`, une liste CSV injectée uniquement dans l'environnement de l'API par
`scripts/ops/sync-operator-allowlist.sh` depuis la variable GitHub Actions de l'environnement.
En développement local, `apps/api/.env` autorise explicitement l'utilisateur de démonstration
`dev-user`; cette valeur ne doit jamais être utilisée en production. Un membre de restaurant qui
ouvre une ancienne URL `/dashboard/admin/*` est renvoyé vers son dashboard.

Le feed interne de coûts `/api/internal/usage/margin` exige un secret séparé
`SOKAR_INTERNAL_USAGE_TOKEN`. Il est injecté uniquement dans l'environnement
de l'API opérateur et envoyé dans l'en-tête `x-sokar-internal-usage-token`.
Sans ce secret, la route répond `503`; elle ne doit jamais être ajoutée à un
écran ou une intégration client.

`RESERVATION_SERVICE_TOKEN` protège la route legacy `POST /reservations`. Il
doit être généré et injecté uniquement par le secret manager (au moins 32
caractères), jamais dans le dépôt, le navigateur ou les payloads Connect. Les
workflows staging et production le synchronisent vers `apps/api/.env` via
`scripts/ops/sync-reservation-token.sh`. Le pipeline vocal n'en a pas besoin :
il appelle `ReservationService` dans le processus API.

Pour la télémétrie Service Copilot, définir `SERVICE_COPILOT_TELEMETRY_SECRET` dans l’environnement
de l’API (valeur aléatoire d’au moins 32 caractères). Elle signe les jetons de recommandation ; ne pas
la réutiliser pour un autre usage et ne jamais la mettre dans une variable `NEXT_PUBLIC_*`.

### Marketing CRM local

Les variables suivantes sont nécessaires uniquement pour le contrôle marketing CRM en local ou en
staging contrôlé. Elles ne doivent jamais être committées ni exposées au dashboard :

| Variable                         | Rôle et défaut sûr                                                                                                                                    |
| -------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `MARKETING_ATTRIBUTION_SECRET`   | Secret HMAC des liens d'attribution, au moins 32 caractères ; absence = liens refusés.                                                                |
| `MARKETING_UNSUBSCRIBE_SECRET`   | Secret HMAC des désinscriptions, au moins 32 caractères ; à séparer du secret d'attribution en environnement réel.                                    |
| `MARKETING_UNSUBSCRIBE_BASE_URL` | URL absolue optionnelle de la route publique de désinscription ; sinon `API_URL/marketing/unsubscribe`.                                               |
| `MARKETING_SENDS_ENABLED`        | `false` par défaut ; seul `true` autorise les routes et le worker à appeler un fournisseur.                                                           |
| `MARKETING_WHATSAPP_ENABLED`     | `false` par défaut ; doit rester `false` tant que le template et le compte WhatsApp ne sont pas qualifiés.                                            |
| `SOKAR_INTERNAL_MARKETING_TOKEN` | Jeton opérateur séparé pour `/api/internal/marketing/reconciliation`; absent = route désactivée (`503`).                                              |
| `CRM_SENSITIVE_NOTE_ROLES`       | Fallback CSV des rôles pouvant lire les notes CRM ; `OWNER,MANAGER` par défaut. Une surcharge par site se configure via `PATCH /crm/privacy` (Owner). |

### POS, paiements et CRM groupe en qualification

Ces flags sont indépendants des entitlements et doivent rester fermés dans les environnements
suivis tant qu'un pilote n'a pas produit ses preuves externes :

| Variable                       | Défaut sûr | Ce que l'ouverture autorise                                                                                                                                                      |
| ------------------------------ | ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POS_CONNECTORS_ENABLED`       | `false`    | Routes POS provider-neutral, import de tickets et matcher ; aucun fournisseur n'est appelé sans adaptateur qualifié.                                                             |
| `RESERVATION_PAYMENTS_ENABLED` | `false`    | Policies et préparation de paiement de réservation, webhook signé ; aucun intent, hold, capture ou remboursement réel n'est créé par le socle local.                             |
| `CUSTOMER_GROUPS_ENABLED`      | `false`    | API d'identité de groupe Multi-site, sous consentement ; aucun rapprochement automatique ni campagne inter-sites n'est activé.                                                   |
| `REPUTATION_ENABLED`           | `false`    | Demandes de feedback post-visite et récupération locale ; aucun envoi ni fournisseur d'avis n'est déclenché par le socle.                                                        |
| `LOYALTY_ENABLED`              | `false`    | Catalogue d'avantages et grants à code hashé ; aucun point, envoi, POS ou débit n'est déclenché par le socle.                                                                    |
| `EXPERIENCES_ENABLED`          | `false`    | Catalogue, sessions, capacité et réservations d'expériences ; aucun paiement, widget, téléphone ou canal événementiel externe n'est déclenché par le socle.                      |
| `EVENTS_ENABLED`               | `false`    | Catalogue, sessions, tarifs, jauges, billets, check-in et liste d'attente ; aucun paiement, facture fiscale, notification ou canal de distribution n'est déclenché par le socle. |
| `DISTRIBUTION_ENABLED`         | `false`    | Connexions, snapshots, runs, liens et inbox webhook provider-neutral ; aucun OAuth, secret fournisseur, webhook public ou appel Google/Meta/API n'est déclenché par le socle.    |

Avant toute ouverture, vérifier la capability correspondante (`pos.connect`,
`reservations.payments`, `customers.group`, `reputation.feedback`, `reputation.loyalty` ou
`experiences.manage`, `events.manage` ou `distribution.manage`), le
rôle Owner/Manager/Staff adapté à l'opération, le backup, le plan de rollback et le compte de test
explicitement autorisé. Les secrets fournisseur restent dans le gestionnaire
de secrets ; aucune valeur ne doit être ajoutée aux fichiers `.env.example`.

Le flag d'envoi est indépendant des entitlements : un restaurant Pro peut préparer et rapporter une
campagne sans qu'un provider externe soit appelé. Tout changement de secret ou de flag doit être
rejoué sur un environnement non productif, avec consentement de test et rollback documenté.

## Voice LLM

Le chemin vocal a un seul fournisseur LLM : **Cerebras** (API OpenAI-compatible,
modèle Qwen 3.8). Groq a été retiré le 27 septembre 2026 ; `GROQ_*`,
`VOICE_LLM_HEDGE_*` et `VOICE_LLM_FALLBACK_MODEL` ne sont plus lus, et
`VOICE_LLM_PROVIDER=groq` est refusé au démarrage.

Définir dans `apps/api/.env` :

```dotenv
VOICE_LLM_PROVIDER="cerebras"        # seule valeur acceptée (défaut)
CEREBRAS_API_KEY="csk-..."
CEREBRAS_BASE_URL="https://api.cerebras.ai/v1"
VOICE_LLM_MODEL="qwen-3.8-27b"
VOICE_LLM_TIMEOUT_MS="8000"
# Premier fragment du modèle principal (tour structuré) : au-delà, OpenRouter prend le tour (500 à 8000 ms).
VOICE_LLM_FIRST_CHUNK_TIMEOUT_MS="2500"
# Hedging (tour structuré) : si le principal n'a pas produit son premier fragment après ce délai, la même
# requête part chez OpenRouter et le premier flux gardé ; l'autre est annulé. 0 = désactivé (0 à 4000 ms).
# Exige OPENROUTER_API_KEY. Trois tours de suite gagnés par le doublon ouvrent le disjoncteur du principal.
VOICE_LLM_HEDGE_MS="700"
```

En production, `CEREBRAS_API_KEY` est obligatoire (≥20 caractères). Les
clés sont des secrets locaux au VPS, jamais commités ni envoyés dans le chat.

Secours du tour structuré (restaurants de `VOICE_STRUCTURED_TURN_RESTAURANT_IDS`) :
si le provider principal échoue avant le premier fragment (402 quota, 429, 5xx,
réseau, circuit ouvert), la même requête JSON Schema stricte part vers
OpenRouter, routée vers l'hébergeur le plus rapide qui respecte
`response_format`. Sans `OPENROUTER_API_KEY`, pas de secours : le tour dit la
phrase de repli. Mesuré le 26 septembre (banc réel) : 0 sortie invalide, mais
début de phrase vers 2 s au lieu de ~350 ms, et `awaiting` parfois `open`.
C'est un filet d'urgence, pas un provider de production.

```dotenv
OPENROUTER_API_KEY=<clé OpenRouter, secret local au VPS>
OPENROUTER_BASE_URL="https://openrouter.ai/api/v1"        # défaut ; Jev (API decisions), juge d'évaluation, suivi de crédit
# Adresse du SEUL secours vocal (tour structuré, chemin à outils, doublon de hedging) ; vide = OPENROUTER_BASE_URL.
# Routage UE : https://eu.openrouter.ai/api/v1. Séparée parce que Jev n'existe pas en UE (decisions répond 404).
# Mesure du 01/10 : voir docs/runbooks/provider-resilience.md (un seul hébergeur UE pour le modèle de repli).
OPENROUTER_FALLBACK_BASE_URL=""
VOICE_STRUCTURED_FALLBACK_MODEL="deepseek/deepseek-v4-flash-0731"  # défaut ; modèle de repli OpenRouter du tour structuré ET du chemin à outils (autres restaurants)
# Hébergeurs du repli, dans l'ordre (vide = tri par latence historique, instable : pointes de 5 à 30 s le 29/09).
VOICE_STRUCTURED_FALLBACK_PROVIDER_ORDER="Cohere,Wafer,Baidu"
```

Latence du tour structuré (mesures du 27 septembre, appel 25650799 et rejeu des
appels enregistrés) :

```dotenv
# Premier passage lancé sur une partielle Deepgram stable, repris seulement si
# la requête finale est identique (rien n'est dit ni exécuté avant).
VOICE_STRUCTURED_SPECULATION_ENABLED="false" # opt-in
VOICE_STRUCTURED_SPECULATION_MS="250"
# Spéculation à la pause : la requête part dès que l'appelant a été silencieux ce délai (détecteur de
# voix sur l'audio entrant), pas 250 ms après la dernière partielle, et pas pendant qu'il parle ;
# ainsi la réponse est prête pendant l'attente avant le premier son (VOICE_FIRST_AUDIO_SILENCE_MS).
# 0 : ancien déclenchement (VOICE_STRUCTURED_SPECULATION_MS). Plafond de requêtes spéculatives
# par tour (~3 k tokens chacune ; la clé Cerebras est limitée à 150 k tokens/minute).
# Métriques : sokar_voice_structured_speculation_total{outcome=hit|miss_*|none},
# sokar_voice_structured_speculation_launch_total{result=started|capped}.
VOICE_STRUCTURED_SPECULATION_PAUSE_MS="150"
VOICE_STRUCTURED_SPECULATION_MAX_LAUNCHES="3"
# Partielle Deepgram figée : Finalize après ce délai (appel 25650799 : 8 s).
VOICE_DEEPGRAM_STALL_FINALIZE_MS="1200"
# Même chose pour une partielle d'un ou deux mots (« 4 », « oui », « demain ») :
# appel c5d6b07d, « 4 » attendait 2,7 s. Une fin trop tôt est rattrapée par le tour
# structuré (turnComplete=false, fragment recollé). Défaut : égal au délai normal.
VOICE_DEEPGRAM_SHORT_STALL_FINALIZE_MS="1200"
# Garde de silence : une fin de tour forcée (partielle figée, jugement du modèle) attend que
# l'audio de l'appelant soit silencieux depuis ce délai, au lieu de tomber pendant qu'il parle
# (appel 5cebe456 : 11 fins de tour forcées sur 17 tombaient pendant la parole). 0 désactive.
# Le report cumulé est plafonné (bruit, écho) : au-delà, le comportement d'avant reprend.
# Métrique : sokar_voice_silence_guard_total{outcome=held|released_after_silence|released_at_cap}.
VOICE_STT_SILENCE_GUARD_MS="350"
VOICE_STT_SILENCE_GUARD_MAX_DEFER_MS="1500"
# Pendant une épellation (nom attendu), la garde est plus longue : les pauses entre deux groupes de lettres
# durent souvent plus d'une seconde (appel 8043662c : « …assam un » jugé fini à 428 ms de silence, le « a »
# suivant perdu). Défaut 1200 ms ; 0 : la garde normale. Le report maximal est alors d'au moins ce délai + 600 ms.
VOICE_STT_SPELLING_SILENCE_GUARD_MS="1200"
# Attente avant le premier son d'une réponse : elle est déjà calculée (texte et voix) mais ne part
# que si l'appelant est silencieux depuis ce délai ; s'il reprend la parole pendant l'attente,
# elle est jetée sans qu'il ait entendu un mot (comme un barge-in, sans attendre la transcription).
# Contexte Cartesia seulement (voix de secours HTTP non concernée). 0 désactive. Le plafond évite
# qu'un bruit continu bloque une réponse. Métriques : sokar_voice_first_audio_hold_total{outcome},
# sokar_voice_first_audio_hold_ms ; télémétrie de tour : événement first_audio_hold.
VOICE_FIRST_AUDIO_SILENCE_MS="600"
VOICE_FIRST_AUDIO_HOLD_CAP_MS="1200"
# Coupure rapide de l'agent : quand la voix de l'appelant (audio entrant) dépasse le niveau RMS
# indiqué pendant cette durée alors que l'agent parle, la lecture est mise EN PAUSE tout de suite
# (~0,14 s), au lieu d'attendre la première transcription partielle (0,7 à 1,3 s). Comme l'écho de
# l'agent peut déclencher la détection, on confirme : transcription = barge-in habituel ; sinon, après
# CONFIRM_MS, appelant encore en train de parler = coupure, silence = la lecture reprend. 0 désactive.
# Contexte Cartesia seulement. Métrique : sokar_voice_fast_barge_in_total{outcome=paused|escalated|resumed}.
VOICE_FAST_BARGE_IN_MS="80"
VOICE_FAST_BARGE_IN_MIN_RMS="800"
VOICE_FAST_BARGE_IN_CONFIRM_MS="500"
# Pas de voix, pas de tour : une transcription (partielle ou validée) n'interrompt l'agent et n'ouvre un
# tour que si l'audio entrant contient de la voix depuis le début de l'énoncé (détecteur RMS de
# caller-voice-activity, marge 1,5 s pour le retard de la reconnaissance). Écarte les textes fantômes
# (bruit, écho de l'agent : appel 30172d22, piste appelant muette, « bon » puis « bonjour » coupaient
# l'agent à chaque réponse). Ne juge qu'après 500 ms d'audio suivi. La voix d'un tour déjà envoyé à
# l'agent ne compte pas : il faut de la voix arrivée au-delà de la fin de ses mots (+150 ms ; appel
# 6a70dff9, « 4 » fantôme 1,3 s après « pour quatre »). "false" ou "0" rétablit l'ancien
# comportement. Métrique : sokar_voice_no_caller_voice_transcript_total{stage=partial|committed}.
VOICE_REQUIRE_CALLER_VOICE="true"
# Fin de tour jugée par le modèle (nécessite VOICE_STRUCTURED_SPECULATION_ENABLED) : dès que
# le premier passage spéculatif renvoie turnComplete=true sur une partielle inchangée, on
# envoie Finalize sans attendre le minuteur de partielle figée. Aucune liste de phrases : le
# modèle juge dans le contexte. turnComplete=false ne change rien (le minuteur reste le filet).
VOICE_STRUCTURED_SEMANTIC_FINALIZE_ENABLED="false"
# Silence avant de répondre à un tour que le modèle juge inachevé (ms, 800 à 6000, défaut 2000),
# mesuré depuis la transcription finale. Tant que des mots arrivent, la réponse est reportée (5 fois max).
VOICE_INCOMPLETE_TURN_SILENCE_MS="2000"
# Vérification de compréhension du tour structuré (restaurants listés, vide = aucun). Le modèle lit
# littéralement ce que l'appelant a dit (`reading`) et déclare `understanding` clear/doubtful ; sur
# doubtful le code n'applique aucun changement de brouillon ni aucune action (même pas une
# vérification de disponibilité) et le modèle redemande. Aucune liste de phrases : le jugement est celui du
# modèle, dans le contexte. Change le schéma et le prompt de ces restaurants : activer d'abord Chez Sokar.
VOICE_UNDERSTANDING_CHECK_RESTAURANT_IDS=""
# Fin de phrase Deepgram : 200 ms par défaut (958 → 849 ms en médiane au rejeu).
VOICE_DEEPGRAM_ENDPOINTING_MS="200"
# Mise en tampon du contexte Cartesia : 0 (nos entrées sont des phrases complètes).
VOICE_TTS_CONTEXT_MAX_BUFFER_MS="0"
```

Relance quand l'appelant n'est pas entendu (appel c5d6b07d du 28 septembre : « euh…
trois » rendu vide par Deepgram, 12 s de silence, raccroché). L'agent repose sa
dernière question : « Pardon, je n'ai pas bien entendu. … » quand Deepgram signale
une parole sans aucun mot reconnu, ou « Vous êtes toujours là ? … » après un
silence. Deux relances au plus par appel, jamais pendant une clôture, et seulement
si la dernière réplique de l'agent était une question. Les petits nombres (« deux »
à « dix ») sont aussi envoyés en tête des mots-clés Deepgram quand les mots-clés
sont activés pour le restaurant.

```dotenv
# Restaurants où la relance est active (liste d'identifiants séparés par des virgules).
VOICE_NO_INPUT_RECOVERY_RESTAURANT_IDS=""
# Silence après une question de l'agent avant « Vous êtes toujours là ? » (3000–20000).
VOICE_NO_INPUT_TIMEOUT_MS="7000"
# La relance est formulée par le modèle à partir d'un fait (parole non comprise, silence, silence après
# l'accueil), sans phrase codée ; la phrase « Pardon, je n'ai pas bien entendu… » ne sert plus que de dernier
# recours (modèle indisponible, réponse vide ou qui demande une action). "false" ou "0" la rétablit seule.
# Journal : [voice] No-input recovery, source=model|fixed.
VOICE_RECOVERY_BY_MODEL="true"
# Attente maximale de la phrase du modèle avant la phrase codée, abandon de la requête (500–5000, défaut 2000).
# Mesuré : médiane 430 ms, un pic à 2,98 s sur 10 relances ; le hedge à 700 ms et la bascule à 2,5 s de première
# réponse existaient déjà, mais aucune borne ne couvrait la relance entière. Journal : source=fixed_timeout.
VOICE_RECOVERY_MAX_WAIT_MS="2000"
# Genre de la voix par défaut (masculine | feminine), à lire dans les métadonnées Cartesia de CARTESIA_VOICE_ID.
# Le prompt dit alors au modèle « Ta voix est … » pour qu'il accorde ce qui le qualifie (« Désolé » ou « Désolée »).
# Vide : rien n'est dit. Ignoré pour un restaurant qui a sa propre voix (genre inconnu).
CARTESIA_VOICE_GENDER=""
```

Les consignes `system` (prompt, langue, contexte de disponibilité) sont
fusionnées en un seul message avant l'envoi : le template Qwen de Cerebras
refuse un message `system` qui n'est pas le premier. Une réponse 402, 429, 5xx
ou une erreur réseau déclenche une réponse parlée déterministe (reprise du
créneau vérifié, sinon demande de répétition, puis proposition du gérant après
deux échecs consécutifs), après le secours OpenRouter du tour structuré.

### Latence Deepgram et secours LLM

Les seuils Deepgram ne sont utilisés que par les sockets Deepgram ; ils ne
changent pas les paramètres de Scribe. `speech_final` déclenche le commit
immédiat, et `UtteranceEnd` reste un filet de sécurité. Valeurs validées au
démarrage par Zod :

```dotenv
VOICE_DEEPGRAM_ENDPOINTING_MS="200"
VOICE_DEEPGRAM_UTTERANCE_END_MS="1000"
VOICE_DEEPGRAM_SPELLING_SILENCE_MS="800"
# Endpoint Deepgram : api.eu.deepgram.com (UE, ~7 ms depuis le VPS) ou api.deepgram.com (États-Unis,
# ~110 ms, défaut). Seules ces deux valeurs sont acceptées : la clé API leur est envoyée.
DEEPGRAM_API_HOST="api.deepgram.com"
# Parcours vocal moderne par défaut : tour structuré, Deepgram (si VOICE_STT_PROVIDER=deepgram), mots-clés
# Deepgram et écoute Dialogue V2 avec filtre d'écho, pour TOUT restaurant sans le lister. Défaut : false
# (seules les listes explicites *_RESTAURANT_IDS s'appliquent). L'exclusion ramène un restaurant à l'ancien
# chemin (outils, Scribe) mais n'annule pas ses listes explicites. Le hedging suit le tour structuré.
VOICE_V2_DEFAULT="false"
VOICE_V2_DISABLED_RESTAURANT_IDS=""
# Suppression de bruit Telnyx (bêta) sur l'audio de l'appelant, avant la transcription. « off » (défaut)
# ou Krisp | DeepFilterNet | AiCoustics | Denoiser ; uniquement pour les restaurants listés.
# Facturée par direction et par minute (une seule direction utilisée). Un échec n'arrête pas l'appel.
VOICE_NOISE_SUPPRESSION_ENGINE="off"
VOICE_NOISE_SUPPRESSION_RESTAURANT_IDS=""
VOICE_DEEPGRAM_MODEL="nova-3"
# Optional; Flux is used only when this CSV contains the restaurant ID.
VOICE_DEEPGRAM_MODEL_RESTAURANT_IDS=""
VOICE_DEEPGRAM_NUMERALS="true"
VOICE_DEEPGRAM_NUMERALS_RESTAURANT_IDS=""
VOICE_DEEPGRAM_PUNCTUATE="false"
VOICE_DEEPGRAM_PUNCTUATE_RESTAURANT_IDS=""
VOICE_DEEPGRAM_MIP_OPT_OUT="true"
VOICE_DEEPGRAM_KEYTERMS_RESTAURANT_IDS=
```

Les réglages `numerals` et `punctuate` ne s'écartent de leurs valeurs actuelles
(`true` et `false`) que pour un restaurant présent dans leur allowlist respective.
`VOICE_DEEPGRAM_KEYTERMS_RESTAURANT_IDS` est vide par défaut ; renseignez-y
uniquement les restaurants qui utilisent les keyterms générés. Hors allowlist,
le chemin historique reste utilisé. Le budget généré est distinct de celui de
Scribe et reste sous 200 tokens estimés (marge prudente sous la limite Deepgram
de 500 tokens).
Le schéma actuel expose le nom, l'adresse, la ville et les
types de cuisine; il ne contient pas de menu structuré ni de modèle de personnel.

`VOICE_DEEPGRAM_MIP_OPT_OUT=true` s'applique à Nova-3 et Flux. Il exclut les
requêtes STT du programme d'amélioration et active la rétention limitée au
traitement selon la documentation Deepgram. Le défaut a volontairement changé;
mettre `false` réactive le comportement fournisseur antérieur.

L'épellation attend 800 ms de silence total, en tenant compte de
`endpointing`; elle ne cumule pas un hold hybride. Les valeurs autorisées sont
respectivement 100–1000 ms, 500–3000 ms et 400–2000 ms.

Le filler différé n'est actif que pour une session Deepgram + Dialogue V2.

```dotenv
VOICE_LLM_FILLER_DELAY_MS="1200"      # 100–5000 ms
```

Dialogue V2 active aussi la suppression d'écho par texte, valable pour Scribe
et Deepgram. Le texte récent de l'agent est conservé uniquement en mémoire,
sans être ajouté aux logs ni à la télémétrie.

**PM2 et `.env` :** l'API lit `.env` via `node --env-file`, qui ne remplace pas
une variable déjà présente dans l'environnement du process. Si PM2 a été lancé
depuis un shell où ces variables étaient exportées, il les garde dans son
snapshot et `pm2 restart --update-env` ne les retire pas : la modification du
`.env` est alors ignorée sans erreur. Pour repartir d'un environnement propre :
`pm2 delete sokar-api sokar-workers && pm2 start infra/ecosystem.config.js --only sokar-api,sokar-workers && pm2 save`.

Pour le diagnostic d'un appel, se fier à `VoiceTurnTelemetry.llmProvider` et
`VoiceTurnTelemetry.llmModel`, puis au même couple dans le bilan
`VoiceCallTelemetry`. Le log `Start call` ajoute `openrouterKeyConfigured` et
`openrouterUsed` afin de ne pas confondre une clé présente avec une requête
effectivement envoyée à OpenRouter.

Le shadow `TurnPlan` est contrôlé par un flag global, sans ciblage par restaurant.

### Span-01, signaux sémantiques shadow

`VOICE_SEMANTIC_SIGNALS_ENABLED=false` par défaut. Activé, chaque tour échantillonné
(`VOICE_SEMANTIC_SIGNALS_SAMPLE_RATE`, 0–1, défaut 1) envoie hors du chemin de
réponse les derniers tours anonymisés à Respan. `RESPAN_API_KEY` est un secret
optionnel chargé depuis l'environnement : si le flag est actif sans clé, l'API
démarre avec un avertissement et le score est `disabled`. `RESPAN_BASE_URL`
vaut `https://api.respan.ai/api/v1` par défaut ; l'appel direct cible `/scores`.
`VOICE_SEMANTIC_SIGNALS_MODEL` vaut `span-01-pro` (ou `span-01-free`).
`span-01-pro` consomme des crédits Respan : sans crédit, l'API répond HTTP 402
(statut `payment_required`). `span-01-free` applique un quota quotidien remis à zéro à 00:00 UTC.
`VOICE_SEMANTIC_SIGNALS_TIMEOUT_MS` vaut 2000 (200–10000) et
`VOICE_SEMANTIC_SIGNALS_HISTORY_TURNS` vaut 3 (1–30). L'état envoyé à Jev isole le message du client à évaluer, précédé de la dernière question de l'agent ; les échanges plus anciens sont marqués « à ne pas évaluer » (appel c5d6b07d : 14/23 → 21/23). Aucun résultat Span-01
ne modifie la policy, l'état, les outils ou la réponse. Le 403 d'accès anticipé
est mesuré `forbidden`.

`VOICE_SEMANTIC_SIGNALS_PROVIDER` vaut `openrouter` par défaut (ou `respan`).
OpenRouter appelle `POST /alpha/decisions` avec `OPENROUTER_API_KEY` et
`OPENROUTER_BASE_URL` (`https://openrouter.ai/api` par défaut) ; le modèle vaut
alors `typesafe/jev-1.13-20260917` (version figée, jamais `jev-latest`). La clé
OpenRouter n'existe qu'en production, pas en staging : le mode shadow y démarre
avec un avertissement et `missing_key`.
Respan garde le client direct `/scores` avec `RESPAN_API_KEY` et
`VOICE_SEMANTIC_SIGNALS_MODEL=span-01-pro` ou `span-01-free`. Jev accepte les
questions `noul` et `choice` : onze comportements en `noul` (une probabilité,
sans score « impossible à dire », donc `not_observable` à 0), plus deux
questions `choice` posées seulement quand l'interaction active les rend
pertinentes — `human_fallback_choice` sous `humanFallback` et
`proposal_response_choice` sous confirmation. Respan n'accepte que `noul` :
le client direct ne reçoit pas ces deux questions. La probabilité maximale de
chaque `choice` alimente l'histogramme
`sokar_voice_semantic_choice_confidence`, qui surveille la surconfiance du
modèle. `BEHAVIOR_SET_VERSION` vaut `2026-09-28.4-jev`.

Phase 2 (avis) de `needs_clarification`, sans effet sur l'appel : chaque tour noté
est comparé à ce qu'a fait l'agent (`unclear` = il fait préciser) et compté dans
`sokar_voice_semantic_advisory_total{behavior="needs_clarification",outcome}` :
`both`, `jev_only` (Jev aurait fait reposer la question alors que l'agent a
continué : les tours à relire avant toute phase 3), `agent_only`, `neither`. Le
même classement est écrit dans l'événement de tour `semantic_signals_shadow`
(`advisoryClarify`), avec le `turnId` pour retrouver le dialogue dans
`voice_debug_turns`. Seuil : `VOICE_SEMANTIC_ADVISORY_CLARIFY_THRESHOLD` (0,8).

Évaluation hors ligne : `pnpm --filter api semantic:eval [fichier.jsonl]
[--provider openrouter|respan]` avec la clé du fournisseur dans l'environnement
(le fournisseur par défaut est `VOICE_SEMANTIC_SIGNALS_PROVIDER`, sinon
`openrouter`). Le JSONL doit déjà être anonymisé ; les rapports agrégés vont dans
`apps/api/scratch/semantic-signals-eval/` (ignoré par git).

Jeu de référence figé : `apps/api/scripts/fixtures/semantic-eval/synthetic-v1.jsonl` (144 cas synthétiques, actions sensibles comprises). À passer à `semantic:eval` après chaque changement de définitions ; construction et limites dans `scripts/ops/semantic-dataset/README.md`.

Annotation : `pnpm --filter api semantic:annotation-export [--days 14] [--limit 400]
[--no-prioritize]`, à lancer sur le VPS de production. Le script lit
`voice_debug_turns` (appels de test des restaurants de
`VOICE_DEBUG_TRANSCRIPT_RESTAURANT_IDS` uniquement, jamais un restaurant client),
masque téléphones et emails, puis classe les tours en mettant en tête ceux où Jev
doute le plus (nécessite `OPENROUTER_API_KEY` ; les scores ne sont pas écrits dans
l'export pour ne pas orienter l'annotation). Il écrit dans
`apps/api/scratch/semantic-annotation/` un JSONL et une page `annotate-*.html`
autonome : ouvrez-la dans un navigateur, annotez au clavier, puis « Exporter le
JSONL » produit le fichier à passer à `semantic:eval`. Les noms dits à l'oral ne
sont pas masqués : la page reste sur le poste de l'annotateur.

Évaluation automatique hebdomadaire : `VOICE_SEMANTIC_AUTO_EVAL_ENABLED=false`
par défaut ; quand le flag est activé, le worker lit les tours des 7 derniers
jours dans `voice_debug_turns`, conserve au plus
`VOICE_SEMANTIC_AUTO_EVAL_MAX_TURNS=300` tours récents et lance Jev et le juge
en parallèle (concurrence 4). Il faut au moins 20 tours annotables. Le juge
utilise `VOICE_SEMANTIC_JUDGE_MODEL=xiaomi/mimo-v2.6-pro` et la
clé secrète `OPENROUTER_API_KEY`. Le job est planifié le lundi à 06:00
(Europe/Paris), avec une tentative. Les rapports agrégés sont écrits dans
`apps/api/scratch/semantic-auto-eval/` et publiés via les métriques
`sokar_voice_semantic_eval_precision`, `..._recall`, `..._examples`,
`..._last_run_timestamp_seconds` et `..._judge_status_total`. Le résumé
opérationnel ne contient ni transcription ni raisonnement du juge. Le juge
MiMo v2.6 Pro coûte environ 0,0005 $ par tour. Sur 6 cas difficiles (28/09/2026), il a
donné 12/12 bonnes réponses, comme `anthropic/claude-sonnet-5` (environ 0,007 $ par
tour, 16 fois plus cher). `xiaomi/mimo-v2.6-flash` est écarté : 9/12 puis 7/12 sur les
mêmes cas, avec des abstentions `not_observable` qui varient d'un passage à l'autre.
Latence d'environ 4 s par tour, sans importance pour un job hebdomadaire. Les appels Jev ont leur propre
coût. Ces annotations restent des
jugements de modèle et ne constituent pas une vérité humaine.

Quand `VOICE_TURN_PLAN_SHADOW_ENABLED=true`, tous les restaurants sont concernés ;
`false` le désactive partout. Il ajoute un outil interne à la completion vocale
Cerebras/Qwen existante pour recevoir la proposition structurée avec la réponse
libre ; il ne lance donc pas de requête LLM shadow séparée sur ce chemin. La
policy valide puis compare la proposition à l’état effectivement conservé.
Aucune valeur proposée ne modifie la conversation ni n’autorise un effet métier,
et la télémétrie n’enregistre pas les valeurs de nom/téléphone. Si le modèle
retourne le tool interne sans contenu parlé, Sokar effectue une génération de
récupération pour préserver la réponse vocale ; ce cas est tracé `speech_missing`.
Le workflow staging active ce flag globalement. Le staging ne dispose pas de
configuration Telnyx : ses smoke tests ne valident donc pas un appel vocal réel.
En production, le flag a été explicitement activé le 2026-09-23 après
vérification qu'aucune session vocale n'était active. Le workflow de production
laisse les flags runtime absents inchangés ; cette activation persiste dans le
fichier d'environnement jusqu'à sa désactivation explicite. Pour changer un
flag vocal en production, synchroniser sa valeur avec
`scripts/ops/sync-runtime-flags.sh prod`, attendre zéro session active, puis
recharger `sokar-api` avec `pm2 reload sokar-api --update-env`.
Les compteurs globaux de validité, décision de policy et accord sont exposés à
Prometheus et présentés dans le dashboard Grafana `Sokar — Voice & SLO`. Ils
n'ont pas de label restaurant et ne contiennent aucune transcription. Le
déploiement production démarre Prometheus et Grafana séparément sur la loopback,
avec 30 jours de rétention Prometheus. Prometheus ne dépend pas du secret Grafana.
Le workflow provisionne `GRAFANA_ADMIN_PASSWORD` depuis l'environnement GitHub
`production` dans `/etc/sokar/grafana.env` (droits `0600`, root uniquement, hors du checkout).

L'accord est aussi compté par dimension (`sokar_voice_turn_plan_shadow_dimension_total`,
labels `dimension` = `intent` | `slots` | `interaction` | `assistant_interaction`) : un
taux global masque qu'une seule dimension diverge.

`VOICE_TURN_PLAN_AUTHORITY_ENABLED=true` (défaut `false`, sans effet si le shadow est
coupé) ne s'applique qu'aux restaurants listés dans
`VOICE_TURN_PLAN_AUTHORITY_RESTAURANT_IDS` (IDs séparés par des virgules, `*` pour tous ;
vide = aucun). Cette liste n'est pas un booléen : elle ne passe pas par
`sync-runtime-flags.sh` et se pose directement dans le fichier d'environnement de l'API,
avant le reload. Pour ces restaurants, l'autorité donne au TurnPlan valide et accepté par la policy une autorité limitée, appliquée
après la réponse vocale : il complète date, heure, couverts et intention seulement quand
ces champs étaient vides avant le tour et n'ont pas été posés par le déterministe ; il ne
remplace jamais un fait existant. Il fixe aussi l'interaction attendue au lieu de
l'inférence regex sur la phrase générée, sauf pour `confirmation`, `humanFallback` et
`partySizeConfirmation`, qui ouvrent une autorisation ou exigent des métadonnées et
restent sur l'inférence texte. Aucun tool ni confirmation ne dépend du plan. Le shadow
continue de comparer le plan à l'état déterministe seul. Décisions comptées par
`sokar_voice_turn_plan_authority_total{field,outcome}`. N'activer qu'après lecture de
l'accord par dimension sur des appels réels.

`VOICE_STRUCTURED_TURN_RESTAURANT_IDS` (IDs séparés par des virgules ; vide = aucun) fait
passer les restaurants listés sur le **tour structuré** : un seul appel au modèle, en JSON
Schema strict, comprend le tour (interprétation, brouillon, attente, action) et formule la
réponse ; `say` est lu en streaming. Aucune règle lexicale du chemin historique ne
s'applique à ces restaurants. Le code valide le format et la plausibilité des valeurs
(date dans l'horizon, heure, couverts, nom), exécute les actions autorisées
(disponibilité réelle ; réservation seulement après un récapitulatif lu au tour précédent
et accepté, sur un créneau vérifié ; message ; transfert ; fin d'appel) et rend leur
résultat au modèle pour la formulation. Aucune action à effet sur un plan à confiance
faible. Si Cerebras échoue, le secours OpenRouter prend le tour. Télémétrie : événement
`structured_turn` (interprétation, action, attente, confiance, champs modifiés ou rejetés ;
aucun texte). Banc contre le vrai modèle, clé de dev uniquement :
`CEREBRAS_API_KEY=… node --env-file=.env --import tsx scripts/voice-structured-bench.ts`
depuis `apps/api`.

Un tour de contenu que les extracteurs n'ont pas compris est confié au modèle au lieu
d'une relance mécanique. Son résultat est compté par
`sokar_voice_turn_plan_deferred_total{outcome}` : `fact_applied`, `no_fact`,
`plan_rejected`, `plan_unavailable`, ou `stall_handoff`. Le garde-fou anti-boucle
s'applique aussi à ces tours : si le modèle repose la même question sans nouveau fait, la
relance est comptée ; après deux relances, le tour suivant revient au déterministe, qui
propose un repli humain réel (`stall_handoff`). Les métriques shadow portent un label
`path` (`llm`, `deferred` ou `deterministic`) pour lire l'accord séparément sur ces tours.

`VOICE_TURN_PLAN_DETERMINISTIC_SHADOW_RATE` (0 à 1, défaut `0`, sans effet si le shadow est
coupé) observe aussi une part des tours répondus sans LLM : après la réponse déterministe,
un appel TurnPlan séparé (outil forcé, température 0, 2,5 s maximum) interprète le tour.
Il ne retarde pas la réponse, ne modifie ni l'état ni l'historique, et ne passe pas par le
disjoncteur LLM, pour qu'une observation lente ne coupe jamais le LLM des appels réels.
Son coût est rattaché à l'appel. C'est la seule mesure des tours où la regex décide seule,
y compris quand elle se trompe sans le savoir (`path="deterministic"`). Commencer bas
(par exemple `0.2`) et monter selon le volume. Comme la liste d'IDs, cette valeur n'est
pas un booléen et se pose directement dans le fichier d'environnement de l'API.

`VOICE_SMART_ENDPOINT_ENABLED=true` (défaut `false`) active la fin de tour hybride.
`VOICE_SMART_ENDPOINT_RESTAURANT_IDS` (IDs séparés par des virgules, vide = tous) la limite
à certains restaurants. Pour ces appels, Scribe coupe après
`VOICE_SMART_ENDPOINT_VAD_SILENCE_SECS` (défaut `0.5`, bornes 0,2 à 3) au lieu de
`ELEVENLABS_STT_VAD_SILENCE_SECS` (défaut `0.95`, qui reste la valeur des autres appels).
Après le commit, l'API ajoute une attente selon la phrase : 0 ms si elle est complète
(ponctuation finale ou réponse d'un ou deux mots comme « oui »), 800 ms si elle finit en
suspens (« demain à », « au nom de », « je suis »), 600 ms pour une correction commencée
(« non, plutôt… »), 400 ms sans ponctuation. Si le client reprend pendant l'attente, la
suite est fusionnée dans le même tour. Comparer avant/après avec
`sokar_voice_end_of_speech_to_first_audio_ms` et `sokar_voice_false_end_of_turn_total`.

`VOICE_STT_CHUNK_MS` (défaut `20`) règle le regroupement des trames audio avant envoi à
Scribe. `20` conserve le comportement historique : chaque trame Telnyx de 20 ms part dans
son propre message. Une valeur multiple de 20 entre `40` et `200` accumule les trames
décodées et n'envoie qu'un message quand la durée cible est atteinte. À 20 ms, le
comportement historique reste inchangé : une trame par message et conversion PCMA vers
`pcm_8000`. Le regroupement ne change pas le format audio.
Le tampon est vidé avant tout commit manuel, une fin de tour, un barge-in, la fermeture ou la
reconnexion de la session, et la fin d'appel ; un timer de sécurité (`valeur + 20 ms`) envoie
un tampon partiel si le flux s'interrompt. Un couple de trames est donc retardé d'au plus la
valeur configurée, uniquement à l'intérieur d'un tour (fin de parole → commit). Toute autre
valeur fait échouer le démarrage (validation Zod). Suivre
`sokar_voice_stt_audio_messages_total{chunk_ms}` et `sokar_voice_stt_chunk_bytes`.

`VOICE_STT_FILTER_BACKGROUND=true` transmet `filter_background_audio=true` à Scribe pour
réduire les faux déclenchements dus aux conversations voisines et au bruit ambiant. Défaut
`false` : aucun paramètre supplémentaire n'est envoyé. Le seuil VAD explicite actuel reste
inchangé. ElevenLabs interdit de combiner ce filtre avec `include_timestamps` : lorsque le
flag est actif, ce seul paramètre explicite est omis ; `include_language_detection` reste
actif. Voir la [référence Scribe Realtime](https://elevenlabs.io/docs/api-reference/speech-to-text/v-1-speech-to-text-realtime).

`VOICE_STT_LANGUAGE_LOCK=true` verrouille l'appel en français après le premier tour commité
que Scribe identifie comme français et qui contient au moins deux mots. La langue de dialogue
ne suit ensuite plus les détections ultérieures. Un contenu non français récupérable par
l'extracteur du champ demandé suit le parcours normal de réservation ; sinon l'agent relance
en français. Après le verrou, une nouvelle session Scribe forcée en français est tentée au
début du prochain tour TTS, jamais pendant que le client parle. Si ce relock échoue, la
session auto-détectée précédente est restaurée ; si elle s'est aussi fermée, la reconnexion
existante reprend la détection automatique. Défaut `false` : comportement actuel.
Les compteurs `sokar_voice_language_locked_total`,
`sokar_voice_non_fr_transcript_after_lock_total{outcome}` et
`sokar_voice_stt_relock_total{result}` sont additifs et ne contiennent ni texte ni PII.

`VOICE_DIALOGUE_LISTENING_V2=true` active le routage strict du dialogue : le chemin déterministe
est réservé à une réponse directe, unique et non ambiguë à la question en attente. Les questions,
corrections, contradictions et tours en boucle sont traités par le LLM sans appliquer de slot
implicite ; les questions n'exposent que l'outil de vérification de disponibilité en lecture seule.
Les fins de tour manifestement coupées ou réduites à une hésitation sont fusionnées pendant 900 ms,
puis relancées naturellement si aucune suite n'arrive. Défaut `false` : chemin historique.

`VOICE_TELNYX_CODEC` (défaut `PCMA`, valeurs `PCMA` ou `L16`) sélectionne le codec
entrant et sortant du Media Stream Telnyx. Avec `L16`, demander 16 kHz dans les deux
sens, envoyer le PCM16 à Scribe en `pcm_16000`, et générer le TTS Cartesia en PCM16 16 kHz.
Le cache TTS est séparé par codec. `sokar_voice_wideband_detected_total{detected,codec}`
indique la présence d'énergie au-dessus de 4 kHz au début de chaque appel L16. Avant
activation, vérifier en staging par un appel réel que l'endianness du payload WebSocket
est bien big-endian (convention RTP L16) et que le retour TTS est audible. Le log
unique `[stream] L16 endian probe` contient `media_format`, `bigEndianRms` et
`littleEndianRms` sur les premières 500 ms de parole, sans contenu audio. Le flag
reste à `PCMA` par défaut.

`VOICE_DEBUG_TRANSCRIPT_RESTAURANT_IDS` (IDs séparés par des virgules, **vide = désactivé**)
enregistre le dialogue de chaque tour pour ces seuls restaurants de test : paroles du client,
réponses et fillers de l'agent, outils appelés, type de tour. Table `voice_debug_turns`, texte
passé par `redactPii()` (téléphones, e-mails ; les noms restent), suppression 14 jours après
l'appel par la tâche quotidienne `purge-expired-voice-debug-turns` (3 h 30, Europe/Paris). Ne
jamais y mettre un restaurant client. Les mesures du tour restent dans `voice_turn_telemetry`.
Chaque réplique de l'agent est comptée par ses propres trames envoyées à Telnyx : envoyée en
entier, « [envoi coupé] », ou omise si aucune trame n'est partie. Avec le contexte Cartesia, la
réponse forme une seule réplique (l'audio ne se rattache pas phrase par phrase). Envoyé ne veut
pas dire entendu : un barge-in peut encore vider l'audio en attente côté Telnyx.

Pour ces mêmes restaurants de test, les événements STT écrivent aussi leur **texte brut** dans
les journaux du serveur (`[voice-debug] raw text`, champ `voiceDebug`) : ce que le filtre d'écho a
reçu et rendu (`echo_prefix_stripped`, `echo_suppressed`, `echo_spared`, avec la parole récente de
l'agent), chaque segment final Deepgram (`final_segment`) et la partielle au moment d'une fin de
tour forcée (`finalize_sent`, avec le silence mesuré). Mêmes garde-fous que le dialogue par tour :
téléphones et e-mails masqués, rien pour un restaurant client, jamais envoyé à un service externe ;
les journaux tournent chaque jour et sont supprimés après 14 jours (logrotate). Autorisé par le
propriétaire le 30/09/2026, car les nombres de mots ne suffisaient pas à comprendre un mot perdu.

`SOKAR_VOICE_READ_TOKEN` (secret, `openssl rand -hex 32`) protège la lecture interne, en
`Authorization: Bearer <jeton>` ; sans lui, les routes répondent 503. Lecture seule :
`GET /api/internal/voice/calls?restaurantId=…&limit=20` (derniers appels),
`GET /api/internal/voice/calls/latest?restaurantId=…` et `GET /api/internal/voice/calls/:callId`
(mesures par tour, plus le dialogue pour les seuls restaurants de
`VOICE_DEBUG_TRANSCRIPT_RESTAURANT_IDS`). Jamais le numéro de l'appelant, le transcript brut ni
les champs d'enregistrement. Pour une session Claude : autoriser `api.sokar.tech` dans l'accès
réseau de l'environnement et y poser la même valeur en variable d'environnement.

Le TurnPlan propose désormais des `facts` : `{field, op: set|replace|clear, value, source:
user_explicit|user_tentative|correction}` ; les anciens `slots` restent lus comme `set` affirmé.
Sous autorité, `set` remplit seulement un champ vide. `replace` corrige un fait d'origine
`contextual` ou `model`, un fait `explicit` seulement si `interpretation=correction`, et jamais
un fait `confirmation` ni un fait d'origine inconnue ou périmée. Un fait `user_tentative` n'est
jamais enregistré ; `clear` n'est pas encore pris en charge. Un remplacement invalide l'accord
de réservation et la disponibilité. La provenance est stockée dans
`conversation.slotProvenance`, liée à la valeur qu'elle décrit. Résultats ajoutés à
`sokar_voice_turn_plan_authority_total` : `replaced`, `protected`, `tentative`, `unsupported`.
Grafana donne un accès anonyme en lecture seule, sans inscription, et s'ouvre
uniquement par tunnel SSH ; ne publiez pas son port.

## Voice STT (Deepgram)

Deepgram Nova-3 est le fournisseur de reconnaissance en production : `VOICE_STT_PROVIDER=deepgram`,
avec `VOICE_V2_DEFAULT=true` tous les restaurants y passent ; sans `VOICE_V2_DEFAULT`, seuls les
identifiants de `VOICE_STT_PROVIDER_RESTAURANT_IDS` (CSV) l'utilisent. Le fournisseur est résolu au début
du Media Stream et reste figé pendant l'appel. **Il n'y a plus de secours vers ElevenLabs Scribe** : si
Deepgram ne s'ouvre pas (clé refusée, clé absente, réseau), l'appel suit le chemin « reconnaissance
indisponible » existant (reconnexions à 500 ms, 1 s puis 2 s, échéance de 15 s, puis le message vocal et le
transfert ; un refus d'authentification est terminal tout de suite). La clé `DEEPGRAM_API_KEY` est
obligatoire en production avec `VOICE_STT_PROVIDER=deepgram` ; `ELEVENLABS_API_KEY` n'est exigée que si
`VOICE_STT_PROVIDER=scribe` (option conservée pour les bancs et les essais, plus utilisée en production).
Ne l'utilisez jamais dans les scripts du banc : ceux-ci exigent une clé bench dédiée.

Le codec Telnyx reste PCMA par défaut. `VOICE_TELNYX_CODEC=L16` conserve le
comportement PCMA pour tout appel sans allowlist explicite. L16 exige que
`VOICE_TELNYX_CODEC_RESTAURANT_IDS` contienne l'ID du restaurant ciblé; une
allowlist vide ou absente reste en PCMA. Les autres appels restent PCMA. La
valeur est évaluée à l'ouverture de l'appel et ne change pas pendant le flux.

Le modèle Deepgram reste `nova-3` par défaut. Le canary Flux nécessite simultanément
`VOICE_DEEPGRAM_MODEL=flux-general-multi` et l'identifiant du restaurant dans
`VOICE_DEEPGRAM_MODEL_RESTAURANT_IDS` ; sans les deux, le modèle résolu reste Nova-3. Flux
utilise l'endpoint `/v2/listen` avec `language_hint=fr`. `flux-general-multi` est le modèle Flux
documenté qui prend en charge le français ; les noms `DEEPGRAM_MODEL` historiques ne pilotent
pas cette sélection. Ce flag ne sélectionne pas Deepgram à lui seul : le provider exige toujours
`VOICE_STT_PROVIDER=deepgram` et `VOICE_STT_PROVIDER_RESTAURANT_IDS`.

Les tours incluent maintenant `endOfSpeechToSttFinalMs`, `holdMs`,
`endOfSpeechToFirstAudioMs`, `firstAudioIsFiller` et `speechEndAt` lorsque mesurables.
La migration `voice_turn_end_of_speech_latency` n'ajoute que des colonnes nullables et doit
passer par le déploiement normal. Les métriques `sokar_voice_end_of_speech_to_stt_final_ms`
et `sokar_voice_stt_provider_audio_messages_total` sont additives.

### Clés des bancs

ElevenLabs ne sert plus à la reconnaissance en production (voir plus haut) et le worker de suivi de solde
ElevenLabs est supprimé (le 02/10/2026) : la clé `ELEVENLABS_API_KEY` n'est plus lue que par le fournisseur
`scribe` et les bancs.

Les bancs doivent utiliser des clés dédiées, jamais les clés de production :

| Variable                     | Usage                                                                                        |
| ---------------------------- | -------------------------------------------------------------------------------------------- |
| **ELEVENLABS_BENCH_API_KEY** | Clé dédiée du banc STT, différente de ELEVENLABS_API_KEY                                     |
| **CARTESIA_BENCH_API_KEY**   | Clé dédiée à la synthèse Cartesia du banc, différente de CARTESIA_API_KEY                    |
| **OPENROUTER_BENCH_API_KEY** | Clé dédiée du banc LLM archivé, différente de OPENROUTER_API_KEY                             |
| **CEREBRAS_BENCH_API_KEY**   | Clé dédiée du diagnostic vocal manuel, différente de CEREBRAS_API_KEY                        |
| **BENCH_MAX_CREDITS**        | Plafond positif obligatoire ; les unités estimées sont affichées avant tout contrôle d'accès |

Les scripts vérifient l'accès à chaque endpoint utilisé avant le corpus, avec une seule
requête de contrôle par fournisseur. Pour Scribe, le contrôle ouvre la socket Realtime et
n'envoie aucun audio. Le banc STT détaillé et ses limites sont documentés dans
apps/api/scripts/voice-stt-bench/README.md. N'exécutez jamais un banc avec une clé
identique à celle de production.

Scribe détecte la langue parmi `ELEVENLABS_STT_LANGUAGES` (défaut `fr,en`).
`ELEVENLABS_STT_ALL_LANGUAGES` doit rester `false` : au téléphone (A-law 8 kHz),
Scribe se trompe alors de langue et transcrit « six personnes » en « sechs
Personen ». Banc du 24/09/2026, 7 phrases × 3 passages : toutes les langues
33 % d'informations critiques justes, `fr,en` 76 %, `fr` imposé 52 %, MAI via
Azure Voice Live 76 %. Ajouter une langue seulement si des appelants la parlent
réellement, et remesurer.

Réponses attendues (`stream/expected-answer.ts`) : quand l'agent pose une
question fermée (nombre de personnes, jour, heure) et que l'analyse exacte ne
trouve rien, la transcription est rapprochée phonétiquement des réponses
possibles. Une valeur nette est retenue puis relue dans la phrase suivante
(« Six personnes, très bien. Pour quel jour ? ») ; deux valeurs proches donnent
« Pardon, six ou seize personnes ? » ; une réponse hors sujet ne donne rien.
Les heures candidates sont les créneaux vérifiés, sinon les horaires
d'ouverture du jour, sinon une liste par défaut.

| Variable                               | Défaut  | Effet                                                                  |
| -------------------------------------- | ------- | ---------------------------------------------------------------------- |
| `VOICE_EXPECTED_ANSWER_ENABLED`        | `false` | `true` active rapprochement, choix « X ou Y ? » et relecture naturelle |
| `VOICE_EXPECTED_ANSWER_RESTAURANT_IDS` | vide    | limite aux restaurants listés (virgules) ; vide = tous                 |

Confirmation guidée par la confiance (`stream/slot-confidence.ts`) : pour
chaque valeur retenue par l'analyse exacte (nombre, jour, heure), la confiance
Scribe des mots qui la portent et la stabilité des transcriptions partielles
décident de la suite. Valeur sûre et stable : relecture seule. Valeur douteuse
ou instable avec un voisin confusable (six/dix/seize, deux/douze, trois/treize,
cinq/sept, 20 h/21 h/22 h, 8 h/20 h, et quart/et demie) : « Pardon, six ou dix
personnes ? ». Valeur très douteuse sans voisin : question reposée autrement.
Heure hors des horaires d'ouverture du jour : jamais acceptée d'office.
L'événement `slot_confidence` publie le type, la confiance arrondie,
l'instabilité et la décision, jamais le texte ni la valeur. À utiliser avec
`VOICE_EXPECTED_ANSWER_ENABLED=true`, qui porte la relecture.

| Variable                                  | Défaut      | Effet                                                                  |
| ----------------------------------------- | ----------- | ---------------------------------------------------------------------- |
| `VOICE_CONFIDENCE_CONFIRM_ENABLED`        | `false`     | `true` active la confirmation guidée par la confiance                  |
| `VOICE_CONFIDENCE_CONFIRM_RESTAURANT_IDS` | vide        | limite aux restaurants listés ; vide = tous                            |
| `VOICE_CONFIDENCE_CONFIRM_SLOTS`          | `partySize` | types sur lesquels la confiance agit (CSV parmi `partySize,date,time`) |

Hors de `VOICE_CONFIDENCE_CONFIRM_SLOTS`, la décision est seulement observée :
`slot_confidence` la publie préfixée `wouldBe…`, sans rien changer au dialogue.
Le banc difficile montre que la confiance Scribe distingue les nombres de
personnes justes des faux, pas les heures : d'où le défaut `partySize`.

Vraisemblance des heures (sous `VOICE_EXPECTED_ANSWER_ENABLED`, indépendante
de la confiance) : une heure hors des horaires d'ouverture du jour, ou de la
semaine si le jour est inconnu, n'est jamais retenue. L'agent demande « 10 h ou
22 h ? » avec l'heure ouverte la plus proche à l'oreille, ou cite les horaires.

Groupes : au-delà de `RestaurantExposureSettings.maxPartySize` (réglage du
tableau de bord « Assistants IA », partagé avec le canal agentique ; 7 sans
ligne de réglages), le téléphone confirme le nombre puis transfère au gérant,
ou prend un message sans ligne gérant. Aucun flag : ce parcours est toujours actif.

Flag coupé, le dialogue est celui d'avant la fonctionnalité. L'événement
`expected_answer` publie le type, le statut et les scores (meilleur, écart),
jamais la transcription. Banc : `apps/api/scripts/voice-stt-bench/README.md`.

Chaque tour publie la confiance Scribe (`minWordConfidence`,
`meanWordConfidence`, `lowConfidenceWordCount`) dans l'événement `stt_final`,
sans le texte. Scribe Realtime envoie une log-probabilité, convertie en
confiance entre 0 et 1.

En cas d'authentification, de quota ou de conditions ElevenLabs refusés, l'appel cesse
immédiatement les reconnexions. Les échecs d'ouverture utilisent un backoff de 500 ms, 1 s
puis 2 s ; chaque ouverture réussie remet le compteur consécutif à zéro. Le repli intervient
après quatre échecs d'ouverture d'affilée, huit reconnexions par appel, ou une échéance
globale de 15 s. Il appelle `dispatchAlert()` en critique (cooldown global d'une heure) pour
les erreurs terminales ; les erreurs de connexion avertissent après plus de cinq appels
touchés en dix minutes. Le message vocal suit la langue active et ne propose la réservation
en ligne que si la page Connect est publiée (opt-in, flag, slug et date de publication). Détails :
docs/runbooks/observability.md.

## Demo restaurant

The seed creates a fictional `Chez Sokar` (slug `chez-sokar-demo`):

- Number: `+331****0405`
- MCP + OpenAI Reserve opt-in enabled
- Hours, personality, test customers (including a VIP)

Used for local voice / MCP tests before a real pilot.

The seed also creates extra published demo listings (`chez-sokar-*` outside `chez-sokar-demo`) so
the city pages (`/restaurants/:city`, which require at least five listings per city) have something
to render. Those are **refused on a remote database** unless `SEED_DEMO_RESTAURANTS=true` is set:
seeding them on production once published ten fake restaurants in the public sitemap (2026-06-28,
cleaned up 2026-09-21). Use the opt-in for staging only, never for production.

### Cartes cadeaux / Stripe Connect

- API : `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` (secrets des endpoints plateforme
  et comptes connectés, liste séparée par des virgules), `DASHBOARD_URL` HTTPS,
  `CONNECT_URL` pour les liens envoyés par la voix.
- Connect : `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`, injecté à la compilation.
- PDF : `GIFT_CARD_IMAGE_ORIGINS`, liste d'origines HTTPS de CDN maîtrisés ; vide désactive
  les téléchargements d'images personnalisées. Aucun domaine fourni par le client.
- Tests locaux uniquement : `GIFT_CARD_FINANCE_TEST_DATABASE_URL`, base dédiée sur localhost.

Voir [activation et qualification des cartes cadeaux](gift-card-financial-safety.md).
