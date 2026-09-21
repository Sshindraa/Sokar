/**
 * Garde-fou R1-1 : un worker qui n'est pas importé par `workers/index.ts` ne
 * démarre jamais, sans aucun signe visible (la file se remplit, personne ne la
 * consomme). Ce test échoue dès qu'un fichier `*.worker.ts` est ajouté sans son
 * import.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const SRC_DIR = path.resolve(process.cwd(), 'src');
const WORKERS_DIR = path.join(SRC_DIR, 'workers');
const INDEX_PATH = path.join(WORKERS_DIR, 'index.ts');

function walk(dir: string, files: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry === '__tests__') continue;
      walk(full, files);
    } else if (entry.endsWith('.worker.ts')) {
      files.push(full);
    }
  }
  return files;
}

describe('registre des workers', () => {
  it('importe chaque fichier *.worker.ts du dépôt', () => {
    const index = readFileSync(INDEX_PATH, 'utf8');
    const workerFiles = walk(SRC_DIR);

    // Garde-fou du garde-fou : si le parcours ne trouve plus rien, le test
    // passerait pour de mauvaises raisons.
    expect(workerFiles.length).toBeGreaterThan(25);

    const missing = workerFiles
      .map((file) => {
        const relative = path
          .relative(WORKERS_DIR, file)
          .split(path.sep)
          .join('/')
          .replace(/\.ts$/, '');
        return relative.startsWith('.') ? relative : `./${relative}`;
      })
      .filter((specifier) => !index.includes(`'${specifier}'`));

    expect(missing).toEqual([]);
  });
});
