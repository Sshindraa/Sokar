# Livraison consolidée du 18 octobre 2026

## Périmètre

Demande de Hamza : versionner et livrer en production le travail restant des sessions, puis mettre à jour main. Intégration effectuée depuis origin/main dans une branche dédiée ; snapshots des changements locaux conservés hors dépôt avant rapprochement.

- Session principale : notifications de confirmation/outbox, WhatsApp avec consentement et callbacks signés, confidentialité Dashboard/Connect/API, correctif de changement de formule Stripe, diagnostics et documentation.
- Réservation : widget partagé avec le dashboard, carton personnel, démonstration interactive, calendrier accessible, modification de date/heure/couverts sur disponibilités réelles, remplacement atomique et maintien du lien signé, annulation sous conditions figées.
- Session dashboard-copy (#491) : correctifs de textes, formulaires, listes, cartes cadeaux, fidélité, réputation et plan de salle, y compris changements locaux non commités. Test Essential ajusté à la suppression volontaire de la bannière Pro.
- Session privacy-csp : nonce du document confidentialité et vérification HTML/hydratation, preuves acquisition.
- Sessions opérateur, tarifs, alertes, staging, relances, sécurité : changements confrontés à main ; versions plus récentes de main conservées lorsqu’elles remplaçaient déjà les anciennes branches.
- Session voix : allowlist du contexte ElevenLabs et correction du health check (#446), sans activation ni appel fournisseur.

## Réconciliation et exclusions

Les branches anciennes ne sont pas toutes des fonctionnalités à activer. Les brouillons #422, #402, #239, #233, #220 et #219 restent ouverts et hors promotion : landing abandonnée, onboarding vocal en brouillon, expériences et configurations non qualifiées. Les propositions de banc/refus #389, #364, #267, #221 et la suppression de worker #377 ne sont pas réappliquées automatiquement sur la pile actuelle. Le correctif historique #400 est à comparer séparément au pipeline actuel ; aucune régression volontaire du rapport d’appel. L’annexe nominative de confidentialité reste un projet, aucune identité personnelle non autorisée n’est publiée.

Aucune migration Prisma ni changement de schéma. Aucune clé ajoutée. Pas de changement de configuration Stripe, de facture, de SMS de test ou d’activation Meta. Les indicateurs WhatsApp, expériences et fonctions non qualifiées restent désactivés. Les indicateurs de gestion de réservation gardent leur configuration propre à chaque environnement ; livrer le code ne les active pas implicitement.

## Validation locale

- Typage monorepo et lint (dont CSS) réussis.
- API : 4 309 tests réussis, 68 ignorés dans la suite unitaire (intégration PostgreSQL prise en charge par la CI dédiée).
- Dashboard : 910 tests réussis ; Connect : 151 ; widget : 23 ; agent-client : 3.
- Scan du diff avec gitleaks : aucune fuite détectée.
- Build production et CI/staging/production : suivi dans la PR et dans les workflows ; aucun succès distant n’est déduit des tests locaux.

## Livraison et retour arrière

Chemin : PR avec contrôles obligatoires → squash main → CI main → staging et smoke → production et smoke. Les snapshots de release et le rollback applicatif existants sont conservés. Vérifier le SHA actif des deux environnements et leurs health checks avant clôture. Les worktrees sources ne sont pas effacés ; ils restent récupérables.
