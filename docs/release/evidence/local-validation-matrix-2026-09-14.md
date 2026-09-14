# Matrice de validation locale — 14 septembre 2026

Cette matrice recense les tests automatisés exécutés sur la branche de travail.
Elle sert à distinguer le logiciel vérifié localement des preuves externes
requises par les portes de release. Aucun résultat ci-dessous ne vaut validation
fournisseur, contrat, identité Clerk réelle ou pilote restaurant.

| Porte                  | Vérification locale                                                                                                                                    |                                                         Résultat | Limite restante                                                                                        |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------: | ------------------------------------------------------------------------------------------------------ |
| P0 Usage               | Suite usage, connecteur Telnyx simulé, concurrence PostgreSQL, contrôle Telnyx réel (août : 0 usage, mai : trafic non nul) et paquet comptable fichier | 17 fichiers / 73 tests + 2 intégration ignorés + preuves réelles | Import dans la destination comptable choisie ; rattachement/conversion du trafic Telnyx non nul de mai |
| P1 Essential           | Billing routes/services, plans partagés et pricing Dashboard                                                                                           |                                                 21 + 4 + 2 tests | Prix Stripe test, Checkout/webhook/facture/portail et 2 pilotes 7 jours                                |
| P2 CRM                 | CRM clients/fusion/projections et groupes                                                                                                              |                                            4 fichiers / 40 tests | Concurrence fusion/segmentation/projection sur PostgreSQL réel et 2 sessions Clerk                     |
| P3 Marketing           | Permissions, segments, campagnes, automatisations, callbacks et reporting                                                                              |                                           11 fichiers / 47 tests | Telnyx/Resend réels, domaine, coûts délivrés, consentement et désinscription                           |
| P4 Attribution         | Service d'attribution couvert dans la suite marketing                                                                                                  |                                   inclus dans 47 tests marketing | Parcours campagne → clic → réservation → visite honorée et comparaison encaissée                       |
| P5 Paiements           | Routes et service de protection bancaire                                                                                                               |                                            2 fichiers / 10 tests | Modèle marchand, DPA, Stripe Connect sandbox et pilote litiges                                         |
| P6 POS                 | Connexions, import de tickets et rapprochement                                                                                                         |                                            3 fichiers / 12 tests | Fournisseur choisi, secret manager, webhooks/worker/DLQ et 30 jours de tickets                         |
| P7 CRM groupe          | Routes/services de groupes et isolation tenant                                                                                                         |                                         inclus dans 40 tests CRM | Sessions Clerk réelles multi-site, effacement/export et consentement campagne                          |
| P8 Réputation/fidélité | Feedback, récupération, avantages et consommation                                                                                                      |                                            6 fichiers / 39 tests | Plateformes/canal choisis, coûts/fréquence et pilote feedback                                          |
| P9 Écosystème          | Expériences, événements et distribution                                                                                                                |                                            8 fichiers / 63 tests | Partenaire, DPA/OAuth, adaptateur public, réconciliation et pilote                                     |

Commandes exécutées depuis la racine :

```text
pnpm --filter @sokar/api exec vitest run <fichiers ciblés>
pnpm --filter @sokar/shared exec vitest run src/__tests__/plan.test.ts
pnpm --filter @sokar/dashboard exec vitest run src/app/PricingSection.test.tsx
```

Les suites utilisent des mocks ou des fixtures locales sauf la preuve P0
PostgreSQL décrite dans
`docs/release/evidence/p0-usage-local-validation-2026-09-14.md`. Le gel
production reste actif tant que les limites de la dernière colonne ne sont pas
levées et signées.
