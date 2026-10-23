"""Fin de tour Nova-3 vs Flux sur les vraies pistes (sortie de call-eot-replay.ts + eot_pauses.py) : décalage par rapport
à la fin de parole mesurée, fins prématurées, tours sans fin de tour, tours transcrits par un seul modèle.
Usage : python3 -I eot_evaluate.py <tours.json> <replay.json> <stats.json>. Sortie : comptes et durées seulement."""
import json, sys, collections
import numpy as np

turns = json.load(open(sys.argv[1]))
replay = json.load(open(sys.argv[2]))["results"]
EARLY = 150  # ms : un événement plus tôt que E - EARLY tombe alors que l'appelant va encore parler

def eot_events(res):
    out, eager, text_since = [], [], []
    for e in res["events"]:
        k = e["kind"]
        if res["model"] == "flux-general-multi":
            if k == "EndOfTurn" and e.get("transcript"):
                out.append((e["atAudioMs"], e["transcript"]))
            elif k == "EagerEndOfTurn" and e.get("transcript"):
                eager.append((e["atAudioMs"], e["transcript"]))
        else:
            if k == "Results" and e.get("isFinal") and e.get("transcript"):
                text_since.append(e["transcript"])
            if k == "Results" and e.get("speechFinal") and text_since:
                out.append((e["atAudioMs"], " ".join(text_since))); text_since = []
            elif k == "UtteranceEnd" and text_since:
                out.append((e["atAudioMs"], " ".join(text_since))); text_since = []
    return out, eager

by_call = collections.defaultdict(list)
for t in turns:
    by_call[t["call"]].append(t)
stats = {}
for res in replay:
    if res["error"]:
        print("erreur", res["call"], res["model"], res["error"]); continue
    ends, eager = eot_events(res)
    ts = sorted(by_call[res["call"]], key=lambda t: t["A"])
    for i, t in enumerate(ts):
        start = t["segs"][0][0]
        E = t["segs"][-1][1]
        stop = min(t["A"] + 1500, ts[i + 1]["segs"][0][0] if i + 1 < len(ts) else 1e12)
        inwin = [x for x in ends if start + 200 <= x[0] < stop]
        early = [x for x in inwin if x[0] < E - EARLY]
        late = [x for x in inwin if x[0] >= E - EARLY]
        eg = [x for x in eager if E - EARLY <= x[0] < stop]
        eg_early = [x for x in eager if start + 200 <= x[0] < E - EARLY]
        # Pause qui suit une fin prématurée : combien de temps avant que l'appelant reprenne.
        resume = []
        for x in early:
            nxt = [s[0] for s in t["segs"] if s[0] > x[0]]
            if nxt: resume.append(nxt[0] - x[0])
        stats.setdefault(res["model"], []).append({
            "call": t["call"], "A": t["A"], "E": E, "gapReal": t["A"] - E, "pauses": t["pauses"],
            "early": len(early), "resumeAfterEarly": resume,
            "lat": (late[0][0] - E) if late else None,
            "eagerLat": (eg[0][0] - E) if eg else None, "eagerEarly": len(eg_early),
            "words": sum(len(x[1].split()) for x in inwin),
        })

models = list(stats)
print("tours", {m: len(v) for m, v in stats.items()})
for m in models:
    v = stats[m]
    lat = np.array([x["lat"] for x in v if x["lat"] is not None])
    miss = sum(1 for x in v if x["lat"] is None)
    early_turns = sum(1 for x in v if x["early"])
    rs = [r for x in v for r in x["resumeAfterEarly"]]
    print(f"\n== {m}")
    print(f"fin de tour après la fin de parole : {len(lat)} ; p25/p50/p75/p90 = {np.percentile(lat,[25,50,75,90]).round()}")
    print(f"aucune fin de tour avant la réponse réelle (+1,5 s) : {miss}")
    print(f"tours avec fin prématurée (l'appelant reparle ensuite) : {early_turns} ; reprise après la fin prématurée p50/p90 = {np.percentile(rs,[50,90]).round() if rs else '-'} (n={len(rs)})")
    if m.startswith("flux"):
        el = np.array([x["eagerLat"] for x in v if x["eagerLat"] is not None])
        print(f"EagerEndOfTurn après la fin de parole : {len(el)} ; p50/p90 = {np.percentile(el,[50,90]).round()} ; tours avec Eager prématuré : {sum(1 for x in v if x['eagerEarly'])}")
    print("mots reconnus (somme)", sum(x["words"] for x in v))
# Comparaison appariée
if len(models) == 2:
    a = {(x["call"], x["A"]): x for x in stats[models[0]]}
    b = {(x["call"], x["A"]): x for x in stats[models[1]]}
    both = [(a[k]["lat"], b[k]["lat"]) for k in a if k in b and a[k]["lat"] is not None and b[k]["lat"] is not None]
    d = np.array([y - x for x, y in both])
    print(f"\napparié ({models[1]} - {models[0]}) sur {len(d)} tours : p25/p50/p75 = {np.percentile(d,[25,50,75]).round()}, {models[1]} plus rapide dans {int((d<0).sum())} tours")
    only_a = sum(1 for k in a if k in b and a[k]["words"] and not b[k]["words"])
    only_b = sum(1 for k in a if k in b and b[k]["words"] and not a[k]["words"])
    print(f"tours avec texte chez {models[0]} seulement : {only_a} ; chez {models[1]} seulement : {only_b}")
json.dump(stats, open(sys.argv[3], "w"))

# Tours transcrits par un seul modèle, fenêtre élargie (+3 s après la réponse réelle), par catégorie.
import re

R = {(r["call"], r["model"]): r for r in replay}


def final_texts(call, model, lo, hi):
    return " ".join(e["transcript"] for e in R[(call, model)]["events"]
                    if lo <= e["atAudioMs"] < hi and e.get("transcript") and (e["kind"] == "EndOfTurn" or e.get("isFinal")))


def spelled(text):
    tokens = [x for x in re.split(r"[\s,.;:!?-]+", text.lower()) if x]
    return len(tokens) >= 2 and sum(1 for x in tokens if re.fullmatch(r"[^\W_]", x)) / len(tokens) >= 0.5


if {"nova-3", "flux-general-multi"} <= set(models):
    counts = collections.Counter()
    for t in turns:
        lo, hi = t["segs"][0][0] - 300, t["A"] + 3000
        nova, flux = final_texts(t["call"], "nova-3", lo, hi), final_texts(t["call"], "flux-general-multi", lo, hi)
        if not nova and not flux:
            counts["aucun texte"] += 1
            continue
        text = nova or flux
        category = "épellation" if spelled(text) else ("1-2 mots" if len(text.split()) <= 2 else "3+ mots")
        counts[(category, "nova" if nova else "-", "flux" if flux else "-")] += 1
    print("\ntranscription par modèle (fenêtre +3 s) :")
    for key, value in sorted(counts.items(), key=str):
        print(value, key)
