# Registre commercial et portes d’activation — phase 0

Date : 7 septembre 2026
Statut : **EN COURS — cadrage prêt, validations externes ouvertes**

Ce registre fixe ce qui peut être annoncé dès le premier lancement, qui porte la preuve, le prix affiché et la condition d’activation. Une fonctionnalité peut rester dans l’offre initiale tout en étant activée avec accompagnement ou sur une cohorte pilote. Aucune ligne ne constitue une garantie avant que la preuve indiquée soit signée.

## Responsabilités

| Domaine                                   | Responsable de réalisation | Décision ou dépendance externe                                      |
| ----------------------------------------- | -------------------------- | ------------------------------------------------------------------- |
| Produit, prix, GO/NO-GO et cohortes       | Hamza                      | Validation finale, contrats et restaurants pilotes                  |
| API, auth, isolation, Prisma, Billing     | Codex                      | Revue produit sur les changements de contrat                        |
| Dashboard, Connect et parcours navigateur | Codex                      | Validation UX et démonstration par Hamza                            |
| Voix, Telnyx, SMS et transfert humain     | Codex                      | Accès fournisseurs, appels réels et décision d’activation par Hamza |
| Infra, CI, sauvegardes et rollback        | Codex                      | Accès VPS, canaux d’alerte et exercice de restauration              |
| RGPD, CGV, DPA et SLA                     | Hamza + conseil juridique  | Identité légale, sous-traitants et texte contractuel signé          |
| Support des dix premiers restaurants      | Hamza                      | Canal, horaires et délai d’escalade à confirmer                     |

## Catalogue annoncé au lancement

| Module                                   | Prix public de référence                           | Porte d’activation                                         | Preuve attendue                                                                                      | État du worktree                                                                                                                                                                                                                                                                                             |
| ---------------------------------------- | -------------------------------------------------- | ---------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Essential                                | 149 € / mois ; annuel affiché avec remise          | Stripe mensuel et annuel, droits synchronisés              | Checkout, webhook signé, facture, annulation et période de grâce                                     | Prix annuel Stripe actif en live et test (1 430,40 €/an, 20 % de remise) ; Checkout annuel, facture, taxes, prorata et période de grâce restent à rejouer                                                                                                                                                    |
| Pro                                      | 249 € / mois ; annuel affiché avec remise          | Même porte que Essential                                   | Même cycle, avec droits Pro et reprise après retry                                                   | Prix annuel Stripe actif en live et test (2 390,40 €/an, 20 % de remise) ; Checkout annuel, facture, taxes, prorata et période de grâce restent à rejouer                                                                                                                                                    |
| Multi-site                               | 249 € / mois + 99 € / établissement supplémentaire | Compte, OWNER, quota payé et deux sites isolés             | Deux sites, membre limité, changement de site, facture `siteCount`, dépassement de quota et rollback | Staging : troisième site créé, quatrième refusé hors quota, suspension/réactivation validées, sélecteur isolé, portail sandbox 447 €/mois et rejeu webhook signé validés ; prix annuels actifs (2 390,40 €/an + 950,40 €/site supplémentaire) ; deux identités réelles et rejeu du transfert restent ouverts |
| Réservations ChatGPT / Claude            | Inclus dans la formule qui l’active                | Canal autorisé, consentement et limite de débit configurés | Réservation de bout en bout par canal, rejeu idempotent, refus inter-compte et transfert humain      | Parcours à rejouer et documenter                                                                                                                                                                                                                                                                             |
| Domaine personnalisé                     | Selon devis ou formule retenue                     | DNS vérifié, TLS actif, fallback Sokar disponible          | Domaine de test en HTTPS, renouvellement, suppression et erreur DNS                                  | Cloudflare SaaS et routes présentes ; preuve cohorte à rejouer                                                                                                                                                                                                                                               |
| Cartes cadeaux                           | Conditions et commission affichées au contrat      | Paiement, ledger et activation restaurant                  | Émission, utilisation partielle, expiration, remboursement et concurrence sans double débit          | Module présent ; cycle complet et rapprochement à signer                                                                                                                                                                                                                                                     |
| Prédictif avancé                         | Inclus seulement avec limites explicites           | Données minimales, confiance et fallback manuel            | Rapport tenu à part, explication de la sortie, aucune décision irréversible automatique              | À qualifier comme pilote manuel                                                                                                                                                                                                                                                                              |
| Politique « sans limite » / taux garanti | Aucun slogan hors texte contractuel                | Usage équitable ou SLA instrumenté                         | Seuils, exclusions, compensation, coût maximal et rapport mensuel                                    | Contrat et métriques à définir                                                                                                                                                                                                                                                                               |

## Dépendances à fermer

- [ ] Profil Telnyx, numéro émetteur, callbacks de livraison et procédure d’incident ;
- [ ] Projet Sentry, uptime extérieur, destinataires et test d’alerte ;
- [x] Billing Portal sandbox ouvert depuis le site secondaire et quatre prix annuels Stripe actifs en live et test ; [ ] TVA/HT-TTC et procédure d’annulation ;
- [ ] Identité légale, DPA, rétention audio/transcription et contact RGPD ;
- [ ] Comptes développeur et secrets de test ChatGPT/Claude ;
- [ ] Texte contractuel de la politique d’usage/SLA ;
- [ ] Canal support, horaires d’astreinte et délai cible.

## Cohorte initiale

Les noms, contacts, prix pilote, créneaux d’onboarding et ordre des vagues restent à renseigner par Hamza. Tant que les deux premiers restaurants pilotes ne sont pas nommés, la phase 0 reste ouverte et aucune activation commerciale autonome ne doit partir.

| Vague      | Restaurants   | Fenêtre d’observation                 | Critère de passage                            |
| ---------- | ------------- | ------------------------------------- | --------------------------------------------- |
| Dogfood    | À renseigner  | 5 jours ouvrés                        | Zéro P0, appels et réservation contrôlés      |
| Pilote 1–2 | À renseigner  | 7 jours minimum                       | Support le jour même, aucun incident critique |
| Vague 2    | 3 restaurants | 72 h avant la suite                   | Métriques stables, rollback disponible        |
| Vague 3    | 5 restaurants | Revue quotidienne la première semaine | Décision GO/NO-GO documentée                  |

## Règle de release

Chaque activation doit référencer le commit, les variables attendues, les migrations, les smoke tests, la sauvegarde et la commande de rollback. La projection Stripe multi-site et le modèle account/site restent additifs. La migration et le backfill sont validés sur staging (10/10 restaurants historiques), le rejeu webhook signé est validé (double réponse 200, signature invalide en 400), le troisième site est créé et le quatrième est refusé hors quota ; les quatre prix annuels Stripe sont actifs en live et test et le Checkout annuel sélectionne le bon prix et la cadence dans un test dédié ; la release `main@ba771559` est déployée en staging et en production avec smoke tests verts. Les preuves d'isolation réelle avec deux identités, de droits membre, de facture annuelle, taxes, prorata, période de grâce et de cohorte pilote restent nécessaires avant l'activation commerciale autonome.
