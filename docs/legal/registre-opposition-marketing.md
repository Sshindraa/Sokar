# Registre d'opposition marketing : analyse juridique

> **Analyse préparatoire produite par une IA, le 3 novembre 2026. Ce n'est pas un avis d'avocat.**
> À faire valider par un professionnel du droit avant toute publication ou signature.

Les renvois [S1], [S2]… pointent vers les sources en fin de note. Les faits sur le code renvoient aux
fichiers du dépôt.

## 1. Conclusions

| Question                 | Recommandation                                                                                                                                                                                                                           |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. Base légale           | **Intérêt légitime du restaurant** (art. 6(1)(f)). Écarter le consentement, le contrat et l'obligation légale. Aucune source ne tranche ce point précis : c'est une position d'analyse, à faire confirmer.                               |
| 2. Rôles                 | **Restaurant responsable de traitement, Sokar sous-traitant**, à une condition : le restaurant doit adopter ces règles par une instruction écrite. Aujourd'hui, aucun contrat signé n'est dans le dépôt, et c'est Sokar qui a tout fixé. |
| 3. Empreinte HMAC        | **Donnée personnelle, oui. Pseudonymisée, oui**, avec deux faiblesses : une seule clé pour tous les restaurants, et une clé sur le même serveur que la base. La formulation publique a été corrigée.                                     |
| 4. Trois ans             | **Recommandation de la CNIL, pas une obligation légale.** On peut l'écrire ainsi. Aucun texte de loi ne fixe cette durée.                                                                                                                |
| 5. Accord et information | Sept clauses à ajouter à l'accord de traitement (§6). Mentions ajoutées à la politique. Page de désinscription à compléter (texte proposé au §6).                                                                                        |
| 6. Autres problèmes      | Le plus sérieux : **une déclaration du restaurant lève l'opposition**, sans geste de la personne (§7, point 1). Il faut changer le code ou l'assumer.                                                                                    |

### Décisions qui restent à Hamza

1. Accepter ou non la base légale et les rôles ci-dessus, puis les faire valider par un avocat.
2. Écrire et signer l'accord de traitement avec les restaurants (rien de signé dans le dépôt).
3. Choisir si le restaurant peut lever seul une opposition (§7, point 1).
4. Choisir une clé par restaurant **avant le premier vrai envoi** (§4). Après, les entrées déjà effacées ne
   pourront plus être converties.
5. Fixer le sort du registre quand un restaurant quitte Sokar (§3).
6. Décider d'une nouvelle version de politique et de la notification promise par e-mail (§7, points 4 et 5).
7. Compléter l'identité du responsable, déjà signalée comme manquante (§7, point 8).

## 2. Base légale

**Ce que dit le droit.** Une personne peut retirer son consentement à tout moment (art. 7(3)) [S1]. Elle peut
s'opposer à la prospection à tout moment, sans motif et sans mise en balance [S3][S5]. Ses données ne servent
alors plus à la prospection (art. 21(3)) [S2]. La prospection par e-mail ou SMS exige un accord préalable, et
chaque message doit permettre d'en demander l'arrêt (art. L.34-5 CPCE, alinéas 1 et 5) [S6].

La CNIL recommande une liste repoussoir pour tenir compte de l'opposition dans la durée, sans usage pour une
autre fin [S3]. **Elle ne dit pas quelle base légale s'applique à cette liste** [S3].

| Base                  | Avis    | Raison                                                                                                                                                                                                                                                     |
| --------------------- | ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Consentement (a)      | Écartée | La personne vient de refuser. Un retrait ferait disparaître la protection qu'elle demande.                                                                                                                                                                 |
| Contrat (b)           | Écartée | Rien dans le contrat de réservation n'exige cette liste. La personne n'a pas de contrat avec Sokar.                                                                                                                                                        |
| Obligation légale (c) | Écartée | Tentante, mais fragile. Le fondement doit être défini par le droit (art. 6(3)) [S1]. Or la loi oblige à respecter l'opposition, pas à garder une liste après effacement, ni pendant trois ans. Les référentiels de la CNIL ne sont pas contraignants [S4]. |
| Intérêt légitime (f)  | Retenue | L'intérêt est clair : respecter durablement le choix de la personne et pouvoir le démontrer. Le traitement est réduit et la protège.                                                                                                                       |

**Limite du raisonnement.** Le référentiel CNIL cite l'obligation légale et l'intérêt légitime comme bases
possibles pour l'archivage de preuves [S7]. Il ne traite pas de la liste d'opposition. Un autre juriste
pourrait donc défendre la base (c). L'avocat doit trancher.

**Le test à documenter.** L'intérêt légitime suppose trois conditions, à évaluer et documenter : un intérêt
légitime, la nécessité, et l'absence de droits de la personne qui l'emportent [S5]. Ce test reste à écrire,
au nom du restaurant.

**La nécessité est le point faible.** Sokar n'envoie que sur accord préalable : une fiche recréée après
effacement est déjà exclue sans le registre. Le registre apporte une protection réelle mais plus étroite : il
bloque une autre fiche à la même adresse, ou un ancien accord SMS (`LEGACY_CUSTOMER_CONSENT`), et il évite de
reproposer l'inscription dans l'e-mail de confirmation (`marketing-consent.service.ts`). Cela reste
défendable. Il faut l'écrire tel quel dans le test, sans le présenter comme indispensable.

### Articulation avec les autres textes

- **Article 21(2) et (3).** Le registre ne sert pas à prospecter, il sert à ne plus prospecter. Il ne viole donc
  pas l'arrêt demandé. Aucune source ne le dit en ces termes : position d'analyse.
- **Article 21(1).** La base (f) ouvre un droit d'opposition au registre lui-même, pour des raisons tenant à la
  situation de la personne. Le responsable doit alors démontrer des motifs impérieux [S2][S5]. Ce droit doit
  être signalé clairement et séparément (art. 21(4)) [S2]. C'est fait dans le nouveau texte public.
- **Article 17.** L'exception « obligation légale » (17(3)(b)) n'est pas disponible avec la base (f). Celle
  sur les droits en justice (17(3)(e)) ne devrait pas être invoquée par principe, hors litige réel ou sérieux
  (lecture prudente, à confirmer).
  Le vrai raisonnement : la donnée reste nécessaire à sa finalité, donc le motif de 17(1)(a) ne joue pas. Si la
  personne s'oppose au titre de 21(1), 17(1)(c) peut s'appliquer sauf motif impérieux [S2][S5]. **En pratique :**
  à une demande d'effacement de l'empreinte, expliquer qu'elle protège la personne, et l'effacer si la personne
  insiste en connaissance de cause. Refuser sèchement serait difficile à défendre.
- **Le code respecte cela sur un point important.** L'effacement n'inscrit au registre que les personnes qui se
  sont déjà opposées ou plaintes (`erasure.service.ts`). Une simple demande d'effacement ne crée pas d'entrée.
- **Article L.34-5.** Sokar n'utilise pas l'exception client de l'alinéa 4 (décision du 27/10). La décision
  n° 2026-1210 QPC du 25 juin 2026 censure les alinéas 6, 8 et 9 sur le cumul des sanctions, avec effet différé
  au 31 octobre 2027 [S6][S8]. Elle ne touche ni l'accord préalable, ni l'obligation de permettre l'arrêt. L'amende
  de l'alinéa 8 va jusqu'à 75 000 € pour une personne physique [S6].

## 3. Rôles

**Ce qui est écrit dans le dépôt :**

- `PRIVACY_DOCUMENT.roles` : pour la réservation et la clientèle, le restaurant fixe les finalités et Sokar agit
  sur ses instructions.
- `privacy-client-annex.md` : même position, mais l'annexe n'est qu'un projet non validé.
- `marketing-email-pilot.md`, décision 8 du 27/10 : clause « Sokar sous-traitant » dans les CGV, relecture à faire.
- `2026-09-07-phase-0-commercial-register.md` : RGPD, CGV et accord de traitement restent à faire avec un conseil.

**Aucun CGU, CGV ou accord de traitement signé n'a été trouvé dans le dépôt.** La page dashboard cite pourtant
« Exécution du contrat (CGU) », et `/legal` ne les contient pas.

**Le problème.** La durée et le type de données sont des « moyens essentiels », réservés au responsable [S9, §40].
Or c'est Sokar qui a tout fixé : données, trois ans, survie à l'effacement, levée. Le commentaire du code dit
`confirmed by the restaurant owner` : c'est une décision de Hamza pour Sokar, pas celle d'un restaurant. Un
sous-traitant qui décide lui-même des finalités et des moyens est traité comme un responsable (art. 28(10)) [S10].

**La solution.** Un service standard, accepté tel quel par le client, n'empêche pas d'être sous-traitant, si le
prestataire n'en tire aucune finalité propre et suit les instructions [S9, exemple du stockage en nuage]. Il faut
donc que le restaurant adopte ces règles par écrit, et que Sokar ne se serve du registre pour rien d'autre.

**Conséquences concrètes :**

- Le restaurant : informe les personnes, répond à leurs demandes, documente le test d'intérêt légitime, tient son
  registre des traitements (art. 30(1)) [S10].
- Sokar : suit les instructions, aide à répondre (art. 28(3)(e)), tient son registre de sous-traitant (art. 30(2)),
  supprime ou restitue en fin de contrat (art. 28(3)(g)) [S10].
- Une demande reçue à `privacy@sokar.tech` doit être transmise au restaurant.
- **Fin de contrat :** la suppression d'un restaurant supprime ses entrées (`onDelete: Cascade`). Les empreintes
  seules ne servent à rien sans la clé : le restaurant qui part perd sa liste d'opposition. À expliquer dans
  l'accord, et à arbitrer (décision 5).

## 4. Empreinte HMAC

**Donnée personnelle : oui.** La CNIL dit que les données hachées restent personnelles [S3]. Sokar détient la clé et
les adresses : il peut retrouver l'entrée d'une adresse connue, et le fait à chaque contrôle
(`loadOptedOutCustomerIds`). L'arrêt C-413/23 P admet qu'une donnée pseudonymisée peut ne pas être personnelle
pour un tiers sans moyen d'identifier [S11]. Cela n'aide pas ici, ni pour Sokar, ni pour le responsable. L'arrêt
porte d'ailleurs sur le règlement 2018/1725, pas sur le RGPD.

**Pseudonymisée : oui, sous conditions.** Il faut des informations supplémentaires conservées à part et protégées
(art. 4(5)) [S12]. Le projet de lignes directrices du CEPD cite les HMAC comme techniques adaptées, et dit que la
clé doit être gardée séparément [S13, §86, §89, §107]. C'est une **version de consultation** ; la version finale n'a
pas été vérifiée.

**Faiblesses à corriger (changement de code, non fait) :**

1. **Une seule clé pour tous les restaurants.** Le calcul porte sur `canal:adresse`, sans le restaurant. La même
   adresse donne donc la même empreinte chez deux restaurants : Sokar peut voir qu'il s'agit de la même personne chez
   deux responsables différents. Le CEPD souligne l'importance de bien délimiter le périmètre [S13]. **Recommandation :**
   inclure le restaurant dans le calcul avant le premier envoi réel. Plus tard, les entrées déjà effacées ne seraient
   plus convertibles, faute d'adresse.
2. **Clé sur le même serveur que la base** (`apps/api/.env`). La sauvegarde de base (`pg_dump`, `scripts/ops/db-backup.sh`)
   n'embarque pas la clé. La séparation est donc logique, pas physique. Acceptable au démarrage, à documenter. La
   configuration réelle du serveur n'a pas été vérifiée.
3. **Adresses et numéros devinables.** Si la clé fuit, on peut tester tous les numéros. La clé est donc l'élément
   critique, et elle doit aussi être sauvegardée (`environment.md`).

**Formulation publique.** « Pseudonymisée » est exact. « Pas rattachée à votre fiche » était trompeur : il n'y a pas de
lien en base, mais l'empreinte est recalculée et comparée à la fiche. Nouveau texte : « n'est pas enregistrée dans votre
fiche client », plus la comparaison avant envoi. La mention « pas d'une donnée anonyme » évite toute confusion. L'article 11
ne peut pas servir à refuser un droit, puisque Sokar peut identifier l'entrée à partir de l'adresse [S1].

## 5. Trois ans

- **Fondement réel :** recommandation de la CNIL, « au minimum 3 ans » [S3][S4], et décision de Hamza du 23/10/2026.
- **Valeur :** non contraignant, mais tout écart doit être justifié [S4]. Aucun texte de loi trouvé ne fixe cette durée.
- **Limite générale :** ne pas garder plus longtemps que nécessaire (art. 5(1)(e)) [S1]. Trois ans exactement respecte le
  minimum recommandé.
- **On peut écrire :** « durée minimale recommandée par la CNIL ».
- **On ne peut pas écrire :** « la loi impose », « obligation légale de trois ans ».

**Faits corrigés dans le texte public.** Le délai court depuis la **dernière** opposition, car une nouvelle opposition le
relance (`registerMarketingOptOut`). L'entrée disparaît plus tôt si l'opposition est levée ou si le restaurant est
supprimé. La purge tourne toutes les cinq minutes, indépendamment du verrou d'envoi (`schedulers.ts`), mais son activité
en production n'a pas été vérifiée, et un échec ne produit qu'un avertissement. Les sauvegardes suivent leur propre cycle,
déjà signalé dans la politique.

## 6. Accord de traitement et information des personnes

**À ajouter à l'accord (art. 28(3)) [S10] :**

1. **Instruction du restaurant** : tenir le registre, avec ces données, cette finalité unique et cette durée de trois ans.
2. **Interdiction** d'utiliser le registre pour une autre fin ou un autre restaurant.
3. **Survie à l'effacement** : le restaurant demande que l'empreinte subsiste, et il sait pourquoi.
4. **Levée** : qui peut lever une opposition, et avec quelle preuve (décision 3).
5. **Demandes des personnes** : transmission par Sokar, délai, réponse par le restaurant.
6. **Fin de contrat** : suppression, avec information sur la perte de la liste (décision 5).
7. **Sécurité** : clé séparée de la base, accès limités, sauvegarde de la clé.

Le contrat doit aussi prévoir l'attestation de consentement déjà décidée pour les listes importées.

**Information des personnes (art. 13 et 14) [S2] :**

| Élément                            | État                                                              |
| ---------------------------------- | ----------------------------------------------------------------- |
| Identité du responsable            | Restaurant : à fournir par lui. Sokar : incomplet (§7, point 8)   |
| Finalité et base légale            | Ajoutées                                                          |
| Intérêt légitime (13(1)(d))        | Ajouté                                                            |
| Durée (13(2)(a))                   | Ajoutée                                                           |
| Droits, dont opposition (21(4))    | Ajoutés                                                           |
| Source pour une plainte (14(2)(f)) | Ajoutée : prestataire d'envoi                                     |
| Moment de l'information            | **Manquant** : la page de désinscription ne parle pas du registre |

La case de consentement du widget renvoie bien vers `/privacy` (`reservation-widget.tsx`). Les pages de désinscription
ne disent rien de la conservation (`marketing-unsubscribe.page.ts`). Elles sont dans le code applicatif : non modifiées.

**Texte proposé** pour la page de confirmation :

> Pour ne plus vous solliciter, nous conservons pour ce restaurant une empreinte de votre adresse ou de votre numéro
> pendant trois ans. [En savoir plus](/privacy)

## 7. Autres problèmes trouvés

**Non corrigés (code ou décision) :**

1. **Le restaurant peut lever seul une opposition.** Un accord saisi par l'équipe (`recordStaffMarketingConsent`) ou par
   `PUT /crm/customers/:id/marketing-permissions/:channel` efface l'entrée (`clearMarketingOptOut`). Le texte d'origine disait
   « de votre part » : c'était inexact. De même, n'importe qui peut cocher la case en réservant avec l'adresse d'un autre,
   puisqu'il n'y a pas de double confirmation. Le responsable doit pouvoir démontrer le consentement (art. 7(1)) [S1].
   **Recommandation :** seule une action de la personne, avec adresse vérifiée, lève l'opposition. Le nouveau texte décrit
   la réalité d'aujourd'hui ; il doit changer si le code change.
2. **Le droit d'accès ne couvre pas le registre.** L'export RGPD n'inclut pas `marketing_opt_outs` (`export.service.ts`).
   L'article 11 n'excuse pas ce manque (§4). À traiter à la main d'ici là, puis à ajouter au code.
3. **Champ `source` libre.** La route `PUT` accepte 80 caractères libres, recopiés dans le registre. Une donnée personnelle
   pourrait y entrer alors que le registre vise le minimum (art. 5(1)(c)) [S1]. À limiter à une liste fermée.
4. **Version de politique figée.** `CURRENT_PRIVACY_POLICY_VERSION` reste `v1.1-2026-10-16`, alors que le texte change. Les
   nouveaux consentements citeraient une version qui ne décrit pas le registre. À changer à la publication (décision 6).
5. **Promesse de la section 7 du dashboard.** Elle annonce qu'une modification substantielle sera notifiée par e-mail. Aucun
   mécanisme n'a été vérifié. Tenir la promesse ou la reformuler (décision 6).
6. **Aucune ligne « prospection » dans la politique.** Les durées du fichier marketing et de la preuve, appliquées depuis le
   28/10 selon le runbook, ne figurent pas dans la politique (art. 13(2)(a)) [S2]. La décision « preuve : 5 ans après le
   retrait » semble aussi en tension avec la suppression de la preuve lors de l'effacement. À clarifier.
7. **Plainte reçue après effacement.** Rien n'est inscrit (limite acceptée le 03/11). Le texte public décrit le cas général ;
   la limite figure dans l'annexe.
8. **Identité du responsable.** Absente de la politique, alors que l'article 13(1)(a) la demande [S2]. Déjà connu. Les champs
   API `dataController: Sokar` et `dpo` peuvent tromper : pour les réservations, le responsable est le restaurant, et aucun DPO
   n'est prouvé (`privacy-local-review.md`). Ces champs publics ne peuvent pas être renommés ; une note additive est possible.

**Corrigés dans cette PR (texte seulement) :**

- Dashboard : le droit d'opposition ne parlait que de la « situation particulière ». Or il est sans condition pour la
  prospection [S3][S5].
- API : le texte de `GET /api/rgpd/privacy-policy` ne citait pas le registre, et disait seulement « selon les conditions légales »
  pour l'opposition.

## 8. Ce que l'avocat doit valider

1. Le choix de la base (f) plutôt que (c) pour une liste d'opposition.
2. La qualification de sous-traitant, vu le service standard conçu par Sokar.
3. La réponse à donner à une demande d'effacement de l'empreinte.
4. Le nouveau texte public et le texte proposé pour la page de désinscription.
5. Les clauses du §6, et l'attestation pour les listes importées.

## 9. Non vérifié

- **Autorité sur la base légale d'une liste repoussoir :** aucune décision ni position de la CNIL ou du CEPD trouvée.
- **EUR-Lex :** la page du RGPD est revenue vide. Le texte a été lu sur la reproduction de la CNIL [S1][S2][S10][S12]. Le
  considérant 26 n'a pas été lu directement.
- **Version finale** des lignes directrices 01/2025 du CEPD.
- **Texte intégral** de l'arrêt C-413/23 P : seul le communiqué a été lu.
- **WhatsApp :** application de L.34-5 non vérifiée. Le canal reste fermé.
- **Démarchage téléphonique** (code de la consommation) : non examiné, hors périmètre du registre.
- **Production :** clé, purge et contenu du registre non vérifiés. Le serveur n'a pas été consulté.

## 10. Sources consultées le 3 novembre 2026

- **[S1]** RGPD, chapitre II, art. 5, 6, 7, 11 (CNIL) : <https://www.cnil.fr/fr/reglement-europeen-protection-donnees/chapitre2>
- **[S2]** RGPD, chapitre III, art. 13, 14, 17, 21 (CNIL) : <https://www.cnil.fr/fr/reglement-europeen-protection-donnees/chapitre3>
- **[S3]** CNIL, liste repoussoir, page du 10 juin 2026 : <https://www.cnil.fr/fr/comment-utiliser-une-liste-repoussoir-pour-respecter-lopposition-la-prospection>
- **[S4]** CNIL, questions-réponses sur les référentiels : <https://www.cnil.fr/fr/questions-reponses-sur-les-referentiels-relatifs-la-gestion-des-activites-commerciales-et-des>
- **[S5]** CEPD, lignes directrices 1/2024 sur l'intérêt légitime, version 1.0, §6, §76-77, §122 : <https://www.edpb.europa.eu/system/files/2024-10/edpb_guidelines_202401_legitimateinterest_en.pdf>
- **[S6]** Art. L.34-5 CPCE (Légifrance) : <https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000042155961>
- **[S7]** CNIL, référentiel gestion des activités commerciales : <https://www.cnil.fr/sites/cnil/files/atoms/files/referentiel_traitements-donnees-caractere-personnel_gestion-activites-commerciales.pdf>
- **[S8]** Conseil constitutionnel, décision n° 2026-1210 QPC : <https://www.conseil-constitutionnel.fr/decision/2026/20261210QPC.htm>
- **[S9]** CEPD, lignes directrices 07/2020, responsable et sous-traitant, §40 : <https://www.edpb.europa.eu/system/files/documents/2023-10/EDPB_guidelines_202007_controllerprocessor_final_en.pdf>
- **[S10]** RGPD, chapitre IV, art. 26, 28, 30 (CNIL) : <https://www.cnil.fr/fr/reglement-europeen-protection-donnees/chapitre4>
- **[S11]** CJUE, C-413/23 P, communiqué n° 107/25 : <https://curia.europa.eu/site/upload/docs/application/pdf/2025-09/cp250107en.pdf>
- **[S12]** RGPD, chapitre I, art. 4(5) (CNIL) : <https://www.cnil.fr/fr/reglement-europeen-protection-donnees/chapitre1>
- **[S13]** CEPD, lignes directrices 01/2025 sur la pseudonymisation, version de consultation : <https://www.edpb.europa.eu/system/files/2025-01/edpb_guidelines_202501_pseudonymisation_en.pdf>
