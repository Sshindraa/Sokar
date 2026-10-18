/**
 * Transcription après coup (mode non continu) d'une piste de l'enregistrement, par Deepgram.
 *
 * Deux oreilles indépendantes sur la piste appelant : Nova-3 (le moteur du direct, relancé sans
 * mots-clés) et Whisper hébergé par Deepgram. Sur la piste agent, Nova-3 seul. Aucun appel au
 * modèle de dialogue.
 */

export type EngineId = 'nova' | 'whisper';

/**
 * Tarifs publics en $ par minute, pré-enregistré : estimation pour le chiffrage, la facture
 * Deepgram fait foi.
 */
export const ENGINES: Record<EngineId, { model: string; usdPerMinute: number }> = {
  nova: { model: 'nova-3', usdPerMinute: 0.0043 },
  whisper: { model: 'whisper-large', usdPerMinute: 0.0048 },
};

export interface TranscribedWord {
  text: string;
  /** Secondes depuis le début de la piste. */
  start: number;
  end: number;
  confidence: number;
}

export interface Transcription {
  engine: EngineId;
  model: string;
  words: TranscribedWord[];
  text: string;
  durationSec: number;
  costUsd: number;
}

export function engineQuery(engine: EngineId): string {
  const params = new URLSearchParams({ model: ENGINES[engine].model, language: 'fr' });
  if (engine === 'nova') {
    // « euh » est une reprise de parole ; les nombres en chiffres rendent l'alignement structurel.
    params.set('filler_words', 'true');
    params.set('numerals', 'true');
    params.set('punctuate', 'true');
  }
  return params.toString();
}

interface DeepgramWord {
  word?: string;
  start?: number;
  end?: number;
  confidence?: number;
}

interface DeepgramBody {
  metadata?: { duration?: number };
  results?: {
    channels?: Array<{
      alternatives?: Array<{ transcript?: string; words?: DeepgramWord[] }>;
    }>;
  };
}

export function parseDeepgramResponse(engine: EngineId, body: DeepgramBody): Transcription {
  const alternative = body.results?.channels?.[0]?.alternatives?.[0];
  if (!alternative) throw new Error('Deepgram response has no channel');
  const durationSec = body.metadata?.duration ?? 0;
  return {
    engine,
    model: ENGINES[engine].model,
    words: (alternative.words ?? []).map((word) => ({
      text: word.word ?? '',
      start: word.start ?? 0,
      end: word.end ?? 0,
      confidence: word.confidence ?? 0,
    })),
    text: alternative.transcript ?? '',
    durationSec,
    costUsd: (durationSec / 60) * ENGINES[engine].usdPerMinute,
  };
}

export async function transcribeWithDeepgram(
  wav: Uint8Array,
  engine: EngineId,
  options: { apiKey: string; fetchImpl?: typeof fetch },
): Promise<Transcription> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const response = await fetchImpl(`https://api.deepgram.com/v1/listen?${engineQuery(engine)}`, {
    method: 'POST',
    headers: { Authorization: `Token ${options.apiKey}`, 'Content-Type': 'audio/wav' },
    body: wav,
    signal: AbortSignal.timeout(120_000),
  });
  if (!response.ok) throw new Error(`Deepgram ${engine} transcription failed: ${response.status}`);
  return parseDeepgramResponse(engine, (await response.json()) as DeepgramBody);
}

/** Une transcription après coup d'une piste : appelée avec le WAV mono de la piste. */
export type Transcriber = (wav: Uint8Array, engine: EngineId) => Promise<Transcription>;
