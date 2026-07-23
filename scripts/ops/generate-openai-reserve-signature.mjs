#!/usr/bin/env node
/**
 * Génère la clé HMAC partagée (si absente) et l'URL statique signée
 * pour le feed OpenAI Reserve /v1/businesses (RES-007).
 *
 * Usage:
 *   node scripts/ops/generate-openai-reserve-signature.mjs
 *   node scripts/ops/generate-openai-reserve-signature.mjs --domain https://api-staging.sokar.tech
 */

import { createHmac, randomBytes } from 'node:crypto';

const domain = process.argv
  .find((arg) => arg.startsWith('--domain='))
  ?.replace('--domain=', '')
  .replace(/\/$/, '');

const baseUrl =
  domain || process.env.PUBLIC_API_URL || process.env.API_URL || 'https://api.sokar.tech';

let secret = process.env.OPENAI_RESERVE_HMAC_KEY;

if (!secret) {
  secret = randomBytes(32).toString('hex');
  process.stdout.write(
    '⚠️  OPENAI_RESERVE_HMAC_KEY non définie. Une clé a été générée pour cet exemple.\n',
  );
  process.stdout.write(
    '   → Pour un vrai déploiement, génère-la sur le serveur et définis-la dans .env\n\n',
  );
} else {
  process.stdout.write('✅ OPENAI_RESERVE_HMAC_KEY lue depuis .env\n\n');
}

if (secret.length < 32) {
  process.stderr.write('❌ OPENAI_RESERVE_HMAC_KEY doit faire au moins 32 caractères.\n');
  process.exit(1);
}

const staticSig = createHmac('sha256', secret).update('GET|/v1/businesses|').digest('base64url');

process.stdout.write('=== Ajouter dans apps/api/.env (staging/prod) ===\n');
process.stdout.write(`OPENAI_RESERVE_HMAC_KEY="${secret}"\n`);
process.stdout.write('\n');
process.stdout.write('=== URL à donner à OpenAI (merchant form) ===\n');
process.stdout.write(`${baseUrl}/v1/businesses?signature=${staticSig}\n`);
process.stdout.write('\n');
process.stdout.write('=== Exemple de pagination ===\n');
process.stdout.write(`${baseUrl}/v1/businesses?signature=${staticSig}&page=1&page_size=20\n`);
