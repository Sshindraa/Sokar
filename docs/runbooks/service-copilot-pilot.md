# Pilote — Service Copilot retard et liste d’attente

Ce runbook couvre le smoke test métier en production, le retour arrière manuel du MVP et le
shadow mode. Il ne doit être exécuté que sur un restaurant de démonstration ou avec l’accord
explicite du responsable du restaurant.

## Règles de sécurité

- Utiliser des identités préfixées par `[TEST COPILOT]` et des coordonnées contrôlées.
- Ne jamais utiliser les coordonnées d’un client réel.
- Prévenir l’équipe avant le test et noter l’heure de début à la seconde près.
- Arrêter le test si T4 ou T12 est occupée, si une vraie réservation risque d’être déplacée, si
  l’analyse propose une autre personne, ou si un envoi client est sur le point d’être déclenché.
- Les brouillons restent en lecture seule. Aucun bouton d’envoi ne doit être utilisé.
- Après application, ne pas supprimer les traces d’audit. Nettoyer uniquement les données de test.

## Smoke test métier authentifié

Restaurant de smoke actuel : `Test Restaurant` (`test-resto-1`). Son numéro doit être confirmé
comme actif dans l’inventaire Telnyx avant chaque campagne de test.

### Préparation

1. Choisir un créneau de service futur où T4 et T12 sont libres pendant toute la durée du test.
2. Créer `Martin Test Copilot` pour 2 personnes, avec la source `service_copilot_smoke`, et
   l’affecter à T4.
3. Créer `Alice Test Copilot`, avec la même source, dans la liste d’attente du même créneau.
4. Vérifier avant l’appel : Martin est `CONFIRMED` sur T4, Alice est `PENDING`, T12 est libre.
5. Noter les identifiants de la réservation, de l’entrée de liste d’attente et des deux tables.

### Appel et application

1. Appeler le numéro du restaurant avec une ligne contrôlée.
2. Dire : « Bonjour, je suis Martin Test Copilot. J’ai une réservation le JJ mois à HH h MM et
   j’aurai 25 minutes de retard. » Confirmer le nom, la date et l’heure si l’agent le demande.
3. Dans Live service, vérifier que la bannière de retard apparaît au-dessus du plan et ouvre le bon
   dossier : Martin, T4, retard de 25 minutes.
4. Vérifier que l’analyse affiche explicitement : Martin T4 vers T12, puis Alice liste d’attente vers
   T4. Toute identité ou table différente impose l’arrêt du test.
5. Préparer les brouillons et vérifier la mention indiquant qu’aucun message n’est envoyé
   automatiquement.
6. Cocher la confirmation uniquement après avoir simulé l’acceptation d’Alice avec la ligne de test.
7. Cliquer une seule fois sur « Vérifier et appliquer » puis confirmer.
8. Vérifier le retour de succès, puis l’état final : Martin est sur T12 avec ses horaires décalés de
   25 minutes ; une réservation Alice est `CONFIRMED` sur T4 ; son entrée de liste est `PROMOTED`.
9. Rafraîchir la page. Les états restent identiques et aucune seconde réservation Alice n’existe.

### Preuves à conserver

Relever dans les journaux et la base, sur la fenêtre temporelle du test :

- un `reservation_delay_reported` lié à Martin et au véritable appel ;
- un `reservation_delay_recovered` lié à Martin, avec le même `correlationId` que le rapport ;
- un `waiting_list_promoted` lié à la nouvelle réservation Alice, motif `delay_recovery` ;
- exactement une réservation promue et un seul événement de récupération après rafraîchissement ;
- aucun HTTP 409 inattendu et aucune nouvelle erreur Sentry liée aux identifiants du test ;
- aucun job SMS, e-mail ou WhatsApp créé par `service_copilot_delay_recovery` et aucun envoi du
  fournisseur sur la fenêtre du test.

Un 409 est acceptable uniquement si un conflit réel a été provoqué volontairement. Dans ce cas,
aucune mutation partielle ne doit exister.

Un second clic ou une reprise réseau du même « Vérifier et appliquer » est attendu : Sokar renvoie
le premier résultat sans créer une seconde promotion. En revanche, si une même clé d’action revient
avec des données différentes (retard, table, groupe ou acceptation), le système répond 409 et le
responsable doit relancer l’analyse. Cette comparaison est aussi refaite une fois les ressources
verrouillées, pour couvrir deux requêtes simultanées.

## Retour arrière transactionnel

Après une application, « Annuler ce plan » restaure automatiquement le plan initial seulement si :

- la réservation retardée est encore confirmée sur la table et les horaires appliqués ;
- la réservation promue est encore confirmée, non installée et inchangée ;
- l’entrée est toujours `PROMOTED`, liée à cette réservation et non expirée ;
- les deux tables et leur plan sont actifs ;
- la table initiale ne présente aucun nouveau conflit.

L’opération verrouille les deux réservations, l’entrée et les deux tables. Elle remet la réservation
retardée sur sa table et ses horaires initiaux, annule la réservation promue, restaure l’entrée en
`PENDING` et écrit les audits `reservation_delay_recovery_reverted`, `reservation_cancelled` et
`waiting_list_restored`. Un second clic retourne le premier résultat sans nouvelle écriture.

Les communications humaines déjà effectuées ne sont jamais rappelées : le responsable doit prévenir
les deux clients.

## Historique persistant

La zone « Plans de retard » du Live service retrouve les opérations après un rafraîchissement ou une
reconnexion. Elle affiche les plans récents de la date de service dans trois états :

- `Appliqué` : les données correspondent encore au plan et le bouton « Annuler » est proposé ;
- `Annulé` : le retour arrière a déjà été exécuté et reste visible pour preuve ;
- `À vérifier` : le service a évolué, la raison est affichée et aucune annulation automatique n’est
  proposée.

Cet historique est reconstruit à partir des audits append-only et de l’état courant. Il n’autorise
jamais à contourner les contrôles : même depuis l’historique, l’annulation reverrouille et revalide
toutes les ressources avant toute écriture.

## Pouls du service

La bande placée au-dessus du plan synthétise la situation de service depuis le serveur, dans le
fuseau du restaurant : retards à traiter, arrivées à installer, tables en service, liste d’attente
et arrivées des 30 prochaines minutes. Les états sont volontairement simples : `urgent` lorsqu’un
retard confirmé reste à traiter, `à surveiller` lorsqu’une arrivée ou une attente demande une
décision, et `sous contrôle` sinon.

Le pouls ne déclenche aucune action, n’envoie aucun message et ne remplace pas le contrôle de
faisabilité. Pour une date passée ou future, il bascule en synthèse de planning afin de ne jamais
faire croire que les compteurs sont temps réel.

## Repli manuel

Cette procédure est réservée aux données de test ou à un incident validé par le responsable.

1. Suspendre toute nouvelle action sur les deux tables et noter l’état visible.
2. Contacter les deux clients avant toute correction si l’incident concerne de vraies personnes.
3. Annuler la réservation promue créée pour Alice. Ne pas supprimer son audit.
4. Si T4 est encore libre sur le nouvel horaire de Martin, réaffecter Martin de T12 vers T4 avec
   l’action transactionnelle d’affectation de table.
5. Si T4 n’est plus libre, conserver Martin sur T12 ou choisir une autre table seulement après
   validation explicite du responsable.
6. Remettre Alice en liste d’attente manuellement si le service le nécessite. Ne pas modifier
   directement la base sans procédure d’incident et sauvegarde.
7. Vérifier qu’aucune réservation ne se chevauche et consigner : opérateur, heure, raison, états
   avant/après et communications effectuées.

Utiliser ce repli uniquement si « Annuler ce plan » retourne 409 parce que le service a évolué. Ne
jamais forcer l’état en base : le refus protège une réservation déjà installée, expirée ou remplacée.

## Shadow mode

Pendant le shadow mode, le responsable décide d’abord ce qu’il ferait sans Sokar, puis révèle la
proposition du Copilot. Aucune proposition ne doit être appliquée automatiquement.

### Télémétrie discrète

La collecte ne modifie pas le Live service : aucun nouveau bandeau, bouton, compteur ou message
n’est ajouté pendant le rush. À l’affichage et à l’ouverture d’une recommandation, le navigateur
envoie seulement un événement silencieux. Les actions de récupération de retard enregistrent ensuite
côté serveur les états appliqué, annulé ou bloqué par conflit. Une recommandation non ouverte avant
son expiration devient `ignorée` ; une recommandation ouverte mais non appliquée devient `expirée`.

Les événements sont rattachés à une occurrence signée HMAC, cloisonnée par restaurant et dédoublonnée
par clé d’idempotence. L’identifiant de l’utilisateur est haché ; aucun contenu client, message ou
décision n’est envoyé à un tiers. Toute panne de télémétrie est sans effet sur l’action opérationnelle.
Consulter les résultats uniquement dans le futur espace qualité ou via le résumé API, jamais dans le
flux de décision du Live service.

Pour chaque situation, relever :

| Champ                     | Valeur attendue                                |
| ------------------------- | ---------------------------------------------- |
| Horodatage et service     | Date, déjeuner/dîner, niveau d’activité        |
| Décision sans Sokar       | Action choisie avant d’ouvrir la proposition   |
| Proposition Sokar         | Résumé exact des personnes, tables et horaires |
| Compris sans aide         | Oui/non, puis raison en cas de non             |
| Décision                  | Acceptée, modifiée ou refusée                  |
| Temps manuel              | Secondes jusqu’à la décision initiale          |
| Temps avec Sokar          | Secondes jusqu’à la décision finale            |
| Conflit 409               | Oui/non et cause réelle                        |
| Mauvaise proposition      | Oui/non, sévérité et explication               |
| Client en attente présent | Oui/non/vérifié par qui                        |

### Indicateurs hebdomadaires

- Compréhension autonome = propositions comprises / propositions observées.
- Taux d’acceptation = propositions acceptées sans modification / propositions applicables.
- Conflits = nombre de 409, séparés entre conflits légitimes et anomalies.
- Temps gagné médian = temps manuel moins temps avec Sokar.
- Taux de mauvaises propositions = propositions incorrectes ou dangereuses / propositions observées.
- Présence réelle = entrées vérifiées présentes / entrées proposées.

Seuil de poursuite conseillé après au moins 20 situations : aucune proposition dangereuse, au moins
80 % comprises sans aide, moins de 5 % de 409 anormaux et un temps médian gagné positif. Toute
proposition impliquant le mauvais client ou une table occupée suspend le pilote et déclenche un audit.

## Nettoyage du smoke test

1. Annuler les deux réservations de test par les voies applicatives normales.
2. Annuler ou laisser expirer l’entrée de liste d’attente de test selon son état ; ne jamais effacer
   les événements d’audit.
3. Vérifier que T4 et T12 n’ont plus d’occupation de test.
4. Consigner le résultat, les anomalies, les identifiants techniques et l’heure de fin dans le
   journal du projet.
