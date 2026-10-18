/**
 * Lit les lignes de journal de l'API qui couvrent la fenêtre d'un appel, dans le fichier courant et
 * les fichiers tournés (`api-out.log`, `.1`, `.N.gz` : rotation quotidienne, 14 jours).
 *
 * Le worker et l'API sont deux processus : le journal de l'appel est dans les fichiers de l'API, que
 * le worker lit en lecture seule (même VPS, même compte). Un fichier dont la dernière écriture
 * précède la fenêtre ne peut pas la contenir et n'est pas ouvert.
 */
import { createReadStream, existsSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { createGunzip } from 'node:zlib';

const LOG_FILE = /^api-out\.log(\.\d+)?(\.gz)?$/;

function minutePrefixes(fromMs: number, toMs: number): string[] {
  const prefixes = new Set<string>();
  for (let at = fromMs; at <= toMs + 60_000; at += 30_000) {
    prefixes.add(`"time":"${new Date(at).toISOString().slice(0, 16)}`);
  }
  return [...prefixes];
}

export async function readCallLogLines(options: {
  dir: string;
  fromMs: number;
  toMs: number;
}): Promise<string[]> {
  if (!existsSync(options.dir)) return [];
  const prefixes = minutePrefixes(options.fromMs, options.toMs);
  const lines: string[] = [];

  const files = readdirSync(options.dir)
    .filter((name) => LOG_FILE.test(name))
    .map((name) => path.join(options.dir, name))
    .filter((file) => statSync(file).mtimeMs >= options.fromMs);

  for (const file of files) {
    const source = createReadStream(file);
    const input = file.endsWith('.gz') ? source.pipe(createGunzip()) : source;
    const reader = readline.createInterface({ input, crlfDelay: Infinity });
    for await (const line of reader) {
      if (prefixes.some((prefix) => line.includes(prefix))) lines.push(line);
    }
  }
  return lines;
}
