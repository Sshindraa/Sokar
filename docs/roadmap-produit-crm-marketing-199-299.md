# Plan de bataille Sokar — offres 199/299 € et trajectoire CRM/marketing

Date de référence : 12 septembre 2026
Statut : plan directeur à exécuter par lots validables
Horizon indicatif : 6 à 9 mois pour une suite solide destinée aux indépendants ; 12 à 18 mois pour approcher la largeur fonctionnelle de SevenRooms
Hypothèse de capacité : un développeur principal à temps plein, Hamza disponible pour les décisions produit, les pilotes et les validations terrain

## 1. Décision produit

Sokar ne doit pas attendre d'égaler SevenRooms pour facturer 199 ou 299 € par mois. Le prix doit être justifié par deux résultats simples et mesurables :

- **Essential — 199 € HT/mois/établissement** : Sokar répond aux appels, prend et modifie les réservations sans erreur, synchronise le planning et réduit le travail manuel de l'équipe.
- **Pro — 299 € HT/mois/établissement** : Sokar ajoute une connaissance client exploitable, des relances ciblées et la mesure des réservations générées.

La trajectoire SevenRooms vient ensuite : caisse, revenu réel, protection bancaire, marketing avancé, CRM groupe, réputation, fidélité, événements et écosystème d'intégrations.

La priorité n'est donc pas le nombre de fonctionnalités. Elle est la fermeture complète de chaînes de valeur :

```text
Essential
appel ou widget → disponibilité fiable → réservation → rappel → service → résultat visible

Pro
interaction → profil enrichi → segment → campagne → réservation → visite → résultat attribué

Avec caisse
visite → ticket de caisse → dépense client → segment de valeur → campagne → revenu encaissé attribué
```

## 2. État réel de départ

### 2.1 Ce qui existe déjà

| Domaine      | Socle existant                                                                                  | Source principale                                                                  |
| ------------ | ----------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| Réservations | Réservation voix, web et agentique, disponibilité, holds, idempotence, états et audit           | `apps/api/src/modules/reservations/`, `apps/api/src/modules/agentic-reservations/` |
| Téléphone IA | Telnyx Media Stream, STT ElevenLabs, LLM, TTS Cartesia, transfert humain, télémétrie de latence | `apps/api/src/modules/voice/`                                                      |
| Salle        | Plan de salle, tables, allocation, walk-ins, service live et liste d'attente                    | `apps/api/src/modules/floor-plan/`                                                 |
| Client       | Nom, téléphone, visites, VIP, notes, occasion, dernier appel, groupe habituel                   | `apps/api/src/modules/customers/` et modèle `Customer`                             |
| Réactivation | Détection hebdomadaire des VIP inactifs 90–180 jours, validation gérant, envoi SMS              | `apps/api/src/shared/queue/workers/reactivation.worker.ts`                         |
| Consentement | Opt-in marketing, retrait, export et effacement RGPD                                            | `apps/api/src/modules/rgpd/` et modèle `CustomerConsent`                           |
| Analyse      | Appels, réservations, couverts, revenu estimé, latence, économie de commission estimée          | `apps/api/src/modules/analytics/`                                                  |
| Multi-site   | Compte, établissements, rôles, sélection de site, quantité facturée                             | modèles `RestaurantAccount*` et routes associées                                   |
| Paiement     | Stripe Billing pour Sokar et Stripe pour les cartes cadeaux                                     | `apps/api/src/modules/billing/`, `apps/api/src/modules/gift-cards/`                |

### 2.2 Limites à ne pas masquer commercialement

- Le fichier client est encore centré sur le téléphone et quelques champs libres. Il n'a ni tags structurés, ni segments sauvegardés, ni historique de dépenses.
- La réactivation est un scénario unique, réservé aux VIP et semi-automatique. Ce n'est pas encore un moteur de campagnes.
- Le revenu affiché est souvent estimé à partir du ticket moyen. Il ne correspond pas à un encaissement observé.
- `CallQuota` compte les appels. Il ne mesure pas la durée, les coûts STT/LLM/TTS, les SMS ni les dépassements facturables.
- Aucun connecteur de caisse métier n'a été identifié dans le dépôt.
- Stripe pour les cartes cadeaux ne constitue pas un parcours d'empreinte bancaire ou d'acompte de réservation.
- Le multi-site a un socle technique, mais l'isolation avec plusieurs identités réelles et le CRM client partagé restent à valider.
- Les prix codés sont encore 149/249 €. La page, les constantes, Stripe, les contrats et les calculs ROI doivent migrer ensemble.

## 3. Périmètre commercial cible

### 3.1 Essential — porte de mise en vente à 199 €

Essential est vendable lorsque tous les éléments suivants fonctionnent de bout en bout :

1. accueil téléphonique 24/7 avec transfert ou solution de secours ;
2. création, modification et annulation de réservation ;
3. disponibilité et capacité cohérentes sur tous les canaux ;
4. planning et plan de salle utilisables pendant un service ;
5. confirmation/rappel avec visibilité des échecs ;
6. widget direct sans commission ;
7. fichier client, notes et historique de base ;
8. onboarding reproductible ;
9. mesure des appels, minutes, réservations et coûts directs ;
10. facturation 199 € cohérente sur toutes les surfaces.

### 3.2 Pro — porte de mise en vente à 299 €

Pro devient vendable comme offre supérieure lorsque le client peut :

1. reconnaître un habitué et consulter une chronologie utile ;
2. filtrer les clients par récence, fréquence, comportement et valeur estimée ;
3. enregistrer des préférences structurées et des tags ;
4. lancer au moins trois scénarios de relance ;
5. respecter automatiquement consentement, désinscription et pression marketing ;
6. voir les messages délivrés, les réservations attribuées et les visites honorées ;
7. bénéficier d'un volume voix supérieur et d'un support prioritaire défini ;
8. distinguer revenu estimé, revenu réservé et revenu encaissé.

La connexion caisse, l'empreinte bancaire et le CRM groupe peuvent ensuite renforcer Pro ou devenir des options. Ils ne doivent pas retarder la première version cohérente de Pro.

## 4. Règles d'exécution

Chaque lot respecte les règles suivantes :

- migration Prisma additive et réversible ; aucune rupture d'API ou de schéma sans décision explicite ;
- fonctionnalité nouvelle sous feature flag par établissement ;
- écriture métier idempotente ;
- Postgres comme source de vérité, Redis uniquement pour cache, verrous courts et files ;
- événement d'audit pour toute mutation commerciale ou financière ;
- aucune PII dans les métriques, logs ou labels ;
- consentement vérifié au moment de l'envoi, même si l'audience a été calculée auparavant ;
- états explicites et relançables pour tout appel fournisseur ;
- activation sur un restaurant interne, puis deux pilotes, puis dix établissements ;
- instrumentation et critères d'acceptation livrés avec la fonction ;
- documentation de support et rollback avant production générale.

## 5. Vue d'ensemble des phases

| Phase                        | Durée indicative | Résultat commercial              | Dépendances majeures                     |
| ---------------------------- | ---------------: | -------------------------------- | ---------------------------------------- |
| 0. Mesure et contrat d'offre |     1–2 semaines | Prix et limites défendables      | Coûts fournisseurs, Stripe test          |
| 1. Essential irréprochable   |     3–5 semaines | Offre 199 € vendable             | Pilotes, appels réels, alerting          |
| 2. CRM Pro                   |     4–6 semaines | Connaissance client exploitable  | Schéma client, règles de fusion          |
| 3. Segments et campagnes     |     5–7 semaines | Offre 299 € vendable             | Consentements, délivrabilité             |
| 4. Attribution et ROI        |     3–4 semaines | Valeur Pro démontrable           | Liens suivis, états de réservation       |
| 5. Protection bancaire       |     4–6 semaines | Réduction mesurable des no-shows | Stripe Connect/merchant model, juridique |
| 6. Première caisse           |    6–10 semaines | Valeur client et revenu réels    | Partenaire POS, API et sandbox           |
| 7. Groupe et multi-site      |     4–6 semaines | Offre groupes crédible           | Isolation Clerk, identité client groupe  |
| 8. Réputation et fidélité    |     5–8 semaines | Rétention et récupération client | Sources d'avis, règles d'avantages       |
| 9. Expériences et écosystème |   8–12+ semaines | Élargissement SevenRooms         | Paiements, distribution, partenaires     |

Les durées sont des ordres de grandeur pour une personne concentrée sur le produit. Elles excluent les délais de contrat, de certification ou d'accès aux API partenaires.

---

## 6. Phase 0 — Mesurer et figer le contrat des offres

**Objectif :** savoir ce que coûte chaque restaurant et ce que chaque formule autorise avant de modifier les prix publics.

### P0-01 — Comptabilité d'usage

Créer un ledger append-only `UsageEvent` ou équivalent avec :

- `restaurantId`, `accountId`, `occurredAt`, `category`, `provider` ;
- `callId`, `messageId` ou référence métier non sensible ;
- durée téléphonique facturée ;
- secondes STT et TTS ;
- tokens LLM entrée/sortie si le fournisseur les expose ;
- SMS/WhatsApp envoyés, segments et statut ;
- stockage audio utilisé ;
- coût fournisseur estimé en millièmes d'euro ;
- clé d'idempotence fournisseur.

Construire une agrégation mensuelle `UsageMonthlyRollup`, recalculable depuis le ledger. Le dashboard doit afficher l'usage sans exposer le détail interne des marges.

**Critères d'acceptation :**

- un appel complet génère une seule ligne par catégorie facturable ;
- un webhook ou job rejoué ne double pas l'usage ;
- le total mensuel peut être recalculé ;
- le coût d'un appel de test peut être rapproché des relevés fournisseurs ;
- les métriques internes donnent coût moyen/minute et coût par réservation aboutie.

### P0-02 — Entitlements et limites

Créer une configuration centralisée par plan :

- fonctionnalités activées ;
- minutes et messages inclus ;
- seuil d'avertissement ;
- politique de dépassement ;
- rétention des appels/transcriptions ;
- niveau de support ;
- nombre d'établissements et utilisateurs.

Ne pas disperser ces règles dans le dashboard et l'API. L'API décide ; l'interface affiche la décision.

**Décisions produit à prendre avec les données pilotes :**

- nombre de minutes incluses en Essential et Pro ;
- prix de la minute ou du pack supplémentaire ;
- blocage, facturation ou mode dégradé après dépassement ;
- nombre de SMS inclus ;
- définition concrète du support prioritaire ;
- remise annuelle et conditions d'engagement.

### P0-03 — Migration commerciale 199/299 €

Mettre à jour dans une seule release coordonnée :

- constantes et mapping de prix ;
- page tarifaire et parcours d'inscription ;
- prix Stripe mensuels et annuels en test puis en production ;
- mapping des `priceId` et webhooks ;
- portail client, upgrade/downgrade et prorata ;
- calcul ROI et emails qui utilisent le prix du plan ;
- CGV, devis, facture et texte HT/TTC ;
- politique pour les clients existants : maintien de prix ou migration annoncée.

**Porte de sortie :** checkout, paiement, webhook rejoué, portail, passage Essential ↔ Pro, annulation et période de grâce validés en sandbox, sans double abonnement.

### P0-04 — Tableau de bord interne de marge

Créer une vue strictement interne :

- MRR par restaurant ;
- coût voix, messages, stockage et support imputable ;
- marge brute en euros et pourcentage ;
- consommation p50/p90/p99 ;
- alertes de dérive ;
- restaurants dépassant le budget de coût du plan.

**Cible initiale à valider :** coût direct inférieur à 50 € pour Essential et 75 € pour Pro si l'objectif de marge brute est 75 %.

---

## 7. Phase 1 — Rendre Essential irréprochable

**Objectif :** vendre 199 € pour un service qui enlève réellement du travail à l'équipe.

### P1-01 — Matrice de conversations réelles

Transformer les cas courants en scénarios E2E reproductibles :

- réserver, modifier, annuler et confirmer ;
- correction de nom, date, heure et nombre de personnes ;
- créneau complet avec alternatives ;
- groupe supérieur à la limite ;
- retard, demande spéciale, accessibilité, allergie et événement privé ;
- bruit, silence, interruption, accent et changement de langue ;
- client déjà connu, homonyme et numéro masqué ;
- panne STT, LLM, TTS, Telnyx, Redis ou base ;
- transfert gérant disponible, absent ou numéro invalide ;
- appel coupé avant et après confirmation.

Le test doit vérifier la base, la capacité, l'audit, la notification et la réponse client. Les simulations automatisées complètent les appels réels ; elles ne les remplacent pas.

### P1-02 — Filet de sécurité téléphonique

- Définir un renvoi de secours par établissement.
- Déclencher le transfert quand Sokar ne comprend pas après un nombre borné de tentatives.
- Afficher les appels échoués et l'action requise.
- Ajouter une alerte fournisseur et une procédure d'incident.
- Préserver la réservation confirmée même si l'envoi de confirmation échoue.
- Tester un déploiement avec un appel en cours ou documenter une fenêtre de drainage.

### P1-03 — Cohérence réservation, capacité et salle

- Unifier les règles de capacité utilisées par voix, widget, dashboard et MCP.
- Vérifier les conflits de table sous concurrence réelle Postgres.
- Rendre visibles les réservations sans table et leur résolution.
- Garantir que modification et annulation libèrent correctement capacité et holds.
- Fermer le parcours walk-in → table → libération.
- Vérifier les états terminaux et la projection legacy `status/state`.

### P1-04 — Notifications opérationnelles

- Définir les notifications obligatoires : confirmation, rappel, annulation et promotion de liste d'attente.
- Modéliser `PENDING`, `SENT`, `DELIVERED`, `FAILED`, `CANCELLED`.
- Enregistrer l'identifiant fournisseur et traiter les callbacks.
- Ajouter retry borné, dead-letter et action manuelle.
- Empêcher les rappels après annulation ou déplacement.
- Afficher l'échec dans le dashboard et permettre un renvoi sûr.

### P1-05 — Onboarding reproductible

Checklist par établissement :

1. horaires, fermetures et capacité ;
2. plan de salle et grandes tables ;
3. politique d'annulation et de groupe ;
4. FAQ, ton, langues et règles de transfert ;
5. numéro, renvoi et appel de test ;
6. widget et domaine ;
7. notifications et consentements ;
8. compte équipe et permissions ;
9. simulation d'un service ;
10. signature de mise en production.

Produire un score de préparation et interdire l'activation si un blocant critique subsiste.

### Porte de sortie Essential

- deux établissements pilotes ont réalisé sept jours incluant au moins deux services de pointe ;
- taux d'appels techniquement pris en charge ≥ 99 % hors panne opérateur documentée ;
- aucune réservation confirmée sans disponibilité vérifiée ;
- 100 % des erreurs de notification sont visibles ;
- tous les appels ont durée et coût attribués ;
- aucune fuite inter-établissement dans les tests d'isolation ;
- coût direct p90 compatible avec le plan ;
- runbook d'incident et renvoi de secours testés ;
- checkout 199 € validé.

---

## 8. Phase 2 — Construire le CRM utile de Pro

**Objectif :** passer d'un carnet de contacts à une mémoire client exploitable avant, pendant et après le service.

### P2-01 — Identité et déduplication

Faire évoluer le modèle sans casser la clé actuelle :

- conserver le téléphone normalisé comme identifiant fort local ;
- ajouter email normalisé et date d'anniversaire partielle ou complète ;
- ajouter `CustomerIdentity` pour plusieurs téléphones/emails si nécessaire ;
- enregistrer la provenance et la date de vérification ;
- détecter les doublons probables ;
- proposer une fusion manuelle avec aperçu ;
- conserver un journal de fusion et permettre une réparation administrative ;
- définir la règle multi-site avant toute fusion entre établissements.

Ne jamais fusionner automatiquement sur le nom seul.

### P2-02 — Chronologie client

Créer un flux `CustomerTimelineEvent` alimenté par :

- appel reçu et motif ;
- réservation créée, modifiée, annulée ;
- visite honorée ou no-show ;
- entrée/sortie de liste d'attente ;
- message transactionnel et marketing ;
- consentement donné ou retiré ;
- carte cadeau achetée ou utilisée ;
- plus tard, commande et paiement caisse.

La chronologie doit charger par pagination, masquer les données sensibles selon le rôle et distinguer événement métier et note humaine.

### P2-03 — Préférences et tags

Ajouter :

- `CustomerTag`, `CustomerTagAssignment` ;
- tags manuels et automatiques identifiables ;
- préférences structurées : salle/terrasse, table favorite, allergies déclarées, accessibilité, langue, type d'occasion ;
- source, confiance, date de collecte et dernière confirmation ;
- expiration ou revalidation pour les données sensibles ou changeantes ;
- historique des modifications.

L'IA peut suggérer un tag depuis une conversation, mais une information sensible ne doit pas devenir automatiquement une vérité permanente sans règle explicite.

### P2-04 — Indicateurs RFM et comportementaux

Calculer de manière déterministe :

- récence de la dernière visite honorée ;
- fréquence de visites sur 30/90/365 jours ;
- couverts cumulés ;
- taux d'annulation et de no-show ;
- jour, service et taille de groupe habituels ;
- valeur estimée tant que la caisse n'est pas connectée ;
- valeur encaissée séparée après intégration caisse ;
- statut nouveau, actif, habitué, à risque ou dormant.

Le `loyaltyScore` actuel doit être documenté, recalculable et explicable, ou remplacé par des dimensions séparées.

### P2-05 — Interface CRM

Écrans minimum :

- liste clients avec recherche et filtres ;
- fiche client avec identité, consentements, indicateurs, préférences, tags et chronologie ;
- édition rapide pendant le service ;
- fusion de doublons ;
- export contrôlé ;
- journal indiquant qui a modifié quoi.

### Porte de sortie CRM

- le profil d'un client test réunit correctement appels, réservations et visites ;
- une fusion ne perd aucune réservation, consentement ou audit ;
- les indicateurs sont recalculables depuis les événements sources ;
- une préférence saisie est visible pendant le prochain appel/service ;
- les rôles non autorisés ne voient pas les notes sensibles ;
- export et effacement RGPD couvrent les nouveaux modèles.

---

## 9. Phase 3 — Segmentation, automatisations et campagnes

**Objectif :** rendre Pro à 299 € immédiatement compréhensible et actionnable.

### P3-01 — Moteur de segments

Commencer avec un constructeur borné, sans langage arbitraire :

- champs autorisés ;
- opérateurs typés ;
- groupes `ET` et `OU` limités ;
- aperçu du nombre de clients ;
- segment dynamique ou snapshot ;
- explication de l'inclusion d'un client ;
- exclusions globales de consentement et de pression marketing.

Segments fournis au lancement :

- première visite honorée récemment ;
- habitués avec au moins N visites ;
- VIP manuels ;
- absents depuis 60/90/120 jours ;
- anniversaire dans les 30 jours ;
- annulation récente sans nouvelle réservation ;
- clients du déjeuner ou du dîner ;
- clients avec no-show à exclure ou à traiter séparément ;
- gros dépensiers uniquement quand la donnée caisse est réelle.

### P3-02 — Modèle de campagne

Créer des entités distinctes :

- `MarketingCampaign` : objectif, canal, segment, créateur, planning, statut ;
- `CampaignAudienceMember` : snapshot et raison d'inclusion ;
- `CampaignMessage` : rendu final, provider, état et coûts ;
- `CampaignConversion` : réservation/visite attribuée ;
- `MarketingSuppression` : refus global ou par canal ;
- `MarketingFrequencyWindow` : contrôle de pression.

États recommandés : `DRAFT`, `READY`, `SCHEDULED`, `SENDING`, `SENT`, `PAUSED`, `CANCELLED`, `FAILED`.

### P3-03 — Trois automatisations initiales

1. **Après première visite** : remerciement envoyé après passage en `HONORED`, jamais après annulation/no-show.
2. **Client dormant** : relance après X jours sans visite et sans réservation future.
3. **Anniversaire** : message dans une fenêtre configurable, avec année facultative et fréquence annuelle garantie.

La réactivation existante doit être migrée ou encapsulée dans ce moteur, sans double envoi pendant la transition.

### P3-04 — Éditeur et prévisualisation

- modèles SMS puis email ;
- variables autorisées et fallback si une donnée manque ;
- rendu sur mobile ;
- estimation du coût avant programmation ;
- envoi test au gérant ;
- date, fuseau et fenêtre horaire ;
- validation explicite avant premier envoi massif ;
- pause immédiate ;
- page d'historique et détails des erreurs.

### P3-05 — Consentement et délivrabilité

- séparer opt-in email, SMS et éventuellement WhatsApp ;
- conserver preuve, source, texte, version et horodatage ;
- vérifier l'opt-in au calcul de l'audience et juste avant envoi ;
- désinscription à effet immédiat ;
- liste de suppression fournisseur synchronisée ;
- fréquence maximale par canal ;
- gestion bounce, plainte, numéro invalide et changement de propriétaire ;
- messages transactionnels strictement séparés du marketing.

### Porte de sortie Pro marketing

- les trois automatisations passent en staging puis sur deux pilotes ;
- aucun client sans consentement valide ne reçoit de marketing ;
- aucune réservation future n'est ciblée par la relance dormant ;
- un rejeu de job ne produit pas de doublon ;
- le gérant voit audience, coût, envois, échecs et désinscriptions ;
- le support peut expliquer pourquoi un client a reçu un message ;
- checkout 299 € et entitlements Pro validés.

---

## 10. Phase 4 — Attribution et marketing mesurable

**Objectif :** démontrer la valeur de Pro sans présenter une estimation comme un encaissement.

### P4-01 — Liens et codes suivis

- créer un lien de réservation signé par campagne et destinataire ;
- préserver `campaignId` et `customerId` pseudonymisé dans le parcours ;
- attribuer création, modification, annulation et visite ;
- supporter un code offre optionnel ;
- définir une fenêtre d'attribution configurable ;
- conserver source initiale et source de conversion sans les écraser.

### P4-02 — Niveaux de revenu

Afficher quatre métriques distinctes :

1. **réservations attribuées** ;
2. **visites honorées attribuées** ;
3. **revenu estimé**, via couverts × ticket moyen ;
4. **revenu encaissé**, seulement issu d'un paiement ou de la caisse.

Le terme « revenu généré » ne doit être utilisé que si la méthode d'attribution et la nature estimée/encaissée sont visibles.

### P4-03 — Rapport campagne

Rapport minimum : audience, délivrés, clics si disponibles, réservations, visites, désinscriptions, coût de campagne, revenu estimé et revenu encaissé. Ajouter une exportation CSV et une comparaison temporelle, sans prétendre établir une causalité expérimentale.

### Porte de sortie attribution

- une réservation issue d'un lien de campagne est attribuée une seule fois ;
- une annulation retire la conversion active mais reste dans l'historique ;
- le passage à `HONORED` met à jour le rapport ;
- les montants estimés et encaissés ne sont jamais additionnés ;
- les résultats sont reproductibles depuis les données sources.

À ce stade, Pro à 299 € possède une proposition de valeur complète.

---

## 11. Phase 5 — Empreinte bancaire, acomptes et no-show

**Objectif :** protéger les services à forte demande et les grands groupes.

### P5-01 — Modèle marchand et responsabilités

Décider avant développement :

- qui est marchand de référence ;
- Stripe Connect ou compte Stripe propre au restaurant ;
- qui supporte litiges, remboursements et frais ;
- quand une carte est enregistrée, autorisée ou débitée ;
- durée et renouvellement d'autorisation ;
- politique selon taille de groupe, service ou événement ;
- traitement d'un no-show partiel ;
- TVA, facture, CGV et consentement à la politique.

Cette décision conditionne l'architecture. Elle doit être validée avec Stripe et un conseil juridique/comptable.

### P5-02 — Policy et réservation

Ajouter une `ReservationPaymentPolicy` versionnée :

- type `NONE`, `CARD_GUARANTEE`, `DEPOSIT`, `PREPAYMENT` ;
- montant fixe ou par personne ;
- seuil de groupe ;
- services/dates concernés ;
- délai d'annulation gratuite ;
- règle de remboursement ;
- snapshot sur la réservation.

### P5-03 — Parcours de paiement

- créer un SetupIntent ou PaymentIntent idempotent ;
- envoyer un lien sécurisé avec expiration ;
- réserver temporairement la capacité pendant le paiement ;
- confirmer seulement après état requis ;
- traiter `requires_action`, échec, expiration, annulation et webhook en retard ;
- ne jamais stocker de carte ;
- afficher au gérant l'état et l'action possible.

### P5-04 — Frais, remboursements et litiges

- action de débit après no-show avec justification ;
- double validation au début du pilote ;
- plafond et délai ;
- remboursement total/partiel ;
- audit immuable ;
- notification client ;
- rapprochement Stripe quotidien ;
- file d'exceptions et runbook de litige.

### Porte de sortie paiement

- scénarios paiement, 3DS, expiration, remboursement et webhook rejoué validés ;
- aucune réservation simultanément confirmée et impayée si la policy exige un paiement ;
- aucune double capture ;
- politique acceptée et horodatée ;
- restauration/rollback n'altère pas le ledger financier ;
- pilote limité à un restaurant et une règle simple avant généralisation.

---

## 12. Phase 6 — Première intégration caisse

**Objectif :** connaître la dépense réelle par visite et déclencher du marketing fondé sur la valeur.

### P6-01 — Sélection du fournisseur

Interroger les dix premiers prospects et choisir le connecteur selon :

- nombre de restaurants réellement équipés ;
- disponibilité et coût de l'API ;
- sandbox et qualité documentaire ;
- webhooks ou fréquence de synchronisation ;
- identifiants disponibles pour rapprocher réservation et ticket ;
- données ligne par ligne et remboursements ;
- conditions de redistribution et DPA ;
- support partenaire.

Ne construire aucun connecteur avant d'avoir au moins deux prospects ou un client signé utilisant cette caisse.

### P6-02 — Couche d'adaptation

Créer une interface interne stable :

```ts
interface PosConnector {
  connect(input: ConnectionInput): Promise<ConnectionResult>;
  verifyConnection(): Promise<ConnectionHealth>;
  syncChecks(cursor?: string): Promise<SyncPage<PosCheck>>;
  getCheck(id: string): Promise<PosCheck | null>;
  disconnect(): Promise<void>;
}
```

Normaliser dans des modèles internes :

- `PosConnection` et statut de santé ;
- `PosLocationMapping` ;
- `PosCheck` et montants hors taxes/taxes/pourboire/remise ;
- `PosCheckItem` optionnel ;
- `PosPayment` ou résumé de paiement ;
- `ReservationCheckMatch` avec méthode et confiance ;
- curseur de synchronisation et dead-letter.

### P6-03 — Rapprochement réservation-ticket

Ordre de préférence : identifiant transmis au POS, table + fenêtre horaire, téléphone/token client, puis proposition manuelle. Un rapprochement faible ne doit pas enrichir automatiquement la valeur client.

Prévoir :

- plusieurs tickets pour une réservation ;
- partage de note ;
- walk-in ;
- remboursement après fermeture ;
- ticket rouvert ;
- réservation déplacée ;
- plusieurs réservations sur une table ;
- devise et fuseau.

### P6-04 — Valeur client réelle

Après rapprochement fiable :

- dépense dernière visite ;
- dépense cumulée et moyenne ;
- dépense par couvert ;
- produits/catégories préférés si légalement et commercialement utile ;
- segment de valeur ;
- revenu encaissé attribué aux campagnes.

### Porte de sortie POS

- 30 jours de synchronisation sans trou silencieux ;
- ≥ 95 % des tickets candidats rapprochés automatiquement ou présentés à résoudre ;
- montants agrégés égaux aux rapports POS sur un échantillon signé ;
- remboursements répercutés ;
- secrets chiffrés et rotation documentée ;
- déconnexion et suppression testées ;
- tableau de santé visible au support.

---

## 13. Phase 7 — CRM groupe et multi-site

**Objectif :** rendre l'offre groupe sûre et utile, au-delà d'une facture multi-établissements.

### P7-01 — Fermer l'isolation actuelle

Exécuter les portes encore ouvertes de `docs/audits/2026-09-07-multisite-gap-matrix.md` :

- deux organisations et deux identités réelles ;
- propriétaire, responsable groupe et membre limité à un site ;
- refus inter-organisation sur chaque écran/API ;
- suspension, réactivation et transfert du site principal ;
- annuel, taxes, prorata et période de grâce ;
- validation iPad et sélection persistante du site.

### P7-02 — Identité client groupe

Éviter de déplacer directement `Customer.restaurantId`. Introduire une identité groupe ou un graphe de correspondance avec :

- consentement à l'usage inter-établissements ;
- visibilité selon rôle ;
- préférences communes et notes privées au site ;
- statistiques groupe et locales ;
- fusion/dissociation auditée ;
- export et effacement couvrant tous les sites concernés.

### P7-03 — Exploitation groupe

- recherche de disponibilité dans les établissements frères ;
- proposition d'un autre restaurant quand le premier est complet ;
- transfert de réservation explicite ;
- segments groupe ;
- campagnes par marque/site ;
- limites de pression marketing au niveau groupe ;
- rapports consolidés et comparaison entre sites ;
- facturation par nombre de sites active.

### Porte de sortie groupe

- zéro accès à une note privée d'un autre site sans droit ;
- le client n'est contacté qu'une fois lorsqu'il appartient à plusieurs audiences ;
- une réservation croisée conserve source, consentement et responsabilité ;
- les chiffres consolidés sont égaux à la somme des sites après déduplication documentée.

---

## 14. Phase 8 — Réputation et fidélité

**Objectif :** fermer la boucle après visite sans construire immédiatement un programme de points complexe.

### P8-01 — Retour après visite

- demander un avis privé après une visite honorée ;
- score, commentaire et thèmes ;
- routage d'un retour négatif vers une tâche gérant ;
- délai de réponse et statut de récupération ;
- ne solliciter ni no-show ni client déjà sollicité récemment ;
- mesurer retour puis nouvelle visite.

### P8-02 — Sources d'avis externes

Ajouter les sources une par une selon accès API : Google en premier si permis, puis autres plateformes demandées par les pilotes. Centraliser la lecture et la réponse seulement si les conditions de la plateforme l'autorisent.

### P8-03 — Avantages simples

Avant les points :

- avantage manuel ou automatique ;
- règle d'éligibilité explicable ;
- validité et limites d'usage ;
- affichage avant le service ;
- consommation auditée ;
- coût estimé ;
- prévention des doublons et abus.

Exemples : coupe offerte pour anniversaire, priorité liste d'attente, attention VIP. Éviter toute promesse qui ne peut pas être exécutée par l'équipe en salle.

### Porte de sortie fidélité

- toute récompense a une règle, un coût, un état et une trace d'utilisation ;
- un retour négatif crée une action assignée ;
- les sollicitations respectent le consentement et la fréquence ;
- le dashboard relie récupération et visite suivante sans confondre corrélation et causalité.

---

## 15. Phase 9 — Expériences, événements et écosystème

Cette phase rapproche Sokar de la largeur de SevenRooms, mais elle ne justifie pas à elle seule 199/299 €.

### P9-01 — Expériences et suppléments

- catalogue d'expériences avec capacité, dates et prix ;
- menus prépayés et suppléments ;
- inventaire séparé ou partagé avec les tables ;
- achat, remboursement et transfert ;
- widget et téléphone capables de les proposer ;
- reporting séparé.

### P9-02 — Événements

- sessions, billets, jauges, tarifs et codes ;
- collecte des participants ;
- liste d'attente ;
- contrôle d'accès simple ;
- facture et remboursement ;
- campagnes liées à l'événement.

### P9-03 — Canaux et API partenaires

Prioriser selon demande commerciale : Google Reserve, Instagram/Facebook, plateformes de réservation et API publique. Pour chaque canal :

- contrat de capacité ;
- source et attribution ;
- idempotence ;
- synchronisation bidirectionnelle ;
- gestion du retard fournisseur ;
- health check et alerte ;
- procédure de déconnexion ;
- tests de concurrence.

## 16. Backlog transversal obligatoire

### Sécurité et RGPD

- matrice de rôles pour CRM, campagnes, paiements et groupe ;
- chiffrement des secrets POS ;
- politiques de rétention par type de donnée ;
- export/effacement étendus à chaque nouveau modèle ;
- registre des sous-traitants et DPA ;
- audit de masse pour exports et campagnes ;
- protection contre l'énumération et limitation de débit.

### Observabilité et support

- métriques par étape sans PII ;
- correlation ID appel/réservation/message/paiement/ticket ;
- dashboards fournisseurs ;
- files d'erreurs et actions de reprise ;
- alertes avec destinataire réel ;
- runbooks et modèles de communication d'incident ;
- outils support en lecture seule par défaut.

### Qualité

- tests unitaires sur règles et transitions ;
- tests Postgres sur concurrence/idempotence ;
- tests de contrat fournisseurs ;
- E2E sur les parcours critiques ;
- tests de migration sur copie anonymisée ;
- accessibilité et largeur iPad ;
- charge sur appels, réservations et envois de campagne ;
- rollback staging avant chaque promotion risquée.

### Données et analytics

Définir un dictionnaire commun : appel répondu, conversation utile, réservation créée, réservation confirmée, visite honorée, no-show, message délivré, conversion, revenu estimé, revenu encaissé. Chaque métrique doit préciser sa source, son propriétaire et son délai de fraîcheur.

## 17. Ordre de construction recommandé

### Vague A — Justifier Essential 199 €

1. P0-01 comptabilité d'usage ;
2. P0-02 entitlements ;
3. P1-01 à P1-05 fiabilité et onboarding ;
4. P0-03 migration Stripe 199/299 ;
5. P0-04 marge interne ;
6. deux pilotes, sept jours, correction des incidents ;
7. ouverture commerciale Essential.

### Vague B — Justifier Pro 299 €

1. identité, chronologie, préférences et tags ;
2. indicateurs RFM et interface CRM ;
3. segments sauvegardés ;
4. trois automatisations ;
5. consentements et délivrabilité ;
6. attribution réservations/visites ;
7. pilote Pro puis ouverture commerciale.

### Vague C — Augmenter la valeur et le revenu

Choisir selon les problèmes des pilotes :

- beaucoup de no-shows ou grands groupes → protection bancaire d'abord ;
- besoin de cibler les meilleurs clients → caisse d'abord ;
- demandes de groupes → CRM multi-site d'abord ;
- besoin de récupération client → réputation d'abord.

### Vague D — Approcher la suite SevenRooms

Étendre connecteurs POS, fidélité, expériences, événements, distribution et API partenaires à partir de ventes réelles, pas d'une checklist concurrentielle abstraite.

## 18. Découpage des 12 premiers sprints

Hypothèse : sprints de deux semaines. Le contenu sera ajusté selon les incidents pilotes.

| Sprint | Livraison principale                                    | Démonstration attendue                               |
| ------ | ------------------------------------------------------- | ---------------------------------------------------- |
| S1     | Ledger d'usage et coût par appel                        | Un appel test est rapproché de bout en bout          |
| S2     | Entitlements, alertes de consommation, marge interne    | Essential et Pro ont des droits et budgets distincts |
| S3     | Matrice E2E voix/réservation et correction P0           | Dix scénarios critiques passent                      |
| S4     | Notifications avec callbacks, erreurs visibles et retry | Une panne SMS est visible et récupérable             |
| S5     | Onboarding, renvoi de secours, readiness gate           | Un restaurant est activé avec checklist signée       |
| S6     | Prix 199/299, Stripe sandbox et deux pilotes Essential  | Cycle commercial complet démontré                    |
| S7     | Identité client, chronologie et migration               | Un profil rassemble appels, réservations et visites  |
| S8     | Préférences, tags, déduplication et droits              | Un doublon est fusionné sans perte                   |
| S9     | Indicateurs RFM et filtres CRM                          | Le gérant retrouve une audience utile                |
| S10    | Modèle campagne, segments et SMS test                   | Une campagne est prévisualisée et estimée            |
| S11    | Trois automatisations, consentement, désinscription     | Aucun message illégitime ou doublon au rejeu         |
| S12    | Attribution, rapport, pilote Pro                        | Réservation et visite apparaissent dans le rapport   |

À la fin de S6, Essential doit pouvoir être vendu à 199 €. À la fin de S12, Pro doit pouvoir être vendu à 299 €. Ce calendrier n'est acceptable que si les portes de qualité passent ; un sprint de stabilisation remplace une nouvelle fonctionnalité dès qu'un incident P0/P1 reste ouvert.

## 19. Indicateurs de pilotage

### Essential

- taux d'appels décrochés ;
- taux de conversations abouties ;
- taux de réservations exactes ;
- transferts humains et raisons ;
- réservations par canal ;
- minutes et coût par appel/réservation ;
- échecs de notification ;
- temps gérant économisé, mesuré par entretien et échantillon ;
- incidents P0/P1 par établissement ;
- marge brute par restaurant.

### Pro

- profils avec identité exploitable ;
- profils enrichis et doublons ;
- taille des segments ;
- délivrés, bounces et désinscriptions ;
- réservations et visites attribuées ;
- coût par visite attribuée ;
- revenu estimé et encaissé séparés ;
- taux de retour à 30/60/90 jours ;
- adoption hebdomadaire du CRM et des campagnes.

### Seuils de décision

- **Maintenir** une fonction si elle est utilisée et apporte un résultat mesurable.
- **Corriger** si elle est utile mais génère erreurs, support ou coût excessif.
- **Simplifier** si moins de 20 % des pilotes comprennent le parcours sans aide.
- **Retirer ou différer** si aucun pilote ne l'utilise sur deux cycles pertinents.
- **Augmenter les limites/prix** si le p90 de coût met en danger la marge.

## 20. Dépendances externes et décisions de Hamza

| Décision                                      | Échéance utile | Impact si absente                             |
| --------------------------------------------- | -------------- | --------------------------------------------- |
| Minutes/SMS inclus par formule                | Phase 0        | Impossible de finaliser entitlements et marge |
| Remise annuelle et maintien des anciens prix  | Phase 0        | Migration Stripe bloquée                      |
| Engagement de support Pro                     | Phase 0        | Promesse commerciale imprécise                |
| Deux restaurants pilotes Essential            | Phase 1        | Fiabilité terrain non prouvée                 |
| Canal email et domaine d'envoi                | Phase 3        | Campagnes email et délivrabilité bloquées     |
| Politique marketing et textes de consentement | Phase 3        | Automatisations non activables                |
| Modèle marchand Stripe                        | Phase 5        | Empreinte/acompte bloqués                     |
| Caisse prioritaire                            | Phase 6        | Connecteur POS non sélectionnable             |
| Deux clients équipés de la même caisse        | Phase 6        | ROI du connecteur insuffisant                 |
| Règles de partage client groupe               | Phase 7        | CRM groupe non activable                      |

## 21. Risques majeurs et réponses

| Risque                                       | Réponse                                                                          |
| -------------------------------------------- | -------------------------------------------------------------------------------- |
| Construire trop large avant les ventes       | Chaque phase a une porte commerciale autonome et des pilotes nommés              |
| Coût voix incompatible avec 199/299 €        | Ledger d'usage, p90, quotas et dépassements avant promesse                       |
| Messages marketing non conformes             | Consentement par canal, preuve, revalidation à l'envoi, suppression immédiate    |
| Doublons client et mauvaise personnalisation | Identités vérifiées, score de rapprochement, fusion manuelle auditée             |
| Faux ROI                                     | Séparer estimé, réservé, honoré et encaissé                                      |
| Double envoi ou double débit                 | Idempotence Postgres et références fournisseur uniques                           |
| Dépendance à un POS                          | Interface adaptateur, health check, sync reprenable, export des données internes |
| Fuite multi-tenant                           | Résolution serveur du site, tests avec identités réelles, rôles minimaux         |
| Dette créée par le legacy                    | Migrations additives, adaptateurs et plan de retrait après observation           |
| Support ingérable                            | Onboarding bloquant, outils de diagnostic, runbooks et limites claires           |

## 22. Définition de “Sokar offre tout ce qui compte face à SevenRooms”

Le but ne doit pas être une égalité de cases marketing. Pour la cible des restaurants indépendants français, Sokar atteint une position compétitive lorsque :

- les réservations voix, web et assistants sont unifiées ;
- la salle et la liste d'attente sont fiables en service ;
- chaque interaction enrichit un profil client contrôlable ;
- les segments et relances sont simples et mesurables ;
- le restaurant protège ses réservations à risque ;
- une caisse prioritaire fournit la dépense réelle ;
- les groupes partagent les données selon des droits explicites ;
- les retours négatifs deviennent des actions ;
- les coûts, marges et résultats sont visibles ;
- l'installation et le support restent nettement plus simples que ceux d'une suite enterprise.

Les intégrations nombreuses, la billetterie avancée et les fonctions spécialisées pour hôtels, clubs ou stades ne deviennent prioritaires que si Sokar choisit ces marchés.

## 23. Prochaine action concrète

Ouvrir un epic par phase et commencer par P0-01. Avant le premier changement de schéma, rédiger les ADR courts pour :

1. ledger d'usage et unité de coût ;
2. entitlements 199/299 ;
3. identité client et fusion ;
4. événements CRM et attribution ;
5. consentement marketing par canal.

Le premier jalon démontrable est : **un appel réel crée une réservation correcte, produit son coût complet, apparaît dans le tableau d'usage et respecte les droits du plan**. Ce jalon constitue la fondation économique et technique de toute la roadmap.

## 24. Documents liés

- `docs/architecture/reservation-commercial-readiness.md`
- `docs/audits/2026-09-06-launch-readiness.md`
- `docs/audits/2026-09-07-phase-0-commercial-register.md`
- `docs/audits/2026-09-07-multisite-gap-matrix.md`
- `docs/architecture/reservation-state-semantics.md`
- `docs/floor-plan-spec.md`
- `docs/gift-cards-spec.md`
- `docs/runbooks/stripe-billing.md`
- [CRM SevenRooms](https://sevenrooms.com/platform/crm/)
- [Réservations et liste d'attente SevenRooms](https://sevenrooms.com/platform/reservations-waitlist/)
- [Tarifs Zenchef](https://www.zenchef.com/fr/formules)
