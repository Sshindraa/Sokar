import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const SRC_ROOT = join(__dirname, '..', '..', '..');

function sourceFiles(directory: string): string[] {
  return readdirSync(directory).flatMap((entry) => {
    const path = join(directory, entry);
    if (statSync(path).isDirectory()) return entry === '__tests__' ? [] : sourceFiles(path);
    return /\.ts$/.test(entry) && !/\.test\.ts$/.test(entry) ? [path] : [];
  });
}

describe('identifiants de job BullMQ', () => {
  // BullMQ refuse un identifiant personnalisé qui contient « : » (« Custom Id cannot contain : ») ;
  // les tests simulent la file et ne le voient pas, l'envoi réel échoue alors à l'ajout du job.
  it('aucun jobId littéral ne contient « : »', () => {
    const offenders = sourceFiles(SRC_ROOT).filter((file) =>
      /jobId:\s*[`'"][^`'"]*:/.test(readFileSync(file, 'utf8')),
    );
    expect(offenders).toEqual([]);
  });
});
