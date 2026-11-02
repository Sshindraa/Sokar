# Proposition : configuration des paiements dans Sokar

Statut : parcours réservé au mode test, qualifié en staging sur un compte fictif.
La PR #622 reste en brouillon ; aucune activation en production ni modification
des comptes existants. La qualification ne couvre pas encore tous les usages.

## Objectif et situation actuelle

Le responsable du restaurant se connecte à Sokar et renseigne les informations
nécessaires aux paiements dans un formulaire affiché dans Sokar, sans devoir se
connecter au Dashboard Stripe. Stripe reste le prestataire de paiement et peut
demander des justificatifs ou des contrôles d'identité.

Le tableau de bord utilise déjà `ConnectAccountOnboarding`. La création actuelle
utilise Accounts v2 avec `dashboard: full` et les responsabilités de frais et
de pertes attribuées à Stripe. Le formulaire intégré du compte existant a été observé en chargement en staging ;
sa cause n'est pas établie. Le parcours réussi ci-dessous utilise un nouveau
compte fictif et ne démontre pas que le problème du compte existant est résolu.

## Option à qualifier

Pour un nouveau compte seulement, étudier Accounts v2 avec `dashboard: none`,
`defaults.responsibilities.fees_collector: application` et
`losses_collector: application`. Stripe calcule `requirements_collector` à
partir de ces propriétés. Une session du composant peut être configurée avec
`disable_stripe_user_authentication` si Stripe l'autorise pour ce compte ;
son comportement réel reste à vérifier. La collecte d'informations passe par le
composant Stripe, pas par un formulaire bancaire développé par Sokar.

Ces paramètres attribuent à Sokar les frais Stripe des paiements directs et la
responsabilité des soldes négatifs. Sokar doit gérer la collecte des exigences
et leur évolution, le support, les litiges et les remboursements. Le modèle de
tarification, les réserves éventuelles et les obligations contractuelles et
opérationnelles doivent être vérifiés avec Stripe avant toute activation.
Certaines responsabilités ne peuvent pas être modifiées après création.

## Résultat du sondage sandbox

Le 30 octobre 2026, avec la clé Stripe de test de staging et sans données de
client, un essai Accounts v1 a été refusé par Stripe, qui demande Accounts v2.
La tentative Accounts v2 avec les paramètres ci-dessus a été refusée : pour une
plateforme française, Stripe demande une attestation d'acceptation des conditions
du compte lors de l'ajout de la configuration marchand. Aucun compte v2 n'a été
créé par cet essai et aucune session n'a pu être testée. L'attestation ne doit
pas être fournie sans une acceptation valable par la personne concernée ; faire
préciser par Stripe le parcours et les termes applicables, y compris en sandbox.

Un second essai, sans configuration marchand ni acceptation, a créé un compte
fictif vide en mode test. Stripe a refusé la session intégrée pour ce compte ; il
a ensuite été fermé. Un essai de création marchand avec une date et une adresse
IP fictives de test a été refusé : la plateforme française doit utiliser un
jeton de compte pour transmettre ces informations.

Ensuite, un jeton v2 portant une acceptation **fictive**, sans personne ni
entreprise réelle, a été créé en mode test avec la clé publique de test. Stripe
a accepté ce jeton lors de la création d'un compte marchand `dashboard: none`,
puis a créé une session `account_onboarding` avec
`disable_stripe_user_authentication: true`. Le compte fictif a été fermé après
le test. Aucun accord réel n'a été accepté. L'essai a été exécuté côté serveur :
il ne prouve pas encore le fonctionnement dans un navigateur ni l'absence de
connexion pendant le formulaire. Une requête CORS préalable à l'API de jetons a
été acceptée pour l'origine staging ; cela ne remplace pas un test navigateur.

Un autre essai a validé une création en deux étapes : compte vide, puis ajout de
la configuration marchand avec un jeton d'acceptation fictive, puis création
de la session. Le compte de test a été fermé. Ce découpage permet d'enregistrer
l'identifiant avant la configuration et de retrouver le même compte après une
interruption, sous réserve d'une mise en œuvre transactionnelle dans Sokar.

Le 30 octobre 2026, un test de la route Sokar avec PostgreSQL local et Stripe
test réels a créé le compte et la session puis repris le même compte ; le compte
fictif a été fermé. Il a révélé que le jeton v2 contient plusieurs caractères
`_`, ce qui a conduit à corriger sa validation. La création du jeton a aussi été
vérifiée depuis un navigateur sur l'origine staging. La première sonde du
composant Stripe effaçait par erreur un élément nécessaire à son fonctionnement :
son échec ne permettait pas de conclure sur Sokar. Après correction, le composant
s'affiche en français et le parcours fictif a été terminé sans connexion Stripe.
Avec les données de test recommandées par Stripe, les encaissements et les
versements ont été activés sur le compte fictif. Un paiement direct fictif de
10 € avec 0,50 € de commission, puis son remboursement complet avec remboursement
de la commission, ont réussi via l'API Stripe. Le compte a été fermé. Cet essai
ne testait pas encore l'achat de carte cadeau dans Sokar ni les notifications.

Le 2 novembre 2026, un essai distinct en staging a terminé la configuration
depuis Sokar, acheté une carte cadeau fictive de 25 € dans l’interface client,
puis annulé la carte via l’API Sokar et confirmé son remboursement Stripe. Le
compte fictif a été fermé et l’option de test désactivée. Lors d’essais
antérieurs, la réception des trois e-mails de vente et des e-mails de remboursement
a été confirmée. SMS et WhatsApp n’ont pas été qualifiés.

## Recueil de l'accord

Selon Stripe, le compte qui demande `card_payments` relève de l'accord complet
[Stripe Connected Account Agreement](https://stripe.com/connect-account/legal/full).
Le représentant du restaurant doit voir le bon contrat et y consentir
expressément. Stripe indique que le composant intégré peut recueillir cet accord,
mais l'essai ci-dessus montre que l'ajout de la configuration marchand v2 exige
une attestation avant de pouvoir utiliser cette session. L'option testée consiste
donc à recueillir préalablement cet accord dans Sokar et à le transmettre dans
un jeton v2 créé directement auprès de Stripe.

Pour un parcours de collecte propre à Sokar, Stripe indique que les plateformes
françaises doivent utiliser des [jetons de compte](https://docs.stripe.com/connect/account-tokens)
afin que les informations soient transmises directement par le navigateur à
Stripe. Le jeton ne doit indiquer l'acceptation qu'après une action explicite du
représentant autorisé. Vérifier le support exact d'Accounts v2 et de la version
Stripe utilisée par Sokar avant d'écrire cette intégration. Prévoir également la
[divulgation des acquéreurs](https://stripe.com/legal/acquirer-disclosure) et
l'information sur le traitement des données. Ne jamais inventer l'accord ni les
éléments de preuve d'une personne réelle.

## Mise en œuvre proposée après clarification

1. Garder cette option désactivée par défaut et limitée à un restaurant de test
   explicitement autorisé, avec contrôle serveur d'une clé Stripe de test. Ne
   pas la rendre disponible aux comptes existants ou en production.
2. Définir le parcours d'acceptation des conditions et les capacités requises
   avec Stripe. Créer un compte fictif isolé, sans compte bancaire ni données
   personnelles réelles, puis vérifier la session intégrée et son nettoyage.
3. Restreindre les sessions au propriétaire du bon restaurant, protéger les
   changements de coordonnées de versement par une authentification renforcée,
   ne pas journaliser secrets de session ni données d'identité, et afficher une
   erreur exploitable en cas de chargement ou de session expirée.
4. Tester dans un navigateur réel le parcours complet, les justificatifs, les
   erreurs et les reprises, en distinguant la panne actuelle de chargement des
   questions de connexion, cookies et politique de sécurité du navigateur.
   Vérifier les états des capacités, les versements, remboursements et litiges
   avec les moyens de test Stripe ; confirmer qu'aucune connexion au Dashboard
   Stripe n'est demandée dans les scénarios pris en charge.
5. Prévoir dans Sokar les informations et actions nécessaires lorsque le
   restaurant ne dispose pas d'un Dashboard Stripe, ainsi que la surveillance
   des exigences, du risque, des soldes et des échecs de versement.

## Protection de la session intégrée : points de mise en œuvre

Le prototype vérifie côté API une authentification Clerk récente (`strict`)
avant la création ou le renouvellement d’une session de compte géré, en plus
du rôle propriétaire et du contrôle du site. Le tableau de bord déclenche la
revérification Clerk lorsque nécessaire. Le composant test utilise
`disable_stripe_user_authentication: true` ; Stripe ne vérifie donc pas lui-même
la session du propriétaire.

Clerk propose `auth.has({ reverification: ... })` côté serveur et
`useReverification()` côté interface. Sa documentation précise que demander un
second facteur peut être ramené au premier si l’utilisateur n’en dispose pas :
ce comportement ne doit pas être présenté comme une authentification à deux
facteurs obligatoire. Le proxy conserve le défi reconnu par Clerk et le client
le transmet au mécanisme de revérification. Il reste à vérifier avec Clerk réel
que la requête retentée utilise un jeton de session actualisé. Référence :
[revérification Clerk](https://clerk.com/docs/guides/secure/reverification).

Le staging de démonstration utilise actuellement une identité injectée sans
session Clerk. Ce mode ne permet donc pas de qualifier la protection réelle. Les
tests devront couvrir un propriétaire authentifié avec Clerk réel, une session
ancienne, une revérification annulée ou échouée, le renouvellement de session,
un autre restaurant, et l’absence de facteur supplémentaire. Conserver un refus
par défaut hors démonstration et ne pas considérer le mode démo comme une preuve
pour la production.

## Comptes existants et décision de mise en service

Ne pas remplacer silencieusement un compte connecté ni supposer que son solde,
ses versements ou son historique suivent un nouvel identifiant. Toute migration
exige une procédure distincte, validée avec Stripe et le restaurant, avec
rapprochement des opérations, gestion des litiges et plan de retour arrière.
Le compte de démonstration actuel reste inchangé.

Avant une mise en service :

- Confirmer les conditions et tarifs Stripe applicables au compte de plateforme.
  Avec `fees_collector: application`, la commission Sokar de 5 % par défaut est
  un revenu brut : Stripe facture les frais à Sokar. Le coût réel dépend du
  contrat et des opérations ; aucun tarif ni marge nette n’est supposé ici.
- Définir qui surveille et traite les exigences Stripe, les échecs de versement,
  les litiges et les soldes négatifs, avec une procédure de reprise et d’alerte.
  L’affichage actuel expose les états d’encaissement et de versement, mais ne
  démontre pas une surveillance proactive ni la gestion complète des litiges.
- Protéger les changements de coordonnées bancaires par une authentification
  renforcée adaptée : la session de test désactive l’authentification Stripe et
  le seul contrôle de rôle propriétaire ne démontre pas cette protection.
- Qualifier les justificatifs, le changement de coordonnées, les refus et reprises,
  les litiges, les versements et les notifications nécessaires en staging. Le
  remboursement testé ci-dessus a été déclenché par API, pas par l’interface.
- Préparer explicitement le déploiement de la migration additive, la gestion des
  clés et du flag de production, un pilote limité, le suivi et le retour arrière.
  Le code actuel exige une clé de test et refuse volontairement les clés réelles.

L’utilisation réelle de ce modèle engage Sokar pour les frais et les soldes
négatifs ; l’essai sandbox ne valide ni le contrat ni les opérations en production.

Références : [configuration Accounts v2](https://docs.stripe.com/connect/accounts-v2/connected-account-configuration?locale=fr-FR),
[composant de configuration intégré](https://docs.stripe.com/connect/supported-embedded-components/account-onboarding),
[exemple Stripe Connect intégré](https://stripe.dev/blog/connect-embedded-components-streamline-onboarding).
