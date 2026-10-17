# Gestion Publique De Reservation

## Etat Local Au 17 Octobre 2026

Apercu interactif local : `http://localhost:3101/r/demo`. La meme vue affiche
une reservation explicitement fictive ; aucun appel API/base/fournisseur,
telephone desactive. Le retrait est simule en memoire et recharger reinitialise
la demonstration. Route refusee hors NODE_ENV=development (404 en production).

Parcours unique `/r#JETON` : consulter la reservation et retirer l'accord de
rappel WhatsApp, sans compte. Modifier/annuler utilise le telephone public du
restaurant, pas une mutation automatique de reservation. Telephone : aucune
nouvelle question WhatsApp, aucun rappel SMS supplementaire.

Le lot de qualification ajoute le lien au SMS de confirmation existant.
Le raccordement des confirmations web Dashboard/Connect reste dans le lot local
plus large : il n’est pas inclus dans cette livraison isolee. Le texte doit tenir dans un segment selon le compteur local ;
le nom est raccourci ou retire avant de sacrifier le lien. Un budget impossible
echoue avant envoi, sans produire un deuxieme SMS. Qualifier le SMS reel et les
eventuels ajouts de l'operateur avant activation.

Pas d'e-mail de reservation ajoute, ni de changement du template WhatsApp a
quatre variables : le lien n'est pas encore distribue par ces canaux. Les routes
de retrait historiques restent compatibles lorsque le nouveau parcours est off.

## Presentation Et Actions Pratiques

La page reprend la composition d'un carton de reservation : eventail de trois
cartes plus basses avec filet fin et surface unie, valeurs sans libelles visibles
redondants (les termes date/heure/couverts restent disponibles aux lecteurs
d'ecran), statut « Confirmee » discret et deux actions proches du carton.
« Ajouter au calendrier » exporte localement un `.ics` uniquement pour une
reservation confirmee ; « Itineraire » apparait si l'adresse est renseignee.
Les commandes calendrier/itineraire sont typographiques, sans cadre ni fond,
avec cibles de 44 px et soulignement renforce au survol.
« Modifier ou annuler », ferme par defaut, regroupe modification/contact et
preferences de rappel. Le retrait WhatsApp reste explicite dans son panneau.
La demonstration n'est signalee qu'en en-tete, et les actions distantes y
restent desactivees. Aucun texte d'envoi ne peut etre deduit du statut seul.

La reponse API est enrichie de facon additive avec `restaurantAddress`
(`formattedAddress`, nullable), `startsAt` (instant UTC) et `endsAt` (nullable).
L'export utilise ces instants sans conversion dans le fuseau du navigateur,
sans identite client ni jeton ; aucune duree n'est inventee si la fin est absente.
L'itineraire ouvre Google Maps sur action explicite, sans referent. L'apercu
fictif desactive l'itineraire et marque son export calendrier comme demonstration.
La page ne promet aucun envoi SMS/e-mail dont elle n'a pas la preuve.

## Securite Et Limites

- Jeton HMAC-SHA256, lie a la reservation, au restaurant, a sa creation et au
  telephone actuel. Aucun jeton brut ni nouvelle table en base.
- Expiration : le plus proche entre creation + 90 jours et reservation + 7 jours.
  Un changement de telephone ou une rotation de cle invalide les anciens liens.
  Un report ne prolonge pas un lien deja distribue.
- URL reproductible, egalement retournee par Connect sur une reponse rejouee.
  Conserver le SMS donne l'acces apres fermeture de la confirmation web.
- Le fragment n'est pas envoye lors de l'ouverture HTTP. Le navigateur le
  transmet uniquement dans le corps POST au proxy de meme origine, puis a l'API.
  Ne jamais journaliser ces corps, liens complets ou captures contenant un jeton.
- Page privee : Sentry desactive au chargement, pas de Clerk, pas d'indexation,
  referrer no-referrer et reponses API no-store. Les liens web utilisent une
  navigation document complete pour appliquer cette exclusion des le demarrage.
- Le lien est un acces porteur : toute personne le possedant voit date, heure,
  couverts, restaurant et peut retirer cet accord. Aucun nom, numero ou e-mail
  client retourne. Ne pas partager le lien ; ce n'est pas une authentification.
- Ouvrir/recharger ne retire rien. Le retrait est explicite, idempotent, ecrit
  avec controle optimiste tenant/reservation et ne touche pas aux autres accords.
  Aucun re-opt-in par ce lien. Un message deja en cours peut encore parvenir.

## Configuration Et Recette Avant Activation

1. Revoir le lot en preservant les hunks concurrents. Aucune migration Prisma.
2. Livrer ensemble page Dashboard, proxy, API et workers compatibles. Les
   configurations nginx versionnees dirigent exactement `/r` et
   `/api/reservation-management` vers Dashboard ; les routes historiques `/r/slug`
   restent sur Connect. Aucun serveur nginx distant modifie pendant ce travail.
3. Garder `RESERVATION_MANAGEMENT_ENABLED=false` initialement. Generer une cle
   aleatoire de 32 octets hexadecimaux dans le gestionnaire de secrets, uniquement
   `RESERVATION_MANAGEMENT_SECRET` (key_env). Meme cle pour API et workers ; ne pas
   la regenerer a chaque deploiement. Aucun secret reel configure ici.
4. Verifier `DASHBOARD_URL` HTTPS, routage, absence de cache/log de corps et
   `nginx -t` sur la cible avant rechargement. Les tests locaux de configuration
   ne remplacent pas cette validation du serveur.
5. En staging, reservation de test autorisee : creation et replay web, reception
   du seul SMS, lien sur telephone, rechargement, retrait, rechargement, absence
   de rappel/repli SMS, erreur reseau, lien altere/expire et correction telephone.
6. Le flag de gestion ne declenche pas WhatsApp. Les flags WhatsApp et collecte
   restent off jusqu'a qualification fournisseur et recette complete.

Retour arriere : couper le flag ferme les acces, sans supprimer la reservation
ni retablir un accord retire. Ne pas changer la cle pour un simple rollback
applicatif ; conserver API/proxy compatibles pour les liens deja distribues.

## Qualifier La Livraison SMS

Staging doit servir `/r` et le proxy avant de creer la reservation de test.
Garder le flag production off. L’expediteur `TELNYX_SMS_FROM` conserve
`SOKAR`, deja configure dans le profil ; ne pas remplacer le numero voix.
Configurer `TELNYX_SMS_WEBHOOK_URL` vers
`https://api-staging.sokar.tech/sms/telnyx/inbound` pour isoler le callback
du webhook production du profil partage. Aucun changement du profil Telnyx.

Le claim `success` et `CONFIRMATION_SMS_SENT` signifient acceptation fournisseur,
pas livraison sur le telephone. La route signee distingue `message.sent` de
`message.finalized` avec statut `delivered`. Pour verifier le meme identifiant
fournisseur en lecture seule, utiliser `scripts/ops/reservation-sms-receipt.mjs`
avec `SOKAR_RECEIPT_MESSAGE_ID` et `TELNYX_API_KEY` charges depuis l’environnement.
Le probe expose le statut, le nombre de parties si connu et les codes d’erreur,
jamais le contenu, le lien ou les numeros. Ne jamais renvoyer un SMS sur la seule
absence d’accuse. Un statut `delivery_failed` ne libere pas le claim d’envoi.
La preuve finale ajoute la reception rapportee par la personne, puis l’ouverture
du carton, l’import calendrier et l’itineraire sur son telephone.
