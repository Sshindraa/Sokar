/**
 * Banc narrowband (phase 1) — corpus FR de réservation et informations critiques.
 *
 * Même esprit que `phrases.ts` (banc existant) : phrases déterministes, voix
 * fixes, bruit et pertes à seeds fixes. Ici la mesure porte sur la chaîne
 * audio seule, donc chaque phrase déclare ses **informations critiques**
 * attendues sous forme normalisée (voir `nb-normalize.ts`).
 *
 * Catégories couvertes : chiffres (couverts et pièges six/dix, deux/douze),
 * heures (`vingt heures trente`, `19h45`) et dates, noms propres et épellation,
 * numéros de téléphone **fictifs** (plage ARCEP 06 39 98 xx xx).
 */

export type CriticalCategory = 'chiffres' | 'heures' | 'noms' | 'telephone' | 'dates';

export interface CriticalInfo {
  category: CriticalCategory;
  /** Valeur normalisée attendue, telle que produite par `normalizeTokens`. */
  value: string;
  /** Libellé lisible du fait mesuré. */
  label: string;
}

export interface BenchClip {
  id: string;
  text: string;
  critical: CriticalInfo[];
}

/** Voix Cartesia (mêmes identifiants que `phrases.ts`, plusieurs timbres). */
export const BENCH_VOICES = [
  'd9f4af15-c402-4f50-bbda-d8823d028d6a', // Henri, masculin
  '3b7d569e-01fc-45ef-b74b-29460956c691', // Josette, féminin
  '9d216805-e52e-4b1e-966a-6447df592a5d', // Fabien, masculin
  '63fdecc2-4e1d-4aa3-a442-27204e3cd3b5', // Léonie, féminin
] as const;

/**
 * Bruit de fond fixe : un seed par répétition de la variante bruitée, avec un
 * SNR décroissant pour couvrir un restaurant calme puis bruyant.
 */
export const NOISE_SEEDS: ReadonlyArray<{ seed: number; snrDb: number; label: string }> = [
  { seed: 20260924, snrDb: 15, label: 'restaurant calme' },
  { seed: 20261001, snrDb: 10, label: 'restaurant bruyant' },
  { seed: 20261101, snrDb: 7, label: 'rue / salle pleine' },
];

/** Nombre de répétitions de la variante propre sur un audio identique. */
export const CLEAN_REPEATS = 3;

function chiffres(value: string, text: string, id: string): BenchClip {
  return { id, text, critical: [{ category: 'chiffres', value, label: 'nombre de couverts' }] };
}

function heure(value: string, text: string, id: string): BenchClip {
  return { id, text, critical: [{ category: 'heures', value, label: 'heure' }] };
}

function nom(value: string, text: string, id: string): BenchClip {
  return { id, text, critical: [{ category: 'noms', value, label: 'nom de réservation' }] };
}

function tel(value: string, text: string, id: string): BenchClip {
  return { id, text, critical: [{ category: 'telephone', value, label: 'téléphone' }] };
}

function date(value: string, text: string, id: string): BenchClip {
  return { id, text, critical: [{ category: 'dates', value, label: 'jour' }] };
}

export const NB_CORPUS: BenchClip[] = [
  // Chiffres : couverts et paires pièges.
  chiffres('4', 'Pour quatre personnes, s’il vous plaît.', 'c01'),
  chiffres('6', 'On sera six.', 'c02'),
  chiffres('10', 'Nous serons dix.', 'c03'),
  chiffres('2', 'Une table pour deux personnes.', 'c04'),
  chiffres('12', 'On sera douze.', 'c05'),
  chiffres('13', 'Il y aura treize personnes.', 'c06'),
  chiffres('16', 'Seize personnes, je pense.', 'c07'),
  chiffres('3', 'Une table pour trois, s’il vous plaît.', 'c08'),
  chiffres('7', 'Nous sommes sept.', 'c09'),
  chiffres('5', 'Cinq personnes pour dîner.', 'c10'),

  // Heures : formes parlées et forme collée.
  heure('20:30', 'Vers vingt heures trente, s’il vous plaît.', 'h01'),
  heure('19:45', 'À dix-neuf heures quarante-cinq.', 'h02'),
  heure('19:45', 'On arrive à 19h45.', 'h03'),
  heure('12:15', 'Plutôt midi et quart.', 'h04'),
  heure('20:00', 'Vers huit heures du soir.', 'h05'),
  heure('21:30', 'Vingt et une heures trente.', 'h06'),
  heure('13:00', 'À treize heures pile.', 'h07'),
  heure('22:00', 'Vers vingt-deux heures.', 'h08'),

  // Dates.
  date('samedi', 'Pour samedi soir, s’il vous plaît.', 'd01'),
  date('mercredi', 'Plutôt mercredi midi.', 'd02'),
  date('vendredi', 'Vendredi prochain, ce serait bien.', 'd03'),
  date('demain', 'Demain soir.', 'd04'),

  // Noms propres, dont deux épellations.
  nom('lefevre', 'C’est au nom de Lefèvre.', 'n01'),
  nom('dupont', 'Au nom de Dupont.', 'n02'),
  nom('moreau', 'Le nom, c’est Moreau.', 'n03'),
  nom('ferreira', 'Je m’appelle Ferreira.', 'n04'),
  nom('lefevre', 'C’est L-E-F-È-V-R-E.', 'n05'),
  nom('dupont', 'D-U-P-O-N-T, Dupont.', 'n06'),

  // Téléphones fictifs (plage réservée à la fiction 06 39 98 xx xx).
  tel('0639981234', 'Mon numéro, c’est zéro six trois neuf neuf huit un deux trois quatre.', 't01'),
  tel('0639985678', 'C’est le zéro six, trois neuf, neuf huit, cinq six, sept huit.', 't02'),
  tel(
    '0639987654',
    'Le numéro c’est zéro six, trois neuf, neuf huit, sept six, cinq quatre.',
    't03',
  ),
];

/** Voix « premade » ElevenLabs (multilingues), alternance homme/femme. */
export const ELEVENLABS_BENCH_VOICES = [
  'pNInz6obpgDQGcFmaJgB', // Adam
  'EXAVITQu4vr4xnSDxMaL', // Sarah
  'ErXwobaYiN019PkySvjV', // Antoni
  '21m00Tcm4TlvDq8ikWAM', // Rachel
];

export function clipVoice(index: number, provider: string = 'cartesia'): string {
  const voices = provider === 'elevenlabs' ? ELEVENLABS_BENCH_VOICES : BENCH_VOICES;
  return voices[index % voices.length];
}

export const ALL_CATEGORIES: CriticalCategory[] = [
  'chiffres',
  'heures',
  'noms',
  'telephone',
  'dates',
];
