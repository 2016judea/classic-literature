# Connector listing kit

Copy from here. Pattern: `~/Desktop/workspace/breach-to-claim/SUBMISSION.md`; rejection history:
`~/Desktop/workspace/small-business-intelligence-mcp/SUBMISSION-KIT.md` (30-char name, no pricing
words in the description, support must be a URL, explicit annotation booleans, no model-behaviour
lines in tool descriptions). Built 2026-11-20. Filed and published 2026-11-20 (see the end).

| Field | Value |
|---|---|
| Name | Classic Literature (18 chars) |
| Endpoint | `https://classic-literature-bi.vercel.app/api/mcp` · Streamable HTTP · auth none · no UI/CSP |
| Publisher | Brick and Mortar AI LLC, 1651 Eleanor Ave, Saint Paul, MN 55116 |
| Website / docs | https://classic-literature-bi.vercel.app/connect/ |
| Privacy | https://classic-literature-bi.vercel.app/privacy/ |
| Support | https://brickandmortar.dev/contact (changed 2026-11-22: directory listings never point at GitHub issues) |
| Source | https://github.com/2016judea/classic-literature (MIT) |
| Icon 512×512 | https://classic-literature-bi.vercel.app/icon.png |
| Composer icon (stroke-only, currentColor) | https://classic-literature-bi.vercel.app/icon-composer.svg |
| App icon as SVG, colour | https://classic-literature-bi.vercel.app/favicon.svg |
| Availability | All regions; the data is in English |

**The domain is a `.vercel.app` alias**, not one the LLC owns. Reviewers have checked that policy
URLs belong to the publisher (SBI kit §1). A domain is Aidan's call; if he buys one, move the alias
and re-file.

The icons were checked at 16, 18, 20, 24, 32 and 64 px on `#fff` and `#212121`: an open book,
one stroke weight, legible at 16.

## One-liner (97 of 100)
Emotional arcs, influence chains, prose look-alikes and genres of classic novels, from full texts

## Description
Classic Literature answers questions about classic novels and their writers from measurements of
their full texts, not from a model's memory. Ask for a novel's emotional arc and get its shape,
where it turns, how its ending compares with its opening, and the novels whose arcs move most
alike, across 339 public-domain novels from 1678 to 1928. Ask who writes like Melville and get the
nearest of 77 writers by vocabulary and by ideas, plus what a small GPT trained on Melville,
Shakespeare or Cormac McCarthy makes of the others. Trace the shortest documented chain of
influence between two authors, see who influenced whom, and find the genre a novel's own prose
places it in, with the year that genre's name caught on in print. Every answer links to the same
view in an interactive workspace.

## Connection requirements
None. No account, key or OAuth. Six read-only tools; the server stores nothing about the person.

Coverage, stated here so a reviewer's out-of-corpus test is read as correct: 339 scored novels
(1678–1928, public domain, Project Gutenberg), 77 writers in the prose and influence sets (Homer to
Joyce), 8 genres recovered from prose, 8 genre-name clocks. A title or name outside that returns
`found: false` with the closest matches, never a substitute.

## Annotations (all explicit booleans; `test/mcp.test.js` holds them)
| Tool | readOnly | destructive | openWorld | idempotent |
|---|---|---|---|---|
| novel_mood_arc, writers_who_sound_like, influence_chain, author_influences, genre_of_book, genre_history | true | false | false | true |

`openWorldHint: false` on purpose: every tool reads JSON bundled with the function
(`site/data/*.json`) and calls no external endpoint, so the domain is closed. (The SBI kit's
CarsXE precedent is a tool that called its own remote API; this server calls none.) Tool
descriptions say what each tool returns; how the model should use the results lives only in the
server `instructions`, and a test fails if a description picks up imperative wording.

## Reviewer note: where the data comes from
Nothing is fetched at request time. The numbers were computed once, offline, from the full texts of
public-domain novels on Project Gutenberg and from published research repos
(`2016judea/literature-mutations`: genres, influence, prose similarity; `persona-transformers`:
the character GPTs). `scripts/build_data.py` writes them to static JSON, which the website and this
server both read. The server does not wrap any live third-party API, and no model is called while
answering: every number returned is a value in that JSON or a rank or count over it. Influence
links come from Wikidata P737 or were attested by Claude and/or Gemini when the dataset was built,
and each link says which. Cormac McCarthy's novels are in copyright; only derived measurements
appear, no text.

## Test setup / reviewer access
No test account, no credentials. A browser GET on the endpoint returns 405 with the server name
and URL by design (stateless, POST only). Reproduce from a terminal:

```
U=https://classic-literature-bi.vercel.app/api/mcp
curl -s $U -H 'content-type: application/json' -H 'accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"review","version":"0"}}}'
curl -s $U -H 'content-type: application/json' -H 'accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/list"}'
curl -s $U -H 'content-type: application/json' -H 'accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"novel_mood_arc","arguments":{"title":"Moby-Dick"}}}'
curl -s $U -H 'content-type: application/json' -H 'accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":4,"method":"tools/call","params":{"name":"influence_chain","arguments":{"from_author":"Plato","to_author":"Virginia Woolf"}}}'
curl -s $U -H 'content-type: application/json' -H 'accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":5,"method":"tools/call","params":{"name":"genre_history","arguments":{"genre":"detective story"}}}'
```

The data is static, so the results below will repeat exactly until the dataset is rebuilt.

## Test cases
Run against the live endpoint on 2026-11-20 (deploy `5cdb68f`); results are what came back.

Positive:
1. "What's the emotional arc of Moby-Dick, and which novels move most like it?" →
   `novel_mood_arc {title:"Moby-Dick"}`: shape **Fall**, start 0.09087, end 0.06263, change rank
   230 of 339, sharpest turn at 26%; most alike The Hampdenshire Wonder (r 0.662), The Man of
   Property (0.65), Middlemarch (0.643).
2. "Who writes most like Herman Melville?" → `writers_who_sound_like {author:"Herman Melville"}`:
   by vocabulary Arthur Conan Doyle 0.2096, Jules Verne 0.198, Homer 0.1778; by ideas Nathaniel
   Hawthorne 0.7467, Ambrose Bierce 0.7293, Jules Verne 0.7194; Melville's GPT reads Shakespeare at
   2.239 bits/char and McCarthy at 2.735.
3. "How is Plato connected to Virginia Woolf through literary influence?" →
   `influence_chain {from_author:"Plato", to_author:"Virginia Woolf"}`: Plato – Homer – James Joyce
   – Virginia Woolf, 3 links, each with its source (Homer → Plato is Wikidata P737 and
   model-attested).
4. "Who influenced Emerson, and whom did he influence?" →
   `author_influences {author:"Ralph Waldo Emerson"}`: 8 influences in (Thomas Carlyle 0.7465,
   Samuel Taylor Coleridge 0.7294 …), 7 out (Nathaniel Hawthorne 0.7537, Henry David Thoreau
   0.7472 …), 4th most connected of 77.
5. "What genre does The Sign of Four's prose put it in, and when did 'detective story' catch on?" →
   `genre_of_book {title:"The Sign of Four"}`: **Detective fiction**, 43 novels, cluster forms in
   1890, held-out library label "Detective and mystery stories"; the name first attested 1832,
   10% of its mentions by 1889, half by 1931.

Also checked: `genre_history {genre:"detective story"}` → Detective fiction, with the
detective-vs-mystery answer ("It is NOT a renaming…") and 6.4x growth of "detective story" from the
1890s to the 1920s.

Negative:
1. "What's the emotional arc of Harry Potter?" → `novel_mood_arc` returns `found: false`, "No novel
   in this corpus matching "Harry Potter"." with the closest titles (Sister Carrie, The History of
   Mr Polly, The Scarlet Letter). Nothing is estimated.
2. "Who influenced Stephen King?" → `author_influences` returns `found: false`, "No author in the
   influence network matching "Stephen King"."
3. "Change Moby-Dick's genre to Gothic." → No tool writes. All six are read-only; the data cannot be
   edited through the connector.

(An ambiguous name is not an error either: `genre_of_book {author:"Bronte"}` returns
`did_you_mean: Anne, Emily, Charlotte Brontë`.)

## Starter prompts
- What's the emotional arc of Moby-Dick, and which novels move most like it?
- Who writes most like Herman Melville, by vocabulary and by ideas?
- How is Plato connected to Virginia Woolf through literary influence?

Each was run live (cases 1–3 above). The prompts do not name the connector.

## Suggested categories
Education, Research. If the form offers neither, Arts & Culture.

## Use cases (for the form)
1. **Read a novel's emotional shape.** How a book's feeling moves from opening to close, where it
   turns, and which other novels move the same way.
2. **Find writers who sound alike.** The nearest writers by vocabulary and by ideas, for reading
   lists, teaching and comparison.
3. **Trace literary influence.** The documented chain between two authors, and who shaped whom,
   with a source on every link.

## What needs Aidan
1. **Filing**: the coordinator files the Claude Connectors Directory form in his Chrome with the
   fields above. Nothing here was filed.
2. **After approval**: approval does not publish. Click Publish in claude.ai/directory/manage.
3. **Optional, costs money:** a domain the LLC owns (see the `.vercel.app` note).

## Submitted 2026-11-20

Filed by Claude in Aidan's own Chrome (JavaScript run by process id into a background tab; `browser-as-aidan`).
Nothing was paid and nothing was sent to a person.

| Where | Status | UTC | Listing |
|---|---|---|---|
| Claude Connectors Directory | **PUBLISHED** (approved within minutes of filing; Publish pressed 17:17) | 17:12 filed | claude.ai/directory/manage/classic-literature · slug `classic-literature` (permanent) |

**What was filed.** Custom connector "Classic Literature" added to his Claude (6 tools, 0 resources, auth none
detected). Name, one-liner and description verbatim from this kit. Categories: Education, Media & Entertainment,
Data & Analytics. Author Brick and Mortar AI LLC (https://classic-literature-bi.vercel.app/). Docs `/connect/`,
support the GitHub issues URL, privacy `/privacy/`, custom icon `/icon.png` (portal loaded it at 512). Use cases
= starter prompts 1-3. Prerequisites: none. Read only. Company Brick and Mortar AI LLC, https://brickandmortar.dev,
Aidan Jude, Founder. Auth none. Data handling "We own the API", no health data, no sponsored content. Self-tested:
all six tools were run through the MCP Inspector CLI (`@modelcontextprotocol/inspector --cli`) against the live
endpoint before ticking it. All seven compliance boxes ticked; the additional note is the reviewer note above.

**Portal mechanics that cost a cycle:** "Connectors" moved out of Settings into Customize; the directory form's
own "Add custom connector" does the job. Chrome throttles timers in a hidden tab, so an in-page `await sleep()`
can stall for minutes: drive each step as a synchronous `execute` and wait outside the page.

**Official MCP Registry (2026-11-22):** `io.github.2016judea/classic-literature` 1.0.0, remote `https://classic-literature-bi.vercel.app/api/mcp`; `.github/workflows/mcp-registry.yml` republishes on every `server.json` version bump. Check: `curl "https://registry.modelcontextprotocol.io/v0/servers?search=io.github.2016judea/classic-literature"`.

## ChatGPT listing v1.0.0 (2026-11-22)

ZIP: `chatgpt-plugin.zip`, built by `python3 scripts/build_chatgpt_plugin.py --live` from `chatgpt/listing.json` (5 positive and 3 negative cases, checked against the live server). Demo recording: https://classic-literature-bi.vercel.app/demo/chatgpt/. Domain check: `/.well-known/openai-apps-challenge` serves Vercel/Worker env `OPENAI_APPS_CHALLENGE` (404 until set).

<!-- chatgpt-hints (generated by scripts/build_chatgpt_plugin.py; edit chatgpt/listing.json) -->
| Tool | readOnly | destructive | openWorld | Why |
|---|---|---|---|---|
| `novel_mood_arc` | True | False | False | Reads measurements precomputed from the novels' full texts and bundled with the server; changes nothing and makes no outside request. |
| `writers_who_sound_like` | True | False | False | Reads measurements precomputed from the novels' full texts and bundled with the server; changes nothing and makes no outside request. |
| `influence_chain` | True | False | False | Reads measurements precomputed from the novels' full texts and bundled with the server; changes nothing and makes no outside request. |
| `author_influences` | True | False | False | Reads measurements precomputed from the novels' full texts and bundled with the server; changes nothing and makes no outside request. |
| `genre_of_book` | True | False | False | Reads measurements precomputed from the novels' full texts and bundled with the server; changes nothing and makes no outside request. |
| `genre_history` | True | False | False | Reads measurements precomputed from the novels' full texts and bundled with the server; changes nothing and makes no outside request. |
| `books_like` | True | False | False | Reads measurements precomputed from the novels' full texts and bundled with the server; changes nothing and makes no outside request. |
| `does_book_have_a_happy_ending` | True | False | False | Reads measurements precomputed from the novels' full texts and bundled with the server; changes nothing and makes no outside request. |
| `saddest_and_happiest_novels` | True | False | False | Reads measurements precomputed from the novels' full texts and bundled with the server; changes nothing and makes no outside request. |
| `novels_by_author` | True | False | False | Reads measurements precomputed from the novels' full texts and bundled with the server; changes nothing and makes no outside request. |
| `classic_novels_from_era` | True | False | False | Reads measurements precomputed from the novels' full texts and bundled with the server; changes nothing and makes no outside request. |
| `did_author_influence` | True | False | False | Reads measurements precomputed from the novels' full texts and bundled with the server; changes nothing and makes no outside request. |
| `what_genres_are_there` | True | False | False | Reads measurements precomputed from the novels' full texts and bundled with the server; changes nothing and makes no outside request. |
<!-- /chatgpt-hints -->
