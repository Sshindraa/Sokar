import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { DemoCallRecorder, liveDemoRecordingDir } from '../demo-recorder';

const frame = (ms: number) => Buffer.alloc(ms * 8, 0x55).toString('base64');
const media = (ms: number) => JSON.stringify({ event: 'media', media: { payload: frame(ms) } });

describe('liveDemoRecordingDir', () => {
  it('est inactif sans variable et refusé en production', () => {
    expect(liveDemoRecordingDir({ NODE_ENV: 'development' })).toBeNull();
    expect(liveDemoRecordingDir({ NODE_ENV: 'development', LIVE_DEMO_RECORDING_DIR: ' /x ' })).toBe(
      '/x',
    );
    expect(
      liveDemoRecordingDir({ NODE_ENV: 'production', LIVE_DEMO_RECORDING_DIR: '/x' }),
    ).toBeNull();
  });
});

describe('DemoCallRecorder', () => {
  const dirs: string[] = [];
  afterEach(() => dirs.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true })));

  it("n'écrit rien quand l'appel est vide", async () => {
    const dir = mkdtempSync(join(tmpdir(), 'demo-rec-'));
    dirs.push(dir);
    await expect(new DemoCallRecorder().save(dir, 'vide')).resolves.toBeNull();
    expect(readdirSync(dir)).toEqual([]);
  });

  it('écrit un MP3 stéréo de la durée de l’appel, sans fichiers temporaires', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'demo-rec-'));
    dirs.push(dir);
    let now = 1_000;
    const recorder = new DemoCallRecorder(() => now);
    recorder.addInbound(frame(20));
    now += 1_000;
    // Une réplique de 1,5 s arrive d'un coup : elle est jouée à la suite, pas superposée.
    recorder.addOutbound(media(500));
    recorder.addOutbound(media(500));
    recorder.addOutbound(media(500));
    now += 3_000;

    const file = await recorder.save(dir, 'appel');
    expect(file).toBe(join(dir, 'appel.mp3'));
    expect(existsSync(file as string)).toBe(true);
    expect(readdirSync(dir)).toEqual(['appel.mp3']);

    const probe = JSON.parse(
      execFileSync('ffprobe', [
        ...['-v', 'error', '-show_entries', 'stream=channels:format=duration', '-of', 'json'],
        file as string,
      ]).toString(),
    );
    expect(probe.streams[0].channels).toBe(2);
    expect(Number(probe.format.duration)).toBeGreaterThan(2.3);
    expect(Number(probe.format.duration)).toBeLessThan(3);
  });

  it('un clear coupe ce qui n’a pas encore été joué', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'demo-rec-'));
    dirs.push(dir);
    let now = 0;
    const recorder = new DemoCallRecorder(() => now);
    recorder.addOutbound(media(2_000));
    now += 500;
    recorder.addOutbound(JSON.stringify({ event: 'clear' }));
    now += 500;
    recorder.addInbound(frame(20));

    const file = await recorder.save(dir, 'coupe');
    const duration = Number(
      execFileSync('ffprobe', [
        ...['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0'],
        file as string,
      ])
        .toString()
        .trim(),
    );
    // 500 ms joués avant le clear, puis 500 ms de silence : bien moins que les 2 s envoyées.
    expect(duration).toBeLessThan(1.3);
  });
});
