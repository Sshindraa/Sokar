# Runbook opérationnel Sokar

> Procédures d'incident transversales (agentic, MCP, OpenAI Reserve,
> Canal A, voice). Pas un document "pilote Lyon" : c'est le runbook
> de prod, applicable à tout ce qui tourne sur Sokar.
>
> **Statut** : squopé en juin 2026 pour retirer la fiction (24/7,
> daily async, weekly retro, status page inexistante). Le pilote
> terrain n'est pas lancé, mais les procédures d'incident restent
> valides et applicables à n'importe quel incident en dev/staging/prod.

## Contacts

| Rôle               | Qui                            | Quand                                       |
| ------------------ | ------------------------------ | ------------------------------------------- |
| On-call P1         | Hamza                          | Tout incident actif listé dans ce runbook  |
| Backup on-call     | (à définir si l'équipe grandit) | Quand Hamza indispo                        |
| Restaurant contact | Base clients Sokar (Dashboard) | Pour chaque resto individuellement          |
| DPO                | `dpo@sokar.tech`               | Tout incident PII (cf. §PII leak ci-dessous)|

## Canaux d'alerte

| Canal                  | Usage                                      | Statut                |
| ---------------------- | ------------------------------------------ | --------------------- |
| Sentry                 | Erreurs applicatives                       | Configuré             |
| Prometheus `/metrics`  | Scraping interne                           | Configuré             |
| Discord/Slack incidents| Alertes ops temps réel                     | **Pas encore créé** (voir `_archive/channel-setup.md`) |
| Status page public     | Communication incident aux restos          | **Pas encore créé**   |

## Health SLO summary

| KPI                                  | Target   | Action si breach                                  |
| ------------------------------------ | -------- | ------------------------------------------------- |
| `sokar_agentic_double_booking_attempts_total` | = 0      | Investigate immédiat (cf. §Double booking)        |
| `sokar_agentic_pii_leaks_total`      | = 0      | Investigate immédiat (cf. §PII leak)              |
| `sokar_agentic_check_availability_duration_ms` p95 | < 800ms | Check Telnyx, Deepgram, Prisma, Redis            |
| 5xx rate                             | < 1%     | Check providers externes + dernière release      |

Source : `GET /metrics` (scrape Prometheus) ou endpoint interne
`/api/internal/pilot-kpis` quand l'auth VPN sera en place.

---

## Procédures d'incident

### P1 — Double booking détecté

**Symptôme** : Sentry alert `double_booking`, compteur
`sokar_agentic_double_booking_attempts_total` > 0.

**Diagnostic** :

1. Récupérer le `restaurantId` + `slotStart` + `attemptedBy` dans Sentry
2. Lister les résas actives pour ce slot :
   ```ts
   db.reservation.findMany({
     where: {
       restaurantId,
       startsAt: { gte: slotStart - 1h, lte: slotStart + 1h },
     },
   });
   ```
3. Vérifier le partial unique index :
   ```sql
   SELECT * FROM pg_indexes WHERE indexname = 'one_active_hold_per_slot';
   ```

**Action** :

1. Contacter le resto dans les 30 min
2. Proposer un dédommagement (surclassement, dessert, prochaine résa offerte)
3. Si > 1 double booking en 24h : rollback la feature fautive pour ce resto
4. Post-mortem dans les 48h

**Escalade** : Hamza (on-call) → CTO si > 3 incidents en 7 jours.

---

### P1 — PII leak détecté

**Symptôme** : Sentry alert `pii_leak`, compteur
`sokar_agentic_pii_leaks_total{kind="phone|email|hex"}` > 0.

**Diagnostic** :

1. Récupérer le `tool` + `kind` (phone/email/hex) + `path` dans Sentry
2. Identifier le tool response fautif
3. Vérifier que `redactResponse()` est bien appelé après l'exécution
   (cf. `apps/api/src/shared/observability/pii-leak.ts`)

**Action IMMÉDIATE** :

1. **Désactiver le tool fautif** : commenter dans `tools/registry.ts` + redéployer
2. Si le PII est sorti du système (logs tiers, telemetry) : notification CNIL
   sous 72h (RGPD Article 33) si risque élevé
3. Identifier tous les sujets affectés via `POST /api/rgpd/export`
4. Communication transparente aux restos

**Escalade** : Hamza + DPO (`dpo@sokar.tech`) → CNIL si confirmé.

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
3. Communication status (status page à créer — placeholder)

**Escalade** : Hamza → hébergeur VPS si > 30 min.

---

### P2 — Latence p95 > 800ms

**Symptôme** : Grafana panneau "Latence check_availability" > 800ms
sur 5 min.

**Diagnostic** :

1. Vérifier Prisma : `EXPLAIN ANALYZE` sur la query
2. Vérifier Redis (cache down ?)
3. Vérifier Telnyx (latence réseau vers provider)

**Action** :

1. Si Postgres : ajouter index manquant
2. Si Redis down : fallback DB marche (vérifier `McpRateLimiter`)
3. Si Telnyx : pas d'action, mais communication

---

### P3 — Restaurant demande aide

**Symptôme** : email direct, message Telegram, ou retour dans un canal
interne.

**Action** :

1. Réponse sous 4h ouvrées
2. Si bug : créer ticket, fix dans la semaine
3. Si question : répondre en screen-share si besoin
4. Logger dans le channel de support approprié

---

## Procédure de désactivation d'urgence

En cas de problème grave (P0) :

1. **Désactiver MCP pour tous les restos** :
   ```sql
   UPDATE restaurants SET agentic_opt_in = false;
   ```
   (Note : la colonne est `agentic_opt_in` pour la rétrocompat avec
   l'agentic P0. Renommage à `acceptsReservations` prévu en P5 — cf.
   spec Canal A v1.1 §13.7.)

2. **Désactiver OpenAI Reserve** :
   ```sql
   UPDATE restaurants SET openai_reserve_enabled = false;
   ```

3. **Désactiver Canal A** (nouveau) :
   ```sql
   UPDATE restaurant_exposure_settings
   SET canal_a_published = false, canal_a_agentic = false;
   ```

4. **Communication** : status page (à créer) + canaux restos (à créer)

5. **Investigation** : root cause analysis dans les 24h

6. **Réactivation** : resto par resto, après validation manuelle

Scripts SQL à créer dans `scripts/` :
- `emergency-disable.sql` (à créer)
- `reactivation.sql` (à créer)

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

- Spec agentic-reservations v3.2 : `docs/sokar-mcp-agentic-reservations-v3.2.md`
- Spec Canal A v1.1 : `docs/canal-a-v1.1.md`
- Code metrics : `apps/api/src/shared/observability/metrics.ts`
- Code PII leak detector : `apps/api/src/shared/observability/pii-leak.ts`
- Code hold service : `apps/api/src/modules/agentic-reservations/core/hold.service.ts`
- Migration `one_active_hold_per_slot` (partial unique index) :
  `packages/database/prisma/migrations/20260621004000_agentic_p0_constraints/`

---

**Changelog** :
- 2026-06-24 : squopé. Retiré "On-call P1 (24/7)", "9h daily async",
  "Weekly retro (1h)", "status.sokar.com (à créer)". Ajouté procédure
  désactivation Canal A. Ajouté référence aux specs v3.2 agentic et
  v1.1 Canal A. Renommé "Runbook opérationnel — Pilote Lyon" en
  "Runbook opérationnel Sokar" (transversal, plus seulement pilote).
