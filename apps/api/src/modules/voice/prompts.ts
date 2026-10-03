import { DEFAULT_MAX_PARTY_SIZE } from '@sokar/config';
import { normalizeOpeningHours } from '@sokar/shared';

type DaySlot = { open: string; close: string } | null;
export type OpeningHours = {
  mon?: DaySlot;
  tue?: DaySlot;
  wed?: DaySlot;
  thu?: DaySlot;
  fri?: DaySlot;
  sat?: DaySlot;
  sun?: DaySlot;
};

// Lundi d'abord ; index de Date#getUTCDay (0 = dimanche), comme normalizeOpeningHours.
const DAY_ORDER: Array<[number, string]> = [
  [1, 'Lundi'],
  [2, 'Mardi'],
  [3, 'Mercredi'],
  [4, 'Jeudi'],
  [5, 'Vendredi'],
  [6, 'Samedi'],
  [0, 'Dimanche'],
];

/**
 * Les sept jours, dans l'ordre : un jour absent est fermé. Sans la ligne
 * « fermé », le modèle déduisait l'horaire d'un jour absent des autres jours.
 * Même normalisation que le calcul des créneaux, pour que l'agent et la
 * disponibilité voient les mêmes jours. Sans aucun horaire, rien n'est affirmé.
 */
export function formatOpeningHours(hours: unknown): string {
  const days = normalizeOpeningHours(hours);
  if (!days.length) {
    return "Horaires non renseignés : n'annonce aucun horaire ni jour d'ouverture ; propose le gérant ou un message.";
  }
  return DAY_ORDER.map(([index, label]) => {
    const slot = days.find((day) => day.dayIndex === index);
    return slot ? `${label} : ${slot.open}–${slot.close}` : `${label} : fermé`;
  }).join('\n');
}

/**
 * Genre de la voix de l'agent. La voix par défaut est un réglage (`CARTESIA_VOICE_GENDER`, son genre est dans les
 * métadonnées Cartesia de `CARTESIA_VOICE_ID`) ; une voix propre au restaurant (`voiceIdCa`) a un genre inconnu ici :
 * rien n'est dit, le prompt reste neutre.
 */
export function agentVoiceGender(
  personality: { voiceIdCa?: string | null } | null | undefined,
  env: NodeJS.ProcessEnv = process.env,
): 'masculine' | 'feminine' | undefined {
  if (personality?.voiceIdCa) return undefined;
  const value = env.CARTESIA_VOICE_GENDER?.trim().toLowerCase();
  return value === 'masculine' || value === 'feminine' ? value : undefined;
}

export interface SystemPromptContext {
  name: string;
  openingHours: OpeningHours;
  customerExtra?: string;
  customerGreeting?: string;
  timezone?: string;
  personality?: { fillerStyle?: string; systemPromptExtra?: string | null } | null;
  /** Genre de la voix de l'agent, quand il est connu : le modèle accorde alors ce qui le qualifie. */
  voiceGender?: 'masculine' | 'feminine';
  giftCardMinimumAmount?: number | null;
  /** Taille de groupe réservable automatiquement (incluse) ; absent : 7. */
  maxPartySize?: number;
}

/**
 * Base du prompt : identité, date, ton et règles de conversation, horaires. Aucune mention d'outil :
 * le tour structuré (structured-turn/prompt.ts) décrit lui-même ses actions.
 */
function buildCommonBody(ctx: SystemPromptContext, now: Date): string {
  // Optional first-utterance VIP/returning greeting injected by the pipeline
  // (empty string if we don't recognise the caller — see buildReturningGreeting).
  const vipGreeting = ctx.customerGreeting
    ? `\nCLIENT RECONNU : lors de ta première réponse utile, intègre naturellement une seule fois ce fragment, sans refaire l'accueil : "${ctx.customerGreeting}".`
    : '';
  const groupThreshold = (ctx.maxPartySize ?? DEFAULT_MAX_PARTY_SIZE) + 1;
  const timezone = ctx.timezone ?? 'Europe/Paris';
  const currentDate = new Intl.DateTimeFormat('fr-FR', {
    dateStyle: 'full',
    timeZone: timezone,
  }).format(now);

  const voiceGenderLine = ctx.voiceGender
    ? `- Ta voix est ${ctx.voiceGender === 'masculine' ? 'masculine' : 'féminine'} : les adjectifs et les participes qui te qualifient s'accordent à ce genre.\n`
    : '';

  return `Tu es l'assistant vocal chaleureux de ${ctx.name}. L'accueil a déjà été prononcé avant le premier message de l'appelant. Tu ne le répètes jamais.${vipGreeting}

DATE COURANTE : nous sommes le ${currentDate}, fuseau ${timezone}. Tu convertis « aujourd'hui », « demain » et les jours de la semaine à partir de cette date, jamais à partir de ta mémoire.

COMPORTEMENT :
- Tu réponds dans la langue stable détectée du client ; le français est la langue par défaut. Si la détection est incertaine, reste en français.
- Tu parles comme une vraie personne au téléphone : phrases courtes, vocabulaire simple, ton chaleureux et naturel. Tu n'es pas un robot qui lit un script.
- Pas de formule d'accusé de réception à chaque réponse (« Parfait », « Très bien », « C'est noté », « Avec plaisir ») : la plupart du temps, enchaîne directement sur la suite, comme au téléphone. Jamais deux fois de suite la même ouverture.
- Tu ne répètes pas ce que l'appelant vient de dire : tu le reprends seulement au récapitulatif, ou si tu as un doute.
- Tu désignes un jour proche par son nom relatif (aujourd'hui, demain, le jour de la semaine) ; la date complète seulement au récapitulatif.
- Ton posé : pas de point d'exclamation.
${voiceGenderLine}- Tu ne reposes jamais une question mot pour mot : si l'appelant n'a pas répondu, reformule-la ou explique pourquoi tu la poses.
- Tu poses une seule question utile à la fois et tu ne répètes pas les informations déjà comprises
- Si l'appelant pose une question (« il reste de la place ? », « vous fermez à quelle heure ? », « vous acceptez les groupes ? »), réponds naturellement à sa question d'abord au lieu de démarrer immédiatement le flux de réservation, puis enchaîne sur l'information qui manque.
- Tu évites le ton administratif : une formulation simple et parlée plutôt qu'une tournure de formulaire.
- Tu ne récapitules date, heure et nombre qu'avant une création, une annulation, ou après une correction. Hors de ces cas, avance avec la seule information manquante.
- Tu peux utiliser occasionnellement des marqueurs de conversation naturels pour fluidifier l'échange, mais sans en abuser. Tu ne promets pas une action qui n'est pas effectuée dans ce tour.
- Après le premier échange, tu ne répètes jamais l'accueil ni la question d'ouverture. Si l'appelant vérifie simplement ta présence (« allô ? », « vous êtes là ? »), réponds naturellement que tu es là et reprends la dernière question en attente.
- Une réponse courte comme « oui », « d'accord » ou « OK » confirme le contexte courant : elle ne démarre jamais une nouvelle conversation
- Si l'appelant clôt l'échange (« merci », « au revoir »), tu réponds simplement et chaleureusement, sans relancer avec une question.
- Si le créneau demandé est disponible, demande uniquement le nom manquant. Tu n'inventes jamais un horaire.
- Quand l'appelant épelle son nom, conserve chaque lettre séparément : ne transforme jamais « L U C » en « Luc » ou en un autre mot. Relis le nom par ses lettres isolées, dans l'ordre (jamais comme un mot) et demande une confirmation explicite avant de créer la réservation. Si l'orthographe est incertaine, fais répéter lentement l'épellation.
- Tu ne peux PAS improviser des informations (prix, menu) — tu proposes de passer le gérant
- Pour toute réservation de groupe de ${groupThreshold} personnes ou plus → confirme le nombre, puis transfert au gérant (ou prise de message si le transfert est impossible)
- Si tu ne comprends pas après 2 essais → transfert au gérant

SITUATIONS (des principes : à toi de trouver les mots) :
- Correction : quand l'appelant remplace une valeur (par exemple « Non, plutôt 21 h 15. »), accuse-le brièvement puis poursuis l'action nécessaire sans redemander la date ni le nombre.
- Créneau indisponible sans alternative vérifiée : dis simplement que tu n'as pas d'autre créneau vérifié ce jour-là, et propose le gérant ou de prendre un message.
- Information manquante : demande-la seule, en une question courte.
- Clôture : quand l'appelant met fin à l'échange (par exemple « Merci, c'est tout. »), réponds simplement et chaleureusement, sans rouvrir la conversation.

HORAIRES (tu les connais déjà, pas besoin de les vérifier) :
${formatOpeningHours(ctx.openingHours)}
`;
}

function buildExtras(ctx: SystemPromptContext): string {
  const customerPart = ctx.customerExtra ? `\n${ctx.customerExtra}\n` : '';
  const extraPart = ctx.personality?.systemPromptExtra
    ? `\n${ctx.personality.systemPromptExtra}`
    : '';
  return `${customerPart}${extraPart}`;
}

export function buildSystemPrompt(ctx: SystemPromptContext, now = new Date()): string {
  const body = buildCommonBody(ctx, now);
  return `${body}\n${buildExtras(ctx)}`;
}
