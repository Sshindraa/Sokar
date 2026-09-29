#!/usr/bin/env node
/**
 * Rejoue les requêtes du jeu de comportements contre le modèle de production.
 * À lancer sur le serveur : la clé est lue dans le .env de l'API et ne sort jamais.
 * *
 * Consomme le quota des appels réels : le nombre de requêtes est plafonné en amont (voir build).
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
const model = env.VOICE_LLM_MODEL || 'qwen-3.8-27b';
const baseUrl = env.CEREBRAS_BASE_URL || 'https://api.cerebras.ai/v1';
const CONCURRENCY = 6;

const usage = { requests: 0, promptTokens: 0, completionTokens: 0 };

async function sample(request) {
  try {
    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        messages: request.messages,
        response_format: request.format,
        temperature: 0.3,
        max_tokens: 400,
        reasoning_effort: 'none',
      }),
      signal: AbortSignal.timeout(30_000),
    });
    const body = await response.json();
    usage.requests += 1;
    usage.promptTokens += body.usage?.prompt_tokens ?? 0;
    usage.completionTokens += body.usage?.completion_tokens ?? 0;
    return JSON.parse(body.choices[0].message.content);
  } catch {
    return null;
  }
}

const jobs = requests.flatMap((request) => Array.from({ length: request.samples }, () => request));
const results = new Array(jobs.length);
let cursor = 0;
await Promise.all(
  Array.from({ length: CONCURRENCY }, async () => {
    while (cursor < jobs.length) {
      const index = cursor++;
      results[index] = await sample(jobs[index]);
    }
  }),
);
const responses = {};
jobs.forEach((job, index) => (responses[job.id] ??= []).push(results[index]));
process.stdout.write(JSON.stringify({ model, usage, responses }));
