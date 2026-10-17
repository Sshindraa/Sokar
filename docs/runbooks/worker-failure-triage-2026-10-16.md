# Triage des echecs workers du 16 octobre 2026

Lecture seule, premier releve a 19:15 Europe/Paris. Aucun envoi SMS, rejeu,
suppression, rattachement fournisseur ou changement de configuration effectue.
Aucun identifiant client, numero, payload de job ni contenu de message exporte.

## Environnements Distincts

| Environnement | File             | Echecs conserves | Nouveaux sur 24 h | Nouveaux sur 1 h | Dernier echec constate  |
| ------------- | ---------------- | ---------------: | ----------------: | ---------------: | ----------------------- |
| Production    | call-recovery    |               10 |                 1 |                0 | 16 octobre, 12:17 Paris |
| Production    | confirmation-sms |                5 |                 0 |                0 | 2 octobre               |
| Production    | sms-client       |               11 |                 0 |                0 | 2 octobre               |
| Staging       | call-recovery    |                1 |                 0 |                0 | 14 octobre              |
| Staging       | evening-report   |              270 |                 0 |                0 | 22 septembre            |

Production : 26 entrees en dead-letter. Staging : une entree en dead-letter.
Ces entrees peuvent recopier des echecs des files d'origine : ne pas additionner
les compteurs comme autant d'incidents distincts sans rapprochement.

Le Redis **local**, distinct de la production, conserve les compteurs de l'ecran
initial : outbox-dispatcher 1021 echecs, evening-report 713 echecs, dead-letter
2080 entrees en attente. Ne pas transposer ces chiffres a la production.

Les fenetres recentes utilisent les scores des ensembles BullMQ `failed` et
les dates de fin des jobs, avec lecture bornee des 50 derniers echecs par file.
Elles ne prouvent pas qu'un service fonctionne : une file sans activite peut
n'enregistrer aucun nouvel echec meme si sa configuration reste invalide.

## Causes Et Limites

- Staging evening-report : les 50 echecs recents echantillonnes indiquent une
  absence de configuration e-mail. Ils sont anterieurs a la cle staging et a #463.
  Les nouveaux tests d'envoi sont acceptes ; aucun ancien rapport n'a ete rejoue.
- Staging call-recovery : l'unique echec conserve indique une cle Telnyx absente
  a la date de l'echec. Ce constat historique ne decrit pas la configuration actuelle.
- Production confirmation-sms : cinq refus explicites du fournisseur, sans code
  detaille conserve dans le motif du job. Cause exacte non attribuee.
- Production call-recovery et sms-client : 21 motifs sont la chaine `null`.
  Les traces pointent vers le SDK Telnyx ; les enregistrements BullMQ seuls ne
  permettent pas de reconstituer les codes des 21 echecs.
- Les logs workers actuellement disponibles contiennent cinq lignes d'erreur
  call-recovery avec HTTP 400, type `TelnyxInvalidRequestError`, code **40305**.
  Cela ne permet pas d'attribuer le meme code a tous les echecs historiques.

Le SDK Telnyx installe construit ces erreurs depuis `responseBody.errors`, mais
son message depend de `raw.message`, souvent absent. Une amelioration future du
diagnostic doit conserver uniquement type/statut/codes techniques, sans copier
les details fournisseur susceptibles de contenir numeros ou contenu de SMS.

## Configuration SMS Constatee En Lecture Seule

- L'expediteur configure a un format E.164 valide et correspond a l'unique numero
  trouve dans le compte Telnyx. Le numero est actif.
- Aucun `messaging_profile_id` n'est rattache au numero selon les lectures
  d'inventaire et de configuration messaging.
- Un profil de messagerie existe dans le compte et est actif.
- `TELNYX_MESSAGING_PROFILE_ID` n'est pas configure dans l'API production.
- La capacite SMS effective du numero n'a pas pu etre etablie par ces reponses.

Telnyx documente le code 40305 comme un expediteur invalide, notamment lorsqu'il
n'est pas associe au profil de messagerie actif :
[documentation fournisseur](https://support.telnyx.com/en/articles/6505121-telnyx-messaging-error-codes).
L'absence de rattachement constitue une piste concrete, pas une preuve que ce
numero peut etre active pour les SMS dans son pays et sa categorie.

## Suite Sure

### Releve SMS Du 17/10 : Lecture Seule

Nouvelles lectures GET Telnyx depuis l'environnement production :

- L'expediteur correspond exactement a un seul numero de l'inventaire ;
  statut `active`, type `local`, connexion voix presente.
- GET configuration messaging HTTP 200 : aucun profil rattache, type `longcode`,
  `features.sms=null` et `features.mms=null`. Ces champs ne suffisent pas a
  confirmer la possibilite d'activer l'envoi SMS : ne pas les traduire en
  garantie de support, ni en preuve definitive d'incompatibilite.
- Un profil messaging trouve, actif ; `TELNYX_MESSAGING_PROFILE_ID` toujours
  absent de l'environnement API production controle.
- Aucun PATCH, rattachement, achat, changement d'expediteur, envoi ou rejeu.
  Numero et secrets restent sur le serveur, seules les metadonnees techniques
  ci-dessus sont conservees dans ce compte rendu.

Question a faire confirmer au fournisseur avant mutation : le numero voix
existant prend-il en charge les SMS transactionnels sortants vers la France ?
Si oui, quelles sont les exigences et la procedure de rattachement messaging
sans modifier la connexion voix ? Si non, quelle option d'expediteur SMS
distinct peut etre qualifiee sans remplacer le numero d'appels ?

### Diagnostic SMS Local Du 17/10

`sendSms` remonte maintenant une erreur generique `TelnyxSmsSendError` avec
statut HTTP et codes techniques a cinq chiffres (par exemple `40305`), au lieu
du message SDK parfois `null`. L'objet reconstruit n'embarque ni corps brut,
headers, details, message fournisseur ou cause originale. La classification
existante refusal/unknown est preservee : pas de retry HTTP ajoute et les
resultats reseau ambigus restent bloques pour reconciliation. Voix et WhatsApp
ne sont pas modifies. Ce diagnostic reste local et ne corrige pas le compte.

### Confirmation Client : Correction Locale Du 17/10

Le worker `outbound-confirm.worker.ts` relit maintenant le telephone, le creneau
(`startsAt`, sinon `reservedAt`), les couverts et les reglages actuels du restaurant.
Le payload historique du job reste compatible, mais ne fournit plus le destinataire
ou le contenu du SMS. Date et heure sont rendues dans le fuseau du restaurant,
independamment du fuseau du serveur. Une reservation passee, sans telephone ou
dont les confirmations SMS ont ete desactivees est ignoree sans nouveau claim.
Les gardes de statut confirme, audit existant et claim anti-doublon restent actives.

Verification : 16 tests du worker passent (6 nouveaux cas), suite API 4122 tests
passes / 58 ignores, TypeScript et lint cibles verts. Aucun envoi reel ni replay.
Ce correctif n'est pas deploye et ne resout pas le refus expediteur Telnyx 40305.

### Qualification Fournisseur

1. Confirmer la capacite SMS et les exigences du numero dans le compte fournisseur.
2. Si eligible, rattacher le numero au profil adapte sans changer le numero
   global ni la configuration des appels. Aucune mutation realisee pendant ce triage.
3. Qualifier avec un destinataire de test explicitement autorise, pas un ancien client.
4. Ne rejouer un ancien SMS qu'apres verification de sa pertinence, du consentement,
   de l'absence d'envoi deja accepte et de l'idempotence.
5. Traiter le stock local separement ; ne jamais purger la dead-letter pour obtenir
   artificiellement un tableau vert. Distinguer historique et echecs recents dans le suivi.

Les lectures utilisees sont SCAN/ZCARD/ZCOUNT/ZREVRANGE/LLEN/HMGET/HGET sur Redis,
des metadonnees de logs filtrees et les inventaires GET Telnyx. Aucun worker ou
constructeur BullMQ susceptible d'inscrire des schedulers n'a ete lance pour l'audit.
