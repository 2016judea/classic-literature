# Classic Literature

A Power BI-style analytics workspace over seven years of research on classic literature.
Four report pages, one set of slicers (author, work, genre, era) that cross-filter every
visual, a guided **Story** per page, and an **Ask** bar that turns a question into a live,
filterable view of the data.

| Page | What it shows | Source |
|---|---|---|
| Sentiment momentum | Sentiment arc and its slope across 339 novels, arc shapes, start vs end, and a graph linking each novel to the 5 whose arcs move most alike (69% share a shape vs 26% by chance) | Computed here from the full Gutenberg texts (TextBlob, 100 windows, 9-part rolling mean): the windowed fix for the 2019 per-paragraph null result |
| Genre mutations | 8 genres recovered from prose alone, a genre–author graph showing the bridge authors, corpus density, the mutation-rate null model, when each genre's *name* caught on | [`literature-mutations`](https://github.com/2016judea/literature-mutations) |
| Influence network | 77 authors, documented influences (Wikidata P737 + model-attested), ego networks, the shortest chain between any two authors, community colouring, whether influence shows in ideas or in prose |
| Atlas | Genres, novelists, novels and influences in one filterable graph | all of the above | `literature-mutations` Phase 2 |
| Prose similarity | Nearest writers by TF-IDF and by embedding, a similarity graph with a threshold slider coloured by Louvain community, all-pairs heatmap, character GPTs for McCarthy / Melville / Shakespeare reading each other, a stylometric map | `literature-mutations`, `persona-transformers` |

Every number on the page is read from `site/data/*.json`, which `scripts/build_data.py`
extracts from the research repos. Nothing is typed by hand.

## Run it

    uv venv .venv && VIRTUAL_ENV=.venv uv pip install textblob
    python3 scripts/fetch_texts.py          # full Gutenberg texts into cache/ (gitignored)
    .venv/bin/python scripts/build_data.py  # writes site/data/*.json and api/_context.json
    python3 -m http.server -d site 8000

## Ask

`api/ask.js` sends the question and a compact block of the site's data to Claude
(`claude-sonnet-5-5`) under a JSON schema. Claude returns a *view* (page, visual,
filters, highlight) and a sentence; the server validates every name against the data and
drops any sentence that states a number the data does not contain. The page renders the
view with its own charts and prints figures computed from its JSON under the answer.
Without `ANTHROPIC_API_KEY` the endpoint returns 503 and the page answers with a local
parser (`site/ask-local.js`) over the same data. Rate limit: 8 questions per IP per
10 minutes, 300 per instance per day, 700 output tokens.

    npm install && npm test   # validator + every example chip through the local parser

McCarthy's novels are in copyright and are not redistributed; only derived measurements
from `persona-transformers` appear here. Gutenberg texts are public domain.

MIT licence.
