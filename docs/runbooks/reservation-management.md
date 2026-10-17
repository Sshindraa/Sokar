# Gestion Publique De Reservation

## Etat Local Au 17 Octobre 2026

Apercu interactif local : `http://localhost:3101/r/demo`. La meme vue affiche
une reservation explicitement fictive ; aucun appel API/base/fournisseur,
telephone desactive. Le retrait est simule en memoire et recharger reinitialise
la demonstration. Route refusee hors NODE_ENV=development (404 en production).

Parcours unique `/r#JETON` : consulter la reservation et retirer l'accord de
rappel WhatsApp, sans compte. La modification utilise le telephone public du restaurant. L’annulation autonome
est disponible sous un drapeau distinct, selon les conditions ci-dessous. Telephone : aucune
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

## Annulation autonome (drapeau desactive par defaut)

`RESERVATION_SELF_CANCELLATION_ENABLED=true` ajoute une offre d’annulation au
DTO public et le bouton « Annuler la reservation » dans « Modifier ou annuler ».
Le client voit les conditions puis confirme explicitement dans un dialogue.
La fermeture du dialogue et la lecture du lien ne modifient rien.

L’onboarding stocke actuellement `capacitySpecials.cancellationPolicy` en texte.
Les nouveaux snapshots de reservation figent les presets exacts 2/24/48 heures,
leur texte et la version (`source=onboarding-v1`). Les creations voix et agentic/
Connect les enregistrent. Le delai fixe historique de deux heures ne doit pas
servir a autoriser une annulation : anciens snapshots sans source fiable,
conditions absentes/libres, absence d’annulation gratuite, acomptes/garanties,
cartes cadeaux, experiences, evenements et distribution externe renvoient au
restaurant. Aucune condition actuelle n’est retroactive sur une ancienne resa.

Avant le delai : annulation gratuite. A la limite exacte ou apres : contact
restaurant ; aucune perception de frais ni remboursement automatique. Le texte
« gratuite jusqu’a » ne definit pas de montant ni une instruction de paiement.
Le parcours financier d’annulation tardive reste a definir avant activation.

Le POST `cancel` exige `confirmed=true` et un `confirmationToken` HMAC emis a la
lecture (10 minutes maximum, jamais au-dela du delai). Sous verrou PostgreSQL,
le serveur reverifie le porteur, le restaurant, l’etat, le creneau, les couverts,
les conditions et les liens financiers. Puis le writer canonique enregistre
CANCELLED pour state/status et un audit sans PII. La capacite derivee exclut la
reservation annulee et le cache de disponibilite est invalide. Le tableId reste
une trace historique. Les projections CRM/marketing sont rejouables.

Un replay d’annulation deja terminee ne fait pas de seconde mutation/audit.
Le carton affiche l’etat serveur, y compris apres rechargement ; le calendrier
n’est plus propose. Un evenement deja importe dans un calendrier personnel ne
peut pas etre supprime a distance. Apres une reponse perdue, le client relit
l’etat avant d’annoncer le resultat. Aucun nouveau SMS n’est envoye par ce flux.

## Modification autonome (drapeau distinct, desactive par defaut)

`RESERVATION_SELF_MODIFICATION_ENABLED=true` expose « Modifier la reservation »
dans le panneau existant. Choisir un nombre de personnes, puis une heure
**le meme jour**, verifier l’ancien et le nouveau choix, confirmer explicitement.
Aucun changement de date dans cette premiere version. Aucune modification ni
hold temporaire n’est cree pendant la consultation ou la fermeture du dialogue.

Le POST `modification_options` demande un nombre de personnes borne (1..50,
limite du restaurant appliquee). Les heures proviennent du moteur de disponibilite
existant, des horaires/fuseau, duree, delai minimum en ligne, tables physiques et
holds actifs. Seule la reservation porteuse est exclue des conflits ; cette lecture
ignore le cache public et ne peut pas y publier une disponibilite personnelle.
Une heure identique reste proposable pour un autre nombre de personnes.

Chaque choix porte une proposition HMAC de 10 minutes maximum, sans PII, liee
au porteur, aux details initiaux, aux reglages et au nouveau creneau/groupe.
Le POST `modify` exige `confirmed=true` et cette proposition. Le service de
modification existant verrouille la capacite du restaurant puis la reservation,
reverifie la proposition et les conditions, les horaires et la capacite reelle,
alloue une table compatible puis remplace les champs dans la meme transaction.
Une place prise entre-temps produit un conflit : l’ancienne reservation/table
reste intacte. L’audit `reservation_fields_changed` conserve un digest de la
proposition pour reconnaitre un replay ; jamais le lien, le token ou l’identite.

L’identifiant et le lien initial restent valables. Le statut et les conditions
figees sont conserves ; le cache de disponibilite est invalide. La synchronisation
Google Calendar du writer existant est conservee. Le carton est actualise apres
reponse serveur ; une reponse perdue declenche une relecture, jamais un second
envoi aveugle. Un evenement deja importe manuellement dans un calendrier
personnel n’est pas modifie a distance.

La modification respecte la limite gratuite de la reservation initiale et de la
cible. Paiement, garantie, carte cadeau, experience, evenement, distribution,
ancien snapshot non fiable, absence de table, politique financiere active au restaurant et validation manuelle renvoient au
restaurant. Il n’y a aucun nouveau SMS ni changement du parcours financier.
Desactiver le drapeau restaure le contact restaurant sans annuler les changements
confirmes. Qualification locale PostgreSQL :
`RESERVATION_MODIFICATION_INT_TESTS=1` (base loopback obligatoire) ; les memes
tests font partie de `AGENTIC_INT_TESTS=1` en CI.
