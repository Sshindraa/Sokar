# Audit des contrats des parcours publics — 24 octobre 2026

Base : production `ab1ca2f57` après correction de la confirmation normale (#575).
Périmètre : réservations Dashboard/Connect/ChatGPT, routage Nginx, cartes cadeaux et cagnottes, promesses de notification. Audit ciblé ; pas de garantie d'exhaustivité sur le monorepo.

Méthode : lecture croisée des composants réellement servis et des routes API, requêtes HTTP GET/HEAD en production et staging, lecture des seuls paramètres publics nécessaires et des comptes agrégés, inspection navigateur staging. Aucun achat, paiement, SMS, nouvelle réservation ni changement de configuration pendant cet audit. Aucun identifiant client ou code cadeau réel dans les preuves.

## Résultat

Six défauts établis, plus un défaut conditionnel sans restaurant actuellement concerné dans les deux environnements contrôlés. P1 = parcours bloqué ; P2 = lien, information ou association perdue.

| ID  | Priorité        | Défaut                                                                                                | État                                                                                   |
| --- | --------------- | ----------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| A   | P1              | Le client API Connect vise le domaine vitrine, où les routes publiques ne sont pas routées vers l'API | HTTP confirmé en production et staging                                                 |
| B   | P1              | La page bénéficiaire `/gift-card/:code` n'est pas routée vers Connect                                 | HTTP confirmé ; lien présent dans la confirmation                                      |
| C   | P1              | Le lien partagé de cagnotte n'ouvre pas le formulaire de contribution                                 | Code et navigateur staging                                                             |
| D   | P2              | Le code cadeau du lien bénéficiaire est perdu par le widget réellement servi                          | Contrat de navigation et payload vérifiés dans le code                                 |
| E   | P2              | Le bouton cadeau d'un widget ouvert par UUID construit une URL invalide                               | HTTP 404 reproduit en staging                                                          |
| F   | P2              | Le formulaire promet un SMS même quand l'envoi du restaurant est désactivé                            | Code et configuration de la démo production                                            |
| G   | P2 conditionnel | Un widget non publié sur Connect peut s'afficher, mais ses routes de réservation le refusent          | Code confirmé ; aucun cas actuel parmi les restaurants avec slug en production/staging |

## A — Origine API du client Connect et routage Nginx

`apps/connect/src/lib/api/gift-cards.ts:10` construit les appels navigateur avec `NEXT_PUBLIC_API_URL`, puis `/public/gift-cards/...`. Dans les environnements déployés, cette variable vaut le domaine principal (`https://sokar.tech`, ou son équivalent staging), également retrouvé dans les bundles contenant le client cadeau.

Preuve GET sans donnée privée :

| Route                                                        | Production | Staging |
| ------------------------------------------------------------ | ---------- | ------- |
| Domaine principal `/public/gift-cards/packs/chez-sokar-demo` | 404        | 404     |
| Domaine API `/public/gift-cards/packs/chez-sokar-demo`       | 200        | 200     |

Les blocs `/public/` de `infra/nginx/sokar.conf` et `sokar-staging.conf` concernent le vhost API ; le vhost principal retombe sur le dashboard. Le client transforme le refus de chargement des packs en tableau vide (`listGiftCardPacks`, ligne 116), ce qui affiche « Aucun pack disponible » au lieu d'une erreur réseau. Les autres opérations cadeaux utilisent la même base ; le paiement n'a pas été essayé. Le client Connect de réservation et les expériences partagent aussi cette origine : leur impact est à qualifier sur les surfaces Connect effectivement servies, contrairement au widget Dashboard qui utilise `/api/proxy` et a été qualifié après #575.

Correction : choisir un contrat d'origine cohérent (proxy public explicite ou origine API publique), puis vérifier la CSP et les routes publiques autorisées. Un simple remplacement par l'origine API exige de revoir la CSP cadeau actuellement limitée à `self` et Stripe pour `connect-src` ; ne pas ouvrir un proxy général sans contrôle. Ne pas masquer un échec API comme une liste vide.

## B — Page bénéficiaire absente du routage public

`apps/connect/src/components/gift-card-confirmation.tsx:82` lie vers `/gift-card/<code>` ; la page existe dans `apps/connect/src/app/gift-card/[code]/page.tsx`. Nginx n'a pas de route correspondante sur le domaine principal et envoie ce chemin au Dashboard.

Preuve avec le marqueur synthétique `audit-route-20261024`, sans code cadeau réel : domaine principal production `/gift-card/audit-route-20261024` = 404 ; serveur Connect staging direct sur le même chemin = 200 et rend sa page bénéficiaire. Le 200 prouve la présence de la page, pas l'existence d'une carte valide. Le routage de la page est donc incorrect indépendamment de la validité du code ; le chargement de son API est en outre affecté par A.

Correction : router `/gift-card/:code` vers Connect, avec les protections de cache et d'indexation adaptées, puis qualifier un code de test existant autorisé.

## C — Lien de cagnotte sans consommateur

`apps/connect/src/components/gift-card-crowdfunding-create.tsx:132` produit `window.location.href + '?crowdfund=' + code`. La page cadeau ne lit pas `crowdfund`, et `GiftCardCrowdfundingPage` n'est importé par aucune route ni composant consommateur. Ouvrir en staging `/widget/chez-sokar-demo/gift-card?crowdfund=audit-route-20261024` affiche « Choisissez le type de carte », pas une contribution ni une erreur de code invalide. Le marqueur est volontairement fictif ; aucun appel de création de cagnotte n'a été effectué.

Autre erreur du même générateur : si l'URL contient déjà `?embedded=1`, le lien ajoute un deuxième `?` au lieu de modifier les paramètres via `URL.searchParams`.

Correction : exposer et monter la page de contribution, traiter explicitement le code, construire le lien avec `URL`, puis qualifier création/partage/contribution en Stripe test.

## D — Code cadeau perdu entre bénéficiaire et réservation

`apps/connect/src/components/gift-card-beneficiary.tsx:72` crée `/widget/<slug>?giftCardCode=<code>` et annonce que la réservation associe la carte sans débiter son solde. Mais Nginx sert ce widget depuis le Dashboard. Son composant `apps/dashboard/src/components/reservation/reservation-widget.tsx` ne lit pas `giftCardCode` et ne l'envoie pas dans `confirm` ; seule l'implémentation Connect le fait.

Impact : réservation possible, mais sans association de la carte promise dans la page bénéficiaire. Ce constat ne signifie pas que le solde est débité ou perdu : aucune transaction cadeau n'a été tentée.

Correction : porter ce contrat sur le widget réellement servi et vérifier l'association retournée par l'API, sans débit automatique.

## E — Cadeau cassé sur les anciennes URLs de widget par identifiant

Le widget sait résoudre `/widget/<uuid>` grâce au repli `/restaurants/<id>/public`. Son lien cadeau (`reservation-widget.tsx:340`) utilise cependant encore le paramètre brut de l'URL au lieu du slug résolu. La page cadeau Connect cherche exclusivement un slug.

Preuve staging sur le restaurant démo : résolution historique par identifiant = 200 ; `/widget/<même identifiant>/gift-card` sur Connect = 404. Aucun identifiant réel n'est publié ici.

Correction : utiliser `restaurant.slug` pour le lien cadeau et son mémorisation, comme pour la confirmation publique corrigée dans #575 ; couvrir ce clic sur l'ancienne URL.

## F — Promesse SMS non conditionnelle

`reservation-widget.tsx:2034` affiche « Vous recevrez une confirmation par SMS après validation. » sans consulter la capacité SMS. L'option `smsConfirmEnabled` est désactivée sur la démo de production. L'écran de succès, lui, indique correctement que les notifications dépendent des options du restaurant.

Correction : texte conditionnel fondé sur une capacité publique explicite, ou texte neutre cohérent avant et après confirmation. Ne pas activer les SMS globalement pour rendre la phrase vraie.

## G — Widget autonome dépendant de la publication Connect

La route `/public/widget/:slug` est volontairement accessible sans publication Connect (`restaurant.routes.ts:874`). Les disponibilités du Dashboard utilisent aussi la résolution publique historique. Mais les nouvelles confirmations, comme les widgets Connect/ChatGPT, appellent `/public/r/:slug/hold` et `confirm`, dont le service `getPublishedBySlug` exige slug, `publishedAt`, `agenticOptIn` et `connectPublished`.

Un établissement avec widget actif et Connect non publié peut donc charger le formulaire, puis être refusé au hold. Aucun restaurant avec slug dans les bases actuellement contrôlées n'est dans cet état : défaut conditionnel, pas une panne observée chez un client. La différence de contrat existait dans Connect ; #575 l'étend à la confirmation normale du Dashboard en réutilisant ces routes publiques.

Correction : décider explicitement si le widget autonome exige la publication Connect. Si non, lui fournir un contrat public dédié sans lever les protections des routes internes ; sinon, bloquer son activation et son formulaire en amont avec un message adapté. La route de génération du lien test gère déjà le refus PAGE_NOT_PUBLISHED explicitement.

## Autres écarts à qualifier

- Le widget ChatGPT (`apps/widget/src/components/reservation-widget.tsx`) ignore `managementUrl` dans son DTO et son écran de confirmation. Le lien ne serait pas proposé même quand l'API l'autorise. Impact client production actuellement masqué par le drapeau de gestion désactivé ; pas classé comme panne active.
- L'implémentation Connect du mode test affiche encore l'entrée cadeau et son lien d'achat sans conserver le jeton test (`booking-widget.tsx:831`). Le widget Dashboard servi sur `/book` masque correctement ce lien. Risque sur une surface Connect directe ou un sous-domaine, à qualifier sans paiement ; pas confondu avec une panne du parcours principal déjà testé.
- `/public/gift-cards/apply` est protégé par l'organisation malgré son nom, mais aucun appel anonyme correspondant n'a été trouvé dans les trois frontends : pas classé comme bug utilisateur sur la seule base du nom.
- La CSP cadeau n'est pas la cause actuelle du refus API : l'origine configurée est bien `self`. Le défaut actuel est le routage 404 ; la CSP devient un point de contrôle si l'origine change.

## Ordre proposé

1. Corriger et qualifier le routage API cadeau, la page bénéficiaire et le lien de cagnotte.
2. Corriger l'association du code cadeau, les anciennes URLs UUID et le texte SMS.
3. Trancher le contrat widget autonome / Connect, puis qualifier les variantes Connect et ChatGPT.
4. Ajouter des tests qui traversent le reverse proxy et le composant réellement déployé : des mocks qui répondent à une URL attendue ne détectent pas une destination Nginx manquante.

L’audit initial était sans modification. Sur demande de Hamza, les corrections ci-dessous ont ensuite été implémentées.

## Corrections implémentées — en qualification

- A/B : règles Nginx limitées aux familles publiques `gift-cards`, `r`, `widget`, aux événements analytiques et au clic signé, plus `/gift-card/` vers Connect. Même origine, CSP et authentification API conservées ; limites spécifiques hold/confirm préservées. Contrôles de déploiement ajoutés sur le domaine principal.
- C : paramètre `crowdfund` consommé par la page cadeau, composant de contribution monté ; lien construit avec `URL.searchParams`, conservation des paramètres et retrait du mode iframe.
- D/E : code cadeau transmis à la confirmation normale sans montant de débit, ignoré en test ; lien cadeau utilisant le slug résolu de l’établissement.
- F : texte neutre avant confirmation ; échec de packs distingué d’une vraie liste vide.
- G : capacité publique additive `bookingEnabled` ; formulaire bloqué avant les coordonnées si la publication actuelle ne permet pas de réserver. Aucune publication automatique ni modification de l’éligibilité serveur.
- Variantes : lien de gestion sur le widget ChatGPT ; absence d’achat cadeau et de consentement WhatsApp dans le parcours test Connect.

Vérifications locales : TypeScript des quatre applications vert ; suites ciblées API/Dashboard/Connect/ChatGPT vertes ; suite Connect complète verte. Vérification réelle Nginx sur un port temporaire isolé : packs/widget/page bénéficiaire 200, famille publique non autorisée 404. Le processus temporaire a été arrêté. Qualification staging/production encore à compléter ; aucune transaction Stripe ou notification fournisseur n’a été déclenchée par ces vérifications.
