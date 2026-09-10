#!/usr/bin/env node
/**
 * Génère un petit corpus bilingue pour comparer les voix Sonic 3.6.
 * Usage : node tools/diagnostics/benchmark-cartesia-voices.mjs
 * Les fichiers sont écrits dans /private/tmp et ne sont jamais ajoutés au git.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const apiKey = process.env.CARTESIA_API_KEY;
const model = process.env.CARTESIA_MODEL || 'sonic-3.6';
const outputRoot =
  process.env.CARTESIA_BENCHMARK_DIR || '/private/tmp/sokar-cartesia-voice-benchmark';

const candidates = [
  { name: 'skylar', id: 'db6b0ed5-d5d3-463d-ae85-518a07d3c2b4' },
  { name: 'daniel', id: '47c38ca4-5f35-497b-b1a3-415245fb35e1' },
  { name: 'jacqueline', id: '9626c31c-bec5-4cca-baa8-f8ba9e84c8bc' },
  { name: 'gemma', id: '62ae83ad-4f6a-430b-af41-a9bede9286ca' },
  { name: 'archie', id: 'ef191366-f52f-447a-a398-ed8c0f2943a1' },
];

const samples = [
  {
    id: 'fr',
    locale: 'fr-FR',
    text: 'Bonjour, je peux vous proposer une table pour quatre personnes ce soir à dix-neuf heures.',
  },
  {
    id: 'en',
    locale: 'en-US',
    text: 'Hello, I can offer you a table for four people tonight at seven o’clock.',
  },
];

function safeFilePart(value) {
  return value.replace(/[^a-z0-9_-]+/gi, '-').toLowerCase();
}

if (!apiKey || apiKey === '...' || apiKey.length < 20) {
  console.error(
    'CARTESIA_API_KEY est absente ou ressemble encore au placeholder. Configurez-la dans votre environnement avant le benchmark.',
  );
  process.exit(2);
}

await mkdir(outputRoot, { recursive: true });
const manifest = {
  model,
  generatedAt: new Date().toISOString(),
  samples,
  voices: [],
};

for (const voice of candidates) {
  const entry = { ...voice, files: [], error: null };
  for (const sample of samples) {
    const response = await fetch('https://api.cartesia.ai/tts/bytes', {
      method: 'POST',
      headers: {
        'Cartesia-Version': '2026-03-01',
        'X-API-Key': apiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model_id: model,
        transcript: sample.text,
        voice: { mode: 'id', id: voice.id },
        locale: sample.locale,
        normalization: 'auto',
        output_format: { container: 'mp3', encoding: 'mp3', sample_rate: 24000 },
      }),
    });

    if (!response.ok) {
      entry.error = `Cartesia ${response.status}: ${(await response.text()).slice(0, 200)}`;
      break;
    }

    const filePath = path.join(outputRoot, `${safeFilePart(voice.name)}-${sample.id}.mp3`);
    await writeFile(filePath, Buffer.from(await response.arrayBuffer()));
    entry.files.push(filePath);
  }
  manifest.voices.push(entry);
}

const manifestPath = path.join(outputRoot, 'manifest.json');
await writeFile(manifestPath, JSON.stringify(manifest, null, 2));
console.log(`Benchmark terminé. Manifeste : ${manifestPath}`);
for (const voice of manifest.voices) {
  console.log(
    `${voice.name}: ${voice.error || `${voice.files.length}/${samples.length} fichiers`}`,
  );
}
