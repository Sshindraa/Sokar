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

/**
 * Contrôle évalué sur UN tirage : vrai ou faux. Tous sont structurels (champs du JSON de
 * sortie, brouillon) ; `say` ne sert qu'à interdire une dérive connue, jamais à imposer une
 * formulation, et aucun nouveau motif de phrase n'est ajouté.
 */
export type SamplePredicate =
  /** Un champ de premier niveau du JSON vaut (ou ne vaut pas) une valeur. */
  | { kind: 'field'; path: string; equals?: unknown; notEquals?: unknown }
  /** Un champ du brouillon vaut une valeur (casse ignorée pour le texte). */
  | { kind: 'draft'; field: string; equals: string | number }
  /** Les champs listés du brouillon sortant sont ceux du brouillon entrant : rien n'a été retenu. */
  | { kind: 'draftUnchanged'; fields: string[] }
  /** Un champ de premier niveau appartient à une liste de valeurs. */
  | { kind: 'fieldIn'; path: string; values: unknown[] }
  /** La phrase dite contient (expect=true) ou évite (expect=false) un motif. */
  | { kind: 'say'; pattern: string; expect: boolean }
  /** La dernière phrase dite ne recopie pas la question donnée. */
  | { kind: 'noRepeatOf'; text: string };

export type BehaviorCheck =
  /** Part des tirages où le contrôle est tenu, au moins `minRate`. */
  | (SamplePredicate & { minRate: number })
  /** Part des tirages où AU MOINS UN des contrôles est tenu (mesuré tirage par tirage, pas en moyenne). */
  | { kind: 'anyOf'; of: SamplePredicate[]; minRate: number }
  /** Nombre moyen de mots de la phrase dite, au plus. */
  | { kind: 'sayWords'; maxMean: number };

/** Valeurs du brouillon qu'une phrase peut porter et qu'on sait annoter. */
export type SpanField = 'time' | 'partySize' | 'customerName';

/**
 * Sous-chaîne EXACTE de la phrase qui porte une valeur, et la valeur qu'elle porte. C'est une
 * annotation (donnée) : le code ne devine jamais quelle partie d'une phrase est une heure, un nombre
 * ou un nom.
 */
export interface ValueSpan {
  text: string;
  value: string | number;
}

export type BehaviorSplit = 'calibration' | 'holdout';

export type PerturbationKind = 'ablation' | 'substitution' | 'noise';

/** Restaurant du jeu : nom et horaires réels d'une fiche, pour ne pas tout mesurer sur un seul profil. */
export interface BehaviorProfile {
  name: string;
  openingHours: Record<string, { open: string; close: string } | null>;
}

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
  /** Actions que le schéma autorise (par défaut : toutes, ou « none » et « end_call » après un résultat d'action). */
  actions?: string[];
  dayPart?: string;
  /** Le tour vient d'être relancé après un silence de l'appelant sur un fragment inachevé. */
  callerFinished?: boolean;
  /** Relance sans énoncé de l'appelant (parole non comprise, silence, silence après l'accueil). */
  recovery?: 'unheard' | 'silence' | 'opening';
  /** Profil restaurant de `profiles` ; absent : Chez Sokar, ouvert tous les jours 12 h–22 h. */
  profile?: string;
  samples?: number;
  /** Sous-chaînes annotées de `transcript` : d'où partent les variantes dégradées. */
  valueSpans?: Partial<Record<SpanField, ValueSpan>>;
  /** Ce que l'appelant a réellement dit n'est pas établi (écoute humaine à faire) : résultat informatif. */
  truthStatus?: 'unverified';
  /** Explicite ; sinon dérivé d'un hachage de l'identifiant (jamais choisi à la main). */
  split?: BehaviorSplit;
  /** Présent sur les variantes générées par `perturb.ts`, jamais dans le fichier de cas. */
  perturbation?: { kind: PerturbationKind; base: string; field: SpanField };
  checks: BehaviorCheck[];
}

export interface BehaviorCasesFile {
  version: number;
  today: string;
  histories?: Record<string, BehaviorMessage[]>;
  profiles?: Record<string, BehaviorProfile>;
  /** Spans annotés supplémentaires (valeurs simples, sans phrase), donneurs des variantes de substitution. */
  spanPool?: Partial<Record<SpanField, ValueSpan[]>>;
  cases: BehaviorCase[];
}

export interface BehaviorResponses {
  model: string;
  /** Sorties JSON du modèle par cas ; null quand la réponse est invalide. */
  responses: Record<string, (Record<string, unknown> | null)[]>;
}

export interface CheckResult {
  description: string;
  /** Sortie BRUTE du modèle : le chiffre qui compte, sans aucun garde-fou du code. */
  rate: number;
  /**
   * Même contrôle après les garde-fous de fact-guards.ts qui touchent le brouillon (l'épellation du nom).
   * Absent quand le contrôle ne lit pas le brouillon ou que les garde-fous n'y changent rien.
   */
  guardedRate?: number;
  required: number;
  passed: boolean;
}

export interface CaseResult {
  id: string;
  behavior: string;
  split: BehaviorSplit;
  valid: number;
  samples: number;
  /** Informatif : mesuré et rapporté, sans jamais faire échouer le jeu (variantes générées, vérité non établie). */
  informational: boolean;
  passed: boolean;
  checks: CheckResult[];
  perturbation?: BehaviorCase['perturbation'];
  /** Variantes générées : part des tirages où le comportement attendu est tenu (sortie brute). */
  successRate?: number;
  /** Idem après garde-fous du code, quand ils changent quelque chose. */
  guardedSuccessRate?: number;
}

export interface SplitSummary {
  /** Comportements non informatifs tenus / total. */
  held: number;
  total: number;
  /** Variantes générées utilisées par indicateur (sans celles dont trop de réponses sont invalides). */
  variants: Record<PerturbationKind, number>;
  /** Part des tirages d'ablation où une valeur absente de la phrase entre dans le brouillon. */
  falseAcceptRate: number | null;
  /** Part des tirages de substitution où le brouillon suit la phrase plutôt que l'état précédent. */
  fidelityRate: number | null;
  /** Part des tirages avec un mot parasite où la valeur annotée reste extraite. */
  noiseRobustness: number | null;
  /** Les mêmes indicateurs après garde-fous du code (épellation du nom) : l'écart avec le brut est ce que le code rattrape. */
  guarded: {
    falseAcceptRate: number | null;
    fidelityRate: number | null;
    noiseRobustness: number | null;
  };
}

export type BehaviorSummary = Record<BehaviorSplit, SplitSummary>;
