/**
 * Mesure avant / après : répétition mot pour mot après une information donnée hors de la question attendue.
 *
 *   tsx scripts/voice-repetition-ab.ts build > requests.json        (premier passage)
 *   tsx scripts/voice-repetition-ab.ts build pass2 > requests.json  (second passage avec le fait du garde-fou)
 *
 * Scénario : l'agent demande le nombre de personnes ; l'appelant donne une heure. Le tour structuré doit retenir
 * l'heure, garder la date, ne rien inventer pour le nombre, et ne pas reposer sa question mot pour mot.
 * Même tour que la production (buildRequest). Le rejeu est fait par voice-behavior-replay.mjs (VBE_ARM_B).
 */
import { readFile } from 'node:fs/promises';
import { buildRequest } from '../src/modules/voice/behavior-eval/build';
import { askedAgainFact } from '../src/modules/voice/stream/structured-turn/asked-again';
import type { BehaviorCase, BehaviorCasesFile } from '../src/modules/voice/behavior-eval/types';

const CASES = 'scripts/fixtures/voice-behavior/cases.json';
const DRAWS = Number(process.env.REP_DRAWS) || 3;

const SCENARIO = {
  id: 'repetition-heure-donnee-au-lieu-du-nombre',
  behavior:
    'Heure donnée à la place du nombre de personnes : retenue, date gardée, question non répétée',
  family: 'repetition',
  measures: 'model',
  origin: 'control',
  source: 'simulation de bout en bout du 09/10/2026 (maison gastronomique, tour 2)',
  history: [
    { role: 'user', content: 'vous êtes ouvert demain' },
    {
      role: 'assistant',
      content:
        'Oui, demain nous sommes ouverts de midi à vingt-deux heures. Pour combien de personnes souhaitez-vous réserver ?',
    },
  ],
  transcript: 'vers vingt heures',
  draft: { date: '2026-09-30', time: '', partySize: 0, customerName: '' },
  awaiting: 'partySize',
  samples: DRAWS,
  checks: [],
} as unknown as BehaviorCase;

/**
 * Second passage du moteur : le modèle a repris sa question ; le fait produit par le garde-fou est transmis avec
 * le brouillon de ce tour (heure retenue). Aucun appel ici : la requête est seulement construite.
 */
function pass2Request(file: BehaviorCasesFile) {
  const before = { date: '2026-09-30', time: '', partySize: 0, customerName: '' };
  const draft = { ...before, time: '20:00' };
  const fact = askedAgainFact({
    lastAwaiting: 'partySize',
    outputAwaiting: 'partySize',
    changed: ['time'],
    before,
    after: draft,
    timeSlotStillValid: false,
  });
  if (!fact) throw new Error('Le garde-fou ne se déclenche pas sur le cas de référence.');
  return buildRequest(
    { ...SCENARIO, id: 'repetition-pass2', draft, actionResult: fact } as unknown as BehaviorCase,
    file,
  );
}

async function build(mode: string) {
  const file = JSON.parse(await readFile(CASES, 'utf8')) as BehaviorCasesFile;
  const requests = mode === 'pass2' ? [pass2Request(file)] : [buildRequest(SCENARIO, file)];
  process.stderr.write(`${requests.length} requête × ${DRAWS} tirages (${mode}).\n`);
  process.stdout.write(JSON.stringify({ requests }));
}

build(process.argv[3] ?? 'pass1').catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
