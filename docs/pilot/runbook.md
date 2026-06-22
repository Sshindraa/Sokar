# Runbook opérationnel — Pilote Lyon

> Document de référence pour l'équipe ops pendant le pilote. À imprimer ou
> garder en favori Slack. Mis à jour à chaque incident post-mortem.

## Contacts

| Rôle               | Qui                            | Quand                                   |
| ------------------ | ------------------------------ | --------------------------------------- |
| On-call P1 (24/7)  | Hamza                          | Tous les incidents Sentry `level=error` |
| Backup on-call     | [TBD]                          | Quand Hamza indispo                     |
| Restaurant contact | Voir `onboarding-checklist.md` | Pour chaque resto individuellement      |

## Canaux Slack/Discord

- `#sokar-pilot-incidents` (P1) : tout incident actif
- `#sokar-pilot-feedback` (P3) : retours restos (positifs, frictions, demandes)
- `#sokar-pilot-data` (P2) : anomalies chiffres KPIs

## Health SLO summary

| KPI                           | Target  | Action si breach                          |
| ----------------------------- | ------- | ----------------------------------------- |
| `reservations_total` (4 sem.) | ≥ 100   | Communication resto, ajustement TTL       |
| `honor_rate`                  | ≥ 50%   | Coaching resto, audit des no-show         |
| `double_booking_attempts`     | = 0     | Investigate immédiat (Sentry)             |
| `pii_leak_incidents`          | = 0     | Investigate immédiat (Sentry + audit log) |
| `check_availability_p95_ms`   | < 800ms | Check Telnyx, Deepgram, Prisma            |

Source : `GET /api/internal/pilot-kpis` (interne) ou Grafana dashboard
(`docs/pilot/grafana-dashboard.json`).

---

## Procédures d'incident

### P1 — Double booking détecté

**Symptôme** : Sentry alert `double_booking`, compteur
`sokar_agentic_double_booking_attempts_total` > 0.

**Diagnostic** :

1. Récupérer le `restaurantId` + `slotStart` + `attemptedBy` dans Sentry
2. Lister les résas actives pour ce slot : `db.reservation.findMany({ where: { restaurantId, startsAt: { gte: slotStart - 1h, lte: slotStart + 1h } } })`
3. Vérifier le partial unique index : `SELECT * FROM pg_indexes WHERE indexname = 'one_active_hold_per_slot';`

**Action** :

1. Contacter le resto dans les 30 min
2. Proposer un dédommagement (surclassement, dessert, prochaine résa offerte)
3. Si > 1 double booking en 24h : rollback la feature MCP/OpenAI Reserve
   pour ce resto (`/api/agentic/opt-in` → désactivation)
4. Post-mortem dans les 48h

**Escalade** : Hamza (on-call) → CTO si > 3 incidents en 7 jours.

---

### P1 — PII leak détecté

**Symptôme** : Sentry alert `pii_leak`, compteur
`sokar_agentic_pii_leaks_total` > 0.

**Diagnostic** :

1. Récupérer le `tool` + `kind` (phone/email/hex) + `path` dans Sentry
2. Identifier le tool response fautif
3. Vérifier que `redactResponse()` est bien appelé après l'exécution

**Action IMMÉDIATE** :

1. **Désactiver le tool fautif** : commenter dans `tools/registry.ts` + redéployer
2. Si le PII est sorti du système (logs tiers, telemetry) : notification CNIL
   sous 72h (RGPD Article 33) si risque élevé
3. Identifier tous les sujets affectés via `POST /api/rgpd/export`
4. Communication transparente aux restos

**Escalade** : Hamza + DPO (`dpo@sokar.com`) → CNIL si confirmé.

---

### P2 — 5xx rate > 1%

**Symptôme** : alert `error_rate_high` OU Grafana panneau "Taux erreur"

> 1% sur 5 min glissantes.

**Diagnostic** :

1. Identifier le type d'erreur (500 vs 502 vs 504)
2. 502/504 : check load balancer, VPS, réseau
3. 500 : check Sentry pour stack trace
4. Vérifier Telnyx / Deepgram / Cartesia / OpenAI status pages

**Action** :

1. Si provider externe : bascule vers backup (ex: Cartesia → ElevenLabs)
   ou pause des résas agentic
2. Si interne : rollback dernière release
3. Communication status public (`status.sokar.com` à créer si prod)

**Escalade** : Hamza → hébergeur VPS si > 30 min.

---

### P2 — Latence p95 > 800ms

**Symptôme** : Grafana panneau "Latence check_availability" > 800ms
sur 5 min.

**Diagnostic** :

1. Vérifier Prisma : `EXPLAIN ANALYZE` sur la query
2. Vérifier Redis (cache down ?)
3. Vérifier Telnyx (latence réseau vers Twilio)

**Action** :

1. Si Postgres : ajouter index manquant
2. Si Redis down : fallback DB marche (vérifier `McpRateLimiter`)
3. Si Telnyx : pas d'action, mais communication

---

### P3 — Restaurant demande aide

**Symptôme** : message dans `#sokar-pilot-feedback` ou email direct.

**Action** :

1. Réponse sous 4h ouvrées
2. Si bug : créer ticket, fix dans la semaine
3. Si question : répondre en screen-share si besoin
4. Logger dans le Slack channel

---

## Daily standup (10 min)

**Quoi** : async dans `#sokar-pilot-data`, 9h chaque jour ouvré.

**Format** :

```
- Hier : [N résas, taux honor X%, N incidents]
- Aujourd'hui : [N calls planifiés restos, 0 incident attendu]
- Blockers : [si applicable]
```

---

## Weekly retro (1h)

**Quoi** : vendredi 16h-17h, en visio.

**Agenda** :

1. KPIs semaine (reservations_created, honor_rate, double_booking, pii_leak, p95)
2. Top 3 frictions restos
3. Top 3 bugs/features
4. Décisions à prendre
5. Actions pour la semaine suivante

---

## Procédure de désactivation d'urgence

En cas de problème grave (P0) :

1. **Désactiver MCP pour tous les restos** : `UPDATE restaurants SET mcp_enabled = false;`
2. **Désactiver OpenAI Reserve** : `UPDATE restaurants SET openai_reserve_enabled = false;`
3. **Communication** : status page + Slack channel restos
4. **Investigation** : root cause analysis dans les 24h
5. **Réactivation** : resto par resto, après validation manuelle

Script SQL préparé dans `scripts/emergency-disable.sql`. Réactivation via `UPDATE restaurants SET mcp_enabled = true WHERE id = '<restaurant-id>';` restaurant par restaurant uniquement.

---

## Post-mortem template

```
## Incident : [titre court]
- Date : YYYY-MM-DD HH:MM
- Durée : X min
- Sévérité : P1 / P2 / P3
- Restaurants affectés : [noms ou "tous"]
- KPIs impactés : [lesquels]

## Timeline
- HH:MM : événement
- HH:MM : détection
- HH:MM : ack on-call
- HH:MM : mitigation
- HH:MM : résolution

## Root cause
[Description technique]

## Action items
- [ ] [action] - [owner] - [deadline]
```

---

## Liens utiles

- Grafana : `https://grafana.sokar.com/d/sokar-pilot`
- Dashboard JSON : `docs/pilot/grafana-dashboard.json`
- Sentry : `https://sokar.sentry.io/projects/sokar-pilot`
- API KPIs : `GET /api/internal/pilot-kpis` (VPN only)
- Emergency disable : `scripts/emergency-disable.sql`
- Daily audit checks : `scripts/audit-checks.sql`
- Status page : `https://status.sokar.com` (\u00e0 cr\u00e9er)
- DB admin : TablePlus / psql sur `sokar-prod`
