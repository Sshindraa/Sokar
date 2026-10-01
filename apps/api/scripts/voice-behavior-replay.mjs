#!/usr/bin/env node
/**
 * Rejoue les requêtes du jeu de comportements contre un modèle : celui de production (Cerebras, par défaut)
 * ou un modèle OpenRouter (pour juger un secours). À lancer sur le serveur : la clé est lue dans le .env de
 * l'API et ne sort jamais.
 *
 * ATTENTION, Cerebras : une seule clé (CEREBRAS_API_KEY) sert aux appels et aux rejeux : chaque rejeu consomme
 * le quota des appels réels (le 29/09, des rejeux l'ont épuisé : 402, plus aucune réponse vocale). Le plafond
 * de requêtes (VBE_MAX_REQUESTS) est le seul garde-fou : à vérifier avant de lancer, surtout quand le solde est
 * bas. OpenRouter : autre crédit (OPENROUTER_API_KEY), sans effet sur les appels tant que le secours n'est pas
 * sollicité, mais le secours en dépend.
 *
 *   node voice-behavior-replay.mjs requests.json [/opt/sokar/apps/api/.env] > responses.json
 *
 * Variables (toutes facultatives ; sans elles, Cerebras comme avant) :
 *   VBE_PROVIDER=cerebras|openrouter   fournisseur
 *   VBE_MODEL=…                        modèle (défaut : VOICE_LLM_MODEL, ou le modèle de repli pour openrouter)
 *   VBE_BASE_URL=…                     adresse (OpenRouter UE : https://eu.openrouter.ai/api/v1)
 *   VBE_REASONING_OFF=1                openrouter : envoie reasoning:{enabled:false} (modèles à raisonnement
 *                                      optionnel comme DeepSeek ; les autres le refusent avec require_parameters)
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
const provider = process.env.VBE_PROVIDER || 'cerebras';
if (provider !== 'cerebras' && provider !== 'openrouter') {
  process.stderr.write(
    `REFUS : VBE_PROVIDER doit valoir cerebras ou openrouter (reçu : ${provider}).\n`,
  );
  process.exit(1);
}
const keyName = provider === 'openrouter' ? 'OPENROUTER_API_KEY' : 'CEREBRAS_API_KEY';
const apiKey = env[keyName];
const jobCount = requests.reduce((total, request) => total + request.samples, 0);
const maxRequests = Number(process.env.VBE_MAX_REQUESTS) || 150;
if (!apiKey) {
  process.stderr.write(`REFUS : ${keyName} absente du .env.\n`);
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
const model =
  process.env.VBE_MODEL ||
  (provider === 'openrouter'
    ? env.VOICE_STRUCTURED_FALLBACK_MODEL || 'deepseek/deepseek-v4-flash-0731'
    : env.VOICE_LLM_MODEL || 'qwen-3.8-27b');
const baseUrl =
  process.env.VBE_BASE_URL ||
  (provider === 'openrouter'
    ? env.OPENROUTER_FALLBACK_BASE_URL || env.OPENROUTER_BASE_URL || 'https://openrouter.ai/api/v1'
    : env.CEREBRAS_BASE_URL || 'https://api.cerebras.ai/v1');
process.stderr.write(`Fournisseur : ${provider} | modèle : ${model} | adresse : ${baseUrl}\n`);
/** Hébergeurs OpenRouter qui ont répondu (pour savoir qui a servi les tirages). */
const served = {};
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
          ...(provider === 'openrouter'
            ? {
                ...(process.env.VBE_REASONING_OFF === '1' ? { reasoning: { enabled: false } } : {}),
                provider: { require_parameters: true },
              }
            : { reasoning_effort: 'none' }),
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
      const body = await response.json();
      if (body.provider) served[body.provider] = (served[body.provider] ?? 0) + 1;
      return JSON.parse(body.choices[0].message.content);
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
process.stdout.write(JSON.stringify({ model, provider, baseUrl, served, responses }));
