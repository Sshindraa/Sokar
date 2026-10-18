# Regulation Resend et alertes systeme

## Portee

Le transport e-mail partage coordonne les envois et les lectures fournisseur entre
API et workers via Redis. Les appels externes a ce transport ne sont pas couverts.
Cette protection n'augmente pas les quotas Resend et ne corrige aucun job historique.

- Admission atomique, horloge Redis, espacement de 150 ms entre deux departs.
- Attente maximale de 5 secondes ; refus certain avant appel fournisseur si
  saturation ou indisponibilite Redis. Aucun envoi tardif apres ce refus.
- Aucun rejeu automatique apres un timeout fournisseur ambigu.
- Les jobs persistants gardent leurs reprises existantes. Un appel direct peut
  rester en echec : aucune nouvelle file de reprise n'est ajoutee.

Le worker `system-health` groupe les alertes eligibles du tick dans un e-mail.
Rappels e-mail toutes les deux heures par `(kind, identifier, severity)`, avec une
entree distincte pour une autre file ou une escalade critique. Une reapparition de
la meme combinaison pendant le cooldown reste soumise a celui-ci ; aucun suivi de
resolution n'est ajoute. Logs/Sentry, webhook et SMS gardent leur cadence de
30 minutes, independamment du resultat e-mail. Un refus e-mail ne valide pas le
rappel de deux heures : verrou court de 60 secondes, reevaluation au tick suivant.
Les autres emetteurs d'alertes conservent leur cadence actuelle.

## Configuration

Sans configuration supplementaire, la coordination utilise `redisCache` du process.
Des environnements partageant la meme equipe Resend doivent utiliser **la meme URL
Redis et la meme base logique** via `RESEND_RATE_LIMIT_REDIS_URL` dans chaque API
et worker. Ne pas utiliser une cle API comme identifiant de limite : plusieurs
cles peuvent partager la limite d'une equipe.

Les deux workflows transmettent ce secret optionnel au script
`scripts/ops/sync-alerting-config.sh`. L'absence de valeur conserve l'existant.
Une valeur fournie doit utiliser `redis:` ou `rediss:`, une base explicite, sans
espace, fragment, query ni caractere dangereux dotenv. Encoder les caracteres
reserves des identifiants. Les fichiers runtime restent en 0600, hors Git ; aucune
valeur n'est affichee par le script.

Le workflow staging n'est pas lie a un environnement GitHub. Le secret commun est
donc configure au niveau du depot. Un secret homonyme d'environnement production
ne doit pas le remplacer par une valeur differente.

## Qualification Et Livraison

Constat du 16 octobre 2026 : coordination configuree dans les deux `.env` API et le
secret de depot, sur la base cache 1 du Redis existant. Aucune base session/file ni
cle metier modifiee. Test isole sur le serveur avec deux clients utilisant les deux
configurations : 30 admissions, espacement minimum de 150 ms, cle temporaire retiree.
Les API staging et production repondaient HTTP 200 apres cette preparation.

Sur autorisation specifique, une cle staging distincte a ete creee avec permission
**Sending access**, uniquement pour `sokar.tech`. Secret de depot
`RESEND_API_KEY_STAGING` et `.env` staging configures ; cle production et liste des
destinataires de staging inchangees. La copie locale de transfert a ete supprimee.
Un message technique sans donnee client vers l'adresse de test fournisseur
`delivered@resend.dev` a ete accepte, avec une cle d'idempotence fixe pour ce test.
Ce test SDK qualifie la cle et l'expediteur, pas encore le nouveau code deploye.
Voir les [adresses de test Resend](https://resend.com/docs/dashboard/emails/send-test-emails).

Avant activation : CI verte, livraison staging et smoke tests verts, controle des
artefacts API/worker et de leur coordination, puis promotion production avec
snapshot de release, controles de sante et retour arriere application disponible.
Ne jamais livrer les autres modifications locales de facturation, confidentialite
ou mentions legales avec ce lot.

Retour arriere applicatif : suivre `docs/runbooks/rollback.md`, sans restauration DB
(aucune migration ici). Les entrees de coordination etaient absentes avant la
preparation : leur retrait doit viser seulement la nouvelle variable et le secret
homonyme, apres verification qu'ils n'ont pas ete modifies depuis. Ne pas restaurer
un `.env` complet. La cle staging est independante et ne doit pas entrainer la
revocation ou la modification de la cle production.
