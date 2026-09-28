#!/usr/bin/env node
/**
 * Construit le jeu d'évaluation figé des signaux sémantiques (Jev).
 *
 * 1. Génère des tours de conversation téléphonique synthétiques, en français,
 *    répartis par catégorie (actions sensibles comprises), au style d'une
 *    transcription STT (minuscules, peu de ponctuation, « euh »).
 * 2. Les étiquette par vote : le juge est interrogé deux fois (température 0,3),
 *    un troisième passage tranche chaque désaccord à la majorité. Un seul modèle
 *    (MiMo v2.6 Pro par défaut) : le vote réduit ses erreurs aléatoires, pas ses
 *    biais systématiques.
 * 3. Écrit un JSONL au format de `semantic:eval` : { id, category, awaitingBefore,
 *    input, output, labels }.
 *
 * Données entièrement synthétiques : aucune donnée d'appel réel n'est envoyée.
 *
 *   OPENROUTER_API_KEY=… node scripts/ops/semantic-dataset/build.mjs \
 *     --defs defs.json --out synthetic.jsonl [--per-category 20]
 *
 * `defs.json` : { behaviors: [{ id, instructions, present, absent }] }, exporté
 * depuis semantic-signals/behaviors.ts (voir README.md).
 */
import { readFileSync, writeFileSync } from 'node:fs';

const args = process.argv.slice(2);
const arg = (name, fallback) => {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : fallback;
};
const key = process.env.OPENROUTER_API_KEY?.trim();
if (!key) throw new Error('OPENROUTER_API_KEY est requis');
const DEFS = JSON.parse(readFileSync(arg('--defs', 'defs.json'), 'utf8'));
const OUT = arg('--out', 'synthetic.jsonl');
const PER_CATEGORY = Number(arg('--per-category', '20'));
// MiMo v2.6 Pro : 12/12 sur les cas difficiles, comme Sonnet 5, pour 1/16 du prix.
const GENERATOR = arg('--generator', 'xiaomi/mimo-v2.6-pro');
const JUDGE = arg('--judge', 'xiaomi/mimo-v2.6-pro');
const JUDGE_TEMPERATURE = 0.3;
const BATCH = 5;

const CATEGORIES = [
  [
    'confirmation',
    'confirmation',
    "le client accepte clairement le récapitulatif de l'agent, parfois familièrement (« ouais », « vas-y », « c'est parfait »)",
  ],
  [
    'hesitation',
    'confirmation',
    'le client hésite face au récapitulatif sans accepter ni refuser (« euh », « attendez », « je sais pas »)',
  ],
  [
    'refus',
    'confirmation',
    'le client refuse ou conteste le récapitulatif, y compris « oui mais en fait… » ou une demande de changement',
  ],
  [
    'correction',
    'date|time|partySize|customerName',
    "le client corrige dans son message une information qu'il avait donnée plus tôt dans le contexte (« non plutôt samedi », « finalement on sera cinq »)",
  ],
  [
    'reponse_simple',
    'date|time|partySize|customerName',
    'le client répond simplement et fermement à la question (date, heure, nombre, nom), sans rien corriger',
  ],
  [
    'incertain',
    'date|time|partySize',
    'le client donne une information en exprimant un vrai doute (« peut-être quatre je sais pas encore », « à confirmer »)',
  ],
  [
    'autre_question',
    'date|time|partySize|open',
    'au lieu de répondre, le client pose une autre question (horaires, terrasse, parking, menu, allergies, animaux)',
  ],
  [
    'gerant',
    'date|time|partySize|open|confirmation',
    "le client demande explicitement à parler au gérant, à un responsable ou à quelqu'un",
  ],
  ['message', 'humanFallback|open', 'le client demande explicitement à laisser un message'],
  [
    'annulation',
    'open|confirmation',
    "le client demande explicitement d'annuler une réservation ; inclure aussi des cas où il veut seulement décaler (pas d'annulation)",
  ],
  [
    'carte_cadeau',
    'open',
    "le client demande à acheter une carte cadeau ; inclure aussi des cas où il demande seulement s'il peut en utiliser une",
  ],
  [
    'ambigu',
    'humanFallback|confirmation|partySize|time',
    'réponse ambiguë ou transcription abîmée : « oui » à une question « A ou B ? », mots mal transcrits (« un an 19 »), phrase coupée',
  ],
];

const post = async (url, body, timeoutMs = 120_000) => {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (response.ok) return await response.json();
    } catch {
      // nouvelle tentative
    }
  }
  return null;
};
// max_tokens borné : sans limite, OpenRouter réserve le maximum du modèle (402).
const chat = (model, messages, schema, temperature, maxTokens = 1_500) =>
  post('https://openrouter.ai/api/v1/chat/completions', {
    model,
    temperature,
    max_tokens: maxTokens,
    messages,
    response_format: { type: 'json_schema', json_schema: { name: 'out', strict: true, schema } },
  }).then((json) => {
    try {
      return JSON.parse(json.choices[0].message.content);
    } catch {
      return null;
    }
  });

const msg = {
  type: 'object',
  properties: {
    role: { type: 'string', enum: ['user', 'assistant'] },
    content: { type: 'string' },
  },
  required: ['role', 'content'],
  additionalProperties: false,
};
const caseSchema = {
  type: 'object',
  properties: {
    cases: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          awaitingBefore: { type: 'string' },
          context: { type: 'array', items: msg },
          agentQuestion: { type: 'string' },
          clientMessage: { type: 'string' },
          agentReply: { type: 'string' },
        },
        required: ['awaitingBefore', 'context', 'agentQuestion', 'clientMessage', 'agentReply'],
        additionalProperties: false,
      },
    },
  },
  required: ['cases'],
  additionalProperties: false,
};

async function generate([category, awaiting, description], count, seed) {
  const prompt = [
    `Génère ${count} tours de conversation téléphonique DIFFÉRENTS entre un agent vocal de restaurant (vouvoiement) et un client, en français.`,
    `Catégorie : ${description}.`,
    `awaitingBefore (ce que l'agent attendait) parmi : ${awaiting}.`,
    "context : 0 à 4 messages antérieurs (alternance client/agent) quand c'est utile, sinon vide.",
    "agentQuestion : la dernière phrase de l'agent juste avant le message du client.",
    'clientMessage : le message du client, écrit COMME UNE TRANSCRIPTION TÉLÉPHONIQUE : minuscules, peu ou pas de ponctuation, hésitations (« euh », « bah »), parfois des mots mal reconnus.',
    "agentReply : la réponse suivante de l'agent (courte).",
    `Varie les restaurants, les dates, les heures, les tailles de groupe, les tournures et les accents régionaux. Graine de variété : ${seed}.`,
  ].join('\n');
  const out = await chat(GENERATOR, [{ role: 'user', content: prompt }], caseSchema, 0.9, 4_000);
  return out?.cases ?? [];
}

const LABEL = { anyOf: [{ type: 'boolean' }, { type: 'string', enum: ['not_observable'] }] };
const ids = DEFS.behaviors.map((behavior) => behavior.id);
const judgeSchema = {
  type: 'object',
  properties: {
    reasoning: { type: 'string' },
    labels: {
      type: 'object',
      properties: Object.fromEntries(ids.map((id) => [id, LABEL])),
      required: ids,
      additionalProperties: false,
    },
  },
  required: ['reasoning', 'labels'],
  additionalProperties: false,
};
const judgeSystem = [
  'Vous annotez des conversations téléphoniques de réservation en français.',
  'Évaluez uniquement le MESSAGE DU CLIENT À ÉVALUER, à la lumière de la DERNIÈRE QUESTION DE L’AGENT. Le contexte antérieur sert seulement à comprendre les références.',
  'Pour chaque comportement, répondez true, false ou not_observable (uniquement si le message ne permet pas de trancher).',
  ...DEFS.behaviors.map(
    (b) => `- ${b.id}: ${b.instructions} Présent si : ${b.present}. Absent si : ${b.absent}.`,
  ),
].join('\n');

/** Même cadrage que formatDecisionState (eval-request.ts), sans la réponse de l'agent. */
function formatState(input) {
  const lastUser = input.map((m) => m.role).lastIndexOf('user');
  const questionIndex =
    lastUser > 0 && input[lastUser - 1].role === 'assistant' ? lastUser - 1 : -1;
  const context = input.slice(0, questionIndex >= 0 ? questionIndex : Math.max(lastUser, 0));
  const speaker = (role) => (role === 'user' ? 'Client' : 'Agent');
  return [
    context.length
      ? `CONTEXTE ANTÉRIEUR (à ne pas évaluer) :\n${context.map((e) => `${speaker(e.role)} : ${e.content}`).join('\n')}`
      : null,
    questionIndex >= 0 ? `DERNIÈRE QUESTION DE L'AGENT : ${input[questionIndex].content}` : null,
    `MESSAGE DU CLIENT À ÉVALUER : ${input[lastUser].content}`,
  ]
    .filter(Boolean)
    .join('\n');
}
const judge = (input) =>
  chat(
    JUDGE,
    [
      { role: 'system', content: judgeSystem },
      { role: 'user', content: formatState(input) },
    ],
    judgeSchema,
    JUDGE_TEMPERATURE,
  ).then((out) => out?.labels ?? null);

async function pool(items, size, worker) {
  const results = new Array(items.length);
  let cursor = 0;
  await Promise.all(
    Array.from({ length: size }, async () => {
      while (cursor < items.length) {
        const index = cursor++;
        results[index] = await worker(items[index], index);
      }
    }),
  );
  return results;
}

// 1. Génération
const jobs = CATEGORIES.flatMap((category) =>
  Array.from({ length: Math.ceil(PER_CATEGORY / BATCH) }, (_, batch) => ({ category, batch })),
);
const generated = (
  await pool(jobs, 6, ({ category, batch }) => generate(category, BATCH, `${category[0]}-${batch}`))
).flatMap((cases, index) => cases.map((c) => ({ ...c, category: jobs[index].category[0] })));
const seen = new Set();
const cases = generated.filter((c) => {
  const k = c.clientMessage.trim().toLowerCase();
  if (!c.clientMessage.trim() || !c.agentQuestion.trim() || seen.has(k)) return false;
  seen.add(k);
  return true;
});
process.stderr.write(
  `générés : ${generated.length}, gardés après dédoublonnage : ${cases.length}\n`,
);

// 2. Étiquetage : deux votes, un troisième sur les désaccords (majorité)
let disagreements = 0;
const labeled = await pool(cases, 6, async (c, index) => {
  const input = [
    ...c.context,
    { role: 'assistant', content: c.agentQuestion },
    { role: 'user', content: c.clientMessage },
  ];
  const [a, b] = await Promise.all([judge(input), judge(input)]);
  if (!a || !b) return null;
  const disputed = ids.filter((id) => a[id] !== b[id]);
  let arbiter = null;
  if (disputed.length) {
    disagreements++;
    arbiter = await judge(input);
    if (!arbiter) return null;
  }
  const labels = Object.fromEntries(
    ids.map((id) => [id, disputed.includes(id) ? arbiter[id] : a[id]]),
  );
  return {
    id: `syn-${String(index + 1).padStart(3, '0')}`,
    category: c.category,
    awaitingBefore: c.awaitingBefore,
    input,
    output: { role: 'assistant', content: c.agentReply },
    labels,
    disputed,
  };
});
const rows = labeled.filter(Boolean);
writeFileSync(OUT, `${rows.map((row) => JSON.stringify(row)).join('\n')}\n`);
const positives = Object.fromEntries(
  ids.map((id) => [id, rows.filter((r) => r.labels[id] === true).length]),
);
process.stderr.write(
  `écrits : ${rows.length} (avec au moins un désaccord tranché : ${disagreements})\npositifs par comportement : ${JSON.stringify(positives)}\n`,
);
