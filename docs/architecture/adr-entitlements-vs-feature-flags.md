# ADR — Entitlements commerciaux et feature flags

Date : 13 septembre 2026  
Statut : accepté, première implémentation livrée sur la branche de travail

## Décision

Le plan effectif du restaurant détermine ses droits commerciaux. La matrice canonique vit dans
`packages/config/src/entitlements.ts` et l'API est seule autorisée à prendre une décision d'accès.
Le dashboard peut afficher cette décision, mais ne doit jamais l'inférer à partir du nom du plan.

ConfigCat peut temporairement remplacer le plan d'un restaurant pour un essai ou un déploiement
progressif. Une fois le plan effectif calculé, la même matrice d'entitlements s'applique. Un feature
flag ne peut donc pas contourner un droit commercial.

## Ordre d'évaluation

1. Charger le plan attaché au restaurant dans Postgres.
2. Appliquer, s'il est valide, l'override `restaurant_plan` de ConfigCat.
3. Normaliser les alias historiques : `STARTER → essential`, `PREMIUM → multi-site`.
4. Résoudre les capabilities et limites depuis `PLAN_ENTITLEMENTS`.
5. Vérifier séparément les flags de rollout, la configuration fournisseur et son état de santé.

```text
plan DB → override ConfigCat → plan commercial → entitlement → flag/runtime health → action
```

## Contrats

- `GET /entitlements` expose les droits du restaurant authentifié, sans coût fournisseur ni marge.
- `requireCapability(capability)` renvoie `403 CAPABILITY_NOT_INCLUDED` avant tout accès métier.
- `reactivation.manage` protège désormais la lecture, l'envoi et le rejet des campagnes de
  réactivation.
- Une capability absente ou fausse est refusée ; aucune règle commerciale ne doit être dupliquée
  dans une page du dashboard.

## Limites actuelles

Les quotas voix et SMS restent `null`, ce qui signifie « aucune limite commerciale encore
appliquée ». Les inventer avant le ledger d'usage créerait un contrat impossible à justifier. Ils
seront chiffrés après la collecte des coûts réels et leur activation demandera des tests de seuil,
de période et de dépassement.

Les capabilities CRM avancé, campagnes et attribution seront ajoutées avec les fonctions
correspondantes. La matrice ne doit pas annoncer comme disponible un module qui n'existe pas.

## Règle de migration

Toute nouvelle restriction sur une fonction déjà utilisée doit être déployée en trois temps :

1. décision observable sans blocage ;
2. mesure des restaurants qui seraient refusés ;
3. enforcement après correction des plans ou période de grâce.

La réactivation est directement protégée car elle est déjà définie comme une fonction Pro et ses
tests couvrent explicitement Essential refusé et Pro autorisé.
