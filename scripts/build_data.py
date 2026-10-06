"""Extract every number the site shows from the research repos into site/data/*.json.

Nothing on the page is typed by hand. Sources (read-only, never modified):
  ~/Desktop/literature-mutations      genre mutations, influence network, stylistic matrix
  ~/Desktop/persona-transformers/out  per-author character GPTs + stylometry
  cache/texts/                        full Gutenberg texts (scripts/fetch_texts.py) for sentiment

Run: .venv/bin/python scripts/build_data.py
"""
import json, math, pathlib, re, statistics
from collections import defaultdict

HOME = pathlib.Path.home() / "Desktop"
LM = HOME / "literature-mutations"
PT = HOME / "persona-transformers/out"
ROOT = pathlib.Path(__file__).resolve().parent.parent
OUT = ROOT / "site/data"
OUT.mkdir(parents=True, exist_ok=True)


def load(p):
    return json.load(open(p))


def r(x, n=4):
    return None if x is None else round(float(x), n)


def write(name, obj):
    p = OUT / name
    p.write_text(json.dumps(obj, separators=(",", ":"), ensure_ascii=False))
    print(f"{name:20s} {p.stat().st_size/1024:8.1f} KB")


# ---------------------------------------------------------------- works + genres
results = load(LM / "results.json")
canon = load(LM / "_data/canon.json")
books = load(LM / "_data/books.json")["books"]
gid_by = {(b["title"], b["author"]): b.get("gutenberg_id") for b in books}

genres = []
for i, c in enumerate(results["communities"]):
    genres.append({
        "id": i, "name": c["genre_name"], "size": int(c["size"]),
        "year_min": int(c["year_min"]), "year_max": int(c["year_max"]),
        "birth_year": int(c["birth_year"]), "held_out_label": c["held_out_label"],
        "top_terms": c["top_terms"][:10],
    })

works = []
for i, b in enumerate(canon):
    g = b["recon"].get("results_community")
    works.append({
        "id": i, "title": b["title"], "author": b["author"], "year": int(b["year"]),
        "decade": int(b["year"]) // 10 * 10, "genre": g,
        "gid": gid_by.get((b["title"], b["author"])),
    })

nm = load(LM / "null_model.json")
ctrl = load(LM / "controls_results.json")
rc = load(LM / "reception_clock.json")
ng = load(LM / "_data/ngrams_raw.json")
ts = load(LM / "term_split.json")
y0 = ng["year_start"]

# Ngram series per reception-clock community: sum of its terms, 1780-1960, 9-year centred mean
# (the clock's own smoothing_years), scaled to occurrences per billion words.
SM = rc["method"]["smoothing_years"]
YEARS = list(range(1780, 1961))
clock = []
for c in rc["communities"]:
    raw = [0.0] * (ng["year_end"] - y0 + 1)
    for t in c["terms"]:
        s = ng["series"].get(t)
        if s:
            raw = [a + (b or 0) for a, b in zip(raw, s)]
    half = SM // 2
    sm = []
    for y in YEARS:
        i = y - y0
        w = raw[max(0, i - half): i + half + 1]
        sm.append(r(sum(w) / len(w) * 1e9, 3))
    n = c["name"]
    clock.append({
        "key": c["key"], "name": c["vocab_reading"], "held_out_label": c["held_out_label"],
        "terms": c["terms"], "n_books": int(c["n_books"]), "year_min": int(c["year_min"]),
        "year_max": int(c["year_max"]), "concentration_z": r(c["concentration_z"], 2),
        "first_attestation": n["first_attestation"], "takeoff_10pct": n["takeoff_10pct"],
        "mass_median": n["mass_median"], "peak_year": n["peak_year_in_window"],
        "series": sm,
    })

hm = results["honest_metrics"]
write("genres.json", {
    "n_books": results["n_books"], "genres": genres, "works": works,
    "timeline": [{k: t[k] for k in ("year", "births", "splits", "merges", "n_communities")} for t in results["timeline"]],
    "cumulative": results["cumulative_genres"],
    "per_book_rate_by_era": hm["per_book_rate_by_era"],
    "per_book_rate_verdict": hm["per_book_rate_verdict"],
    "robust_finding": hm["robust_finding"],
    "null_model": {"real_total": nm["real_total_mutations"], "parts": nm["real_parts"],
                   "shuffled_mean": nm["shuffled_mean"], "shuffled_std": nm["shuffled_std"],
                   "z": nm["z"], "trials": nm["trials"], "draws": nm["shuffled_draws"]},
    "controls": {"author_confound_pct": ctrl["author_confound_pct"], "n_authors": ctrl["n_authors"],
                 "verdict": ctrl["verdict"],
                 "emergent": [{"n": e["n"], "year_min": e["year_min"], "year_max": e["year_max"],
                               "concentration_z": e["concentration_z"], "top_terms": e["top_terms"],
                               "label": e["held_out_label"]} for e in ctrl["emergent_genres"]]},
    "clock": {"years": YEARS, "smoothing_years": SM, "communities": clock,
              "r_year_min_vs_name_takeoff": r(rc["cross_clock"]["r_year_min_vs_name_takeoff"], 3)},
    "term_split": {"question": ts["question"],
                   "decade_means_per_million": ts["test2_substitution"]["decade_means_per_million"],
                   "detective_growth_1890s_to_1920s": ts["test2_substitution"]["detective_growth_1890s_to_1920s"],
                   "settled": ts["verdict"]["settled"]},
})

# ---------------------------------------------------------------- influence + prose matrix
ig = load(LM / "_data/influence_graph.json")
names = [a["name"] for a in ig["authors"]]
idx = {n: i for i, n in enumerate(names)}
N = len(names)
sty = [[None] * N for _ in range(N)]
con = [[None] * N for _ in range(N)]
for e in ig["edges"]:
    a, b = idx[e["from"]], idx[e["to"]]
    sty[a][b] = sty[b][a] = r(e["stylistic"])
    con[a][b] = con[b][a] = r(e["conceptual"])

doc = {}
for e in load(LM / "_data/wikidata_influences.json"):
    if e["from"] in idx and e["to"] in idx and e["from"] != e["to"]:
        doc.setdefault((e["from"], e["to"]), set()).add("Wikidata P737")
for e in load(LM / "_data/known_influences.json"):
    if e["from"] in idx and e["to"] in idx and e["from"] != e["to"]:
        doc.setdefault((e["from"], e["to"]), set()).add("model-attested (" + "+".join(e["models"]) + ")")
documented = []
for (f, t), src in sorted(doc.items()):
    a, b = idx[f], idx[t]
    documented.append({"from": f, "to": t, "sources": sorted(src),
                       "stylistic": sty[a][b], "conceptual": con[a][b]})

hv, hw, dc = ig["held_out_validation"], ig["held_out_validation_wikidata"], ig["density_control"]
write("influence.json", {
    "authors": ig["authors"], "documented": documented,
    "signal_correlation": ig["signal_correlation"], "same_form_pct": ig["same_form_pct"],
    "n_edges": ig["n_edges"],
    "validation": {"known": hv, "wikidata": hw, "well_represented": dc["well_represented_subset"],
                   "verdict": dc["verdict"]},
})

# ---------------------------------------------------------------- persona transformers
st = load(PT / "stylometry.json")
inv = load(PT / "investigation.json")


def mds2(D):
    """Classical MDS to 2-D (power iteration, no numpy needed for 73 points)."""
    n = len(D)
    D2 = [[D[i][j] ** 2 for j in range(n)] for i in range(n)]
    rm = [sum(row) / n for row in D2]
    gm = sum(rm) / n
    B = [[-0.5 * (D2[i][j] - rm[i] - rm[j] + gm) for j in range(n)] for i in range(n)]
    vecs = []
    for _ in range(2):
        v = [math.sin(i + 1.3 * len(vecs)) for i in range(n)]
        lam = 0
        for _ in range(500):
            w = [sum(B[i][j] * v[j] for j in range(n)) for i in range(n)]
            for (u, l) in vecs:
                d = sum(w[i] * u[i] for i in range(n))
                w = [w[i] - d * u[i] for i in range(n)]
            lam = math.sqrt(sum(x * x for x in w))
            v = [x / lam for x in w]
        vecs.append((v, lam))
    return [[r(vecs[0][0][i] * math.sqrt(vecs[0][1]), 4), r(vecs[1][0][i] * math.sqrt(vecs[1][1]), 4)] for i in range(n)]


dm = [[(x if x > 0 else 0.0) for x in row] for row in st["delta"]["matrix"]]
xy = mds2(dm)
main = ["mccarthy", "melville", "shakespeare"]
write("prose.json", {
    "authors": names, "forms": [a["form"] for a in ig["authors"]],
    "earliest": [a["earliest_year"] for a in ig["authors"]],
    "stylistic": sty, "conceptual": con,
    "persona": {
        "authors": main,
        "cross_bpc": {m: {t: r(inv["cross_bpc"][m][t], 3) for t in main} for m in main},
        "val_loss": {m: r(inv["models"][m]["best_val_loss"], 3) for m in inv["models"]},
        "train_chars": {m: inv["models"][m]["train_chars"] for m in inv["models"]},
        "params": inv["models"]["mccarthy"]["params"],
        "probe_mccarthy_essays": {m: r(inv["probe_bpc"][m]["mccarthy_essays"], 3) for m in main},
        "tells": st["delta"]["tells"], "n_vocab": len(st["delta"]["vocab"]), "n_texts": st["n"],
        "purity": {"delta": r(st["delta"]["purity"], 3), "ncd": r(st["ncd"]["purity"], 3)},
        "per_author_purity": {a: r(st["delta"]["per_author"][a], 3) for a in main},
        "nearest_book": {m: st["samples"][m]["nearest_book"]["delta"] for m in st["samples"]},
        "map": [{"author": a, "label": l, "x": p[0], "y": p[1]}
                for a, l, p in zip(st["authors"], st["labels"], xy)],
    },
})

# ---------------------------------------------------------------- sentiment (computed here)
# Method is Prose Similarities' own fix for the 2019 null result: score overlapping windows,
# not paragraphs (sentiment_by_parts), normalise every book to the same number of parts
# (sentiment_multiple_novels), then smooth. TextBlob polarity, as in the original.
TEXTS = ROOT / "cache/texts"
PARTS, WIN = 100, 9
START = re.compile(r"\*\*\*\s*START OF (THE|THIS) PROJECT GUTENBERG.*?\*\*\*", re.I | re.S)
END = re.compile(r"\*\*\*\s*END OF (THE|THIS) PROJECT GUTENBERG", re.I)
SENT_CACHE = ROOT / "cache/sentiment_raw.json"
cache = load(SENT_CACHE) if SENT_CACHE.exists() else {}
try:
    from textblob import TextBlob
except ImportError:
    TextBlob = None

def smooth(v, w):
    h = w // 2
    return [sum(v[max(0, i - h): i + h + 1]) / len(v[max(0, i - h): i + h + 1]) for i in range(len(v))]

def shape(s):
    a, b, c = (statistics.mean(s[i * 33:(i + 1) * 33 + (1 if i == 2 else 0)]) for i in range(3))
    up1, up2 = b - a, c - b
    if up1 > 0 and up2 > 0: return "Rise"
    if up1 < 0 and up2 < 0: return "Fall"
    if up1 < 0 < up2: return "Fall–rise"
    return "Rise–fall"

arcs, done = [], 0
for w in works:
    gid = w["gid"]
    key = str(gid)
    if key not in cache and TextBlob and gid and (TEXTS / f"{gid}.txt").exists():
        t = (TEXTS / f"{gid}.txt").read_text(encoding="utf-8", errors="ignore")
        m = START.search(t); t = t[m.end():] if m else t
        m = END.search(t); t = t[:m.start()] if m else t
        words = t.split()
        if len(words) > 5000:
            step = len(words) / PARTS
            cache[key] = [r(TextBlob(" ".join(words[int(i * step):int((i + 1) * step)])).sentiment.polarity, 4)
                          for i in range(PARTS)]
            cache[key + ":words"] = len(words)
            done += 1
            if done % 20 == 0:
                SENT_CACHE.write_text(json.dumps(cache)); print("scored", done, flush=True)
    if key in cache:
        raw = cache[key]
        s = smooth(raw, WIN)
        mom = [0.0] + [s[i] - s[i - 1] for i in range(1, PARTS)]
        arcs.append({"work": w["id"], "words": cache[key + ":words"], "raw": [r(x, 3) for x in raw],
                     "smooth": [r(x, 4) for x in s], "momentum": [r(x * 100, 3) for x in mom],
                     "mean": r(statistics.mean(raw), 5), "start": r(statistics.mean(s[:10]), 5),
                     "end": r(statistics.mean(s[-10:]), 5), "shape": shape(s),
                     "turn": max(range(5, PARTS - 5), key=lambda i: abs(s[i + 5] - s[i - 5])),
                     "range": r(max(s) - min(s), 5)})
SENT_CACHE.write_text(json.dumps(cache))
# The page needs only the smoothed arc up front (momentum is its first difference, taken in the
# browser); the unsmoothed scores load on demand when a single novel is picked.
slim = [{k: (v if k != "smooth" else [round(x, 3) for x in v]) for k, v in a.items() if k not in ("raw", "momentum")} for a in arcs]
write("sentiment.json", {"parts": PARTS, "window": WIN, "method": "TextBlob polarity per 1% of the book, 9-part centred mean; momentum = change per 1% of the book, x100", "arcs": slim})
write("sentiment_raw.json", {str(a["work"]): a["raw"] for a in arcs})
print("works", len(works), "arcs", len(arcs))

# ---------------------------------------------------------------- Ask context (api/_context.json)
# The compact, factual block the /api/ask function hands to Claude, plus the entity lists the
# server validates a returned view against. Built from the same JSON the page renders.
arc_by = {a["work"]: a for a in arcs}
lines = []
lines.append("WORKS (title | author | year | genre | sentiment shape | start | end):")
for w in works:
    a = arc_by.get(w["id"])
    lines.append(f'{w["title"]} | {w["author"]} | {w["year"]} | {genres[w["genre"]]["name"] if w["genre"] is not None else "-"} | '
                 + (f'{a["shape"]} | {a["start"]:.3f} | {a["end"]:.3f}' if a else "- | - | -"))
lines.append("\nGENRES (prose-recovered clusters): name | novels | years | first forms | held-out label | distinctive words")
for g in genres:
    lines.append(f'{g["name"]} | {g["size"]} | {g["year_min"]}-{g["year_max"]} | {g["birth_year"]} | {g["held_out_label"]} | {", ".join(g["top_terms"][:8])}')
lines.append("\nGENRE-NAME CLOCK (Google Books mentions per billion words of the genre's own name, 9-yr mean): name | terms | first attested | 10% takeoff | half of mentions by | in-window peak year | value every 10 years 1780..1960")
for c in clock:
    lines.append(f'{c["name"]} | {"; ".join(c["terms"])} | {c["first_attestation"]} | {c["takeoff_10pct"]} | {c["mass_median"]} | {c["peak_year"]} | '
                 + " ".join(f"{y}:{v:.1f}" for y, v in zip(YEARS, c["series"]) if y % 10 == 0))
lines.append(f'\nMUTATION NULL MODEL: {nm["real_total_mutations"]} real mutation events vs {nm["shuffled_mean"]} mean with dates shuffled (z {nm["z"]}). Per-book rate by era: {hm["per_book_rate_by_era"]}. Detective fiction is the one genre concentrated in time (z {ctrl["emergent_genres"][0]["concentration_z"]}).')
lines.append("\nDOCUMENTED INFLUENCES (influence > influenced | conceptual similarity | stylistic similarity):")
for d in documented:
    lines.append(f'{d["from"]} > {d["to"]} | {d["conceptual"]} | {d["stylistic"]}')
lines.append(f'Validation: documented pairs vs random pairs, conceptual z {hv["conceptual"]["z"]}, stylistic z {hv["stylistic"]["z"]} (Wikidata subset: {hw["conceptual"]["z"]}, {hw["stylistic"]["z"]}).')
lines.append("\nNEAREST PROSE (author: top 5 by TF-IDF stylistic similarity):")
for i, n in enumerate(names):
    nn = sorted(((sty[i][j], names[j]) for j in range(N) if j != i and sty[i][j] is not None), reverse=True)[:5]
    lines.append(f'{n} ({ig["authors"][i]["form"]}, from {ig["authors"][i]["earliest_year"]}): ' + ", ".join(f"{m} {v:.3f}" for v, m in nn))
P = {m: {t: round(inv["cross_bpc"][m][t], 3) for t in main} for m in main}
lines.append(f'\nCHARACTER GPTs (one model per author; best validation loss nats/char): ' + ", ".join(f"{m} {inv['models'][m]['best_val_loss']:.3f}" for m in main)
             + f'. Cross bits/char, model->text: {P}.')
ctx = {"context": "\n".join(lines),
       "authors": authorsAll if (authorsAll := sorted({w["author"] for w in works} | set(names) | {"Cormac McCarthy"})) else [],
       "works": sorted({w["title"] for w in works}), "genres": [g["name"] for g in genres],
       "clock": [c["name"] for c in clock], "network": names}
(ROOT / "api").mkdir(exist_ok=True)
(ROOT / "api/_context.json").write_text(json.dumps(ctx, ensure_ascii=False))
print("api/_context.json", round(len(ctx["context"]) / 1024, 1), "KB of context")

# ---------------------------------------------------------------- graphs.json
# Relational structure for the node-link views. Communities are Louvain (seed 42) so a colour
# means the same group on every load; the page draws edges and thresholds live from the matrices.
import numpy as np, networkx as nx
from collections import Counter

def louvain(edges, n):
    G = nx.Graph(); G.add_nodes_from(range(n))
    for a, b, w in edges: G.add_edge(a, b, weight=w)
    com = sorted(nx.community.louvain_communities(G, weight="weight", seed=42), key=len, reverse=True)
    lab = [0] * n
    for k, c in enumerate(com):
        for i in c: lab[i] = k
    return lab, nx.community.modularity(G, com, weight="weight")

# 1. Novels linked by arc shape: Pearson r of the z-scored smoothed arcs, 5 nearest each.
K_ARC = 5
X = np.array([a["smooth"] for a in arcs], dtype=float)
X = (X - X.mean(1, keepdims=True)) / X.std(1, keepdims=True)
Cr = X @ X.T / X.shape[1]; np.fill_diagonal(Cr, -9)
nn = np.argsort(-Cr, 1)[:, :K_ARC]
arc_edges = {}
for i in range(len(arcs)):
    for j in nn[i]:
        a, b = sorted((i, int(j))); arc_edges[(a, b)] = round(float(Cr[a, b]), 3)
arc_lab, arc_q = louvain([(a, b, w) for (a, b), w in arc_edges.items()], len(arcs))
shapes_l = [a["shape"] for a in arcs]
same = float(np.mean([shapes_l[i] == shapes_l[j] for i in range(len(arcs)) for j in nn[i]]))
chance = sum(v * v for v in Counter(shapes_l).values()) / len(arcs) ** 2

# 2. Writers linked by prose (stylistic) and by ideas (conceptual): communities on a 4-NN graph.
def knn_comm(M, k=4):
    E = {}
    for i in range(N):
        row = sorted(((M[i][j], j) for j in range(N) if j != i and M[i][j] is not None), reverse=True)[:k]
        for w, j in row:
            a, b = sorted((i, j)); E[(a, b)] = w
    return louvain([(a, b, w) for (a, b), w in E.items()], N)
sty_lab, sty_q = knn_comm(sty)
con_lab, con_q = knn_comm(con)

# 3. Influence communities on the documented graph (undirected, weight = conceptual).
inf_lab, inf_q = louvain([(idx[d["from"]], idx[d["to"]], d["conceptual"] or 0.5) for d in documented], N)

write("graphs.json", {
    "arc": {"k": K_ARC, "edges": [[a, b, w] for (a, b), w in arc_edges.items()], "community": arc_lab,
            "modularity": round(arc_q, 3), "same_shape_neighbours": round(same, 3), "same_shape_chance": round(chance, 3),
            "median_r": round(float(np.median([Cr[i, j] for i in range(len(arcs)) for j in nn[i]])), 3)},
    "prose": {"k": 4, "stylistic": sty_lab, "conceptual": con_lab,
              "modularity": {"stylistic": round(sty_q, 3), "conceptual": round(con_q, 3)}},
    "influence": {"community": inf_lab, "modularity": round(inf_q, 3)},
})
