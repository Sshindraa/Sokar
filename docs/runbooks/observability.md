# Runbook — Observabilité

> **Statut : ACTIF — créé le 21 septembre 2026.** Chantier R1-6 de
> [`roadmap-production-readiness.md`](../roadmap-production-readiness.md). Remplace la lecture
> implicite « tout est dans `/metrics` de l'API », qui n'était plus vraie après R1-1.

## Topologie

Depuis R1-1, deux process publient des métriques, et **Prometheus doit scraper les deux** :

| Process                            | Endpoint                        | Ce qu'il publie                                                                                                                                      |
| ---------------------------------- | ------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `sokar-api` (`dist/main.js`)       | `http://127.0.0.1:4000/metrics` | HTTP (`sokar_http_requests_total`), Connect, réservations, agentic, **sessions vocales actives** (`sokar_voice_active_sessions`) et latences vocales |
| `sokar-workers` (`dist/worker.js`) | `http://127.0.0.1:4001/metrics` | Files BullMQ (`sokar_queue_jobs`), appels/réservations en défaut sur 24 h, **SLO** (`sokar_slo_status`, `sokar_slo_value`), alertes envoyées         |

Staging utilise les ports décalés `4100` (API) et `4101` (worker). Les deux environnements tournent
sur le même VPS, donc un seul Prometheus scrape les quatre cibles et chaque série porte un label
`env` (`production` ou `staging`) — c'est ce label que les dashboards filtrent.

## Garde d'accès

L'endpoint `/metrics` est protégé par `shared/observability/metrics-auth.ts`, partagé par les deux
process : auth basique si `METRICS_BASIC_AUTH_USER` + `METRICS_BASIC_AUTH_PASSWORD` sont définis,
sinon allowlist d'IP (`METRICS_ALLOWLIST_IPS`, loopback par défaut).

Prometheus tourne en `network_mode: host`, donc il atteint les deux endpoints depuis la loopback :
aucun secret n'est nécessaire. Si Prometheus repasse un jour en réseau bridge, il faudra définir les
identifiants basiques sur les deux process et les déclarer dans `infra/prometheus/prometheus.yml`.

## Accès à Grafana

Grafana écoute sur `127.0.0.1:3030` et n'est **pas** exposé par Nginx. L'accès se fait par tunnel :

```zsh
ssh -L 3030:127.0.0.1:3030 deploy@sokar
# puis http://localhost:3030 — utilisateur admin, mot de passe GRAFANA_ADMIN_PASSWORD
```

`GRAFANA_ADMIN_PASSWORD` doit être présent dans l'environnement du compose avant le premier
démarrage : sans lui, le service refuse de démarrer (volontairement, plutôt qu'un mot de passe par
défaut).

## Démarrer la stack

```zsh
# sur le VPS, depuis /opt/sokar
docker compose -f infra/docker-compose.yml up -d prometheus grafana
```

Prometheus conserve 30 jours de séries (`prometheus-data`), Grafana ses dashboards et son état
(`grafana-data`). Les deux dashboards sont provisionnés depuis `infra/grafana/dashboards/` — ils ne
s'éditent pas dans l'interface, toute modification passe par le dépôt :

- **Sokar — Voice & SLO** : état des cinq SLO, sessions vocales simultanées (seuil 70), erreurs
  fournisseurs voice, p95 Connect, TTFT LLM, premier audio TTS ;
- **Sokar — Files & Alertes** : dead-letter, appels sans transcription, réservations sans SMS, taux
  de 5xx, profondeur des files, alertes envoyées par canal.

## Ajouter ou modifier une alerte

1. Ajouter la règle dans `infra/prometheus/alerts.yml` (`expr`, `for`, `labels.severity`,
   `annotations.summary` — les quatre sont exigés).
2. Le test `apps/api/src/shared/observability/__tests__/alert-rules.test.ts` échoue si la règle
   référence une métrique qui n'existe pas, ou si une métrique maison n'a pas le préfixe `sokar_`.
   C'est ce test qui remplace l'ancienne vérification manuelle : une règle qui cite une métrique
   inexistante ne se déclenche jamais, silencieusement.
3. Mettre à jour le dashboard concerné si la règle introduit une nouvelle métrique.

## Limites connues

- Le test des règles valide les **noms** de métriques, pas le fait qu'elles soient peuplées dans le
  process scrapé. La répartition API / worker est celle du tableau ci-dessus ; se tromper de cible
  donne un panneau vide, pas une erreur.
- Les compteurs HTTP vivent en mémoire : un redémarrage remet les séries à zéro. C'est sans
  conséquence sur Prometheus (les compteurs sont monotones par process), mais `rate()` peut produire
  un pic au redémarrage.
- Les alertes in-app (`system-health`, `alert-evaluation`) restent la source des notifications
  email/webhook/SMS. Prometheus et Grafana servent à l'historique et aux dashboards.
