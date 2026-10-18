/**
 * Question redondante au tour structuré : l'agent redemande une information déjà connue, ou repose la question qu'il
 * vient de poser alors que l'appelant a donné autre chose et que sa réplique ne le prend pas en compte.
 *
 * Critère structurel : les champs attendus, les champs du brouillon avant et après le tour, et les champs modifiés.
 * Aucune comparaison de mots : une question reformulée reste une question sur le même champ. Le second passage reçoit
 * un fait ; le modèle formule la suite lui-même, sans formule imposée. Le nom garde son circuit de confirmation.
 */

/** Champs dont la question peut être redondante. Le nom est exclu : il a son propre circuit d'épellation. */
const ASKABLE: Record<string, string> = {
  date: 'le jour',
  time: "l'heure",
  partySize: 'le nombre de personnes',
};

/** Champs qu'on ne demande pas deux fois une fois donnés. */
const REPEATABLE_FIELDS = ['date', 'partySize'];

function isFilled(value: unknown): boolean {
  return value !== undefined && value !== null && value !== '' && value !== 0;
}

export interface AskedAgainInput {
  /** Champ attendu au tour précédent (state.lastAwaiting). */
  lastAwaiting: string;
  /** Champ que la sortie du modèle déclare attendre ce tour. */
  outputAwaiting: string;
  /** Champs du brouillon modifiés ce tour. */
  changed: readonly string[];
  /** Brouillon avant ce tour. */
  before: Record<string, unknown>;
  /** Brouillon après ce tour. */
  after: Record<string, unknown>;
  /** Vrai quand le créneau gardé est encore vérifié pour ce jour et ce nombre de personnes (isSlotVerified). */
  timeSlotStillValid: boolean;
}

/** Fait pour le second passage, ou null quand il n'y a rien à corriger. */
export function askedAgainFact(input: AskedAgainInput): string | null {
  const asked = input.outputAwaiting;
  if (ASKABLE[asked] === undefined) return null;

  // 1. Information donnée avant ce tour, et pourtant redemandée. L'heure reste couverte tant que son créneau est
  // valable ; une correction (changed), une ambiguïté (traitée par le moteur) ou une indisponibilité la rouvrent.
  const covered = asked === 'time' ? input.timeSlotStillValid : REPEATABLE_FIELDS.includes(asked);
  if (covered && isFilled(input.before[asked]) && !input.changed.includes(asked)) {
    return `Tu redemandes ce qui est déjà retenu : ${ASKABLE[asked]} (${String(input.after[asked])}). Ne le redemande pas et ne le reprends pas : passe à ce qui manque, ou à la suite de l'appel.`;
  }

  // 2. Même question qu'au tour précédent, alors que l'appelant vient de donner une autre information.
  if (input.lastAwaiting === asked && !input.changed.includes(asked)) {
    const other = input.changed.find((field) => ASKABLE[field] !== undefined);
    if (other !== undefined) {
      return `L'appelant vient de donner ${ASKABLE[other]} (${String(input.after[other])}) : c'est retenu dans le brouillon. Tu attendais encore ${ASKABLE[asked]} : ne reprends pas ce qu'il vient de dire, et pose directement la question sur ${ASKABLE[asked]}, avec d'autres mots que ta question précédente.`;
    }
  }
  return null;
}
