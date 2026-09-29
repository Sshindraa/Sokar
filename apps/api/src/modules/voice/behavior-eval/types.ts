/**
 * Jeu de test de comportements du tour structuré.
 *
 * Chaque cas rejoue un moment réel d'un appel (historique, phrase de l'appelant,
 * état du brouillon) devant le modèle et mesure, sur plusieurs tirages, la part des
 * réponses qui respectent un comportement. Les contrôles sont structurels (champs du
 * JSON de sortie) ; un motif dans la phrase dite ne sert qu'à *interdire* une dérive
 * connue, jamais à imposer une formulation. Rien de tout cela n'est utilisé à
 * l'exécution : le modèle décide, le jeu mesure.
 */
export interface BehaviorMessage {
  role: 'user' | 'assistant';
  content: string;
}

export type BehaviorCheck =
  /** Part des tirages où un champ de premier niveau du JSON vaut (ou ne vaut pas) une valeur. */
  | { kind: 'field'; path: string; equals?: unknown; notEquals?: unknown; minRate: number }
  /** Part des tirages où un champ du brouillon vaut une valeur (casse ignorée pour le texte). */
  | { kind: 'draft'; field: string; equals: string | number; minRate: number }
  /** Part des tirages où la phrase dite contient (expect=true) ou évite (expect=false) un motif. */
  | { kind: 'say'; pattern: string; expect: boolean; minRate: number }
  /** Nombre moyen de mots de la phrase dite, au plus. */
  | { kind: 'sayWords'; maxMean: number }
  /** Part des tirages où la dernière phrase dite ne recopie pas la question donnée. */
  | { kind: 'noRepeatOf'; text: string; minRate: number };

export interface BehaviorCase {
  id: string;
  /** Comportement visé, pour regrouper le rapport. */
  behavior: string;
  /** D'où vient le cas (appel, tour). */
  source: string;
  /** Dialogue précédent, en ligne ou par nom dans `histories` du fichier. */
  history: BehaviorMessage[] | string;
  transcript: string;
  draft?: Partial<{ date: string; time: string; partySize: number; customerName: string }>;
  awaiting?: string;
  reservationCreated?: boolean;
  /** Résultat d'action déjà exécutée : la réponse ne peut plus qu'être dite ou terminer l'appel. */
  actionResult?: string;
  dayPart?: string;
  samples?: number;
  checks: BehaviorCheck[];
}

export interface BehaviorCasesFile {
  version: number;
  today: string;
  histories?: Record<string, BehaviorMessage[]>;
  cases: BehaviorCase[];
}

export interface BehaviorResponses {
  model: string;
  /** Sorties JSON du modèle par cas ; null quand la réponse est invalide. */
  responses: Record<string, (Record<string, unknown> | null)[]>;
}

export interface CheckResult {
  description: string;
  rate: number;
  required: number;
  passed: boolean;
}

export interface CaseResult {
  id: string;
  behavior: string;
  valid: number;
  samples: number;
  passed: boolean;
  checks: CheckResult[];
}
