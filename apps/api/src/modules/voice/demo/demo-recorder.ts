/**
 * Enregistrement local d'un appel de démonstration, pour pouvoir l'écouter après coup.
 *
 * Réservé au développement : actif seulement si `LIVE_DEMO_RECORDING_DIR` est défini, et jamais en
 * production. Produit un MP3 stéréo comme l'enregistrement d'un vrai appel (appelant à gauche,
 * agent à droite), dans un dossier hors dépôt. L'audio est une donnée personnelle : il n'est jamais
 * commité et rien de son contenu n'est écrit dans les journaux.
 *
 * Calage : l'appelant est placé à l'heure d'arrivée de ses trames (le navigateur les envoie en temps
 * réel). L'agent est placé comme le lecteur les jouerait : une trame commence quand la précédente
 * finit (les trames d'une réplique en cache arrivent d'un coup), et un `clear` (interruption) coupe
 * ce qui n'a pas encore été joué.
 */

import { execFile } from 'node:child_process';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';

const run = promisify(execFile);
const BYTES_PER_MS = 8; // G.711 A-law, 8 kHz, 1 octet par échantillon
const ALAW_SILENCE = 0xd5;

type Chunk = { startMs: number; data: Buffer };

export function liveDemoRecordingDir(env: NodeJS.ProcessEnv = process.env): string | null {
  if (env.NODE_ENV === 'production') return null;
  const dir = env.LIVE_DEMO_RECORDING_DIR?.trim();
  return dir ? dir : null;
}

export class DemoCallRecorder {
  private readonly startedAt: number;
  private readonly inbound: Chunk[] = [];
  private outbound: Chunk[] = [];
  private playEndMs = 0;

  constructor(private readonly now: () => number = Date.now) {
    this.startedAt = now();
  }

  private elapsed(): number {
    return this.now() - this.startedAt;
  }

  addInbound(payloadBase64: string): void {
    const data = Buffer.from(payloadBase64, 'base64');
    if (data.length > 0) this.inbound.push({ startMs: this.elapsed(), data });
  }

  /** Reçoit un message tel qu'envoyé au navigateur (JSON) ; ignore tout ce qui n'est pas audio. */
  addOutbound(raw: unknown): void {
    if (typeof raw !== 'string') return;
    let msg: { event?: string; media?: { payload?: string } };
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }
    const at = this.elapsed();
    if (msg.event === 'clear') {
      this.outbound = this.outbound.flatMap((chunk) => {
        if (chunk.startMs >= at) return [];
        const keep = Math.floor((at - chunk.startMs) * BYTES_PER_MS);
        return keep < chunk.data.length
          ? [{ ...chunk, data: chunk.data.subarray(0, keep) }]
          : [chunk];
      });
      this.playEndMs = Math.min(this.playEndMs, at);
      return;
    }
    const payload = msg.event === 'media' ? msg.media?.payload : undefined;
    if (typeof payload !== 'string' || payload.length === 0) return;
    const data = Buffer.from(payload, 'base64');
    const startMs = Math.max(at, this.playEndMs);
    this.outbound.push({ startMs, data });
    this.playEndMs = startMs + data.length / BYTES_PER_MS;
  }

  private static render(chunks: Chunk[], totalBytes: number): Buffer {
    const track = Buffer.alloc(totalBytes, ALAW_SILENCE);
    let cursor = 0;
    for (const chunk of chunks) {
      const at = Math.max(Math.round(chunk.startMs * BYTES_PER_MS), cursor);
      if (at >= totalBytes) continue;
      const slice = chunk.data.subarray(0, totalBytes - at);
      slice.copy(track, at);
      cursor = at + slice.length;
    }
    return track;
  }

  /** Écrit `<dir>/<id>.mp3` ; renvoie le chemin, ou null s'il n'y a rien à enregistrer. */
  async save(dir: string, id: string): Promise<string | null> {
    const end = Math.max(
      ...this.inbound.map((c) => c.startMs + c.data.length / BYTES_PER_MS),
      ...this.outbound.map((c) => c.startMs + c.data.length / BYTES_PER_MS),
      0,
    );
    if (end <= 0) return null;
    const totalBytes = Math.ceil(end * BYTES_PER_MS);
    await mkdir(dir, { recursive: true, mode: 0o700 });
    const left = join(dir, `${id}.caller.alaw`);
    const right = join(dir, `${id}.agent.alaw`);
    const out = join(dir, `${id}.mp3`);
    try {
      await writeFile(left, DemoCallRecorder.render(this.inbound, totalBytes));
      await writeFile(right, DemoCallRecorder.render(this.outbound, totalBytes));
      await run('ffmpeg', [
        '-y',
        '-loglevel',
        'error',
        ...['-f', 'alaw', '-ar', '8000', '-ac', '1', '-i', left],
        ...['-f', 'alaw', '-ar', '8000', '-ac', '1', '-i', right],
        ...['-filter_complex', '[0:a][1:a]amerge=inputs=2[a]', '-map', '[a]', '-ac', '2'],
        ...['-codec:a', 'libmp3lame', '-b:a', '64k', out],
      ]);
      return out;
    } finally {
      await Promise.all([rm(left, { force: true }), rm(right, { force: true })]);
    }
  }
}
