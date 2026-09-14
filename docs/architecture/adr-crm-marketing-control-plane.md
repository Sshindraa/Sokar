# ADR — CRM enrichi et contrôle marketing idempotent

Date : 14 septembre 2026
Statut : accepté, implémentation locale partielle ; production gelée jusqu'à la clôture des
chantiers 199/299 €

## Contexte

Le fichier client historique mélangeait téléphone, compteurs et notes libres. Il ne permettait
pas d'expliquer pourquoi un client était ciblé, de rejouer une projection sans doublon ou de
prouver un consentement par canal. Une campagne ne doit jamais transformer un snapshot d'audience
en droit permanent d'envoyer un message : le consentement, la suppression fournisseur et la
pression marketing doivent être contrôlés au dernier moment.

## Décisions

### Projection CRM additive

- `CustomerIdentity` ajoute des téléphones, emails et identifiants POS normalisés sans déplacer
  automatiquement une identité qui appartient déjà à un autre client.
- Une collision d'identité devient une candidate de fusion manuelle ; le nom seul ne déclenche
  jamais une fusion. Le preview expose les identités partagées et la mutation déduplique les
  lignes identiques dans la transaction au lieu de refuser un doublon détecté par téléphone/email.
- `CustomerTimelineEvent` est append-only avec `dedupeKey` unique. Les métadonnées refusent les
  clés évidentes de PII (`phone`, `email`, `transcript`, `messageBody`, `token`, etc.).
- `CustomerMetricSnapshot` est une projection recalculable depuis les réservations : visites
  honorées, annulations, no-show, couverts, récence et dépenses estimées. La dépense encaissée
  reste nulle tant qu'une caisse ou un paiement réel n'est pas raccordé.
- Les préférences et tags sont allow-listés, bornés, datés et rattachés à une source. Une
  suggestion vocale ne devient pas une donnée sensible permanente sans confirmation.

Le backfill `apps/api/scripts/backfill-customer-crm.ts` est conçu pour être lancé en dry-run,
avec checkpoint et sans suppression. Une exécution de production nécessite une preuve de volume,
de durée et de restauration avant activation.

### Segments bornés

`CustomerSegment` conserve un AST versionné validé par Zod. Les champs et opérateurs sont
allow-listés, les groupes sont limités et le compilateur produit uniquement un
`Prisma.CustomerWhereInput` connu. Le preview retourne le nombre, un échantillon et les raisons
d'exclusion ; aucun langage arbitraire ou filtre SQL fourni par le client n'est accepté.

### Consentement et suppression

- `MarketingPermission` est la projection courante par client et canal (`SMS`, `EMAIL`,
  `WHATSAPP`) ; `MarketingPermissionEvent` conserve chaque preuve, version, source et horodatage.
- Un opt-in exige `proofVersion` et un hash SHA-256 de la preuve. Le texte brut n'est pas stocké
  dans le ledger de permission.
- Pendant la migration, `CustomerConsent.marketingOptIn` peut autoriser SMS/email uniquement.
  WhatsApp exige toujours un opt-in explicite par canal.
- `MarketingSuppression` gagne sur tout opt-in. Une désinscription par lien signé met à jour la
  permission immédiatement et ne révèle ni téléphone ni email.
- Avant le fournisseur, l'envoi revalide permission, suppression, contact et fréquence. Le
  compteur journalier est réservé par mise à jour conditionnelle et contrainte unique afin que
  deux workers ne dépassent pas le plafond.

### Campagne et livraison

Une `MarketingCampaign` suit `DRAFT → READY → SCHEDULED → SENDING → SENT/FAILED` et peut être
annulée. `CampaignAudienceMember` est le snapshot immuable de l'audience ;
`CampaignMessage` est une ligne par destinataire avec une clé `marketing:<campaign>:<customer>`
unique et des états `PENDING → SENDING → ACCEPTED` ou `FAILED/CANCELLED`.

Le worker `marketing-campaign` :

1. réclame une campagne et chaque message avec `updateMany` conditionnel ; un rejeu perd la claim
   et ne rappelle pas le fournisseur ;
2. revalide l'éligibilité, réserve le slot de pression et revalide encore le consentement ;
3. rend uniquement les variables allow-listées, génère un lien de désinscription signé et envoie
   via Telnyx SMS, Resend email ou WhatsApp explicitement activé ;
4. conserve l'état provider, l'identifiant provider et le rendu final, sans écrire de téléphone
   ou de corps dans les logs ;
5. termine par `SENT` si toutes les lignes sont traitées, sinon `FAILED` avec un code borné.

Le flag `MARKETING_SENDS_ENABLED=true` est obligatoire pour déclencher un fournisseur. Tant que
la délivrabilité, la configuration des callbacks et les textes de consentement ne sont pas validés sur les pilotes,
les routes d'envoi et de programmation restent en `503 MARKETING_SENDS_DISABLED`.

### Automations bornées

`MarketingAutomation` ne permet que trois types versionnés : `AFTER_FIRST_HONORED`, `DORMANT` et
`BIRTHDAY`. La configuration est validée par Zod avant l'activation : délai après visite (0–168 h),
inactivité (30–365 jours), fenêtre anniversaire (0–30 jours), heure locale, canal et template
allow-listé avec désinscription obligatoire.

Le scan horaire charge les clients actifs dans le tenant, recontrôle contact, permission,
suppression et plafond de fréquence, puis crée une campagne snapshot `READY`. Chaque événement est
réclamé par une contrainte unique `(automation_id, customer_id, trigger_key)` dans
`MarketingAutomationDispatch`. Une panne Redis laisse la campagne `READY` ; le scan suivant peut
la ré-enfiler lorsque le flag fournisseur est autorisé. La réactivation VIP historique est
maintenant encapsulée dans le même pipeline : sa validation dashboard crée une
`MarketingCampaign` liée par une clé unique, ses messages passent par le worker marketing et le
vieux job ne peut plus contacter Telnyx. Le scan legacy est suspendu pour les sites qui ont activé
l'automation `DORMANT`, et les envois legacy restent bloqués par `MARKETING_SENDS_ENABLED`.

### Attribution et rapport

Les liens d'attribution utilisent un token HMAC à durée limitée ; seuls son hash et les
identifiants en base sont persistés. Le payload ne contient pas de téléphone/email. Le widget
enregistre le clic à l'ouverture, puis une création de réservation avec un token valide ajoute une
conversion `RESERVATION_CREATED`, idempotente par clé. Le passage à `HONORED` ajoute la conversion
correspondante ; une annulation désactive les conversions actives mais conserve l'historique.

`POST /marketing/campaigns/:id/preview` relit le snapshot d'audience, rend un exemple avec les
variables allow-listées et calcule les unités facturables sans créer de message. Il résout le tarif
versionné à la date d'exécution (ou à la date planifiée) et retourne `PRICED` avec le montant et
l'identifiant du tarif lorsqu'une ligne validée existe ; il reste `NOT_AVAILABLE` sans taux
rapproché.

`POST /marketing/campaigns/:id/test` réutilise ce rendu pour un contrôle « gérant » en mode
`DRY_RUN`. Il retourne `providerContacted=false`, ne crée aucune ligne de message et ne consomme
aucun plafond de fréquence. Le raccordement à une boîte ou un numéro de test reste une étape
fournisseur séparée, activable uniquement après validation du pilote.

`GET /marketing/campaigns/:id/report` reconstruit les compteurs depuis audience, messages, liens,
permissions et conversions. Les réservations, visites honorées, revenus estimés et revenus
confirmés restent des métriques distinctes. Le coût réel des messages est rapproché séparément
depuis les événements d'usage ; le preview peut déjà afficher une estimation `PRICED` lorsqu'un
tarif fournisseur validé couvre la date, sinon il reste `NOT_AVAILABLE`.

`GET /marketing/campaigns/:id/report.csv` reprend ces agrégats en CSV UTF-8 avec BOM, protège les
valeurs qui ressemblent à des formules tableur et ne contient aucune adresse client.

`GET /marketing/providers/readiness` retourne des booléens de configuration pour les canaux SMS,
email et WhatsApp, ainsi que le flag global d'envoi. Il fournit aussi les noms des variables
manquantes (`missing` et `callbackMissing`) sans valeur sensible. Les clés et adresses d'expédition
ne sont jamais renvoyées ; l'interface s'en sert pour expliquer un blocage de pilote sans permettre
d'activer un provider depuis le dashboard. Le WhatsApp marketing exige explicitement le flag, un
numéro Business et un profil de messagerie Telnyx ; le flag reste désactivé par défaut.

Les callbacks signés dont l'identifiant provider ne correspond à aucune `CampaignMessage` sont
écrits dans `MarketingProviderReconciliation`. La ligne contient l'identifiant provider, le type,
le statut normalisé, un hash du corps et des horodatages, jamais le corps ou une adresse client.
Une clé d'événement stable rend les rejeux idempotents. Le worker dédié relit les lignes `OPEN`
toutes les cinq minutes, rattache celles dont le message est apparu et les marque `RESOLVED`; une
action opérateur peut marquer une ligne `IGNORED` avec une raison bornée. La réconciliation ne
appelle jamais le provider et le flag d'envoi n'est pas requis.

### Fondation POS provider-neutral

La migration `20260914140000_pos_foundation` ajoute `PosConnection`, `PosCheck` et
`ReservationCheckMatch` avec des clés tenant-scoped, des montants `DECIMAL(12,2)` et des contraintes
de devise/confiance. `credentialReference` reste une référence opaque vers un gestionnaire de
secrets ; aucun token ni payload brut n'est écrit dans Postgres, les logs ou les réponses API.

`pos-connector.ts` fixe le contrat à implémenter après la sélection d'un fournisseur. Tant que
`POS_CONNECTORS_ENABLED` vaut `false`, les routes `/pos/connections*` répondent `503`; lorsqu'elles
sont activées en local, l'import est dry-run par défaut et l'upsert est idempotent par connexion et
identifiant externe. Le curseur n'avance qu'après la transaction complète. Le matcher v1 produit
un score explicable et des statuts `MATCHED`, `REVIEW` ou `UNMATCHED`; il ne crée une association
qu'après fourniture explicite d'une réservation et n'enrichit jamais le CRM pour une suggestion
faible.

## Autorisations et isolation

Les routes CRM avancé, segments, campagnes, automations et attribution sont protégées par les capabilities
Pro (`customers.advanced`, `marketing.segments`, `marketing.campaigns`,
`marketing.automations`, `marketing.attribution`, `crm.merge`). Chaque lecture et mutation
porte le `restaurantId` résolu par Clerk ; un identifiant fourni par le client ne choisit jamais
le tenant.

### Masquage des notes et métadonnées

Les notes du modèle `Customer` et les `metadata` des événements de chronologie sont des champs
sensibles. Les routes `GET /crm/customers/:id` et
`GET /crm/customers/:id/timeline` les masquent pour tout rôle absent de la liste effective du
site. Cette liste est stockée dans `Restaurant.crmSensitiveNoteRoles` sous forme CSV normalisée ;
si elle est nulle, l'API utilise `CRM_SENSITIVE_NOTE_ROLES`, dont la valeur par défaut est
`OWNER,MANAGER`. Le serveur renvoie `notes: null` et `metadata: {}` lorsque le rôle ne peut pas
lire ces champs, sans modifier les valeurs persistées. `GET/PATCH /crm/privacy` expose et modifie
la liste du site, avec une mutation réservée à Owner ; la validation exige toujours le rôle Owner
afin d'éviter de rendre les notes illisibles à tous les responsables. Les droits d'écriture des
préférences et tags restent limités à Owner/Manager.

## Travail restant avant activation commerciale

- preuve PostgreSQL de concurrence (la politique de notes par établissement via
  `GET/PATCH /crm/privacy`, le fallback `CRM_SENSITIVE_NOTE_ROLES`, l'API de fusion, son audit,
  ses garde-fous Owner/Manager, les pages liste/détail/doublons, l'édition des préférences/tags,
  l'export RGPD vérifié et la réparation de projection métrique Owner sont livrés localement) ;
- preuve PostgreSQL concurrente du seed des segments système (le constructeur Pro, ses huit
  audiences à clé stable, le preview, le CRUD, le refresh et l'explication lisible des règles sont
  livrés localement ; le seed lazy est idempotent et tenant-scoped) ;
- configuration effective des callbacks Telnyx/Resend, bounces/plaintes et domaine email (les
  fixtures de contrat, l'inbox de réconciliation, son worker et le marquage opérateur sont livrés
  localement) ;
- vérification terrain de la migration legacy et absence de double envoi pendant la transition ;
- template WhatsApp approuvé, tests de délivrabilité et domaine email ;
- caisse de production et réconciliation des ventes (la fondation locale POS et son matcher sont
  livrés, mais aucun fournisseur, sandbox ou webhook n'est raccordé), paiements de réservation,
  activation du CRM groupe (son socle account/site et son consentement sont livrés localement),
  réputation et fidélité (la fondation feedback/récupération est livrée localement ; les
  fournisseurs, l'envoi et les avantages restent ouverts) ;
- tests PostgreSQL concurrents de fusion, dry-run backfill signé et pilote staging.

## Migration et rollback

Les migrations `20260913210000` à `20260914170000` sont additives. Le déploiement doit appliquer
le schéma avant d'activer les flags. Un rollback applicatif laisse les tables nouvelles en place
et désactive les flags ; une restauration DB ne se fait qu'avec le runbook de rollback et une
sauvegarde horodatée. Aucun changement n'est poussé ou déployé pendant le gel production.

## Vérification locale au 14 septembre 2026

- Prisma generate et validate verts ;
- typecheck API, ESLint et Prettier marketing verts ;
- tests CRM, segments, permissions, campagnes, automations, worker, attribution, RGPD, entitlements et
  réservations verts (la suite ciblée est rejouée avant commit) ;
- aucune clé provider ou donnée de contact n'est ajoutée au dépôt.
