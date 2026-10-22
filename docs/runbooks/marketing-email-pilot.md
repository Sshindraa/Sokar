# Pilote marketing par e-mail (Chez Sokar)

Préparé le 22 octobre 2026. Portes concernées : `P3_MARKETING` (segments, campagnes, conformité) et
`P4_ATTRIBUTION` (attribution et ROI), toutes deux `LOCAL_ONLY` dans
[`product-gates.json`](../release/product-gates.json).

**Périmètre : e-mail uniquement.** Les SMS restent bloqués (erreur Telnyx 40008 depuis l'expéditeur
« SOKAR », en attente du support Telnyx) ; WhatsApp marketing reste coupé. Aucun message n'a été envoyé
pour préparer ce document : tout ce qui suit est une procédure, pas un constat d'exécution.

Références : [ADR du plan de contrôle CRM/marketing](../architecture/adr-crm-marketing-control-plane.md),
[variables d'environnement](environment.md), [délivrabilité](email-sms-deliverability.md).

## 1. Ce qui est prêt dans le code

| Élément                                                                                              | État                                                                                                                                                             |
| ---------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Segments, aperçu d'audience, brouillon, préparation, programmation, envoi, annulation, rapport + CSV | Livrés (`apps/api/src/modules/marketing/`), protégés par `marketing.campaigns` (plan Pro) et par `MARKETING_FEATURES_ENABLED`                                    |
| Consentement par canal (`MarketingPermission`) avec preuve hachée et journal d'événements            | Livré ; **aucune interface ne permet de le recueillir** (voir §6)                                                                                                |
| Désinscription signée par canal, immédiate, sans révéler l'adresse                                   | Livrée ; page de confirmation en français et en-têtes `List-Unsubscribe` ajoutés par cette PR                                                                    |
| Contrôle au dernier moment : contact, consentement, suppression, plafond de 3 messages par jour      | Livré (worker `marketing-campaign`, deux contrôles avant l'appel Resend)                                                                                         |
| Callbacks Resend signés (Svix) → statut du message, rapprochement des identifiants inconnus          | Livrés ; endpoint `POST /marketing/webhooks/resend`                                                                                                              |
| Suppression automatique après plainte ou rebond définitif                                            | **Ajoutée par cette PR** (il n'existait aucun code qui créait une suppression)                                                                                   |
| Liste blanche de destinataires propre au marketing (`MARKETING_RECIPIENT_ALLOWLIST`)                 | **Ajoutée par cette PR** ; vide = aucune restriction                                                                                                             |
| Mode « test » d'une campagne                                                                         | `POST /marketing/campaigns/:id/test` est un **dry-run** : il rend le message mais ne contacte aucun fournisseur. L'envoi réel de test passe par la liste blanche |

## 2. Défauts constatés et corrigés (PR dédiée)

1. **Plainte ou rebond définitif sans effet.** Un statut `COMPLAINED` ou `BOUNCED` était enregistré sur
   le message, mais l'adresse pouvait recevoir la campagne suivante. Désormais une suppression
   (`COMPLAINED` ou `HARD_BOUNCE`, canal e-mail) est créée ; l'audience et le worker l'excluent déjà.
   Un rebond temporaire (`Transient`) ne supprime rien.
2. **Désinscription par GET.** Le lien de l'e-mail désinscrivait dès l'ouverture de l'URL et répondait en
   JSON brut. Les anti-virus et aperçus de lien (Outlook, Gmail) ouvrent les liens : les destinataires
   auraient été désinscrits sans le savoir, ce qui fausse le pilote. Désormais le GET affiche une page de
   confirmation en français ; le bouton envoie un POST. Le POST accepte aussi le jeton dans l'URL, comme le
   fait le « un clic » RFC 8058 des messageries.
3. **Pas d'en-têtes `List-Unsubscribe`.** Ajoutés (avec `List-Unsubscribe-Post: List-Unsubscribe=One-Click`) :
   Gmail et Outlook affichent un bouton « Se désabonner » natif.
4. **Adresses non cliquables.** Le corps de l'e-mail n'était que du texte échappé : le lien de désinscription
   et celui de réservation sont maintenant des liens `<a>`.
5. **Rapprochement encombré.** Le webhook Resend reçoit aussi les événements des e-mails transactionnels, qui
   ne correspondent à aucun message de campagne et restaient `OPEN` pour toujours, bloquant la fenêtre de
   100 lignes lue toutes les cinq minutes. Une ligne sans message de campagne est fermée (`IGNORED`,
   `AUTO_EXPIRED_NO_CAMPAIGN_MESSAGE`) après deux heures.

## 3. Constats à connaître avant d'envoyer

- **Verrou de déploiement production.** `scripts/verify-product-gates.mjs` refuse tout `deploy.sh --env prod`
  si `MARKETING_SENDS_ENABLED=true` figure dans `apps/api/.env` (le profil `core-operator-foundations` le
  déclare dans `disabledFeatureFlags`). Conséquence : pendant une fenêtre d'envoi en production, **aucun
  déploiement ne passe** tant que le flag est à `true`. Soit la fenêtre est courte et coupée aussitôt, soit
  une PR distincte retire ce flag du profil (décision de release, non faite ici).
- **`EMAIL_TEST_ALLOWLIST` ne convient pas à la production.** Elle filtre **tous** les e-mails du site
  (confirmations, alertes, démos). Elle n'existe côté CI que pour staging (`EMAIL_TEST_ALLOWLIST_STAGING`).
  En production, utilisez `MARKETING_RECIPIENT_ALLOWLIST`, qui ne touche que les messages marketing.
- **Secrets non propagés par la CI.** `RESEND_WEBHOOK_SECRET`, `MARKETING_UNSUBSCRIBE_SECRET`,
  `MARKETING_ATTRIBUTION_SECRET`, `MARKETING_SENDS_ENABLED` et `MARKETING_RECIPIENT_ALLOWLIST` ne passent par
  aucun workflow ni `sync-env.sh` : ils se posent à la main dans `apps/api/.env` du VPS, puis
  `pm2 reload sokar-api --update-env` et rechargement des workers.
- **Quota Resend.** Le plan constaté est Free : 100 e-mails par jour et 3 000 par mois, partagés avec les
  e-mails transactionnels. Un pilote de quelques adresses tient largement.
- **Jeton dans les journaux d'accès.** L'URL de désinscription contient le jeton ; il n'embarque que des
  identifiants opaques (aucune adresse), mais ne le copiez pas dans un ticket.
- **Le consentement historique.** Sans ligne `MarketingPermission`, un `CustomerConsent.marketingOptIn`
  (rattaché au téléphone) autorise aussi l'e-mail (ADR, « période de migration »). Rien dans le dashboard,
  le widget ou Connect ne le met à `true` (seuls des appels API directs de type MCP le peuvent). Pour le
  pilote, ne comptez que sur un consentement **e-mail explicite** (§5, étape B).

## 4. Base légale du consentement

- Prospection électronique à des particuliers : consentement préalable (article L.34-5 du Code des postes et
  des communications électroniques, RGPD article 6.1.a). La décision d'architecture suit cette règle : l'opt-in
  est un acte explicite, jamais pré-coché, daté, versionné et rattaché à une preuve hachée (le texte brut n'est
  pas stocké).
- Retrait à tout moment, sans effet sur les traitements antérieurs : prévu par la politique de confidentialité
  (`apps/api/src/modules/rgpd/privacy-policy.ts`) et par le lien de chaque message.
- Chaque message doit identifier le restaurant et porter `{{unsubscribeUrl}}` (le serveur refuse un modèle qui
  l'omet). Mettez le nom du restaurant dans le corps (`{{restaurant.name}}`).
- **Pour le pilote**, les destinataires sont uniquement des personnes qui ont donné leur accord pour ce test
  (vous, collaborateurs, proches informés). Version de preuve proposée : `pilote-interne-2026-10`, texte de
  preuve : « Accord donné par le titulaire de l'adresse pour recevoir les e-mails du pilote Sokar, retirable à
  tout moment ». À conserver tel quel pour que le hachage reste identique.
- **À valider par vous** (je ne tranche pas le droit) : le texte qui sera montré à de vrais clients (case à
  cocher non pré-cochée), la finalité (« offres et actualités de <restaurant> »), la durée de conservation de
  la preuve, et la mention dans l'annexe client (`privacy-client-annex.md`). Resend : DPA signé archivé en
  privé ; conservation effective à valider (voir `Context.md`).

## 5. Liste de vérification du pilote (adresses de test seulement)

Faites les étapes dans l'ordre. Chaque étape a un critère de réussite ; s'il n'est pas atteint, arrêtez-vous.
Recommandation : déroulez tout d'abord sur **staging** (sans verrou de déploiement), puis répétez en
production la fenêtre d'envoi.

### Étape A — Configuration (aucun envoi)

| #   | Action                                                                                                                                                                                                                                                                                                                | Critère de réussite                                                                                                                 |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| A1  | Resend : domaine `sokar.tech` vérifié (DKIM `resend._domainkey`, retour `send.sokar.tech`), clé d'envoi présente dans `RESEND_API_KEY`, `EMAIL_FROM` = `noreply@sokar.tech`                                                                                                                                           | Tableau de bord Resend : domaine « Verified » ; `readiness.email.missing` vide                                                      |
| A2  | DNS : SPF racine avec Google, DMARC `_dmarc.sokar.tech` (voir `email-sms-deliverability.md`, absents à la date du 17/10, à reconfirmer)                                                                                                                                                                               | `dig TXT sokar.tech` et `dig TXT _dmarc.sokar.tech` renvoient les valeurs attendues                                                 |
| A3  | Resend → Webhooks : endpoint `https://api.sokar.tech/marketing/webhooks/resend` (staging : `api-staging.sokar.tech`), événements `email.sent`, `delivered`, `bounced`, `complained`, `failed`, `suppressed` (+ `opened`/`clicked` si vous voulez mesurer). Copier le secret de signature dans `RESEND_WEBHOOK_SECRET` | `readiness.email.callbackConfigured` = `true` ; l'historique du webhook Resend montre des réponses 200 (et aucune 403 de signature) |
| A4  | Poser `MARKETING_UNSUBSCRIBE_SECRET` (≥ 32 caractères, distinct de l'attribution), `MARKETING_ATTRIBUTION_SECRET`, et `MARKETING_UNSUBSCRIBE_BASE_URL` = `https://api.sokar.tech/marketing/unsubscribe`                                                                                                               | `GET` d'un lien généré affiche la page de confirmation sur le bon domaine                                                           |
| A5  | `MARKETING_FEATURES_ENABLED=true` (déjà vrai en production), `MARKETING_WHATSAPP_ENABLED=false`, `MARKETING_SENDS_ENABLED=false`                                                                                                                                                                                      | `GET /marketing/providers/readiness` : `sendsEnabled=false`, `whatsapp.configured=false`                                            |
| A6  | `MARKETING_RECIPIENT_ALLOWLIST=<adresse-1>,<adresse-2>` (vos adresses de test, en minuscules)                                                                                                                                                                                                                         | `readiness.recipientAllowlistActive=true` (la liste elle-même n'est jamais renvoyée)                                                |
| A7  | Chez Sokar a la capacité `marketing.campaigns` (plan Pro)                                                                                                                                                                                                                                                             | Le menu Marketing du dashboard s'ouvre sans message de plan                                                                         |

### Étape B — Destinataires de test et consentement

| #   | Action                                                                                                                                                                                                           | Critère de réussite                                                                                    |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| B1  | Créez une réservation de test sur `/book/<slug-chez-sokar>` pour **chaque** adresse de test (ou utilisez un client existant à votre nom) : la fiche CRM `/dashboard/customers/crm/<id>` apparaît avec son e-mail | Chaque testeur a une fiche CRM avec e-mail renseigné                                                   |
| B2  | Sur chaque fiche, ajoutez l'étiquette `pilote-email` (clé minuscule, séparée par des tirets)                                                                                                                     | L'étiquette est visible sur la fiche                                                                   |
| B3  | Enregistrez le consentement e-mail de chaque testeur (appel API, voir §6 : aucune interface pour l'instant)                                                                                                      | `GET /crm/customers/<id>/marketing-permissions` renvoie `EMAIL`, `OPTED_IN`, `proofVersion` renseignée |
| B4  | Gardez un testeur **sans** consentement et un testeur déjà « désinscrit » : ils servent de témoins                                                                                                               | Ils figureront dans les exclusions de l'aperçu (étape C)                                               |

Exemple d'appel de consentement (jeton de session Clerk d'un Owner/Manager dans `$TOKEN`, ne le collez nulle part) :

```bash
curl -sS -X PUT "https://api.sokar.tech/crm/customers/<id-client>/marketing-permissions/EMAIL" \
  -H "authorization: Bearer $TOKEN" -H "content-type: application/json" \
  -d '{"status":"OPTED_IN","source":"PILOT_INTERNAL","proofVersion":"pilote-interne-2026-10","proof":"Accord donné par le titulaire de l'\''adresse pour recevoir les e-mails du pilote Sokar, retirable à tout moment"}'
```

### Étape C — Segment, brouillon, aperçu (toujours sans envoi)

| #   | Action                                                                                                                                                                                        | Critère de réussite                                                                                                                                          |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| C1  | `/dashboard/marketing/segments` : segment « Pilote e-mail » = étiquette `pilote-email` (règle `tag` / `EXISTS` / `pilote-email`)                                                              | L'aperçu donne exactement le nombre de testeurs étiquetés                                                                                                    |
| C2  | `/dashboard/marketing/campaigns/new` : canal E-mail, objet « Pilote Sokar — test », corps avec `{{customer.firstName}}`, `{{restaurant.name}}`, `{{reservationLink}}` et `{{unsubscribeUrl}}` | Brouillon créé ; `audienceCount` = nombre de testeurs avec consentement ; le témoin sans consentement apparaît en `NO_CONSENT`, le désinscrit en `OPTED_OUT` |
| C3  | Aperçu de la campagne et test « gérant » (dry-run)                                                                                                                                            | `providerContacted=false`, aucun message créé, coût estimé `PRICED` ou `NOT_AVAILABLE` (jamais d'erreur)                                                     |
| C4  | Préparer la campagne (`READY`)                                                                                                                                                                | Statut `READY` ; audience figée = celle de C2                                                                                                                |

**Point d'arrêt** : si l'effectif de C2 diffère du nombre de testeurs attendu, n'allez pas plus loin.

### Étape D — Fenêtre d'envoi (action de votre part uniquement)

| #   | Action                                                                                                                                                                        | Critère de réussite                                                                                                                                           |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D1  | Vérifiez `recipientAllowlistActive=true`, puis passez `MARKETING_SENDS_ENABLED=true` et rechargez API et workers. **Production : aucun déploiement pendant la fenêtre (§3).** | `readiness.sendsEnabled=true`                                                                                                                                 |
| D2  | Lancez l'envoi de la campagne `READY` (bouton Envoyer ou `POST /marketing/campaigns/:id/send`)                                                                                | Statut `SENDING` puis `SENT` ; `acceptedCount` = nombre de testeurs ; zéro `FAILED`                                                                           |
| D3  | Contrôlez les boîtes de réception (et le dossier spam)                                                                                                                        | Chaque testeur reçoit **un** message, expéditeur « Sokar », réponse vers `hello@sokar.tech`, lien de désinscription cliquable, bouton natif « Se désabonner » |
| D4  | Contrôlez les callbacks                                                                                                                                                       | Messages en `DELIVERED` (`deliveredCount`) ; aucune ligne `OPEN` dans `/api/internal/marketing/reconciliation` (avec `SOKAR_INTERNAL_MARKETING_TOKEN`)        |
| D5  | **Remettez aussitôt** `MARKETING_SENDS_ENABLED=false` et rechargez                                                                                                            | `readiness.sendsEnabled=false`                                                                                                                                |

### Étape E — Désinscription de bout en bout

| #   | Action                                                                              | Critère de réussite                                                                                                           |
| --- | ----------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| E1  | Un testeur ouvre le lien de désinscription reçu                                     | Page « Ne plus recevoir ces messages ? » ; **rien n'est encore modifié** (`GET …/marketing-permissions` toujours `OPTED_IN`)  |
| E2  | Il clique sur « Me désinscrire »                                                    | Page « Vous êtes désinscrit » ; permission `EMAIL` = `OPTED_OUT`, source `UNSUBSCRIBE_LINK`, événement horodaté dans la fiche |
| E3  | Créez un second brouillon sur le même segment, aperçu d'audience                    | Le testeur désinscrit est exclu (`OPTED_OUT`), l'effectif baisse de 1                                                         |
| E4  | (Optionnel) le bouton natif « Se désabonner » de Gmail/Outlook sur un autre testeur | Même résultat qu'en E2 (réponse 200 du POST)                                                                                  |
| E5  | Vérifiez le message d'un lien falsifié ou expiré                                    | Page « Ce lien n'est plus valide », aucune modification                                                                       |

Si un nouvel envoi était nécessaire pour prouver l'exclusion côté worker, refaites D1–D5 : le message du
désinscrit doit finir `CANCELLED` avec `OPTED_OUT`, sans appel Resend.

### Étape F — Rebond et plainte (optionnel, prouve la suppression automatique)

Resend fournit des adresses de test (`delivered@resend.dev`, `bounced@resend.dev`, `complained@resend.dev`,
à reconfirmer dans sa documentation). Créez une fiche par adresse, consentement et étiquette comme à l'étape B,
ajoutez-les à `MARKETING_RECIPIENT_ALLOWLIST`, envoyez, puis :

| Critère de réussite                                                                                                                    |
| -------------------------------------------------------------------------------------------------------------------------------------- |
| `bounced@resend.dev` → message `BOUNCED`, suppression `HARD_BOUNCE` ; `complained@resend.dev` → `COMPLAINED`, suppression `COMPLAINED` |
| L'aperçu d'audience suivant les exclut (`SUPPRESSED:HARD_BOUNCE` / `SUPPRESSED:COMPLAINED`)                                            |

### Étape G — Coûts et rapprochement (P3)

| Action                                                | Critère de réussite                                                                                                          |
| ----------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `GET /marketing/campaigns/:id/report` et `report.csv` | Compteurs audience / acceptés / livrés cohérents avec les boîtes ; le CSV ne contient aucune adresse                         |
| Événements d'usage (`EMAIL_MESSAGES`) de la campagne  | Un par message accepté, identifiant Resend rapproché du `providerMessageId` du message                                       |
| Rapprochement                                         | `/api/internal/marketing/reconciliation?status=OPEN` vide                                                                    |
| Coût réel e-mail                                      | Aujourd'hui `NOT_AVAILABLE` tant qu'aucun tarif Resend n'est rapproché : notez le coût réel du plan (Free = 0 € à ce volume) |

### Étape H — Attribution (P4)

| Action                                             | Critère de réussite                                                                                                        |
| -------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| Un testeur clique `{{reservationLink}}` et réserve | Le rapport indique un clic puis une conversion `RESERVATION_CREATED`                                                       |
| La visite est marquée honorée dans le dashboard    | Conversion `RESERVATION_HONORED` ; annuler la réservation désactive la conversion sans effacer l'historique                |
| Comparer à une période de référence                | Le rapport garde séparés réservations, visites honorées, revenus estimés et revenus confirmés ; aucune affirmation causale |

### Étape I — Fermeture

`MARKETING_SENDS_ENABLED=false`, supprimer ou conserver la liste blanche (à votre choix, elle protège),
exporter le rapport, ajouter une entrée au Journal, mettre à jour les bloqueurs de `P3_MARKETING` et
`P4_ATTRIBUTION` dans `product-gates.json` (en PR distincte).

## 6. Ce qui reste à faire par vous

1. **Resend** : confirmer le domaine vérifié, créer le webhook (A3) et me donner la décision d'activer les
   événements d'ouverture/clic ; copier le secret dans l'`.env` du VPS (staging puis production).
2. **Secrets et drapeaux sur le VPS** : poser `MARKETING_UNSUBSCRIBE_SECRET`, `MARKETING_ATTRIBUTION_SECRET`,
   `MARKETING_UNSUBSCRIBE_BASE_URL`, `MARKETING_RECIPIENT_ALLOWLIST` ; décider qui ouvre la fenêtre
   `MARKETING_SENDS_ENABLED=true` (voir le verrou de déploiement du §3). Je n'y ai pas touché.
3. **DNS** : reconfirmer SPF/DMARC chez Cloudflare.
4. **Choisir les testeurs** : liste des adresses réelles (hors dépôt), avec leur accord.
5. **Recueil du consentement** : il n'existe aucune interface (ni case dans le widget de réservation, ni
   contrôle dans la fiche CRM) ; jusque-là, seuls des appels API le créent. Décidez si l'on ajoute un contrôle
   « Consentement e-mail » dans la fiche CRM (utile au pilote) et la case non pré-cochée du formulaire de
   réservation (nécessaire pour de vrais clients), avec le texte juridique validé.
6. **Base légale** : valider le texte de consentement et la durée de conservation (§4).
7. **Verrou de déploiement** : décider entre fenêtre courte sans déploiement et retrait du flag du profil
   `core-operator-foundations`.
8. **Telnyx** : toujours en attente du support (40008) ; hors périmètre de ce pilote.
9. **Revue et fusion** de la PR qui accompagne ce document (correctifs du §2).

## 7. Retour arrière

Aucune migration n'est ajoutée. Pour couper : `MARKETING_SENDS_ENABLED=false` et rechargement ; les messages
`PENDING` restent en attente et la campagne peut être annulée (`POST /marketing/campaigns/:id/cancel`).
Les suppressions créées automatiquement se retirent une à une en base (ligne `marketing_suppressions`) après
vérification de l'adresse concernée.
