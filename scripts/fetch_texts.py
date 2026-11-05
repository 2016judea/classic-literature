"""Fetch the full Project Gutenberg text of every novel in the literature-mutations corpus.

The research repo keeps only a ~120k-character excerpt per book (_data/books.json),
which is the first third of most novels: too short to draw a sentiment arc end to end.
Texts are public domain; cached under cache/texts/ (gitignored), four workers, a second's pause each.
"""
import json, pathlib, time, urllib.request

SRC = pathlib.Path.home() / "Desktop/workspace/literature-mutations/_data/books.json"
OUT = pathlib.Path(__file__).resolve().parent.parent / "cache/texts"
OUT.mkdir(parents=True, exist_ok=True)

books = json.load(open(SRC))["books"]
ids = sorted({b["gutenberg_id"] for b in books if b.get("gutenberg_id")}, key=int)
print(len(ids), "gutenberg ids")
def fetch(gid):
    dest = OUT / f"{gid}.txt"
    if dest.exists() and dest.stat().st_size > 1000:
        return
    for url in (f"https://www.gutenberg.org/cache/epub/{gid}/pg{gid}.txt",
                f"https://www.gutenberg.org/files/{gid}/{gid}-0.txt"):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "classic-literature research build (personal, 1 req/s)"})
            data = urllib.request.urlopen(req, timeout=60).read()
            dest.write_bytes(data)
            print(gid, len(data), flush=True)
            break
        except Exception as e:
            print(gid, "fail", url, e, flush=True)
    time.sleep(1)


# Four workers, each pausing a second between requests.
from concurrent.futures import ThreadPoolExecutor
with ThreadPoolExecutor(4) as ex:
    list(ex.map(fetch, ids))
