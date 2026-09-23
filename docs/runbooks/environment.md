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

## Files

| File                         | Role                                                              |
| ---------------------------- | ----------------------------------------------------------------- |
| `.env.local` (root)          | `DATABASE_URL`, `REDIS_URL`, `POSTGRES_PASSWORD`                  |
| `packages/database/.env`     | `DATABASE_URL` for Prisma CLI (`db:push`, `db:seed`, `db:studio`) |
| `apps/connect/.env`          | Connect dev vars (`SITE_URL`, `API_URL`, `NEXT_PUBLIC_API_URL`)   |
| `apps/api/.env` (prod)       | All API vars (Telnyx, ElevenLabs, Cartesia, DB, Redis, etc.)      |
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

Le chemin vocal utilise un provider unique : Groq direct avec le modèle
`qwen/qwen3.8-27b` par défaut. `VOICE_LLM_PROVIDER` et
`VOICE_LLM_FALLBACK_MODEL` ne sont plus lus par l’API et ne doivent pas être
ajoutés aux environnements.

Définir dans `apps/api/.env` :

```dotenv
GROQ_API_KEY="gsk_..."
GROQ_BASE_URL="https://api.groq.com/openai/v1"
VOICE_LLM_MODEL="qwen/qwen3.8-27b"
VOICE_LLM_TIMEOUT_MS="8000"
```

La clé Groq est un secret local au VPS et ne doit jamais être commitée ou
envoyée dans le chat. Une réponse en 402, 429, 5xx ou une erreur réseau
déclenche la dégradation vocale prévue ; aucun autre modèle n'est appelé.

`OPENROUTER_API_KEY` peut rester provisionnée comme clé isolée pour des outils
hors production. Elle n'est pas lue par le pipeline vocal et ne constitue pas
un mécanisme de repli.

Pour le diagnostic d'un appel, se fier à `VoiceTurnTelemetry.llmProvider` et
`VoiceTurnTelemetry.llmModel`, puis au même couple dans le bilan
`VoiceCallTelemetry`. Le log `Start call` ajoute `openrouterKeyConfigured` et
`openrouterUsed` afin de ne pas confondre une clé présente avec une requête
effectivement envoyée à OpenRouter.

Le shadow `TurnPlan` est contrôlé par un flag global, sans ciblage par restaurant.
Quand `VOICE_TURN_PLAN_SHADOW_ENABLED=true`, tous les restaurants sont concernés ;
`false` le désactive partout. Il ajoute un outil interne à la completion vocale
Groq/Qwen existante pour recevoir la proposition structurée avec la réponse
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
disjoncteur Groq, pour qu'une observation lente ne coupe jamais le LLM des appels réels.
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
