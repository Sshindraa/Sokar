# Audit Critique Notifications Du 17 Octobre 2026

## Verdict

Ne pas activer WhatsApp ou presenter le parcours confirmation SMS + rappel
WhatsApp comme qualifie en production. Les tests verts couvrent des comportements
locaux simules ; ils ne prouvent ni la couverture de tous les parcours de
reservation ni la livraison reelle. Les points ci-dessous restent ouverts.

Perimetre : travaux WhatsApp/SMS de cette conversation, leurs appels et leurs
interfaces web. Les modifications concurrentes billing, confidentialite,
e-mail/alerting et workflows ne sont pas approuvees par cet audit. `git diff`
montre 57 fichiers suivis modifies au moment du controle, auxquels s'ajoutent
les fichiers non suivis. Ce n'est pas un lot livrable en bloc.

Aucun correctif applicatif, envoi fournisseur, modification de compte,
commit, push ou deploiement pendant cette revue. Seul ce rapport et la memoire
projet sont ajoutes/actualises.

## Constats

### A1 - P1 : Acquittement SMS Sans Recu Classe Succes

Source : `apps/api/src/shared/telnyx/client.ts:134`, puis
`apps/api/src/shared/queue/workers/outbound-confirm.worker.ts:152`.

`normalizeTelnyxSendResponse({})` retourne `outcome=success`, sans identifiant
fournisseur. Le worker peut donc conserver un claim reussi et ecrire l'audit
confirmation_sms_sent alors qu'aucun recu exploitable n'a ete obtenu.
Le comportement precede mes dernieres corrections SMS : je ne l'ai pas corrige
pendant le durcissement des diagnostics. L'adaptateur Meta est plus conservateur.

Reproduction executee avec la fonction reelle :
`{"outcome":"success","provider":"telnyx","channel":"sms"}`.

Suite : un recu absent/malforme doit rester incertain ; tester la frontiere
adaptateur-worker, sans audit de succes ni nouvel appel automatique.

### A2 - P1 : Rappel WhatsApp Dans Le Fuseau Du Serveur

Source : `apps/api/src/shared/queue/workers/confirmation-sms.worker.ts:59`,
`:153`, `:240` et `:255`.

Le scan construit demain dans le fuseau du processus. Le formatage de la date
et de l'heure ne transmet pas le fuseau du restaurant, et la requete n'inclut
pas ce champ. Avec un serveur UTC, un rendez-vous parisien de 19 h peut etre
annonce a 17 h. Les bornes du jour peuvent aussi inclure/exclure le mauvais
creneau. Ce mecanisme est herite, mais mon adaptation WhatsApp le conserve.

Reproduction executee avec TZ=UTC et l'instant 2026-10-18T17:00:00Z :
formatage actuel 17:00 ; formatage Europe/Paris 19:00.

Suite : bornes et affichage dans le fuseau restaurant ; tests UTC, hiver/ete,
minuit et changement d'heure. Le correctif SMS immediat ne corrige pas ce worker.

### A3 - P1 : Le Scan Peut Envoyer Des Donnees Obsoletes

Source : `apps/api/src/shared/queue/workers/confirmation-sms.worker.ts:266`.

La relecture ajoutee ne recupere que statut, etat, date de notification et
consentements. Le telephone, l'horaire, les couverts et le canal restent ceux du
premier scan. Si un operateur corrige une reservation pendant que le scan traite
les precedentes, le rappel peut partir vers l'ancien numero ou annoncer l'ancien
horaire ; un passage hors WEB peut aussi ne pas etre vu.

Suite : relecture complete et revalidation de l'eligibilite temporelle juste
avant envoi ; test avec modification entre findMany et findUnique. Les controles
ne doivent pas faire croire a une atomicite absolue entre base et fournisseur.

### A4 - P1 : Confirmation SMS Non Uniforme Entre Parcours

Sources : `apps/api/src/modules/reservations/reservation.service.ts:468`,
`apps/api/src/modules/agentic-reservations/core/reservation.service.ts:615`,
`apps/api/src/modules/connect/connect.routes.ts:808`.

La creation historique enfile client-confirm quand le reglage SMS le permet.
Le parcours Connect hold/confirm appelle le service agentic, qui constate
explicitement notification=not_sent ; aucun enfilement equivalent n'a ete trouve
sur ce chemin. La collecte WhatsApp ne remplit pas ce manque preexistant.
La politique annoncee confirmation SMS pour les reservations web n'est donc
pas implementee uniformement dans le code examine.

Suite : definir puis qualifier une emission idempotente commune, distinguant
creation confirmee, validation manuelle et replay. Ne pas ajouter un POST SMS
direct dans la route pour masquer l'absence de traitement durable.

### A5 - P2 : Un Envoi SMS Peut Couter Plusieurs Segments

Sources : `apps/api/src/shared/queue/workers/outbound-confirm.worker.ts:143`,
`apps/api/src/modules/usage/messaging-usage.service.ts:55`.

Le nom du restaurant est injecte sans budget de longueur ou d'encodage.
Une apostrophe typographique suffit a basculer le texte en Unicode. Le compteur
de segments existe et comptabilise cet effet, mais aucune limite ne le previent.
Ce risque est herite ; mes corrections recentes ne garantissent pas un segment.

Reproduction avec le compteur reel : le texte fictif ci-dessous a 97 caracteres
et compte pour deux segments :

`Reservation confirmee - Chez l'Exemple 18/10/2026 19:00 2pers. Annulation: appelez le restaurant.`

Dans la reproduction, l'apostrophe entre l et Exemple est U+2019, pas U+0027
utilise pour rendre la ligne ASCII ci-dessus. Aucun numero client utilise.

Suite : definir un budget de segments, normaliser seulement le texte approprie,
prevoir un texte plus court et tester les noms longs/non GSM. Ne pas promettre
un tarif par reservation sur la seule base du nombre d'appels API.

### A6 - P2 : Retrait Autonome Perdu Apres Fermeture Ou Reponse Perdue

Sources : `apps/api/src/modules/connect/connect.routes.ts:868`,
`apps/connect/src/components/booking/confirmation-view.tsx:35` et `:82`.

Le jeton de retrait n'est retourne que pour une creation non reutilisee et
reste dans la memoire de la page. Apres fermeture, ou si la premiere reponse
HTTP est perdue puis rejouee avec reused=true, le client ne dispose plus du
bouton de retrait alors que son accord est conserve. Le contact restaurant
reste possible, mais ce n'est pas un parcours autonome durable. Limite de ma
premiere implementation, deja documentee, a traiter avant ouverture large.

Suite : gestion de reservation durable, securisee et recuperable, sans stocker
le jeton brut en clair ni exposer de donnees personnelles en URL.

### A7 - P2 : Echec De Livraison Meta Sans Suivi Operationnel

Sources : `apps/api/src/shared/whatsapp/meta-status.ts:33`,
`apps/api/src/shared/queue/workers/reconciliation.worker.ts:254`.

Les callbacks conservent un rang Redis ; ils ne mettent pas a jour un statut de
livraison par reservation et n'ouvrent pas d'alerte pour un echec apres acceptation.
La reconciliation ignore les claims deja success. Un message accepte puis echoue
peut donc rester considere envoye, sans signalement operationnel exploitable.
Pas de doublon observe par ce mecanisme, mais pas de suivi complet de livraison.
Le timeout sans identifiant Meta reste manuel, sans correlation opaque d'essai.

Suite : dissocier acceptation et livraison, definir le traitement des echecs
et l'examen manuel, sans renvoi ni secours SMS automatique. Fonctionnalite manquante
de mon lot, pas une integration de livraison terminee.

## Verification Executee Pendant Cette Revue

- API : 4135 tests passes, 58 ignores (382 fichiers passes, 6 ignores).
- Connect : 22 tests booking-widget/confirmation-view passes.
- Dashboard : 24 tests du widget passes.
- TypeScript : API, Connect et Dashboard verifies.
- `git diff --check` : propre.
- Reproductions locales : decalage UTC/Paris, compteur deux segments, recu SMS
  vide classe success. Aucune requete fournisseur ou base pendant ces reproductions.
- Pas de nouveau build de production ou Playwright reel pendant cette revue.
  Les parcours navigateur anterieurs etaient simules, pas des receptions SMS/WhatsApp.
- Pas de nouvelle lecture des comptes fournisseurs : utiliser les dates des
  releves precedents, pas les presenter comme un statut live.

Les tests existants ne couvrent pas suffisamment le fuseau propre au restaurant,
les modifications pendant le scan, la perte de la reponse portant le jeton,
le cout en segments et la couverture de notification Connect/agentic.

## Ordre De Suite

1. Corriger A1-A4 et ajouter les tests de regression correspondants.
2. Traiter le budget SMS A5, puis le retrait durable A6 et la supervision A7.
3. Isoler le lot et les fichiers non suivis ; revoir chaque hunk partage. Exclure
   les travaux concurrents billing/privacy/email/CI, sans les restaurer ou supprimer.
4. Fournisseurs : capacite SMS/rattachement Telnyx a confirmer, verification
   Facebook bloquee, compte/application/secrets Meta non qualifies, template et
   facturation a recontroler. Aucun rattachement aveugle du numero voix.
5. Staging seulement apres revue du lot et circuit CI, drapeaux d'envoi off au
   depart ; protection des logs proxy pour la query de verification Meta.
6. Recette avec destinataire de test autorise : confirmation web et telephone,
   rappel WEB avec accord, retrait, absence d'accord, doublon, timeout, callbacks.
   Ne rejouer aucun ancien job et ne tester sur aucun client historique.
7. Production uniquement apres recette et bilan explicite, avec retour arriere.

Decision : aucun feu vert de publication a l'issue de cet audit.

## Correctifs Locaux Apres Audit (17/10)

Les constats ci-dessus decrivent l'instant de revue, avant correction.

| Point | Etat actuel local                     | Verification / reserve                                                                                                                                                                                                                                                                                                    |
| ----- | ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A1    | Corrige                               | Recu Telnyx absent ou blanc = unknown, sans audit de succes ni nouvel envoi. Meta rejette aussi un ID blanc.                                                                                                                                                                                                              |
| A2    | Corrige                               | Scan UTC borne a 72 h puis comparaison au lendemain local de chaque restaurant ; affichage avec son fuseau. Tests UTC/Los Angeles, hiver/ete, minuit et DST.                                                                                                                                                              |
| A3    | Corrige                               | Relecture complete avant envoi (telephone, creneau, couverts, canal, accord, restaurant). Retrait telephone, changement de jour/canal/accord ignores. Pas de promesse d'atomicite entre Postgres et le fournisseur.                                                                                                       |
| A4    | Corrige pour WEB/Connect              | Intention outbox dans la transaction de creation confirmee ou validation PENDING vers CONFIRMED ; consommation via le meme job SMS deterministe et les claims existants. Reglage SMS respecte. PHONE et MCP gardent leur contrat existant.                                                                                |
| A5    | Corrige pour le texte de confirmation | Budget d'un segment selon le compteur local, normalisation ponctuation, texte court et nom raccourci si necessaire. Tarif et eventuels ajouts fournisseur restent a qualifier reellement.                                                                                                                                 |
| A6    | Corrige localement, off               | Page unique Ma reservation, lien signe dans le SMS existant et les confirmations web ; reproductible au replay, retrait explicite apres rechargement. Aucune migration. Cle dediee non configuree et routage nginx local a qualifier sur cible. Voir `../runbooks/reservation-management.md`.                             |
| A7    | Revue manuelle ajoutee                | Un callback failed non depasse par delivered/read enfile une revue deterministe avec le recu technique, sans destinataire/contenu, sans liberer le claim d'acceptation ni renvoi SMS/WhatsApp. Panne de cette queue = 503 pour rejeu Meta. Pas de nouveau tableau de bord de livraison ; timeout sans ID toujours manuel. |

Verification apres correctifs : 4169 tests API passes / 58 ignores, TypeScript
API et lint cibles verts, diff-check propre. Tests workers executes aussi sous
TZ=UTC et TZ=America/Los_Angeles. Fournisseurs et base simules dans les tests.
Le nouveau topic outbox exige des workers compatibles avant de deployer les
producteurs ; aucun deploiement partiel ou rejeu d'anciens jobs.

Les revues d'echec utilisent la conservation de la dead-letter existante, pas
le TTL 7 jours du cache de recus ; inspecter l'etat fournisseur le plus recent
avant toute decision manuelle, car une livraison peut suivre un echec.

Manifest de livraison : `2026-10-17-notifications-delivery-manifest.md`.
Activation toujours bloquee par la recette du parcours durable et les qualifications externes.

Correction de securite complementaire : le `childLoggerFactory` de main.ts
ignorait les options du logger enfant ; le `logLevel: silent` de la route Meta
ne suffisait donc pas a proteger la query contenant le verify token. Les options
sont maintenant propagees a Pino et un test injecte dans buildApp verifie leur
prise en compte. Les logs du proxy restent a qualifier avant configuration Meta.
Le test de cette regression fait partie du total indique ci-dessus.
Les tentatives sans recu n'ecrivent pas non plus de consommation acceptee dans
le ledger ; leur cout reel reste a rapprocher lors de la revue manuelle.

Compatibilite de release : le consommateur outbox relit la reservation scopee
au restaurant, verifie son eligibilite, puis produit le format historique complet
du job SMS pour rester lisible par les anciens workers. Les donnees client ne
sont pas stockees dans l'evenement Postgres ; le job SMS garde son contrat prive
existant. Le worker actuel relit toujours la reservation a son tour.

Verification apres A6 : 4181 tests API passes / 58 ignores, 37 tests Dashboard
cibles et 23 tests Connect passes. Trois parcours Playwright simules
desktop/iPhone/iPad : ouverture, rechargement sans retrait, retrait explicite,
puis rechargement avec accord retire ; captures inspectees. TypeScript des trois
applications, lint cible et diff-check verts. Tests de replay Connect, proxy
sans cookies/auth, routage nginx exact et SMS unique d'un segment ajoutes.
Pas de validation `nginx -t` locale (binaire absent), de nouvelle compilation de
production, ni de livraison reelle SMS/WhatsApp. La cle de gestion et les flags
ne sont pas configures/actives ; aucune publication ou mutation distante.
