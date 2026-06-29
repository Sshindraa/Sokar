# Stratégie d'onboarding Sokar

Source d'inspiration : Mobbin, _I Studied 1,460 Onboarding Flows. Here's What I Found._ (10 min, juin 2026).
Ce doc ne recopie pas la vidéo — il filtre ses conclusions à travers le prisme Sokar (B2B, gérants de restaurant français 40-60 ans, non-devs, desktop/tablette, facturation mensuelle).

## Diagnostic de l'existant

L'onboarding Sokar actuel (`apps/dashboard/src/features/onboarding/steps.tsx`) est un **wizard de configuration** :

```
Identité → Horaires → Personnalité → Calendar → Phone → Connect (5 étapes)
```

Chaque écran _collecte_ des données. **Aucun écran ne délivre la valeur.** L'aha moment — entendre l'IA répondre correctement à un appel, voir une résa bookée — n'arrive qu'**après** toute la config. C'est l'inverse exact du pattern gagnant identifié par Mobbin (Duolingo : tu apprends déjà pendant l'onboarding ; Speak : tu parles déjà avant l'inscription).

Le mode démo existe (`use-demo-mode.tsx` → `/public/preview/restaurant` sur le seed `chez-sokar-demo`) mais c'est un **toggle global** post-onboarding, pas un déclencheur mid-flow. La machinerie TTS Cartesia existe dans `apps/api/src/modules/voice/` mais n'est exposée que via le pipeline d'appels live (`stream/handler.ts`), pas via un endpoint standalone utilisable pendant l'onboarding.

## Les 7 idées de la vidéo (rappel)

1. La longueur n'est pas le problème, la longueur perçue oui (moyenne 25 écrans ; Duolingo 60+ qui ne se sent pas).
2. Vendre l'outcome, pas la feature (Timo, Front Butts, Alma laisse essayer avant signup).
3. Founder's touch à l'aha moment, pas à l'inscription (Airbnb = vidéo CEO après 1ère annonce).
4. Personnalisation : 23% des apps, seulement 7% des apps IA — opportunité manquée pour l'IA ciblant un public qui a besoin d'une expérience taillée dès le départ.
5. Montrer ce que les réponses ont débloqué (Noom/Bitepal/Brilliant/Speak : plan perso + date d'objectif avant usage).
6. Données de conversion réelles : Headspace multi-goals +10% free trial, Dollar Shave Club copy +5% subs, Grammarly pricing par quiz +20% upgrades, House signup split +15%, Mural checklist persistante +10% rétention J7.
7. Progressive disclosure > education front-chargée (Cake Equity tooltips contextuels ; pre-permission screens avant popups OS).

## Ce qu'il faut retenir et développer pour Sokar

### Action 1 — Injecter l'aha moment à l'étape 3 (priorité n°1)

Pattern Duolingo transposé : l'utilisateur **écoute un appel démo** avant d'avoir fini la config. Dès que `hours` + `personality` sont saisis (étape 3/10), générer un audio court : « Voici comment Sokar répondra vendredi 19h à une demande de table pour 4 » avec la voix Cartesia + le ton choisi.

- La machinerie existe (`voice/tts-cache.ts`, `stream/handler.ts`, seed `chez-sokar-demo`).
- Manque : un endpoint léger `POST /onboarding/demo-call` qui synthétise un script fixe avec les paramètres `personality` courants (pas de pipeline Telnyx complet).
- C'est le levier à plus fort impact : l'aha moment passe de « fin du wizard » à « milieu du wizard ».

### Action 2 — « Show what answers unlocked » sur l'étape Personnalité

Aujourd'hui `KnowledgeStep` collecte `profileType`, `fillerStyle`, `speakingRate`, `systemPromptExtra` puis passe à la suite. Pattern Noom/Bitepal : après ces 4 réponses, afficher un écran « Voici votre assistant configuré » avec un **transcript exemple** côté à côté (résa simple / annulation / question sur les plats) montrant comment les choix se traduisent en comportement. Le gérant _voit_ que ses réponses ont produit quelque chose.

### Action 3 — Founder's touch à l'aha moment, pas à l'inscription

La vidéo place le founder's touch _après_ la première action de valeur (Airbnb = après 1ère annonce, pas après signup). Pour Sokar : après le 1er appel démo écouté (aha moment de l'action 1), afficher une note/vidéo courte de Hamza — pas après l'inscription Clerk. Le public 40-60 ans B2B valorise la relation humaine ; un message court « Bienvenue chez Sokar — si l'assistant ne répond pas comme vous voulez, écrivez-moi directement » avec une signature scannée aurait un impact disproportionné vs une bannière générique.

### Action 4 — Progressive disclosure sur `systemPromptExtra`

`KnowledgeStep` présente 4 contrôles d'un coup (profil, élocution, vitesse, prompt custom). Pour un gérant non-tech, `systemPromptExtra` est intimidant. Pattern Cake Equity : ne montrer ce champ qu'aux utilisateurs qui ont déjà écouté l'appel démo et veulent affiner. Garder les 3 premiers contrôles visibles, fold le champ avancé derrière un « Affiner le comportement (optionnel) ». Réduit l'abandon sur l'écran le plus technique.

### Action 5 — Pre-permission screen avant le portage du numéro

`PhoneStep` implique une action opérateur irréversible (renvoi d'appels vers le numéro Sokar). Pattern Brilliant/Centro : avant de demander le portage/renvoi, afficher un écran « Voici exactement ce qui va se passer : vos appels du 01… au 06… seront renvoyés vers Sokar. Vous pouvez reprendre la main à tout moment en tapant _21_ ». Teaser du comportement + rassurance réversible. Réduit la friction sur l'étape la plus engageée du flow voice.

## Ce qu'il ne faut PAS emprunter de la vidéo

- **Gamification / animations ludiques** (raton laveur à nommer, billet qui vibre) — infantilisant pour un gérant de 52 ans en contexte B2B.
- **Paywall mid-onboarding** — Sokar est B2B mensuel ; le pricing se discute en sales/demo, pas dans le wizard. Grammarly +20% ne s'applique pas au modèle Sokar.
- **Multi-intent queries type Headspace** — Sokar n'a pas de « goals » multiples ; le gérant a un seul objectif (répondre aux appels). Ne pas forcer l'analogie.
- **Allonger le flow pour le plaisir** — Sokar est déjà court (~10 étapes vs 25 moyenne). Le risque n'est pas la longueur, c'est l'absence de valeur mid-flow. Corriger ça (action 1) avant de toucher à la longueur.

## Biais d'échantillon à garder en tête

1 460 flows = quasi-exclusivement des **apps mobiles consumer** (Duolingo, Headspace, Tinder, Bitepal…). Le public Sokar est l'inverse. Transposer directement les patterns est dangereux : on emprunte les _principes_ (vendre l'outcome, aha moment mid-flow, progressive disclosure), pas l'_esthétique_ gamifiée. Le cultural caveat du créateur (marchés asiatiques info-denses) s'inverse pour Sokar : un gérant de restaurant français est **encore moins** tolérant au clutter qu'un user consumer US.

## Vérifications rapides côté code (à faire)

- Confirmer que la checklist `onboarding-dashboard.tsx` **persiste après dismiss** (pattern Mural +10% rétention J7). Si elle disparaît au dismiss, c'est un quick win.
- Confirmer que `use-demo-mode.tsx` peut être déclenché **à l'étape 3** et pas seulement en toggle global — c'est le branchement technique de l'action 1.
- Vérifier s'il existe déjà un endpoint TTS standalone réutilisable, ou s'il faut en créer un (`POST /onboarding/demo-call`).

## En une phrase

L'onboarding Sokar actuel est un wizard de config qui retarde l'aha moment ; le seul levier qui vaut l'effort immédiat est de faire écouter un appel démo **au milieu** du flow (étape 3), pas à la fin. Le reste (founder's touch, progressive disclosure sur le prompt custom, pre-permission avant portage) sont des raffinements secondaires.
