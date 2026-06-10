# Session Debug Telnyx — 2026-06-10

## Contexte

Premier vrai test de bout en bout du pipeline vocal Telnyx en prod
(`https://api.sokar.tech/voice/telnyx`). Le numéro +33 4 51 22 15 28
a été appelé, l'API a reçu le webhook, mais plusieurs bugs ont été
découverts et fixés en cascade.

## État à la fin de la session

✅ **Marche** :
- Webhook `/voice/telnyx` reçoit les events Telnyx
- Vérification signature Ed25519 (raw body)
- `RestaurantService.loadContext()` charge le resto en DB
- `CallSessionManager.create()` enregistre la session vocale
- WebSocket `/voice/stream/:callId` accepte la connexion Telnyx
- `event: start` trouve la session
- `speakTtsStreamed()` est appelé pour le greeting

❌ **Bloque** :
- Cartesia TTS renvoie **HTTP 402 Payment Required** (compte sans crédits)
- Conséquence : aucun audio applicatif n'est envoyé à Telnyx
- Le caller entend le message d'erreur **par défaut de Telnyx** :
  "je rencontre une difficulté technique"
- **PAS** la voix de Sokar/Cartesia

## Bugs fixés dans la session (4 commits)

### 1. `0a8a7a7` — Debug logs dans le guard Telnyx
**Pourquoi** : les webhooks étaient rejetés en 403 sans qu'on sache pourquoi
(catch silencieux dans le guard). Ajout de logs structurés pour
diagnostiquer.

**Note** : ce commit peut être revert une fois le diagnostic terminé.
Les logs sont utiles mais bruyants en prod.

### 2. `2b15375` — Raw body pour vérif signature Ed25519
**Bug critique** : Telnyx signe les bytes exacts du payload. Fastify
re-sérialise `req.body` via JSON, ce qui change l'ordre des clés et
invalide la signature.

**Fix** : ajout d'un `addContentTypeParser` qui préserve le raw body
en `request.rawBody`, et le guard utilise ce raw body au lieu de
`JSON.stringify(req.body)`.

### 3. `9021f6a` — Cast type pour le content-type parser
**Pourquoi** : TypeScript se plaignait que `body` pouvait être
`string | Buffer<ArrayBufferLike>`. Cast explicite en `string`.

### 4. `7f93493` — Pre-création de la session dans call.initiated
**Bug critique** (TODO connu du dev précédent) : le WebSocket
`/voice/stream/:callId` fait `mgr.get(start.call_control_id)` mais
**personne n'appelait `CallSessionManager.create()`**. La méthode
existait mais était morte. Log "No session found for start event" +
silence.

**Fix** : créer la session dans le handler `call.initiated` du
pipeline, juste après la création du Call record en DB. Le WebSocket
start event trouve la session et déclenche le greeting.

## Modifications de skills

L'ancienne clé Cartesia (32 chars, suffix `6KRN`) a été retirée de
2 fichiers de skills pour des raisons de sécurité :
- `~/.hermes/skills/devops/sokar-deployment/references/vps-session-2026-05-22.md`
- `~/.hermes/skills/devops/sokar-deployment/references/vps-session-2026-05-23.md`

**Remplacé par** : `Cartesia API Key: <in Doppler — do NOT commit to disk>`

## Nouvelle clé Cartesia

L'utilisateur a fourni une nouvelle clé :
- Clé : `sk_car_***` (29 chars, finit par `16zw`)
- Stockée dans `/opt/sokar/apps/api/.env` ligne 1
- API redémarrée pour recharger l'env
- **Mais** : le compte n'a plus de crédits, donc Cartesia renvoie 402

**Action utilisateur requise** : recharger les crédits Cartesia sur
https://cartesia.ai → account → billing. Une fois fait, le pipeline
vocal sera fonctionnel.

## TODO restants (non bloquants mais à fixer)

D'après les observations du subagent précédent et mes propres checks :

1. **`TELNYX_APP_ID="..."` et `TELNYX_WEBHOOK_SECRET="..."`** dans
   `/opt/sokar/apps/api/.env` sont des placeholders littéraux
   (3 points / 3 étoiles). Non utilisés par le code actuellement,
   mais à nettoyer pour la cohérence.

2. **Restaurant de test `test-resto-1`** a `carrier = 'vapi'` au
   lieu de `'telnyx'`. Hardcodé en `'telnyx'` dans le code donc
   non bloquant, mais à mettre à jour pour les stats.

3. **Debug logs du commit `0a8a7a7`** : à retirer une fois le
   pipeline validé en prod (pollue les logs).

4. **Patch `deploy-vps.sh`** : ajouter les fixes du 9 juin :
   - `yes | pnpm install --frozen-lockfile` (force reinstall)
   - `chown deploy + chmod 644` sur `.next/standalone` avant build
   cf. `references/deploy-pitfalls-2026-06-09.md`

5. **Page CGV / Mentions légales / RGPD** : obligatoire avant
   facturation. Pas de mention RGPD actuelle dans le site.

## Prochaine session

Quand l'utilisateur aura rechargé les crédits Cartesia, le pipeline
vocal devrait fonctionner end-to-end. Pour valider :

1. Appeler le +33 4 51 22 15 28 depuis un téléphone
2. Vérifier que la voix de Sokar dit "Bonjour, Test Restaurant !"
3. Poser une question de réservation (ex: "Table pour 2 à 20h")
4. Vérifier que la réservation est créée en DB
5. Vérifier que le dashboard affiche l'appel dans `/dashboard/calls`

## Annexes

- Skill `telnyx-voice-pipeline` : `/Users/hamza/.hermes/skills/fastify-typescript/telnyx-voice-pipeline/SKILL.md`
- Skill `sokar-deployment` : `/Users/hamza/.hermes/skills/devops/sokar-deployment/SKILL.md`
- Référence pitfalls : `references/deploy-pitfalls-2026-06-09.md`
- Fichiers de code modifiés :
  - `apps/api/src/main.ts` (raw body content-type parser)
  - `apps/api/src/modules/voice/telnyx.guard.ts` (use rawBody + debug logs)
  - `apps/api/src/modules/voice/telnyx.pipeline.ts` (pre-create session)
