import { z } from 'zod';

/**
 * Regroupement des trames audio avant envoi à Scribe (`VOICE_STT_CHUNK_MS`).
 *
 * Telnyx livre des trames G.711 de 20 ms. Les envoyer une par une (comportement
 * historique) coûte un message WebSocket par trame. Le flag permet d'accumuler
 * plusieurs trames et d'envoyer un message plus gros, sans changer le format
 * ni le codec.
 *
 * Valeurs acceptées :
 *   - `20` (défaut) : envoi immédiat, chemin strictement inchangé ;
 *   - un multiple de 20 entre 40 et 200 : regroupement.
 *
 * Toute autre valeur est refusée au démarrage par la validation Zod de
 * `env.ts`, donc le pipeline ne voit jamais une valeur non supportée.
 */

export const STT_CHUNK_MS_DEFAULT = 20;
export const STT_CHUNK_MS_MIN_BUFFERED = 40;
export const STT_CHUNK_MS_MAX = 200;
export const STT_CHUNK_MS_STEP = 20;

/** Marge du timer de sécurité au-delà de la durée cible. */
export const STT_CHUNK_SAFETY_EXTRA_MS = 20;

export const STT_CHUNK_MS_ERROR_MESSAGE =
  'VOICE_STT_CHUNK_MS doit valoir 20 (défaut) ou un multiple de 20 entre 40 et 200.';

export function isValidSttChunkMs(value: number): boolean {
  if (!Number.isInteger(value)) return false;
  if (value === STT_CHUNK_MS_DEFAULT) return true;
  return (
    value >= STT_CHUNK_MS_MIN_BUFFERED &&
    value <= STT_CHUNK_MS_MAX &&
    value % STT_CHUNK_MS_STEP === 0
  );
}

/**
 * Normalise la variable d'environnement.
 * Absente ou vide → défaut (20). Invalide → `null`, pour que Zod échoue
 * proprement au démarrage plutôt que de retomber silencieusement sur 20.
 */
export function parseSttChunkMs(raw: unknown): number | null {
  if (raw === undefined || raw === null) return STT_CHUNK_MS_DEFAULT;
  const text = String(raw).trim();
  if (text === '') return STT_CHUNK_MS_DEFAULT;
  const value = Number(text);
  return isValidSttChunkMs(value) ? value : null;
}

/**
 * Valeur runtime. Le démarrage a déjà validé la variable : une valeur
 * inattendue (test isolé, process sans `env.ts`) retombe sur le défaut plutôt
 * que de faire échouer l'audio d'un appel en cours.
 */
export function getSttChunkMs(): number {
  return parseSttChunkMs(process.env.VOICE_STT_CHUNK_MS) ?? STT_CHUNK_MS_DEFAULT;
}

export const sttChunkMsSchema = z.preprocess(
  (value) => parseSttChunkMs(value),
  z.number({ invalid_type_error: STT_CHUNK_MS_ERROR_MESSAGE }),
);
