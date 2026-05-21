/**
 * Cache de fillers audio pré-générés pour combler les silences
 * pendant que le LLM réfléchit.
 *
 * Les fillers sont générés au démarrage via Cartesia TTS et mis en cache
 * en mémoire pour être joués instantanément.
 */
import { WebSocket } from 'ws';

interface FillerSet {
  casual: string[];
  warm: string[];
  formal: string[];
}

const FILLERS: FillerSet = {
  casual: [
    "Je regarde ça…",
    "Laissez-moi voir…",
    "Un instant…",
    "Voyons voir…",
    "Alors, je vérifie…",
  ],
  warm: [
    "Pas de souci, je regarde ça !",
    "Je m'en occupe, une seconde…",
    "Je vous dis ça tout de suite !",
    "Alors laissez-moi checker…",
  ],
  formal: [
    "Veuillez patienter un instant…",
    "Je consulte nos disponibilités…",
    "Un moment, s'il vous plaît…",
    "Je regarde cela pour vous…",
  ],
};

/** Cache de chunks audio (base64) pour chaque filler */
const fillerCache = new Map<string, string[]>();
let initialized = false;

/**
 * Génère et cache les fillers audio au démarrage de l'application.
 * À appeler une fois au boot.
 */
export async function initFillerCache(): Promise<void> {
  if (initialized) return;

  const allFillers = [
    ...FILLERS.casual,
    ...FILLERS.warm,
    ...FILLERS.formal,
  ];

  const apiKey = process.env.CARTESIA_API_KEY;
  if (!apiKey) {
    console.warn('[fillers] No CARTESIA_API_KEY — fillers will not be cached');
    initialized = true;
    return;
  }

  let cached = 0;
  await Promise.allSettled(allFillers.map(async (text) => {
    try {
      const chunks = await generateFillerAudio(text);
      if (chunks.length > 0) {
        fillerCache.set(text, chunks);
        cached++;
      }
    } catch {
      // Silently skip failed generations
    }
  }));

  console.log(`[fillers] Cached ${cached}/${allFillers.length} fillers`);
  initialized = true;
}

/**
 * Joue un filler aléatoire sur le WebSocket Telnyx.
 * Choisit le style correspondant à la personnalité du restaurant.
 */
export function playFiller(
  telnyxWs: WebSocket,
  style: 'CASUAL' | 'FORMAL' | 'WARM',
): void {
  if (telnyxWs.readyState !== WebSocket.OPEN) return;

  const pool = FILLERS[style.toLowerCase() as keyof FillerSet];
  const text = pool[Math.floor(Math.random() * pool.length)];

  const cached = fillerCache.get(text);
  if (cached) {
    // Jouer depuis le cache (instantané)
    for (const chunk of cached) {
      telnyxWs.send(JSON.stringify({ event: 'media', media: { payload: chunk } }));
    }
  } else {
    // Fallback textuel (le LLM peut lire ça)
    console.warn('[fillers] No cached audio for:', text);
  }
}

/**
 * Génère un filler audio via Cartesia TTS et retourne les chunks base64.
 */
async function generateFillerAudio(text: string): Promise<string[]> {
  const response = await fetch('https://api.cartesia.ai/tts/sse', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Cartesia-Version': '2026-03-01',
      'X-API-Key': process.env.CARTESIA_API_KEY ?? '',
    },
    body: JSON.stringify({
      model_id: 'sonic-3.5',
      transcript: text,
      voice: {
        mode: 'id',
        id: process.env.CARTESIA_VOICE_ID ?? 'f786b574-daa5-4673-aa0c-cbe3e8534c02',
      },
      output_format: {
        container: 'raw',
        encoding: 'pcm_mulaw',
        sample_rate: 8000,
      },
    }),
  });

  if (!response.ok) {
    throw new Error(`Filler TTS ${response.status}`);
  }

  const chunks: string[] = [];
  const reader = response.body?.getReader();
  if (!reader) throw new Error('No response body');

  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';

    for (const line of lines) {
      if (!line.startsWith('data: ')) continue;
      const data = line.slice(6).trim();
      try {
        const parsed = JSON.parse(data);
        if (parsed.type === 'chunk' && parsed.audio) {
          chunks.push(parsed.audio);
        }
      } catch { /* skip */ }
    }
  }

  return chunks;
}
