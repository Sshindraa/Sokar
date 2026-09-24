# Banc STT vocal

Le banc synthétise les phrases avec Cartesia, les dégrade comme un appel téléphonique,
puis les transcrit avec ElevenLabs Scribe. Il peut consommer des crédits chez les deux
fournisseurs. Ne le lancez jamais avec les clés de production.

## Clés et plafond obligatoires

Fournissez **ELEVENLABS_BENCH_API_KEY** et **CARTESIA_BENCH_API_KEY** depuis un compte
dédié au banc. Le script refuse de démarrer si l'une manque, si elle est identique à la
clé de production correspondante lorsqu'elle est présente, si le corpus est vide ou si
**BENCH_MAX_CREDITS** n'est pas un entier positif.

Avant toute requête fournisseur, il affiche une estimation conservative, compte deux
fois les caractères attendus pour la transcription, ajoute la synthèse Cartesia de
toutes les phrases et le contrôle d'accès Cartesia, puis s'arrête si le total dépasse
BENCH_MAX_CREDITS. Le plafond doit être inférieur au solde disponible sur les comptes
de banc.

Après validation du budget, le script effectue une requête de contrôle vers chaque
endpoint réellement utilisé :

- Cartesia : une synthèse de la première phrase, comprise dans l'estimation ;
- ElevenLabs : une ouverture de la socket Realtime, sans envoi d'audio.

Si un contrôle échoue, aucun lot ne démarre. Les transcriptions sont générées ensuite
avec transcribe.cjs. evaluate.ts traite hors ligne les transcriptions déjà stockées et
n'appelle aucun fournisseur.

## Exécution

Construisez d'abord l'API pour que transcribe.cjs puisse importer dist, puis passez le
corpus JSON comme argument. Chargez les secrets depuis un fichier local ignoré par Git
ou un gestionnaire de secrets ; ne les placez jamais dans le dépôt ni dans la ligne de
commande.

    pnpm --filter @sokar/api build
    node apps/api/scripts/voice-stt-bench/transcribe.cjs /chemin/vers/phrases.json

Le dépôt ne contient pas de second-opinion.cjs à la date du 24/09/2026. Si un outil de
seconde opinion est ajouté, il doit appliquer les mêmes règles de clé dédiée,
comparaison à la clé de production, estimation plafonnée et contrôle unique d'accès.

Le diagnostic manuel `tools/diagnostics/test-stt-tts.mjs` utilise également des clés
dédiées (`ELEVENLABS_BENCH_API_KEY`, `CARTESIA_BENCH_API_KEY` et `GROQ_BENCH_API_KEY`) et
le plafond `BENCH_MAX_CREDITS`. Il refuse les clés de production avant sa première
requête ; les crédits estimés sont vérifiés dans l'unité native de chaque fournisseur.
