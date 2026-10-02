import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import os from 'node:os';
import path from 'node:path';
import { readCallLogLines } from '../call-report/log-files';

const line = (iso: string, extra = '') =>
  `2026-10-02 14:00:00: {"time":"${iso}","msg":"x${extra}"}`;
const T = (iso: string) => Date.parse(iso);

describe('readCallLogLines', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(path.join(os.tmpdir(), 'call-report-logs-'));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  function write(name: string, lines: string[], mtimeIso: string) {
    const file = path.join(dir, name);
    const text = `${lines.join('\n')}\n`;
    writeFileSync(file, name.endsWith('.gz') ? gzipSync(text) : text);
    utimesSync(file, new Date(mtimeIso), new Date(mtimeIso));
  }

  it('garde les lignes de la fenêtre, dans le fichier courant et dans les fichiers tournés', async () => {
    write('api-out.log', [line('2026-10-03T00:30:00.000Z', 'cur')], '2026-10-03T01:00:00Z');
    write(
      'api-out.log.1',
      [line('2026-10-02T23:59:50.000Z', 'a'), line('2026-10-02T12:00:00.000Z', 'out')],
      '2026-10-03T00:00:00Z',
    );
    write('api-out.log.2.gz', [line('2026-10-02T00:00:10.000Z', 'older')], '2026-10-02T00:00:00Z');

    const lines = await readCallLogLines({
      dir,
      fromMs: T('2026-10-02T23:59:00Z'),
      toMs: T('2026-10-03T00:31:00Z'),
    });
    expect(lines.map((item) => item.match(/x(\w+)"/)![1]).sort()).toEqual(['a', 'cur']);
  });

  it('lit un fichier compressé', async () => {
    write('api-out.log.3.gz', [line('2026-10-01T23:43:03.000Z', 'gz')], '2026-10-02T00:00:00Z');
    const lines = await readCallLogLines({
      dir,
      fromMs: T('2026-10-01T23:42:00Z'),
      toMs: T('2026-10-01T23:46:00Z'),
    });
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('xgz');
  });

  it('ne lit pas un fichier dont la dernière écriture précède la fenêtre', async () => {
    write('api-out.log.9.gz', [line('2026-09-20T10:00:00.000Z', 'old')], '2026-09-21T00:00:00Z');
    const lines = await readCallLogLines({
      dir,
      fromMs: T('2026-10-02T10:00:00Z'),
      toMs: T('2026-10-02T10:05:00Z'),
    });
    expect(lines).toEqual([]);
  });

  it('renvoie une liste vide quand le dossier de journaux est absent', async () => {
    expect(await readCallLogLines({ dir: path.join(dir, 'nope'), fromMs: 0, toMs: 1 })).toEqual([]);
  });
});
