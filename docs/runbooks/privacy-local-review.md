# Revue finale du lot confidentialité local

Revue du 16 octobre 2026. Lot préparé localement, non commité et non déployé.
Validation technique réussie ; validation des informations contractuelles et
des durées non acquise. Ce document n'autorise aucune publication.

## Périmètre vérifié

- Notice publique commune Dashboard, Connect et API : cinq catégories de
  destinataires, sans inventaire nominatif de la stack.
- Liste nominative préparée dans une annexe client distincte, encore en projet.
- Preuves et paramètres techniques conservés dans le dossier interne.
- Même explication de la réservation et des choix de confirmation sur les trois
  surfaces ; consentement marketing distingué des confirmations. La revue finale
  retire aussi le jargon restant sur Connect et complète les finalités propres
  de Sokar et les droits dans le texte API.
- Aucun changement des booléens de consentement, des routes publiques, du schéma
  ou des traitements de purge. Le contenu des notifications de démo est minimisé
  localement : référence et lien vers le suivi authentifié, sans coordonnées ni
  établissement. L'acceptation des envois et les destinataires restent inchangés.
- Seule action sur un compte fournisseur : acceptation de l'ATDC Workspace après
  autorisation explicite, statut et date vérifiés. Aucun changement de formule,
  région ou réglage de conservation ; HIPAA inchangé.
- Version documentaire locale `v1.1-2026-10-16` : les nouveaux enregistrements
  utiliseront cette version après livraison. Pas de réécriture des consentements
  historiques ni de renouvellement automatique. Cette évolution faisait déjà
  partie du lot d'harmonisation avant la revue finale.
- Les champs API historiques et leurs types restent présents, notamment
  `retentionDays: 730`, qualifié comme seuil technique et non promesse d'effacement.
  Le champ historique `dpo` contient un contact, pas la preuve de nomination d'un DPO.

## Fichiers à livrer ensemble

Les chemins ci-dessous sont relatifs à la racine du dépôt. Inclure les fichiers
nouveaux non suivis : le diff des seuls fichiers suivis n'est pas le lot complet.

| Groupe                                           | Fichier                                                                    |
| ------------------------------------------------ | -------------------------------------------------------------------------- |
| Source commune                                   | `packages/shared/src/privacy.ts`                                           |
| Export commun                                    | `packages/shared/src/index.ts`                                             |
| API                                              | `apps/api/src/modules/rgpd/privacy-policy.ts`                              |
| Test API                                         | `apps/api/src/modules/rgpd/__tests__/privacy-policy.test.ts`               |
| Test API                                         | `apps/api/src/modules/rgpd/__tests__/rgpd.routes.test.ts`                  |
| Test consentements                               | `apps/api/src/modules/rgpd/__tests__/consent.service.test.ts`              |
| Dashboard                                        | `apps/dashboard/src/app/privacy/page.tsx`                                  |
| Test Dashboard                                   | `apps/dashboard/src/app/privacy/page.test.tsx`                             |
| Connect                                          | `apps/connect/src/app/privacy/page.tsx`                                    |
| Test Connect                                     | `apps/connect/src/app/privacy/page.test.tsx`                               |
| Test navigateur                                  | `apps/connect/e2e/privacy.spec.ts`                                         |
| Notification démo                                | `apps/api/src/modules/demo-requests/demo-request.service.ts`               |
| Test notification                                | `apps/api/src/modules/demo-requests/__tests__/notification-status.test.ts` |
| Procédure de conservation démo                   | `docs/runbooks/demo-request-retention.md`                                  |
| Dossier interne                                  | `docs/runbooks/privacy-disclosures.md`                                     |
| Projet d'annexe clients                          | `docs/runbooks/privacy-client-annex.md`                                    |
| Revue locale                                     | `docs/runbooks/privacy-local-review.md`                                    |
| État courant, portion confidentialité uniquement | `docs/obsidian/Context.md`                                                 |
| Journal, entrées confidentialité uniquement      | `docs/obsidian/Journal.md`                                                 |

La page `apps/dashboard/src/app/legal/page.tsx` était déjà modifiée avant ce lot :
adresse seule et réserve sur l'identité. Elle n'a pas été retouchée par la revue.
Ne pas l'inclure implicitement dans ce lot ni la réinitialiser. Les entrées voix
et ElevenLabs du journal sont concurrentes : conserver leur contenu et séparer
les portions lors d'une éventuelle préparation de commit autorisée. Ne pas
utiliser un ajout global de tout le répertoire de travail.

## Résultats de vérification

Complément opérations, à isoler du lot de notice lors d'une livraison : suivi
d'acceptation corrigé, régulation Resend entre processus et e-mails système groupés,
avec rappels à deux heures. Sources/tests dans `shared/email`, `shared/observability`,
`shared/queue/workers/system-health.worker.ts`, ainsi que `src/test/setup.ts` côté API.
Configuration et limites : `docs/runbooks/environment.md`, section Régulation Resend.
Raccordement de configuration également préparé localement :
`.github/workflows/deploy-staging.yml`, `.github/workflows/deploy-prod.yml`,
`scripts/ops/sync-env.sh alerting` et
`apps/api/src/shared/email/__tests__/deployment-config.test.ts` (8 tests de synchronisation).
Mise à jour du 16 octobre : lot ops isolé livré par la PR #463 (`e5eb3520`), CI puis
staging/smoke et production verts. Coordination Redis commune configurée ; clé
staging distincte créée/configurée sur confirmation, sans changer la clé prod ni
l'allowlist. Deux alertes techniques groupées dans un e-mail fournisseur accepté,
répétition supprimée ; aucun destinataire client. Admission prod, santé et processus
API/workers vérifiés, snapshots de rollback présents. Aucun job historique purgé.
Ce lot est déjà livré : ne pas l'embarquer une seconde fois dans la notice locale.
183 tests ciblés et typecheck API réussis ; essai Redis local isolé : 30 requêtes concurrentes,
3 clients, 30 admissions espacées d'au moins 150 ms, sans appel Resend.
Lot toujours local, aucune correction des incidents historiques. Travaux billing hors périmètre.

Complément minimisation : 28 tests du module démo et TypeScript API réussis.
Les tests vérifient notamment l'absence de coordonnées dans la charge envoyée
au SDK, le lien sans jeton ni identifiant et l'échappement HTML de la référence.

- `pnpm --filter @sokar/shared build` : réussi.
- TypeScript API, Dashboard et Connect : réussi.
- Tous les tests du répertoire RGPD API : 83 réussis, 8 fichiers.
- Dashboard confidentialité, affirmations marketing et formulaire démo : 16 réussis.
- Connect confidentialité : 1 réussi. Total ciblé : 100 tests unitaires.
- Playwright Connect confidentialité : 4 réussis, dont le nonce CSP après hydratation.
- Contrôle des deux pages réelles à 390, 820 et 1440 px : HTTP 200, aucune
  erreur JavaScript, aucun débordement horizontal et aucune ancre manquante.
- Les liens internes de sommaire, le contact `mailto:` et la destination CNIL
  sont cohérents. Les pages locales Dashboard `/legal` et `/demo` répondent 200.
- La configuration Nginx du dépôt dirige `/privacy` vers Connect. Le test de
  Dashboard seul ne suffirait donc pas à qualifier la page destinée au site public.
- Prettier et `git diff --check` : réussis. Pas de build complet de production.

Ces vérifications ne valident ni l'existence effective de la boîte de contact,
ni les garanties contractuelles d'un compte fournisseur, ni les purges en production.
Les réponses HTTP ne constituent pas une validation juridique des pages.

## Réserves avant publication

Complément documentaire : `privacy-disclosures.md` distingue désormais les
engagements publics vérifiés de Resend / Google et les preuves encore nécessaires
pour les comptes Sokar. Ce contrôle ne ferme pas les réserves ci-dessous et ne
modifie ni le code public ni les configurations des services.

- Identité complète de l'éditeur / responsable : les mentions restent incomplètes ;
  aucune identité personnelle non autorisée n'est ajoutée par ce lot.
- Entités, contrats, pays et garanties de transfert des fournisseurs réellement
  utilisés. Resend : plan Transactional Free constaté, DPA signé fournisseur
  téléchargé et archivé hors Git ; conservation effective non testée. Workspace constaté en lecture seule :
  Business Starter actif, stockage au repos « Aucune préférence ». Ne pas
  annoncer une résidence exclusivement européenne ; contrat et conservation
  de la messagerie restent à qualifier.
- Durées des comptes, des réservations, des transcriptions, des journaux et des
  cookies ; cycles des sauvegardes et copies ; preuve d'exécution des suppressions.
- Première revue manuelle des demandes de démo et traitement des copies e-mail.
- Annexe et accord de traitement clients : qualification des rôles et services
  actifs, communication initiale et procédure de changement de sous-traitants.
- Qualification juridique des bases retenues, notamment des demandes particulières
  pouvant contenir des informations de santé ; une préférence d'envoi enregistrée
  dans le code ne suffit pas à établir la base légale d'un traitement.

La simplification de la notice ne ferme aucune de ces réserves. Dashboard reste
`noindex` ; les autres réglages d'indexation n'ont pas été changés. Aucun commit,
push, déploiement, envoi de message ni effacement effectué. Seul l'ATDC Google a
été accepté sur le compte, après autorisation spécifique et vérification du résultat.
