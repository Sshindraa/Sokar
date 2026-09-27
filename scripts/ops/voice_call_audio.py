#!/usr/bin/env python3
"""Analyse l'enregistrement d'un appel vocal, au-delà de la transcription.

Récupère l'enregistrement privé (MP3 deux pistes : appelant à gauche, agent à
droite) depuis le VPS, qui seul détient les accès au stockage, puis mesure ce
que la transcription ne montre pas : silences réellement perçus par
l'appelant, chevauchements (l'agent coupe l'appelant, ou l'inverse), niveau de
bruit, saturation. Produit aussi un spectrogramme des deux pistes.

L'audio est une donnée personnelle : il est écrit hors du dépôt
(`$TMPDIR/sokar-call-audio/<appel>` par défaut) et n'est jamais commité. Les
enregistrements n'existent que pour les restaurants de
CALL_RECORDING_TEST_RESTAURANT_IDS et expirent après 30 jours au plus.

Usage :
  python3 scripts/ops/voice_call_audio.py latest --restaurant <id>
  python3 scripts/ops/voice_call_audio.py <début-de-l-id-d-appel>
Options : --host deploy@sokar  --out <dossier>  --no-fetch (réanalyse)
Dépendances locales : ffmpeg, numpy.
"""
from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
import tempfile
from datetime import datetime
from pathlib import Path

import numpy as np

SAMPLE_RATE = 8000
FRAME_MS = 20
CHANNELS = ("appelant", "agent")

# Exécuté sur le VPS depuis /opt/sokar/apps/api (code compilé déjà déployé).
REMOTE_FETCH = r"""
const { db } = require('./dist/shared/db/client.js');
const { getPrivateRecording } = require('./dist/modules/voice/call-recording.service.js');
(async () => {
  // Avec `node -e`, les arguments suivent directement l'exécutable.
  const [selector, restaurantId] = process.argv.slice(1);
  const where = selector === 'latest'
    ? { restaurantId, recordingStatus: 'AVAILABLE' }
    : { id: { startsWith: selector } };
  const call = await db.call.findFirst({
    where,
    orderBy: { createdAt: 'desc' },
    select: { id: true, restaurantId: true, recordingStatus: true, recordingStorageKey: true,
              recordingStartedAt: true, createdAt: true, durationSec: true },
  });
  if (!call) { process.stderr.write('Appel introuvable\n'); process.exit(2); }
  if (call.recordingStatus !== 'AVAILABLE' || !call.recordingStorageKey) {
    process.stderr.write(`Enregistrement indisponible (${call.recordingStatus})\n`); process.exit(3);
  }
  const object = await getPrivateRecording(call.recordingStorageKey);
  const chunks = [];
  for await (const chunk of object.Body) chunks.push(chunk);
  const meta = { id: call.id, restaurantId: call.restaurantId, durationSec: call.durationSec,
                 createdAt: call.createdAt, recordingStartedAt: call.recordingStartedAt };
  const header = Buffer.from(JSON.stringify(meta) + '\n');
  process.stdout.write(Buffer.concat([header, ...chunks]), () => process.exit(0));
})().catch((err) => { process.stderr.write(String(err && err.message) + '\n'); process.exit(1); });
"""

# Dialogue par tour (route interne en lecture seule, jeton lu sur le VPS).
REMOTE_TURNS = r"""
NAME=SOKAR_VOICE_READ_TOKEN
T=$(sed -n "s/^${NAME}=//p" .env | head -1 | tr -d '"')
curl -sf -H "Authorization: Bearer $T" "http://127.0.0.1:4000/api/internal/voice/calls/$1"
"""


def run_remote(host: str, script: str, args: list[str], node: bool) -> bytes:
    remote_cmd = (
        "cd /opt/sokar/apps/api && "
        + ("node --env-file=.env -e \"$(cat)\" " if node else "bash -s -- ")
        + " ".join(args)
    )
    result = subprocess.run(
        ["ssh", host, remote_cmd], input=script.encode(), capture_output=True, check=False
    )
    if result.returncode != 0:
        noise = result.stderr.decode(errors="replace").strip().splitlines()
        message = [line for line in noise if '"level":30' not in line][-3:]
        raise SystemExit(f"Échec côté VPS : {' / '.join(message) or result.returncode}")
    return result.stdout


def fetch(host: str, selector: str, restaurant: str | None, out_root: Path) -> Path:
    if selector == "latest" and not restaurant:
        raise SystemExit("« latest » demande --restaurant <id>.")
    raw = run_remote(host, REMOTE_FETCH, [selector, restaurant or "-"], node=True)
    header, _, audio = raw.partition(b"\n")
    meta = json.loads(header)
    folder = out_root / meta["id"][:8]
    folder.mkdir(parents=True, exist_ok=True)
    (folder / "call.mp3").write_bytes(audio)
    try:
        turns = json.loads(run_remote(host, REMOTE_TURNS, [meta["id"]], node=False))
        meta["turns"] = turns.get("turns", [])
    except (SystemExit, json.JSONDecodeError):
        meta["turns"] = []
    (folder / "meta.json").write_text(json.dumps(meta, ensure_ascii=False, indent=1))
    return folder


def decode_channel(mp3: Path, channel: int) -> np.ndarray:
    pcm = subprocess.run(
        ["ffmpeg", "-v", "error", "-i", str(mp3), "-af", f"pan=mono|c0=c{channel}",
         "-ar", str(SAMPLE_RATE), "-f", "s16le", "-"],
        capture_output=True, check=True,
    ).stdout
    return np.frombuffer(pcm, dtype=np.int16).astype(np.float32) / 32768.0


def speech_segments(samples: np.ndarray) -> tuple[list[tuple[float, float]], dict]:
    """Détection d'énergie : seuil adaptatif au bruit de fond de la piste."""
    frame = SAMPLE_RATE * FRAME_MS // 1000
    count = len(samples) // frame
    frames = samples[: count * frame].reshape(count, frame)
    rms = np.sqrt(np.mean(frames**2, axis=1)) + 1e-9
    db = 20 * np.log10(rms)
    floor = float(np.percentile(db, 10))
    threshold = max(floor + 10.0, -50.0)
    active = db > threshold
    segments: list[list[float]] = []
    start = None
    for index, on in enumerate(active):
        if on and start is None:
            start = index
        elif not on and start is not None:
            segments.append([start * FRAME_MS / 1000, index * FRAME_MS / 1000])
            start = None
    if start is not None:
        segments.append([start * FRAME_MS / 1000, count * FRAME_MS / 1000])
    merged: list[list[float]] = []
    for segment in segments:  # une pause < 350 ms reste dans la même prise de parole
        if merged and segment[0] - merged[-1][1] < 0.35:
            merged[-1][1] = segment[1]
        else:
            merged.append(segment)
    kept = [(round(a, 2), round(b, 2)) for a, b in merged if b - a >= 0.15]
    speech_db = db[active]
    stats = {
        "noise_floor_dbfs": round(floor, 1),
        "speech_level_dbfs": round(float(np.percentile(speech_db, 50)), 1) if speech_db.size else None,
        "clipped_ratio": round(float(np.mean(np.abs(samples) >= 0.99)), 5),
    }
    return kept, stats


def spectrogram(mp3: Path, folder: Path, duration: float) -> Path:
    width = int(min(4000, max(1200, duration * 30)))
    target = folder / "spectrogram.png"
    subprocess.run(
        ["ffmpeg", "-v", "error", "-y", "-i", str(mp3), "-lavfi",
         f"showspectrumpic=s={width}x400:mode=separate:legend=1:color=intensity:scale=log",
         str(target)],
        check=True,
    )
    return target


def recording_offset(meta: dict, iso: str | None) -> float | None:
    if not iso or not meta.get("recordingStartedAt"):
        return None
    start = datetime.fromisoformat(meta["recordingStartedAt"].replace("Z", "+00:00"))
    return round((datetime.fromisoformat(iso.replace("Z", "+00:00")) - start).total_seconds(), 2)


def report(folder: Path) -> str:
    meta = json.loads((folder / "meta.json").read_text())
    mp3 = folder / "call.mp3"
    tracks = {}
    for channel, name in enumerate(CHANNELS):
        segments, stats = speech_segments(decode_channel(mp3, channel))
        tracks[name] = {"segments": segments, **stats}
    duration = max((s[1] for t in tracks.values() for s in t["segments"]), default=0.0)
    image = spectrogram(mp3, folder, duration)

    events = sorted(
        [(a, b, name) for name, t in tracks.items() for a, b in t["segments"]],
        key=lambda item: item[0],
    )
    lines = [
        f"# Appel {meta['id'][:8]} — écoute instrumentée",
        f"Enregistrement démarré {meta.get('recordingStartedAt')} (l'accueil peut le précéder). "
        f"Durée analysée : {duration:.1f} s.",
        "",
        "| Piste | Bruit de fond | Niveau de parole | Saturation |",
        "|---|---|---|---|",
    ]
    for name, t in tracks.items():
        lines.append(
            f"| {name} | {t['noise_floor_dbfs']} dBFS | {t['speech_level_dbfs']} dBFS "
            f"| {t['clipped_ratio'] * 100:.2f} % |"
        )
    lines += ["", "## Chronologie (secondes depuis le début de l'enregistrement)", ""]
    lines += ["| Début | Fin | Qui | Remarque |", "|---|---|---|---|"]
    last_caller_end = None
    for index, (start, end, name) in enumerate(events):
        notes = []
        overlap = [
            other for other in events
            if other[2] != name and other[0] < start < other[1]
        ]
        if overlap:
            other = overlap[0]
            notes.append(
                f"commence pendant que l'{other[2]} parle ({other[1] - start:.1f} s de chevauchement)"
            )
        if name == "agent" and last_caller_end is not None and start >= last_caller_end:
            notes.append(f"silence perçu : {start - last_caller_end:.2f} s")
        if name == "appelant":
            last_caller_end = end
        elif start >= (last_caller_end or 0):
            last_caller_end = None
        lines.append(f"| {start:.2f} | {end:.2f} | {name} | {'; '.join(notes)} |")

    if meta.get("turns"):
        lines += ["", "## Tours transcrits, recalés sur l'enregistrement", ""]
        for turn in meta["turns"]:
            at = recording_offset(meta, turn.get("speechEndAt"))
            where = f"fin de parole ≈ {at:.2f} s" if at is not None else "position inconnue"
            lines.append(f"- #{turn['sequence']} ({where}) « {turn.get('callerText') or ''} »"
                         f" → « {turn.get('agentText') or ''} »")
    lines += ["", f"Spectrogramme : {image}", f"Audio (privé, hors dépôt) : {mp3}"]
    text = "\n".join(lines) + "\n"
    (folder / "report.md").write_text(text)
    return text


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("call", help="début de l'id d'appel, ou « latest »")
    parser.add_argument("--restaurant", help="restaurant (obligatoire avec latest)")
    parser.add_argument("--host", default=os.environ.get("SOKAR_SSH_HOST", "deploy@sokar"))
    parser.add_argument("--out", type=Path,
                        default=Path(tempfile.gettempdir()) / "sokar-call-audio")
    parser.add_argument("--no-fetch", action="store_true", help="réanalyse un dossier déjà récupéré")
    args = parser.parse_args()
    if args.no_fetch:
        folder = args.out / args.call[:8]
    else:
        folder = fetch(args.host, args.call, args.restaurant, args.out)
    sys.stdout.write(report(folder))


if __name__ == "__main__":
    main()
