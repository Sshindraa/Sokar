# Contexte Sokar

> État courant, court et à jour. Historique complet : [[Journal]]. Archives : [[archive/Context-log-2026]] (activité), [[archive/Context-decisions-2026]] (décisions).
>
> Les entrées d'activité ne vont **jamais** ici : direction `Journal.md`. Les décisions de plus de ~30 jours partent dans `archive/Context-decisions-2026.md`.
>
> Tenue du fichier : ne reçoit que les TODOs et les décisions du mois courant. Doit rester sous ~8 Ko — `scripts/quality/check-vault-size.sh` le vérifie avant chaque push.

## TODOs actifs

- [ ] **Sokar Connect — Pilote fermé** : il ne reste que **10 restos réels** + **sitemap GSC**. La **résa via lien ChatGPT est validée le 2026-09-21** : `connectAgentic` activé sur `chez-sokar-demo`, JSON-LD `ReserveAction` exposé, deep link fonctionnel, réservation réelle créée avec `source=chatgpt` persistée, et `holdToConfirmRate` sorti de zéro (4 SLO `met: true`, health GREEN — mais **n=1**, donc sans valeur statistique). Le monitoring P1 (`GET /api/internal/connect-kpis`, page `/dashboard/connect/pilot`) est déployé depuis le 2026-07-27.
- [x] **Sécurité — KPIs internes sans authentification** : **résolu le 2026-09-21**. `/api/internal/connect-kpis` et `/api/internal/pilot-kpis` répondaient 200 depuis Internet. Audit de la famille complète : les 11 autres routes `/api/internal/*` étaient déjà couvertes (les routes mutantes par `requireSokarOperator()`, `usage/margin` et `marketing/reconciliation` par token, en 503 quand le secret manque). Les deux fuites se limitaient à de la lecture agrégée. Garde `requireSokarOperator()` ajoutée sur les deux routes — le dashboard les appelle depuis le navigateur à travers le proxy Clerk, donc l'opérateur reste autorisé via `SOKAR_OPERATOR_USER_IDS`, déjà provisionné en prod. Aucun nouveau secret.
- [x] **Sokar Connect — fiches fictives publiées en prod** : **résolu le 2026-09-21**. Les 9 fiches `chez-sokar-*` (publiées le 2026-06-28 23:07 par un `db:seed` lancé sur la base prod sans `NODE_ENV`) ont été dépubliées en production via `pnpm --filter @sokar/database unpublish:demo-restaurants -- --apply`. Sitemap `sokar.tech` : 14 → 3 URLs ; `/restaurant/chez-sokar-veggie-paris` → 404 ; `/restaurants/paris` → 404 ; `/restaurants/lyon` → `noindex` (`totalInCity: 1`, `reason: not_enough_inventory`) ; `chez-sokar-demo` conservée (200 + JSON-LD). Conséquence à garder en tête : la vitrine publique ne contient plus que la fiche démo, donc le pilote a besoin des 10 restos réels pour que la surface ait du sens.
- [x] **Dette technique — Voice tests cassés (17 failures pré-existantes)** : résolu — `vitest run` API : 120 test files pass, 1235 tests pass, 6 skipped. Les modules `voice/__tests__/` (205 tests), `customers/__tests__/customer.service.test.ts` (12 tests) et `telnyx.pipeline.test.ts` (17 tests) sont verts. Le TODO du vault était obsolète.
- [x] **Gift-cards Stripe réel — déployé en production** : code finalisé + déployé sur `feat/floor-plan-construction` (commit `da94d5fd`). API health 200, endpoint `/webhooks/stripe` joignable (400 sans signature attendu). Clés live et publishable key déjà présentes sur le VPS. Webhook Stripe Dashboard à vérifier : `https://api.sokar.tech/webhooks/stripe` avec `payment_intent.succeeded` et `payment_intent.payment_failed`.
- [ ] **Dette technique — env de test tsserver locké** : 2 tsserver.js tournent en background et bouffent 100% CPU à chaque typecheck. `find ... -name "*.tsbuildinfo" -delete && rm -rf .next .tsbuildinfo` corrige temporairement. À killer au reboot ou à disable dans VSCode (extensions TS). **Non-bloquant**.
- [ ] **Dette technique — smoke test Sokar Connect skip** : `smoke.test.ts` est `describe.skip` car trop couplé aux signatures internes. Les tests unitaires (38/38) couvrent les 4 endpoints. Pour un vrai e2e, monter docker-compose + Playwright.

## Décisions récentes

2026-09-21 — [connect, onboarding, api] **Publier exige un slug** — `PATCH /api/restaurants/:id/connect` avec `connectPublished: true` refusait auparavant d'échouer proprement : sans slug, la fiche passait `connectPublished=true` + `publishedAt` + `agenticOptIn=true` mais ne produisait aucune page publique, sans message. La route renvoie désormais `409 { code: 'CONNECT_SLUG_REQUIRED', missing: ['slug'] }` avant toute écriture. Forme alignée sur `PROVISIONING_NOT_READY`.

2026-09-21 — [connect, database, seed, sécurité] **Le seed ne publie plus de fiches fictives sur une base distante** — Le garde passe de `NODE_ENV !== 'production'` (qui échouait en mode ouvert) à un raisonnement sur l'hôte de `DATABASE_URL`. Les fiches de démo `chez-sokar-*` ne se créent plus que sur `localhost`/`127.0.0.1`/`::1`, ou sur une base distante avec l'opt-in explicite `SEED_DEMO_RESTAURANTS=true`. Conséquence opérationnelle : si le seed doit alimenter les pages locales de staging, il faut désormais poser cet opt-in — `env.md` le documente. La fiche `chez-sokar-demo` reste hors garde et se crée partout.

2026-09-21 — [codex, performance, plugins, config] **Configuration Codex allégée** — Les entrées résiduelles Google Calendar et Slack sont désactivées (elles étaient déjà absentes côté gestionnaire de plugins). L’ancien plugin `computer-use` est désactivé ; `unified-computer-use`/`cua_repl` et le pont Chromium utilisé avec Brave restent actifs, GitHub est conservé. Le raisonnement par défaut passe de `max` à `high` pour réduire la latence ; `max` reste disponible comme choix ponctuel. Mesure sur session fraîche à confirmer.

## Liens rapides

[[README]] [[Architecture]] [[Journal]] [[Telnyx Pipeline]] [[Sokar Connect P0]] [[API Endpoints]]
