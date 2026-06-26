#!/usr/bin/env node
/**
 * Test pipeline vocal — STT (Deepgram) ↔ TTS (Cartesia) ↔ LLM (OpenRouter)
 *
 * Usage : node scripts/smoke/test-stt-tts.mjs
 *
 * Valide chaque API indépendamment pour vérifier que les clés .env sont valides.
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

// ─── Load .env ────────────────────────────────────────────────────────────────
const envPath = resolve(process.cwd(), '.env');
if (!existsSync(envPath)) {
  console.log('❌ .env introuvable');
  process.exit(1);
}

const raw = readFileSync(envPath);
function getEnv(key) {
  const idx = raw.indexOf(key + '=');
  if (idx === -1) return '';
  const valStart = idx + key.length + 1;
  const end = raw.indexOf('\n', idx);
  const valEnd = end === -1 ? raw.length : end;
  let val = raw.slice(valStart, valEnd).toString('utf-8').trim();
  if (val.startsWith('"') && val.endsWith('"')) val = val.slice(1, -1);
  return val;
}

const DG_KEY = getEnv('DEEPGRAM_API_KEY');
const CA_KEY = getEnv('CARTESIA_API_KEY');
const OR_KEY = getEnv('OPENROUTER_API_KEY');
const CA_VOICE = getEnv('CARTESIA_VOICE_ID') || 'f786b574-daa5-4673-aa0c-cbe3e8534c02';

function keyOk(k) {
  return k && k.length > 10 && k !== '...' && !k.includes('***');
}

let passed = 0,
  failed = 0,
  skipped = 0;
function ok(label) {
  console.log(`  ✅ ${label}`);
  passed++;
}
function no(label, detail) {
  console.log(`  ❌ ${label}`);
  if (detail) console.log(`     ${detail}`);
  failed++;
}
function skip(label, reason) {
  console.log(`  ⏭️  ${label} — ${reason}`);
  skipped++;
}

// ─── 1. Deepgram STT ────────────────────────────────────────────────────────────
async function testDeepgram() {
  console.log('\n━━━ 1. Deepgram STT ━━━');
  if (!keyOk(DG_KEY)) return skip('Deepgram API', 'clé API manquante ou invalide dans .env');

  // Générer un fichier WAV 16-bit PCM 8kHz avec un signal test
  const sr = 8000,
    dur = 0.5;
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + dur * sr * 2, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(sr, 24);
  header.writeUInt32LE(sr * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36);
  header.writeUInt32LE(dur * sr * 2, 40);

  const audio = Buffer.alloc(dur * sr * 2);
  for (let i = 0; i < dur * sr; i++) {
    const s = Math.sin((2 * Math.PI * 440 * i) / sr) * 0.3;
    audio.writeInt16LE(Math.floor(s * 32767), i * 2);
  }
  const wav = Buffer.concat([header, audio]);

  try {
    const res = await fetch(
      'https://api.deepgram.com/v1/listen?model=nova-3&language=fr&punctuate=true',
      {
        method: 'POST',
        headers: { Authorization: `Token ${DG_KEY}`, 'Content-Type': 'audio/wav' },
        body: wav,
      },
    );
    const txt = await res.text();
    if (res.ok) {
      const data = JSON.parse(txt);
      const transcript = data?.results?.channels?.[0]?.alternatives?.[0]?.transcript ?? '';
      ok(
        `HTTP ${res.status} — "${transcript.slice(0, 60)}" (${res.headers.get('x-ratelimit-remaining') || '?'} req restantes)`,
      );
    } else {
      no(`HTTP ${res.status}`, txt.slice(0, 200));
    }
  } catch (e) {
    no('Exception', e.message);
  }
}

// ─── 2. Cartesia TTS ────────────────────────────────────────────────────────────
async function testCartesia() {
  console.log('\n━━━ 2. Cartesia TTS ━━━');
  if (!keyOk(CA_KEY))
    return skip(
      'Cartesia TTS',
      `CARTESIA_API_KEY manquante → créer un compte sur cartesia.ai, générer une clé, ajouter dans .env`,
    );

  try {
    const res = await fetch('https://api.cartesia.ai/tts/sse', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Cartesia-Version': '2026-03-01',
        'X-API-Key': CA_KEY,
      },
      body: JSON.stringify({
        model_id: 'sonic-3.5',
        transcript: 'Test de synthèse vocale Cartesia.',
        voice: { mode: 'id', id: CA_VOICE },
        output_format: { container: 'raw', encoding: 'pcm_mulaw', sample_rate: 8000 },
      }),
    });

    if (res.ok) {
      // Lire le stream SSE pour vérifier qu'on reçoit des chunks audio
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = '';
      let chunks = 0;
      let timeout = setTimeout(() => {}, 5000); // dummy
      const p = new Promise((resolvePromise) => {
        timeout = setTimeout(() => resolvePromise('timeout'), 5000);
        (async () => {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            buf += decoder.decode(value, { stream: true });
            const lines = buf.split('\n');
            buf = lines.pop() ?? '';
            for (const line of lines) {
              if (!line.startsWith('data: ')) continue;
              const data = JSON.parse(line.slice(6));
              if (data.type === 'chunk' && data.data) chunks++;
              if (data.type === 'done') {
                resolvePromise('done');
                return;
              }
            }
          }
          resolvePromise('end');
        })();
      });
      const result = await p;
      clearTimeout(timeout);
      if (chunks > 0) ok(`HTTP ${res.status} — ${chunks} chunks audio reçus`);
      else no('Aucun chunk audio reçu');
    } else {
      const txt = await res.text();
      no(`HTTP ${res.status}`, txt.slice(0, 200));
    }
  } catch (e) {
    no('Exception', e.message);
  }
}

// ─── 3. OpenRouter LLM ──────────────────────────────────────────────────────────
async function testOpenrouter() {
  console.log('\n━━━ 3. OpenRouter LLM ━━━');
  if (!keyOk(OR_KEY)) return skip('OpenRouter', 'clé API manquante');

  try {
    const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${OR_KEY}` },
      body: JSON.stringify({
        model: 'mistralai/ministral-3b-2512',
        messages: [
          { role: 'system', content: 'Tu es un agent vocal concis.' },
          { role: 'user', content: 'Dis bonjour en français.' },
        ],
        max_tokens: 50,
      }),
    });
    const data = await res.json();
    if (res.ok && data?.choices?.[0]?.message?.content) {
      ok(`HTTP ${res.status} — "${data.choices[0].message.content.slice(0, 100)}"`);
    } else {
      no(`HTTP ${res.status}`, JSON.stringify(data).slice(0, 250));
    }
  } catch (e) {
    no('Exception', e.message);
  }
}

// ─── Main ────────────────────────────────────────────────────────────────────────
async function main() {
  console.log('═'.repeat(60));
  console.log('  🔍 Diagnostic Pipeline Vocal');
  console.log('  TTS : Cartesia sonic-3.5 | STT : Deepgram nova-3 | LLM : OpenRouter');
  console.log('═'.repeat(60));
  console.log('');
  console.log('  État des clés API dans .env :');
  console.log(`  • DEEPGRAM_API_KEY  : ${keyOk(DG_KEY) ? '✓' : '✗'}`);
  console.log(`  • CARTESIA_API_KEY  : ${keyOk(CA_KEY) ? '✓' : '✗ (placeholder)'}`);
  console.log(`  • OPENROUTER_API_KEY: ${keyOk(OR_KEY) ? '✓' : '✗'}`);
  console.log('');

  await testDeepgram();
  await testCartesia();
  await testOpenrouter();

  console.log('\n' + '═'.repeat(60));
  const total = passed + failed + skipped;
  console.log(`  Résumé : ${passed} ✅ / ${failed} ❌ / ${skipped} ⏭️`);
  console.log('═'.repeat(60));

  // Recommandations
  if (!keyOk(DG_KEY) || !keyOk(CA_KEY)) {
    console.log('\n📋 Clés API nécessaires :');
    if (!keyOk(DG_KEY))
      console.log('  • Deepgram : https://console.deepgram.com → générer une clé API');
    if (!keyOk(CA_KEY))
      console.log('  • Cartesia : https://cartesia.ai → API Keys → créer une clé');
    console.log('');
    console.log('  Ajoute-les dans .env :');
    console.log('    DEEPGRAM_API_KEY="ta_cle"');
    console.log('    CARTESIA_API_KEY="ta_cle"');
    console.log('    CARTESIA_VOICE_ID="f786b574-daa5-4673-aa0c-cbe3e8534c02"');
    console.log('');
    console.log('  Sinon, tu peux tester le pipeline de logique métier sans audio :');
    console.log('    curl -X POST http://localhost:4000/api/test/simulate-call \\');
    console.log('      -H "Content-Type: application/json" \\');
    console.log('      -d \'{"callerPhone": "+33612345678"}\'');
  } else if (passed === 3) {
    console.log('\n✅ Toutes les API vocales sont fonctionnelles !');
  }
}

main().catch(console.error);
