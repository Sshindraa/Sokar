# Contexte Sokar

> État courant, court et à jour. Historique complet : [[Journal]]. Archives : [[archive/Context-log-2026]] (activité), [[archive/Context-decisions-2026]] (décisions).
>
> Les entrées d'activité ne vont **jamais** ici : direction `Journal.md`. Les décisions de plus de ~30 jours partent dans `archive/Context-decisions-2026.md`.
>
> Tenue du fichier : ne reçoit que les TODOs et les décisions du mois courant. Doit rester sous ~8 Ko — `scripts/quality/check-vault-size.sh` le vérifie avant chaque push.

## TODOs actifs

- [ ] **Observabilité R1-6 / TurnPlan shadow** : Prometheus scrape les quatre cibles production/staging ; Grafana est actif en production, loopback-only et accessible en lecture via tunnel SSH. Le shadow TurnPlan est activé globalement sans autorité métier ; attendre des appels réels éligibles et lire l’accord **par dimension** avant d’activer `VOICE_TURN_PLAN_AUTHORITY_ENABLED` sur un restaurant pilote via `VOICE_TURN_PLAN_AUTHORITY_RESTAURANT_IDS` (canary additif, défaut off). Suivants : opération/provenance des faits, reprise scope-safe, proposal→confirm→commit pour annulation et carte cadeau, barrière de parole, cycle Telnyx du transfert.
- [ ] **Staging email / dead-letter** : Resend reste désactivé. `EVENING_REPORTS_ENABLED=false` est posé en staging ; après PR #215, le garde-fou scheduler/worker est déployé en staging et production. Les 14 schedulers et 270 rapports périmés ont été retirés, dead-letter staging vide et alerte résolue. Aucun rejeu ni clé de production copiée ; prévoir un fournisseur dédié et une destination de test avant d’activer les emails.
- [ ] **Production dead-letter** : 7 entrées (2 `confirmation-sms`, 5 origine inconnue), datées du 4 au 10 septembre ; triage à faire, aucune modification à ce stade.
- [ ] **Onboarding self-service (R2-5)** : la route historique ne répondait que pour un restaurant. Ajout de `GET /admin/onboarding-funnel/cohort` (opérateur, tous établissements) avec abandon par étape, jalons et délai jusqu'à la première réservation (médiane/p90), plus la page `/admin/onboarding`. Agrégation pure testée (9 cas). Reste : mesurer une amélioration réelle, ce qui suppose la cohorte de pilotes (R2-3).
- [ ] **Facturation SaaS — P1 Essential** : **checkout ouvert en production le 2026-09-22** (preuve `docs/release/evidence/essential-checkout-opening-2026-09-22.md`). Release `b00e326` déployée, 79/79 migrations appliquées, backfill exécuté (prod 0, staging 1), catalogue live 8/8, webhooks live conformes. Bloqueur restant : **signer deux pilotes Essential et tenir sept jours de métriques** (R2-3).
- [ ] **Sokar Connect — Pilote fermé** : il ne reste que **10 restos réels** + **sitemap GSC**. La **résa via lien ChatGPT est validée le 2026-09-21** : `connectAgentic` activé sur `chez-sokar-demo`, JSON-LD `ReserveAction` exposé, deep link fonctionnel, réservation réelle créée avec `source=chatgpt` persistée, et `holdToConfirmRate` sorti de zéro (4 SLO `met: true`, health GREEN — mais **n=1**, donc sans valeur statistique). Le monitoring P1 (`GET /api/internal/connect-kpis`, page `/dashboard/connect/pilot`) est déployé depuis le 2026-07-27.
- [ ] **Dette technique — env de test tsserver locké** : 2 tsserver.js tournent en background et bouffent 100% CPU à chaque typecheck. `find ... -name "*.tsbuildinfo" -delete && rm -rf .next .tsbuildinfo` corrige temporairement. À killer au reboot ou à disable dans VSCode (extensions TS). **Non-bloquant**.
- [ ] **Dette technique — smoke test Sokar Connect skip** : `smoke.test.ts` est `describe.skip` car trop couplé aux signatures internes. Les tests unitaires (38/38) couvrent les 4 endpoints. Pour un vrai e2e, monter docker-compose + Playwright.

## Décisions récentes

2026-09-24 — [reservations, voice, prisma] **Seuil de groupe unifié à 7** — La valeur par défaut des réservations vocales et agentiques est 7, portée par une constante partagée et le défaut Prisma. La migration ne change que le défaut des nouvelles lignes ; les lignes existantes conservent leur valeur.

2026-09-23 — [voice, TurnPlan, observabilité] **Shadow global et supervision** — `VOICE_TURN_PLAN_SHADOW_ENABLED=true` concerne tous les restaurants, sans allowlist ; `false` coupe partout. Flag actif en staging et production, API saine après reload sans session active. Le TurnPlan ne modifie rien. Prometheus scrape les quatre cibles de production et staging ; Grafana est séparé, loopback-only, en lecture seule par tunnel SSH. Son secret admin dédié est dans l’environnement GitHub `production` et le workflow le synchronise hors du checkout. Aucun appel réel staging (Telnyx absent).

2026-09-21 — [connect, onboarding, api] **Publier exige un slug** — `PATCH /api/restaurants/:id/connect` avec `connectPublished: true` refusait auparavant d'échouer proprement : sans slug, la fiche passait `connectPublished=true` + `publishedAt` + `agenticOptIn=true` mais ne produisait aucune page publique, sans message. La route renvoie désormais `409 { code: 'CONNECT_SLUG_REQUIRED', missing: ['slug'] }` avant toute écriture. Forme alignée sur `PROVISIONING_NOT_READY`.

2026-09-21 — [connect, database, seed, sécurité] **Le seed ne publie plus de fiches fictives sur une base distante** — Le garde passe de `NODE_ENV !== 'production'` (qui échouait en mode ouvert) à un raisonnement sur l'hôte de `DATABASE_URL`. Les fiches de démo `chez-sokar-*` ne se créent plus que sur `localhost`/`127.0.0.1`/`::1`, ou sur une base distante avec l'opt-in explicite `SEED_DEMO_RESTAURANTS=true`. Conséquence opérationnelle : si le seed doit alimenter les pages locales de staging, il faut désormais poser cet opt-in — `env.md` le documente. La fiche `chez-sokar-demo` reste hors garde et se crée partout.

2026-09-21 — [codex, performance, plugins, config] **Configuration Codex allégée** — Les entrées résiduelles Google Calendar et Slack sont désactivées (elles étaient déjà absentes côté gestionnaire de plugins). L’ancien plugin `computer-use` est désactivé ; `unified-computer-use`/`cua_repl` et le pont Chromium utilisé avec Brave restent actifs, GitHub est conservé. Le raisonnement par défaut passe de `max` à `high` pour réduire la latence ; `max` reste disponible comme choix ponctuel. Mesure sur session fraîche à confirmer.

## Liens rapides

[[README]] [[Architecture]] [[Journal]] [[Telnyx Pipeline]] [[Sokar Connect P0]] [[API Endpoints]]
