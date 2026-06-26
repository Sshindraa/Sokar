/**
 * Client CLI pour simuler un appel vocal local.
 *
 * Usage :
 *   pnpm exec tsx scripts/smoke/simulate-voice-call.ts
 *
 * Variables d'environnement :
 *   SOKAR_API_BASE      (défaut http://localhost:4000)
 *   SOKAR_CALLER_PHONE  (défaut +336****5678)
 *   SOKAR_SIMULATE_MODE (auto | mock, défaut mock)
 */

const API_BASE = process.env.SOKAR_API_BASE ?? 'http://localhost:4000';
const CALLER_PHONE = process.env.SOKAR_CALLER_PHONE ?? '+336****5678';
const MODE = process.env.SOKAR_SIMULATE_MODE ?? 'mock';

async function main() {
  // 1. Créer l'appel simulé
  const initRes = await fetch(`${API_BASE}/api/test/simulate-call`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      callerPhone: CALLER_PHONE,
      mode: MODE,
    }),
  });

  if (!initRes.ok) {
    const err = await initRes.text();
    console.error('simulate-call failed:', initRes.status, err);
    process.exit(1);
  }

  const init = (await initRes.json()) as {
    callControlId: string;
    restaurant: { id: string; name: string };
    caller: { phone: string; isVip: boolean };
    mode: string;
  };

  console.log('=== Appel simulé ===');
  console.log(`Restaurant : ${init.restaurant.name}`);
  console.log(`Caller     : ${init.caller.phone} (VIP: ${init.caller.isVip})`);
  console.log(`Mode       : ${init.mode}`);
  console.log(`callControlId : ${init.callControlId}`);
  console.log('');

  // 2. Premier tour : demande de réservation
  const firstTranscript = 'je voudrais faire une réservation';
  console.log(`Vous : ${firstTranscript}`);
  await sendUtterance(init.callControlId, firstTranscript);

  // 3. Vérifier la réservation en DB via l'endpoint de test
  const reservationsRes = await fetch(
    `${API_BASE}/api/test/simulate-call/${init.callControlId}/reservations`,
  );
  if (reservationsRes.ok) {
    const reservations = (await reservationsRes.json()) as any[];
    console.log('');
    console.log('=== Réservations trouvées ===');
    console.log(JSON.stringify(reservations, null, 2));
  }
}

async function sendUtterance(callControlId: string, transcript: string) {
  const res = await fetch(`${API_BASE}/api/test/simulate-utterance`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ callControlId, transcript }),
  });

  if (!res.ok) {
    const err = await res.text();
    console.error('simulate-utterance failed:', res.status, err);
    return;
  }

  const data = (await res.json()) as { ok: boolean; response: string; error?: string };
  if (data.ok) {
    console.log(`Callyx : ${data.response}`);
  } else {
    console.error('Error:', data.error);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
