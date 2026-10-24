# Audit des contrats des parcours publics — 24 octobre 2026

Base : production `ab1ca2f57` après correction de la confirmation normale (#575).
Périmètre : réservations Dashboard/Connect/ChatGPT, routage Nginx, cartes cadeaux et cagnottes, promesses de notification. Audit ciblé ; pas de garantie d'exhaustivité sur le monorepo.

Méthode de l'audit initial : lecture croisée des composants réellement servis et des routes API, requêtes HTTP GET/HEAD en production et staging, lecture des seuls paramètres publics nécessaires et des comptes agrégés, inspection navigateur staging. Aucun achat, paiement, SMS, réservation ni changement de configuration pendant cette phase. La recette staging ultérieure est documentée à la fin. Aucun identifiant client ou code cadeau réel dans les preuves versionnées.

## Résultat

L'audit initial a établi six défauts et un défaut conditionnel sans restaurant actuellement concerné dans les deux environnements contrôlés. La qualification a ensuite révélé deux écarts secondaires. P1 = parcours bloqué ; P2 = lien, information ou association perdue.

| ID  | Priorité        | Défaut                                                                                                | État actuel                                                                   |
| --- | --------------- | ----------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| A   | P1              | Le client API Connect vise le domaine vitrine, où les routes publiques ne sont pas routées vers l'API | Corrigé et déployé staging/production ; smoke public 200                      |
| B   | P1              | La page bénéficiaire `/gift-card/:code` n'est pas routée vers Connect                                 | Corrigé et déployé ; page chargée en recette staging                          |
| C   | P1              | Le lien partagé de cagnotte n'ouvre pas le formulaire de contribution                                 | Corrigé et déployé ; formulaire et objectif affichés en recette staging       |
| D   | P2              | Le code cadeau du lien bénéficiaire est perdu par le widget réellement servi                          | Corrigé et déployé ; association confirmée sans débit                         |
| E   | P2              | Le bouton cadeau d'un widget ouvert par UUID construit une URL invalide                               | CTA cadeau corrigé par slug et testé sur le widget staging                    |
| F   | P2              | Le formulaire promet un SMS même quand l'envoi du restaurant est désactivé                            | Corrigé ; formulaire et succès affichent un texte neutre                      |
| G   | P2 conditionnel | Un widget non publié sur Connect peut s'afficher, mais ses routes de réservation le refusent          | Corrigé en amont par `bookingEnabled` ; aucun restaurant affecté actuellement |
| H   | P2              | Le lien « Retour » d'un ancien widget UUID conservait l'UUID dans l'URL                               | Corrigé et couvert par test ; livraison en attente via le PR de suivi         |
| I   | P2              | Le bandeau de réservation test affirmait que les messages sont envoyés sans vérifier les options      | Corrigé et couvert par tests ; livraison en attente via le PR de suivi        |

## A — Origine API du client Connect et routage Nginx

`apps/connect/src/lib/api/gift-cards.ts:10` construit les appels navigateur avec `NEXT_PUBLIC_API_URL`, puis `/public/gift-cards/...`. Dans les environnements déployés, cette variable vaut le domaine principal (`https://sokar.tech`, ou son équivalent staging), également retrouvé dans les bundles contenant le client cadeau.

Preuve GET sans donnée privée :

| Route                                                        | Production | Staging |
| ------------------------------------------------------------ | ---------- | ------- |
| Domaine principal `/public/gift-cards/packs/chez-sokar-demo` | 404        | 404     |
| Domaine API `/public/gift-cards/packs/chez-sokar-demo`       | 200        | 200     |

Les blocs `/public/` de `infra/nginx/sokar.conf` et `sokar-staging.conf` concernent le vhost API ; le vhost principal retombe sur le dashboard. Le client transforme le refus de chargement des packs en tableau vide (`listGiftCardPacks`, ligne 116), ce qui affiche « Aucun pack disponible » au lieu d'une erreur réseau. Les autres opérations cadeaux utilisent la même base ; le paiement n'a pas été essayé. Le client Connect de réservation et les expériences partagent aussi cette origine : leur impact est à qualifier sur les surfaces Connect effectivement servies, contrairement au widget Dashboard qui utilise `/api/proxy` et a été qualifié après #575.

Correction #576 : routes Nginx limitées aux familles publiques utiles sur le domaine principal, origine navigateur inchangée, puis erreur de chargement distinguée d'une liste vide. La CSP reste sur `self` et Stripe ; aucun proxy API général n'a été ouvert.

## B — Page bénéficiaire absente du routage public

`apps/connect/src/components/gift-card-confirmation.tsx:82` lie vers `/gift-card/<code>` ; la page existe dans `apps/connect/src/app/gift-card/[code]/page.tsx`. Nginx n'a pas de route correspondante sur le domaine principal et envoie ce chemin au Dashboard.

Preuve avec le marqueur synthétique `audit-route-20261024`, sans code cadeau réel : domaine principal production `/gift-card/audit-route-20261024` = 404 ; serveur Connect staging direct sur le même chemin = 200 et rend sa page bénéficiaire. Le 200 prouve la présence de la page, pas l'existence d'une carte valide. Le routage de la page est donc incorrect indépendamment de la validité du code ; le chargement de son API est en outre affecté par A.

Correction #576 : `/gift-card/:code` est routée vers Connect avec les protections de cache et d'indexation attendues. La route répond 200 en staging et production ; une carte de recette a affiché son solde staging.

## C — Lien de cagnotte sans consommateur

`apps/connect/src/components/gift-card-crowdfunding-create.tsx:132` produit `window.location.href + '?crowdfund=' + code`. La page cadeau ne lit pas `crowdfund`, et `GiftCardCrowdfundingPage` n'est importé par aucune route ni composant consommateur. Ouvrir en staging `/widget/chez-sokar-demo/gift-card?crowdfund=audit-route-20261024` affiche « Choisissez le type de carte », pas une contribution ni une erreur de code invalide. Le marqueur est volontairement fictif ; aucun appel de création de cagnotte n'a été effectué.

Autre erreur du même générateur : si l'URL contient déjà `?embedded=1`, le lien ajoute un deuxième `?` au lieu de modifier les paramètres via `URL.searchParams`.

Correction #576 : la page de contribution est montée quand le lien contient `crowdfund`; le lien conserve les paramètres avec `URL`. Le formulaire et son objectif ont été vérifiés en staging. Aucun paiement Stripe n'a été soumis.

## D — Code cadeau perdu entre bénéficiaire et réservation

`apps/connect/src/components/gift-card-beneficiary.tsx:72` crée `/widget/<slug>?giftCardCode=<code>` et annonce que la réservation associe la carte sans débiter son solde. Mais Nginx sert ce widget depuis le Dashboard. Son composant `apps/dashboard/src/components/reservation/reservation-widget.tsx` ne lit pas `giftCardCode` et ne l'envoie pas dans `confirm` ; seule l'implémentation Connect le fait.

Impact : réservation possible, mais sans association de la carte promise dans la page bénéficiaire. Ce constat ne signifie pas que le solde est débité ou perdu : aucune transaction cadeau n'a été tentée.

Correction #576 : le lien bénéficiaire transmet le code au widget réellement servi ; la confirmation l'associe sans calcul client du débit. En staging, l'association a été confirmée, le solde est resté à 50 €, sans consommation ni appel Stripe.

## E — Cadeau cassé sur les anciennes URLs de widget par identifiant

Le widget sait résoudre `/widget/<uuid>` grâce au repli `/restaurants/<id>/public`. Son lien cadeau (`reservation-widget.tsx:340`) utilise cependant encore le paramètre brut de l'URL au lieu du slug résolu. La page cadeau Connect cherche exclusivement un slug.

Preuve staging sur le restaurant démo : résolution historique par identifiant = 200 ; `/widget/<même identifiant>/gift-card` sur Connect = 404. Aucun identifiant réel n'est publié ici.

Correction #576 : le CTA cadeau utilise le slug résolu. Le widget legacy ouvert par UUID charge le formulaire cadeau par son slug en staging. Le lien « Retour » restant sur la même page est corrigé séparément par le PR de suivi.

## F — Promesse SMS non conditionnelle

`reservation-widget.tsx:2034` affiche « Vous recevrez une confirmation par SMS après validation. » sans consulter la capacité SMS. L'option `smsConfirmEnabled` est désactivée sur la démo de production. L'écran de succès, lui, indique correctement que les notifications dépendent des options du restaurant.

Correction #576 : le formulaire et l'écran de succès utilisent un texte neutre indiquant que les notifications dépendent des options du restaurant. Le bandeau distinct du mode test a reçu le même ajustement dans le PR de suivi.

## G — Widget autonome dépendant de la publication Connect

La route `/public/widget/:slug` est volontairement accessible sans publication Connect (`restaurant.routes.ts:874`). Les disponibilités du Dashboard utilisent aussi la résolution publique historique. Mais les nouvelles confirmations, comme les widgets Connect/ChatGPT, appellent `/public/r/:slug/hold` et `confirm`, dont le service `getPublishedBySlug` exige slug, `publishedAt`, `agenticOptIn` et `connectPublished`.

Un établissement avec widget actif et Connect non publié peut donc charger le formulaire, puis être refusé au hold. Aucun restaurant avec slug dans les bases actuellement contrôlées n'est dans cet état : défaut conditionnel, pas une panne observée chez un client. La différence de contrat existait dans Connect ; #575 l'étend à la confirmation normale du Dashboard en réutilisant ces routes publiques.

Correction #576 : l'API expose `bookingEnabled` et le formulaire bloque en amont si la publication requise manque. Les routes internes et leur politique d'éligibilité restent inchangées.

## Autres écarts examinés

- Le widget ChatGPT ignorait `managementUrl`. #576 l'affiche désormais quand l'API fournit le lien.
- Connect exposait l'achat cadeau et le consentement WhatsApp en mode test. #576 masque ces actions et ne transmet pas de code cadeau dans ce mode.
- `/public/gift-cards/apply` est protégé par l'organisation, mais aucun appel anonyme correspondant n'existe dans les trois frontends examinés : pas de défaut utilisateur établi.
- La CSP cadeau n'était pas la cause des 404 : l'origine est restée `self`. Aucun élargissement CSP n'a été nécessaire.

L'audit initial était en lecture seule. Après demande de correction, #576 a livré les défauts A à G. La recette staging a ensuite révélé deux défauts résiduels : le lien « Retour » d'un widget legacy ouvert par UUID conservait cet UUID, et le bandeau mode test affirmait que les messages étaient envoyés même si les notifications étaient désactivées. Ces deux points sont corrigés dans le suivi en cours et couverts par tests ciblés.

## Livraison et qualification staging — 24 octobre 2026

Le PR #576 (`3619eb00`, fusionné dans `b8c09d85`) a passé CI, puis les déploiements staging (`40044092703`) et production (`40044514453`). Le contrôle de parcours staging (`40077442591`) est vert. Les trois routes publiques du domaine principal renvoient HTTP 200 sur staging et production : métadonnées widget, packs cadeau et page bénéficiaire. Les règles restent limitées aux routes publiques autorisées ; une route privée non listée répond 404 dans la vérification Nginx isolée.

Recette navigateur staging : la page bénéficiaire a affiché une carte de contrôle à 50 € ; le lien partagé a ouvert le formulaire de cagnotte avec objectif de 100 € ; le widget legacy par UUID a chargé le formulaire cadeau à partir du slug. Une réservation normale de contrôle a été confirmée le 27 octobre à 12 h pour deux personnes. La base confirme l'association du code cadeau, un solde inchangé de 50 €, zéro consommation et zéro appel Stripe. Le drapeau SMS de la démo était désactivé ; aucun SMS n'a été envoyé par cette réservation. La réservation et les deux cartes de recette ont ensuite été annulées.

Vérifications du suivi : 34 tests du widget Dashboard et 33 tests Connect ciblés passent, y compris les deux régressions nouvellement couvertes. Le paiement Stripe complet n'a pas été exécuté afin de ne pas créer d'achat ; l'association sans débit a bien été qualifiée.
