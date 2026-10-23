"""Pauses de l'appelant autour des fins de tour réelles, depuis les enregistrements deux pistes récupérés par
scripts/ops/voice_call_audio.py (hors dépôt). Usage : python3 -I eot_pauses.py <dossier-audio> <tours.json>
Le fichier de sortie contient des temps seulement (aucun texte) ; il reste hors du dépôt avec l'audio."""
import json, subprocess, sys
from datetime import datetime
from pathlib import Path
import numpy as np

SR = 8000
F = 20  # ms

def decode(mp3, ch):
    pcm = subprocess.run(["ffmpeg", "-v", "error", "-i", str(mp3), "-af", f"pan=mono|c0=c{ch}", "-ar", str(SR), "-f", "s16le", "-"], capture_output=True, check=True).stdout
    return np.frombuffer(pcm, dtype=np.int16).astype(np.float32) / 32768.0

def frames_db(x):
    n = SR * F // 1000
    c = len(x) // n
    fr = x[: c * n].reshape(c, n)
    return 20 * np.log10(np.sqrt(np.mean(fr ** 2, axis=1)) + 1e-9)

def active(db):
    floor = float(np.percentile(db, 10))
    return db > max(floor + 10.0, -50.0)

def segments(mask, merge_ms, min_ms):
    segs, start = [], None
    for i, on in enumerate(mask):
        if on and start is None: start = i
        elif not on and start is not None: segs.append([start, i]); start = None
    if start is not None: segs.append([start, len(mask)])
    out = []
    for s in segs:
        if out and (s[0] - out[-1][1]) * F < merge_ms: out[-1][1] = s[1]
        else: out.append(s)
    return [(a * F, b * F) for a, b in out if (b - a) * F >= min_ms]

def analyse(folder):
    mp3 = folder / "call.mp3"
    meta = json.loads((folder / "meta.json").read_text())
    cdb, adb = frames_db(decode(mp3, 0)), frames_db(decode(mp3, 1))
    n = min(len(cdb), len(adb)); cdb, adb = cdb[:n], adb[:n]
    ca, aa = active(cdb), active(adb)
    # Écho de l'agent dans la piste appelant : trame active chez l'agent (ou 100 ms avant) et nettement plus faible.
    agent_near = aa | np.roll(aa, 1) | np.roll(aa, 2) | np.roll(aa, 3) | np.roll(aa, 4) | np.roll(aa, 5)
    echo = ca & agent_near & (cdb < adb - 6)
    caller = segments(ca & ~echo, 120, 100)
    agent = segments(aa, 120, 150)
    # Prises de parole de l'agent : segments fusionnés si l'appelant ne parle pas entre eux.
    utts = []
    for s in agent:
        if utts and s[0] - utts[-1][1] < 900 and not any(c[0] < s[0] and c[1] > utts[-1][1] for c in caller):
            utts[-1][1] = s[1]
        else: utts.append(list(s))
    rec0 = meta.get("recordingStartedAt")
    turns_db = []
    for t in meta.get("turns", []):
        if rec0 and t.get("speechEndAt"):
            off = (datetime.fromisoformat(t["speechEndAt"].replace("Z", "+00:00")) - datetime.fromisoformat(rec0.replace("Z", "+00:00"))).total_seconds() * 1000
            turns_db.append((off, t))
    rows = []
    prev_end = 0
    for u in utts:
        A = u[0]
        win = [c for c in caller if c[0] >= prev_end - 100 and c[1] <= A + 60]
        if win:
            E = win[-1][1]
            pauses = [win[i + 1][0] - win[i][1] for i in range(len(win) - 1)]
            # Reprise de l'appelant après le début de la voix : segment non-écho qui commence pendant la prise de parole.
            over = [c for c in caller if A + 60 < c[0] < min(u[1], A + 2500)]
            spanning = [c for c in caller if c[0] < A - 60 and c[1] > A + 200]
            match = None
            for off, t in turns_db:
                if abs(off - E) < 1200 and (match is None or abs(off - E) < abs(match[0] - E)): match = (off, t)
            t = match[1] if match else {}
            rows.append({
                "call": meta["id"][:8], "A": A, "segs": win, "agentEnd": u[1], "gap": A - E, "speech": E - win[0][0],
                "pauses": pauses, "over": len(over) > 0, "overStart": (over[0][0] - A) if over else None,
                "spanning": len(spanning) > 0,
                "eosFinal": t.get("endOfSpeechToSttFinalMs"), "eosAudio": t.get("endOfSpeechToFirstAudioMs"),
                "filler": t.get("firstAudioIsFiller"), "interrupted": t.get("interrupted"),
                "dbOffsetDelta": round(match[0] - E) if match else None,
                "date": meta["createdAt"][:10],
            })
        prev_end = u[1]
    return rows

if __name__ == "__main__":
    root = Path(sys.argv[1])
    allrows = []
    for folder in sorted(root.iterdir()):
        if (folder / "call.mp3").exists():
            allrows += analyse(folder)
    json.dump(allrows, open(sys.argv[2], "w"))
    print(len(allrows), "tours")
