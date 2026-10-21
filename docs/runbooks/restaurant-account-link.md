# Rattachement d’un restaurant à un compte

## Parcours d’un nouveau restaurateur

1. La connexion Clerk sélectionne une organisation. Le dashboard appelle `POST /api/auth/sync`.
2. L’API crée ou retrouve le compte commercial, crée le propriétaire initial et crée le premier restaurant avec `accountId`, `isPrimary=true` et `siteStatus=ACTIVE`. Les trois écritures de création utilisent la même transaction Prisma : une erreur ne doit jamais être confirmée comme une inscription réussie.
3. Le restaurateur renseigne son restaurant, ses horaires, sa salle et ses règles, puis configure les canaux. Le numéro Sokar reste attribué par un opérateur ; l’inscription seule ne met pas les appels en service.
4. L’écran de formule propose un essai de 14 jours sans carte (`POST /billing/trial`). Le compte est l’unité de facturation et possède un établissement principal. Une fois l’essai terminé, l’absence de moyen de paiement entraîne l’annulation Stripe ; le webhook met à jour les droits. Les paiements et changements de formule passent ensuite par les parcours Stripe prévus.
5. La synchronisation dashboard retente les erreurs réseau, délais dépassés, HTTP 429 et HTTP 5xx, au maximum trois fois. Un échec persistant affiche un message et un bouton Réessayer. Un changement d’organisation annule la tentative précédente et synchronise la nouvelle organisation. Les contrôles d’accès et d’onboarding restent appliqués.

La présence de clés Stripe et d’un drapeau d’activation n’est pas une recette de paiement. Avant l’ouverture commerciale, qualifier un parcours complet en environnement Stripe de test, du compte Clerk aux webhooks et droits, sans faire de souscription réelle pour cette vérification.

## Diagnostic d’un ancien restaurant inaccessible

Ne pas déduire la propriété d’une adresse e-mail, du nom du restaurant ou d’un identifiant d’URL.

- Vérifier l’identité Clerk et les organisations dont cette identité est membre.
- Comparer `RestaurantAccount.clerkOrganizationId`, les memberships Sokar et `Restaurant.accountId`.
- Distinguer un restaurant historique créé par seed/opérateur d’un restaurant créé par l’inscription. Le resolver conserve une compatibilité historique ; `accountId=null` ne prouve donc pas à lui seul une panne de toutes les inscriptions.
- Vérifier l’établissement actif et les étapes d’onboarding : changer le rattachement ne valide pas automatiquement la configuration de la salle ou des canaux.

Un rattachement manuel à un compte donne accès aux données du restaurant : le réserver à une demande explicite du propriétaire après vérification des identités. Ne pas relier automatiquement deux établissements selon leur nom ni lancer un backfill global pour résoudre un seul dossier.

## Intervention Chez Sokar du 21 octobre 2026

Le compte connecté avait son propre établissement vide, tandis que Chez Sokar provenait du seed et n’avait aucun compte. Sur autorisation du propriétaire, Chez Sokar a été rattaché à son compte vérifié et désigné principal. L’établissement vide (sans appels, clients, réservations ni facturation) a été archivé, sans suppression. L’onboarding du seul restaurant de test a été contourné explicitement dans ses tâches ; aucune exposition publique, configuration téléphonique ou souscription n’a été activée par cette opération.

Sauvegarde privée des champs modifiés avant transaction dans `~deploy/env-backups/restaurant-link-2026-10-21T20-14-57-041Z.json`, droits 600. Ne pas versionner son contenu. Retour arrière : restaurer les seuls champs sauvegardés et le statut de l’établissement archivé après contrôle des changements intervenus depuis.

Vérifications : dashboard de Chez Sokar accessible avec la session du propriétaire ; lien CRM Pro visible sur Clients ; aucun restaurant sans compte après intervention. Les drapeaux ConfigCat et la téléphonie n’ont pas été modifiés.
