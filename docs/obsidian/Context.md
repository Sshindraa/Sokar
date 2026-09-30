# Contexte Sokar

> État courant, court et à jour. Historique complet : [[Journal]]. Archives : [[archive/Context-log-2026]] (activité), [[archive/Context-decisions-2026]] (décisions).
>
> Les entrées d'activité ne vont **jamais** ici : direction `Journal.md`. Les décisions de plus de ~30 jours partent dans `archive/Context-decisions-2026.md`.
>
> Tenue du fichier : ne reçoit que les TODOs et les décisions du mois courant. Doit rester sous ~8 Ko — `scripts/quality/check-vault-size.sh` le vérifie avant chaque push.

## TODOs actifs

- [ ] Span-01 : annoter 300 à 500 tours difficiles, puis décider de la phase 2 (advisory).

- [ ] Banc voix phase 1 : créer `CEREBRAS_EVAL_API_KEY` sur le VPS, lancer la mesure de référence `VBE_SUITE=perturb`, et annoter par écoute humaine le cas bf3893ae (`truthStatus: unverified`).
- [ ] Essai staging L16 : confirmer l’endianness avec la sonde.
- [ ] Activer `VOICE_STT_CHUNK_MS=100` après vérification staging.
- [ ] Phase 4a : évaluer le verrouillage FR côté Scribe.
- [ ] Étudier le débruitage et le parser par étape.
- [ ] Après déploiement phase 6, refaire l’appel pilote Deepgram + Dialogue V2 et analyser latence/fallback.
- [ ] Avant un canary Flux, comprendre les 9/31 finals manquants sur le bruit synthétique; allowlist Flux vide jusque-là.
- [ ] Phase A3 : décider d’un canary keyterms métier/L16 après revue des résultats synthétiques et validation staging.
- [ ] MCP : fusionner puis déployer le reset compatible avec l’audit, nettoyer le run existant du staging et rejouer les écritures après déploiement. Claude staging est reconnecté avec la portée multi-restaurants approuvée par l’utilisateur ; seuls les tests Chez Sokar sont autorisés pour ce run. Les clients n’exposent pas `initialize`/`tools/list` bruts.

## Décisions récentes

2026-09-30 — [MCP, UX] Pour une question simple de disponibilité, utiliser `answer_availability`, dont la sortie est limitée à `{ message }`; répondre uniquement avec le résultat utile, sans commentaire automatique sur l’absence de réservation. Si la personne demande explicitement si une réservation a été créée, répondre clairement. Après tout déploiement ou changement des consignes MCP, actualiser la liste d’outils dans ChatGPT et Claude : les deux peuvent conserver les définitions précédentes en cache. Les clients génèrent encore le texte final.

2026-09-29 — [MCP, UX] **Prompts et resources différés** — Les parcours ChatGPT/Claude déjà observés utilisent directement recherche, disponibilité et réservations ; aucune demande produit ne justifie une surface `prompts`/`resources` supplémentaire. Réévaluer lorsqu’un parcours récurrent nécessite un workflow guidé ou un contenu restaurant statique dans le client.

2026-09-29 — [MCP, contrats] **Retries sûrs et résultats validés à l'exécution** — Une modification répétée avec les mêmes valeurs devient un no-op (`changed: false`) ; une annulation déjà réussie renvoie `cancelled: true` sans rejouer les effets. Les erreurs exposent aussi un code/message stable dans `_meta["com.sokar/error"]`, en conservant le texte existant. Sokar vérifie les sorties après redaction contre les schémas publiés. `create_quote` est conservé sans changement de contrat comme référence informative temporaire ; son `quoteId` ne réserve pas la capacité et ne peut pas finaliser une réservation. `create_hold` reste l'action qui garde un créneau.

2026-09-29 — [MCP, contrats et observabilité] **Contrats de recherche additifs, métriques indépendantes du client** — `search_restaurants` expose adresse, cuisine, gamme de prix et créneau exact ; `check_availability` expose décision, alternatives et action recommandée, sans IDs internes de conflit. Les dimensions Prometheus restent outil, statut, type d’authentification et transport ; ChatGPT/Claude sont comparés dans la matrice plutôt que distingués par un nouveau label.

2026-09-25 — [voice, deepgram, keyterms] **Keyterms par restaurant en opt-in** — Les termes métier générés (budget estimé dédié de 200 tokens) s'activent par allowlist. Hors allowlist, conserver les keyterms historiques pour préserver le comportement ; aucune donnée client/personnel ou note libre n'est chargée. `VOICE_DEEPGRAM_MIP_OPT_OUT=true` devient le seul changement Deepgram par défaut.

2026-09-24 — [reservations, voice, prisma] **Seuil de groupe unifié à 7** — La valeur par défaut des réservations vocales et agentiques est 7, portée par une constante partagée et le défaut Prisma. La migration ne change que le défaut des nouvelles lignes ; les lignes existantes conservent leur valeur.

2026-09-23 — [voice, TurnPlan, observabilité] **Shadow global et supervision** — `VOICE_TURN_PLAN_SHADOW_ENABLED=true` concerne tous les restaurants, sans allowlist ; `false` coupe partout. Flag actif en staging et production, API saine après reload sans session active. Le TurnPlan ne modifie rien. Prometheus scrape les quatre cibles de production et staging ; Grafana est séparé, loopback-only, en lecture seule par tunnel SSH. Son secret admin dédié est dans l’environnement GitHub `production` et le workflow le synchronise hors du checkout. Aucun appel réel staging (Telnyx absent).

2026-09-21 — [connect, onboarding, api] **Publier exige un slug** — `PATCH /api/restaurants/:id/connect` avec `connectPublished: true` refusait auparavant d'échouer proprement : sans slug, la fiche passait `connectPublished=true` + `publishedAt` + `agenticOptIn=true` mais ne produisait aucune page publique, sans message. La route renvoie désormais `409 { code: 'CONNECT_SLUG_REQUIRED', missing: ['slug'] }` avant toute écriture. Forme alignée sur `PROVISIONING_NOT_READY`.

2026-09-21 — [connect, database, seed, sécurité] **Le seed ne publie plus de fiches fictives sur une base distante** — Le garde passe de `NODE_ENV !== 'production'` (qui échouait en mode ouvert) à un raisonnement sur l'hôte de `DATABASE_URL`. Les fiches de démo `chez-sokar-*` ne se créent plus que sur `localhost`/`127.0.0.1`/`::1`, ou sur une base distante avec l'opt-in explicite `SEED_DEMO_RESTAURANTS=true`. Conséquence opérationnelle : si le seed doit alimenter les pages locales de staging, il faut désormais poser cet opt-in — `env.md` le documente. La fiche `chez-sokar-demo` reste hors garde et se crée partout.

2026-09-21 — [codex, performance, plugins, config] **Configuration Codex allégée** — Les entrées résiduelles Google Calendar et Slack sont désactivées (elles étaient déjà absentes côté gestionnaire de plugins). L’ancien plugin `computer-use` est désactivé ; `unified-computer-use`/`cua_repl` et le pont Chromium utilisé avec Brave restent actifs, GitHub est conservé. Le raisonnement par défaut passe de `max` à `high` pour réduire la latence ; `max` reste disponible comme choix ponctuel. Mesure sur session fraîche à confirmer.

## Liens rapides

[[README]] [[Architecture]] [[Journal]] [[Telnyx Pipeline]] [[Sokar Connect P0]] [[API Endpoints]]
