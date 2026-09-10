#!/usr/bin/env node
/**
 * Test pipeline vocal — STT (ElevenLabs Scribe) ↔ TTS (Cartesia) ↔ LLM (OpenRouter)
 *
 * Usage : pnpm test:diagnostic  (ou node --env-file=.env.local tools/diagnostics/test-stt-tts.mjs)
 *
 * Valide chaque API indépendamment pour vérifier que les clés .env sont valides.
 */

// ─── Vérifier que .env.local est chargé (via --env-file) ─────────────────────
if (
  !process.env.ELEVENLABS_API_KEY &&
  !process.env.CARTESIA_API_KEY &&
  !process.env.OPENROUTER_API_KEY
) {
  console.log("❌ Variables d'environnement manquantes — .env.local non chargé.");
  console.log('   Lancez via : pnpm test:diagnostic');
  console.log('   ou          : node --env-file=.env.local tools/diagnostics/test-stt-tts.mjs');
  process.exit(1);
}

const EL_KEY = process.env.ELEVENLABS_API_KEY || '';
const CA_KEY = process.env.CARTESIA_API_KEY || '';
const OR_KEY = process.env.OPENROUTER_API_KEY || '';
const CA_VOICE = process.env.CARTESIA_VOICE_ID || 'f786b574-daa5-4673-aa0c-cbe3e8534c02';
const EL_MODEL = process.env.ELEVENLABS_STT_MODEL || 'scribe_v2_realtime';
const CA_MODEL = process.env.CARTESIA_MODEL || 'sonic-3.5';
const OR_MODEL = process.env.OPENROUTER_MODEL || 'mistralai/ministral-3b-2512';

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

// ─── 1. ElevenLabs Scribe STT ───────────────────────────────────────────────
async function testElevenLabsStt() {
  console.log('\n━━━ 1. ElevenLabs Scribe STT ━━━');
  if (!keyOk(EL_KEY))
    return skip('ElevenLabs STT', 'clé API manquante ou invalide dans .env.local');

  try {
    const res = await fetch('https://api.elevenlabs.io/v1/user', {
      method: 'GET',
      headers: { 'xi-api-key': EL_KEY },
    });
    const txt = await res.text();
    if (res.ok) {
      ok('Auth ElevenLabs validée (modèle ' + EL_MODEL + ', HTTP ' + res.status + ')');
    } else {
      no('HTTP ' + res.status, txt.slice(0, 200));
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
      `CARTESIA_API_KEY manquante → créer un compte sur cartesia.ai, générer une clé, ajouter dans .env.local`,
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
        model_id: CA_MODEL,
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
      let timeout;
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
        model: OR_MODEL,
        messages: [
          { role: 'system', content: 'Vous êtes un agent vocal concis.' },
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
  console.log('  TTS : Cartesia sonic-3.5 | STT : ElevenLabs Scribe | LLM : OpenRouter');
  console.log('═'.repeat(60));
  console.log('');
  console.log('  État des clés API dans .env.local :');
  console.log(`  • ELEVENLABS_API_KEY  : ${keyOk(EL_KEY) ? '✓' : '✗'}`);
  console.log(`  • CARTESIA_API_KEY  : ${keyOk(CA_KEY) ? '✓' : '✗ (placeholder)'}`);
  console.log(`  • OPENROUTER_API_KEY: ${keyOk(OR_KEY) ? '✓' : '✗'}`);
  console.log('');

  await testElevenLabsStt();
  await testCartesia();
  await testOpenrouter();

  console.log('\n' + '═'.repeat(60));
  const total = passed + failed + skipped;
  console.log(`  Résumé : ${passed} ✅ / ${failed} ❌ / ${skipped} ⏭️`);
  console.log('═'.repeat(60));

  // Recommandations
  if (!keyOk(EL_KEY) || !keyOk(CA_KEY)) {
    console.log('\n📋 Clés API nécessaires :');
    if (!keyOk(EL_KEY))
      console.log('  • ElevenLabs : https://elevenlabs.io → API Keys → générer une clé');
    if (!keyOk(CA_KEY))
      console.log('  • Cartesia : https://cartesia.ai → API Keys → créer une clé');
    console.log('');
    console.log('  Ajoutez-les dans .env :');
    console.log('    ELEVENLABS_API_KEY="cle"');
    console.log('    CARTESIA_API_KEY="cle"');
    console.log('    CARTESIA_VOICE_ID="f786b574-daa5-4673-aa0c-cbe3e8534c02"');
    console.log('');
    console.log('  Sinon, vous pouvez tester le pipeline de logique métier sans audio :');
    console.log('    curl -X POST http://localhost:4000/api/test/simulate-call \\');
    console.log('      -H "Content-Type: application/json" \\');
    console.log('      -d \'{"callerPhone": "+33612345678"}\'');
  } else if (passed === 3) {
    console.log('\n✅ Toutes les API vocales sont fonctionnelles !');
  }
}

main().catch(console.error);
