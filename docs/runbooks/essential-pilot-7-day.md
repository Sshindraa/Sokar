# Runbook — Pilote Essential sur sept jours

> **Statut : MODÈLE DE RUNBOOK — preuve terrain ouverte.** Le checkout Essential est ouvert en
> production et le catalogue Stripe live est conforme. Ce document décrit le protocole à exécuter
> pour deux restaurants ; il ne constitue pas une preuve tant que les fiches de pilote et les
> métriques réelles ne sont pas jointes. Voir [`../release/evidence/essential-checkout-opening-2026-09-22.md`](../release/evidence/essential-checkout-opening-2026-09-22.md).

Ce pilote valide la boucle commerciale et l'exploitation quotidienne d'Essential à 199 €/mois. Il
porte sur deux restaurants consentants pendant sept jours consécutifs. Il ne doit pas être élargi à
un troisième restaurant avant la revue GO/NO-GO des deux premiers.

## Conditions d'entrée

- [ ] Deux restaurants ont accepté le pilote et désigné un responsable joignable pendant le service.
- [ ] L'accord et la date de début sont conservés dans la fiche d'audit interne, sans téléphone,
      nom de client ou transcript brut dans le dépôt.
- [ ] Chaque restaurant a terminé l'onboarding : identité, horaires, numéro, renvoi/webhook et
      appel de validation confirmés dans le parcours normal.
- [ ] Le propriétaire a souscrit Essential via Checkout ; `GET /billing/status` confirme le plan,
      la cadence et la prochaine échéance.
- [ ] Les huit prix Stripe live sont conformes (`verify-stripe-catalog.mjs` : 8/8) et les événements
      de facturation requis sont actifs sur le webhook live.
- [ ] Le tableau de bord Prometheus/Grafana, Sentry et l'accès opérateur aux KPIs sont vérifiés
      avant le premier service.

Les identifiants de restaurant et de compte restent dans l'outil d'exploitation ou la fiche d'audit
à accès restreint. Utiliser dans les exports une référence de pilote opaque (`essential-pilot-a`,
`essential-pilot-b`). Ne jamais ajouter de clé Stripe, de secret webhook ou de donnée client à ce
runbook.

## Fiche de démarrage

À copier dans une fiche datée de `docs/audits/` :

```text
Référence pilote : essential-pilot-__
Restaurant : [référence interne restreinte]
Date/heure de début (Europe/Paris) : ____
Date/heure de fin (Europe/Paris) : ____
Plan/cadence : Essential / mensuel ou annuel
Responsable restaurant : [référence restreinte]
Responsable Sokar : [référence interne]
Consentement archivé : oui / non
Snapshot initial billing/status : [lien ou empreinte]
Snapshot initial KPIs : [lien ou empreinte]
Décision finale : GO / NO-GO / prolonger sous contrôle
```

## Relevé quotidien

Le relevé est effectué à la même heure chaque jour, puis après le service du soir. Les réponses
JSON sont conservées sous forme d'empreinte ou de valeurs agrégées ; les payloads contenant des
coordonnées client restent hors du dépôt.

| Contrôle   | Source                                                | À relever                                                                  |
| ---------- | ----------------------------------------------------- | -------------------------------------------------------------------------- |
| Abonnement | `GET /billing/status` dans le dashboard du restaurant | statut, cadence, échéance, grâce ou résiliation programmée                 |
| KPI pilote | `GET /api/internal/pilot-kpis`                        | total, honor rate, p95 disponibilité, double booking, incidents PII, santé |
| Onboarding | `GET /admin/onboarding-funnel/cohort`                 | activation, premier appel, première réservation, délai médian/p90          |
| Voice/SLO  | Prometheus + Grafana                                  | sessions actives, erreurs fournisseur, SLO en échec, backlog et alertes    |
| Stripe     | Dashboard Stripe en lecture seule                     | facture/événement attendu, échec ou recouvrement éventuel                  |
| Terrain    | responsable du restaurant                             | appels reçus, réservations corrigées manuellement, friction et incident    |

### Calendrier

- **J-1** : vérifier les conditions d'entrée, prendre les snapshots et confirmer la fenêtre de
  service. Aucun client réel ne sert de cas de test dédié.
- **J0** : effectuer un appel contrôlé avec l'accord du restaurant, puis vérifier la réservation
  dans le dashboard et dans le KPI agrégé. Marquer le début du compteur de sept jours.
- **J1 à J6** : relever les cinq sources chaque jour, noter les incidents et conserver le lien vers
  l'alerte ou le ticket interne. Une donnée manquante est `UNKNOWN`, jamais zéro.
- **J7** : prendre le snapshot final, vérifier la facture et le portail, recueillir l'avis du
  responsable, puis rédiger la décision GO/NO-GO.

## Arrêt immédiat et reprise

Suspendre le pilote concerné et prévenir l'opérateur si l'un de ces événements survient :

- double réservation, réservation perdue ou état incohérent non expliqué ;
- fuite de donnée personnelle, mauvais établissement ou accès inter-tenant ;
- débit, prix, cadence ou période de grâce qui ne correspondent pas au Checkout ;
- appel vocal qui reste muet sans dégradation, ou répétition d'un outil métier dangereux ;
- alerte SLO critique non acquittée ou worker/API indisponible pendant le service.

Pendant l'analyse, ne pas modifier directement PostgreSQL et ne pas supprimer les audits. Utiliser
les voies applicatives idempotentes : portail Stripe pour une résiliation, désactivation normale de
la publication Connect ou du numéro concerné, et procédure de rollback/incident pour une mutation
technique. Le checkout global reste ouvert pour les autres comptes tant qu'une décision opérateur
n'a pas demandé une fermeture globale documentée.

Un incident fournisseur transitoire sans perte de réservation est conservé comme incident du pilote
avec son début, sa fin, sa dégradation observée et l'alerte associée. Il ne doit pas être transformé
en succès silencieux.

## Preuves de clôture

Une fiche par restaurant doit contenir :

1. la référence opaque, les dates et le consentement ;
2. les sept relevés quotidiens et le snapshot final `billing/status` ;
3. les valeurs KPI agrégées au début et à la fin, avec les périodes et l'empreinte des exports ;
4. la liste des incidents, alertes, reprises et décisions opérateur ;
5. la facture ou l'événement Stripe attendu, vérifié sans secret ;
6. le feedback du responsable et la décision signée `GO`, `NO-GO` ou `prolonger sous contrôle`.

La porte `P1_ESSENTIAL` ne passe à `CLOSED` que lorsque les deux fiches couvrent sept jours
complets, qu'aucun incident bloquant n'est ouvert et que la décision de sortie est explicite. Une
fiche incomplète reste `OPEN` ; elle ne doit pas être compensée par une moyenne globale.

## Nommage des preuves

```text
docs/audits/YYYY-MM-DD-essential-pilot-a-7-day.md
docs/audits/YYYY-MM-DD-essential-pilot-b-7-day.md
```

Les captures doivent être rédigées avant archivage. Les valeurs sensibles restent dans les systèmes
appropriés ; le dépôt ne contient que la preuve minimale permettant de rejouer la décision.
