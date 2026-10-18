# Connect — Identité publique, 3 octobre 2026

Avant : capture utilisateur du 03/10 à 15:03. Colonne explicative largement vide, titre dupliqué, progression 1/5 et 1/10 concurrente, action suivante doublonnée, bas de modale coupé.

Après : formulaire et aperçu réactif en deux colonnes à partir de 768 px, aperçu ouvrable sur mobile, en-tête et actions hors du corps défilant. Une action de sauvegarde dans le pied, lien proposé depuis le nom, disponibilité explicite avec reprise sur erreur, compteur de description, import JPG/PNG/WebP limité à 10 Mo avec remplacement/suppression et recadrage central paysage pour une photo importée. Brouillon conservé en mémoire du provider pour le même restaurant pendant la session (pas après rechargement). Photo de démonstration identifiée à la réouverture.

## Vérification et appréciation

- Contrôle visuel local à 1440×900, 1024×768 et 390×844 : pied visible, pas de débordement horizontal mobile. À hauteur limitée, le corps défile sans déplacer les actions.
- Saisie de 108 caractères immédiatement reflétée dans la carte. Fermeture/reprise : texte conservé. Aperçu mobile ouvrable.
- 4 tests ciblés passent (ConnectIdentityStep + PhoneStep), typecheck dashboard et ESLint des fichiers modifiés passent.
- Résultat satisfaisant : meilleure utilisation de l’espace, résultat concret, hiérarchie et action principale claires. L’aperçu est illustratif et ne remplace pas le rendu exact de la page publique.
- Limites : pas de sauvegarde réelle effectuée dans le navigateur, tests API simulés ; recadrage central, sans déplacement manuel du cadre ; matériel iPad, lecteurs d’écran et zoom 200 % non vérifiés.
- Captures : desktop.jpg (photo de démonstration), ipad.jpg (sans photo), mobile.jpg. Des fixtures locales ont servi à la saisie, sans soumission.

Livraison locale, sans commit ni déploiement. Workspace contenant de nombreux changements préexistants.

## Ajustement : tout visible sur ordinateur

À la demande de l’utilisateur, réduction des espaces desktop de l’en-tête/corps/pied, zone d’import compacte, description de 96 px et photo d’aperçu adaptée à la hauteur du viewport. Taille du texte conservée. Mesures DOM finales sans photo et description de 196 caractères : corps 426/426 px à 1366×600 et 1280×640, 458/458 px à 1440×900 (scrollHeight/clientHeight). Aucun défilement dans ces configurations. Le défilement de secours reste disponible pour les fenêtres exceptionnellement basses et les états d’erreur. Capture : desktop-no-scroll.jpg. Styles mobiles préservés.

## Aération adaptative

Espaces entre sections jusqu’à 24 px, entre label/champ/aide jusqu’à 8 px, marges verticales jusqu’à 20 px, selon la hauteur utile. Vérification sans overflow à 1366×600 (426/426), 1280×640 (452/452) et 1440×780 (510/510). Capture desktop-spacious.jpg. Les petits écrans conservent la version compacte.

## Validation assistée

Présentation préremplie localement depuis les informations connues, textes existants prioritaires, adresse générée/vérifiée et modifiable, URL canonique /restaurant/, couverture par monogramme. Suppression de l’import de photo Unsplash de démonstration. Le CTA devient actif sans saisie après vérification du lien ; une présentation effacée affiche la raison du blocage. Fermer conserve un brouillon en mémoire jusqu’au rechargement, sans autosave distant. Pas d’estimation de durée ajoutée sans mesure. Tests 5/5, typecheck/lint OK. Corps sans scroll à 1366×600 (402/402), contrôle mobile et action Modifier. Capture assisted-validation.jpg. Enrichissement continu sur les étapes suivantes et sauvegarde persistante des brouillons restent hors de cette modification.

## Mode review & approve

État initial : trois résumés et aperçu client, CTA Continuer actif immédiatement. Adresse, texte et import photo éditables à la demande uniquement. Texte effacé remplacé automatiquement par la proposition prudente. Contrôle de disponibilité avant toute écriture (y compris clic immédiat), sans afficher un statut technique normal. URL et badge redondants retirés de l’aperçu. Tests ciblés 4/4, typecheck/lint OK. Corps sans overflow à 1366×600 : 360/360 px. Capture review-approve.jpg. Les autres étapes ne sont pas modifiées par cette itération.

## Aperçu prioritaire

Fenêtre compacte (576 px max) centrée sur la fiche ; Modifier les informations ouvre les détails et élargit la fenêtre. Couverture typographique volontaire, libellés raccourcis accessibles, titre et cadre de réglages retirés. Présentation minimale depuis les seules données connues (sans remplissage ni invention). Capture preview-first.jpg ; normal sans overflow 1366×600 (359/359), ouverture/fermeture des détails contrôlée. Tests 4/4, typecheck/lint OK.
