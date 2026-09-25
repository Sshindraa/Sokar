# Contexte Sokar

> État courant, court et à jour. Historique complet : [[Journal]]. Archives : [[archive/Context-log-2026]] (activité), [[archive/Context-decisions-2026]] (décisions).
>
> Les entrées d'activité ne vont **jamais** ici : direction `Journal.md`. Les décisions de plus de ~30 jours partent dans `archive/Context-decisions-2026.md`.
>
> Tenue du fichier : ne reçoit que les TODOs et les décisions du mois courant. Doit rester sous ~8 Ko — `scripts/quality/check-vault-size.sh` le vérifie avant chaque push.

## TODOs actifs

- [ ] Essai staging L16 : confirmer l’endianness avec la sonde.
- [ ] Activer `VOICE_STT_CHUNK_MS=100` après vérification staging.
- [ ] Phase 4a : évaluer le verrouillage FR côté Scribe.
- [ ] Étudier le débruitage et le parser par étape.

## Décisions récentes

2026-09-24 — [reservations, voice, prisma] **Seuil de groupe unifié à 7** — La valeur par défaut des réservations vocales et agentiques est 7, portée par une constante partagée et le défaut Prisma. La migration ne change que le défaut des nouvelles lignes ; les lignes existantes conservent leur valeur.

2026-09-23 — [voice, TurnPlan, observabilité] **Shadow global et supervision** — `VOICE_TURN_PLAN_SHADOW_ENABLED=true` concerne tous les restaurants, sans allowlist ; `false` coupe partout. Flag actif en staging et production, API saine après reload sans session active. Le TurnPlan ne modifie rien. Prometheus scrape les quatre cibles de production et staging ; Grafana est séparé, loopback-only, en lecture seule par tunnel SSH. Son secret admin dédié est dans l’environnement GitHub `production` et le workflow le synchronise hors du checkout. Aucun appel réel staging (Telnyx absent).

2026-09-21 — [connect, onboarding, api] **Publier exige un slug** — `PATCH /api/restaurants/:id/connect` avec `connectPublished: true` refusait auparavant d'échouer proprement : sans slug, la fiche passait `connectPublished=true` + `publishedAt` + `agenticOptIn=true` mais ne produisait aucune page publique, sans message. La route renvoie désormais `409 { code: 'CONNECT_SLUG_REQUIRED', missing: ['slug'] }` avant toute écriture. Forme alignée sur `PROVISIONING_NOT_READY`.

2026-09-21 — [connect, database, seed, sécurité] **Le seed ne publie plus de fiches fictives sur une base distante** — Le garde passe de `NODE_ENV !== 'production'` (qui échouait en mode ouvert) à un raisonnement sur l'hôte de `DATABASE_URL`. Les fiches de démo `chez-sokar-*` ne se créent plus que sur `localhost`/`127.0.0.1`/`::1`, ou sur une base distante avec l'opt-in explicite `SEED_DEMO_RESTAURANTS=true`. Conséquence opérationnelle : si le seed doit alimenter les pages locales de staging, il faut désormais poser cet opt-in — `env.md` le documente. La fiche `chez-sokar-demo` reste hors garde et se crée partout.

2026-09-21 — [codex, performance, plugins, config] **Configuration Codex allégée** — Les entrées résiduelles Google Calendar et Slack sont désactivées (elles étaient déjà absentes côté gestionnaire de plugins). L’ancien plugin `computer-use` est désactivé ; `unified-computer-use`/`cua_repl` et le pont Chromium utilisé avec Brave restent actifs, GitHub est conservé. Le raisonnement par défaut passe de `max` à `high` pour réduire la latence ; `max` reste disponible comme choix ponctuel. Mesure sur session fraîche à confirmer.

## Liens rapides

[[README]] [[Architecture]] [[Journal]] [[Telnyx Pipeline]] [[Sokar Connect P0]] [[API Endpoints]]
