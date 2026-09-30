#!/usr/bin/env node
/**
 * Rejoue les requêtes du jeu de comportements contre le modèle de production.
 * À lancer sur le serveur : la clé est lue dans le .env de l'API et ne sort jamais.
 *
 * ATTENTION : une seule clé Cerebras (CEREBRAS_API_KEY) sert aux appels et aux rejeux : chaque
 * rejeu consomme le quota des appels réels (le 29/09, des rejeux l'ont épuisé : 402, plus aucune
 * réponse vocale). Le plafond de requêtes (VBE_MAX_REQUESTS) est le seul garde-fou : à vérifier
 * avant de lancer, surtout quand le solde est bas.
 *
 *   node voice-behavior-replay.mjs requests.json [/opt/sokar/apps/api/.env] > responses.json
 */
import { readFileSync } from 'node:fs';

const [requestsFile, envFile = '/opt/sokar/apps/api/.env'] = process.argv.slice(2);
if (!requestsFile) throw new Error('Usage : node voice-behavior-replay.mjs requests.json [.env]');
const env = Object.fromEntries(
  readFileSync(envFile, 'utf8')
    .split('\n')
    .filter((line) => /^[A-Z_]+=/.test(line))
    .map((line) => [
      line.slice(0, line.indexOf('=')),
      line.slice(line.indexOf('=') + 1).replace(/^["']|["']$/g, ''),
    ]),
);
const { requests } = JSON.parse(readFileSync(requestsFile, 'utf8'));
const apiKey = env.CEREBRAS_API_KEY;
const jobCount = requests.reduce((total, request) => total + request.samples, 0);
const maxRequests = Number(process.env.VBE_MAX_REQUESTS) || 150;
if (!apiKey) {
  process.stderr.write('REFUS : CEREBRAS_API_KEY absente du .env.\n');
  process.exit(1);
}
if (jobCount > maxRequests) {
  process.stderr.write(
    `REFUS : ${jobCount} requêtes (~${Math.round((jobCount * 3.4) / 1000)} M de tokens en entrée), ` +
      `plafond ${maxRequests}. Rejouer quelques cas (VBE_ONLY=id1,id2) ou relever VBE_MAX_REQUESTS.\n`,
  );
  process.exit(1);
}
process.stderr.write(
  `Rejeu : ${jobCount} requêtes, ~${Math.round((jobCount * 3.4) / 100) / 10} M de tokens en entrée.\n`,
);
const model = env.VOICE_LLM_MODEL || 'qwen-3.8-27b';
const baseUrl = env.CEREBRAS_BASE_URL || 'https://api.cerebras.ai/v1';
const CONCURRENCY = 6;

const MAX_ATTEMPTS = 6;

/**
 * Crédit épuisé (402) ou clé refusée (401/403) : inutile de continuer, chaque requête suivante échouerait
 * et le rejeu renverrait des réponses vides que rien ne distingue d'un modèle muet. Le 30/09, trois passages
 * sur six sont partis ainsi en silence et ont épuisé le crédit partagé avec les appels réels.
 */
let fatal = null;
const FATAL_STATUSES = new Set([401, 402, 403]);
/** Au-delà, trop de réponses vides pour que les taux mesurés aient un sens. */
const MAX_EMPTY_RATE = 0.25;

/** Cerebras limite les tokens par minute : un 429 se rattrape en attendant, il n'est pas un verdict. */
async function sample(request) {
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const response = await fetch(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model,
          messages: request.messages,
          ...(request.format ? { response_format: request.format } : {}),
          temperature: 0.3,
          max_tokens: request.maxTokens ?? 400,
          reasoning_effort: 'none',
        }),
        signal: AbortSignal.timeout(30_000),
      });
      if (FATAL_STATUSES.has(response.status)) {
        fatal ??= `HTTP ${response.status} du fournisseur (${response.status === 402 ? 'crédit épuisé' : 'clé refusée'})`;
        return null;
      }
      if (response.status === 429 && attempt < MAX_ATTEMPTS) {
        const waitS = Number(response.headers.get('retry-after')) || 5 * attempt;
        await new Promise((resolve) => setTimeout(resolve, waitS * 1000));
        continue;
      }
      return JSON.parse((await response.json()).choices[0].message.content);
    } catch {
      return null;
    }
  }
  return null;
}

// Test préalable : une requête minimale. Un refus arrête tout avant de dépenser quoi que ce soit.
await sample({
  messages: [{ role: 'user', content: 'ok' }],
  format: undefined,
  maxTokens: 3,
});
if (fatal) {
  process.stderr.write(`ARRÊT : ${fatal}. Aucune requête du jeu n'a été envoyée.\n`);
  process.exit(2);
}

const jobs = requests.flatMap((request) => Array.from({ length: request.samples }, () => request));
const results = new Array(jobs.length);
let cursor = 0;
await Promise.all(
  Array.from({ length: CONCURRENCY }, async () => {
    while (!fatal && cursor < jobs.length) {
      const index = cursor++;
      results[index] = await sample(jobs[index]);
    }
  }),
);
if (fatal) {
  process.stderr.write(
    `ARRÊT : ${fatal}. Rejeu interrompu, aucune sortie écrite (elle serait faussée par des réponses vides).\n`,
  );
  process.exit(2);
}
const empty = results.filter((result) => result == null).length;
if (empty / jobs.length > MAX_EMPTY_RATE) {
  process.stderr.write(
    `ARRÊT : ${empty}/${jobs.length} réponses vides (réseau, quota ou format ?). Sortie non écrite.\n`,
  );
  process.exit(3);
}
const responses = {};
jobs.forEach((job, index) => (responses[job.id] ??= []).push(results[index]));
process.stdout.write(JSON.stringify({ model, responses }));
