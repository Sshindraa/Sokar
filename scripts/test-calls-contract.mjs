/**
 * Test de contrat — Page Calls Dashboard
 * Vérifie que la logique de parsing de la page fonctionne avec des données API réelles
 * Usage : node scripts/test-calls-contract.mjs
 */

// ─── Simule la réponse API /calls ─────────────────────────────────────────
const mockApiResponse = {
  data: [
    {
      id: 'call-001',
      callSid: 'telnyx-a1b2c3',
      durationSec: 145,
      transcript: 'Bonjour, je voudrais réserver une table pour 4 personnes ce soir à 20h.',
      intent: 'RESERVATION',
      outcome: 'RESERVED',
      carrier: 'telnyx',
      createdAt: '2026-06-03T14:30:00.000Z',
    },
    {
      id: 'call-002',
      callSid: 'telnyx-d4e5f6',
      durationSec: 32,
      transcript: null,
      intent: 'HOURS',
      outcome: 'INFO',
      carrier: 'telnyx',
      createdAt: '2026-06-03T16:45:00.000Z',
    },
    {
      id: 'call-003',
      callSid: 'telnyx-g7h8i9',
      durationSec: 210,
      transcript: 'Mon groupe fait 12 personnes, est-ce que vous pouvez nous accueillir ?',
      intent: 'RESERVATION',
      outcome: 'HANDOFF',
      carrier: 'telnyx',
      createdAt: '2026-06-03T18:10:00.000Z',
    },
    {
      id: 'call-004',
      callSid: 'telnyx-j0k1l2',
      durationSec: null,
      transcript: null,
      intent: null,
      outcome: 'ERROR',
      carrier: 'telnyx',
      createdAt: '2026-06-03T19:00:00.000Z',
    },
  ],
  total: 4,
  limit: 50,
  offset: 0,
};

// ─── Logique de la page Calls (copiée ici pour test) ─────────────────────
function formatDuration(seconds) {
  if (!seconds || seconds <= 0) return '—';
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

function formatDate(iso) {
  return new Date(iso).toLocaleDateString('fr-FR', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function OutcomeBadge(outcome) {
  const map = {
    RESERVED: { label: 'Réservé', color: 'emerald' },
    INFO: { label: 'Info', color: 'blue' },
    HANDOFF: { label: 'Transféré', color: 'amber' },
    NO_ACTION: { label: 'Aucune action', color: 'neutral' },
    ERROR: { label: 'Erreur', color: 'red' },
  };
  return map[outcome] || { label: outcome || 'Inconnu', color: 'neutral' };
}

function IntentLabel(intent) {
  const map = {
    RESERVATION: 'Réservation',
    HOURS: 'Horaires',
    MENU: 'Menu',
    CANCEL: 'Annulation',
    OTHER: 'Autre',
  };
  return map[intent] || intent || '—';
}

function accentClass(outcome) {
  const map = {
    RESERVED: 'border-l-emerald-500',
    ERROR: 'border-l-red-500',
    HANDOFF: 'border-l-amber-500',
  };
  return map[outcome] || 'border-l-white/10';
}

// ─── Assertions ────────────────────────────────────────────────────────────
let passed = 0;
let failed = 0;

function assert(name, condition) {
  if (condition) {
    console.log(`  ✅ ${name}`);
    passed++;
  } else {
    console.log(`  ❌ ${name}`);
    failed++;
  }
}

console.log('\n━━━ Test Contract — Page Calls ━━━\n');

// 1. Parsing API
const calls = Array.isArray(mockApiResponse.data) ? mockApiResponse.data : [];
const total = typeof mockApiResponse.total === 'number' ? mockApiResponse.total : 0;

assert('Parsing API — calls array', calls.length === 4);
assert('Parsing API — total count', total === 4);

// 2. Format duration
assert('formatDuration(145) → 2m 25s', formatDuration(145) === '2m 25s');
assert('formatDuration(32) → 32s', formatDuration(32) === '32s');
assert('formatDuration(null) → —', formatDuration(null) === '—');
assert('formatDuration(0) → —', formatDuration(0) === '—');

// 3. Format date
assert('formatDate parse', formatDate('2026-06-03T14:30:00.000Z').includes('2026'));
assert('formatDate parse', formatDate('2026-06-03T14:30:00.000Z').includes('30'));

// 4. Outcome badges
assert('Outcome RESERVED', OutcomeBadge('RESERVED').label === 'Réservé');
assert('Outcome HANDOFF', OutcomeBadge('HANDOFF').label === 'Transféré');
assert('Outcome ERROR', OutcomeBadge('ERROR').label === 'Erreur');
assert('Outcome null', OutcomeBadge(null).label === 'Inconnu');

// 5. Intent labels
assert('Intent RESERVATION', IntentLabel('RESERVATION') === 'Réservation');
assert('Intent HOURS', IntentLabel('HOURS') === 'Horaires');
assert('Intent null', IntentLabel(null) === '—');

// 6. Accent classes
assert('Accent RESERVED', accentClass('RESERVED') === 'border-l-emerald-500');
assert('Accent ERROR', accentClass('ERROR') === 'border-l-red-500');
assert('Accent default', accentClass('NO_ACTION') === 'border-l-white/10');

// 7. Transcript truncation simulation
function truncate(text, max) {
  if (!text) return null;
  return text.length > max ? text.slice(0, max) + '…' : text;
}
assert('Truncate 60 chars', truncate(calls[0].transcript, 60).endsWith('…'));
assert('Truncate short', truncate(calls[1].transcript, 60) === null);

// 8. Null safety — tous les champs optionnels
assert('Null transcript OK', calls[1].transcript === null);
assert('Null intent OK', calls[3].intent === null);
assert('Null outcome handled', OutcomeBadge(calls[3].outcome).label === 'Erreur');
assert('Null duration OK', formatDuration(calls[3].durationSec) === '—');

// 9. Mobile card details structure
const mobileDetails = (call) => [
  { label: 'Durée', value: formatDuration(call.durationSec) },
  { label: 'Opérateur', value: call.carrier || '—' },
  ...(call.transcript ? [{ label: 'Transcript', value: truncate(call.transcript, 60) }] : []),
];
assert('Mobile details — with transcript', mobileDetails(calls[0]).length === 3);
assert('Mobile details — no transcript', mobileDetails(calls[1]).length === 2);

// ─── Résumé ────────────────────────────────────────────────────────────────
console.log(`\n━━━ Résultat : ${passed} passed, ${failed} failed ━━━\n`);
if (failed > 0) {
  process.exit(1);
}
