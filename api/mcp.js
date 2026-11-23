// POST /api/mcp — a remote MCP server (Streamable HTTP, stateless JSON responses, no auth) over
// the same data the site renders. Pattern from breach-to-claim api/mcp.js.
// Every number a tool returns is read from site/data/*.json (built by scripts/build_data.py);
// this file only looks up, ranks and joins. Every link handed out carries src=mcp.
// One PostHog event per tool call: the tool, ok and duration, plus the name a caller reached for when
// it is not one of ours (attempted). Nothing the person typed is logged.
const G = require("../site/data/genres.json");
const SEN = require("../site/data/sentiment.json");
const INF = require("../site/data/influence.json");
const PR = require("../site/data/prose.json");
const GR = require("../site/data/graphs.json");

const SITE = "https://classic-literature-bi.vercel.app";
const VERSION = "0.1.0";
const PH_KEY = "phc_yFgRGppL6H7DvhgZTQKbHdrY5oqnpLT482rrNYtLqnAx"; // public project key, same block as site/index.html
const ANN = { readOnlyHint: true, destructiveHint: false, openWorldHint: false, idempotentHint: true };

// ------------------------------------------------------------------ data joins (same as site/app.js)
const works = G.works;
const arcIndex = new Map(SEN.arcs.map((a, i) => [a.work, i]));
const genreName = i => (i == null ? null : G.genres[i].name);
const SHAPES = ["Rise", "Fall", "Rise–fall", "Fall–rise"];
const SHAPE_MEANING = {
  Rise: "warmer in the middle third than the first, and warmer again in the last",
  Fall: "cooler in the middle third than the first, and cooler again in the last",
  "Rise–fall": "warms into the middle third, then cools in the last",
  "Fall–rise": "cools into the middle third, then warms in the last",
};
const CLOCK_TO_GENRE = { detective: "Detective fiction", historical: "Historical romance", nautical: "Nautical adventure", early_novel: "Early English novel" };
const PERSONA = { mccarthy: "Cormac McCarthy", melville: "Herman Melville", shakespeare: "William Shakespeare" };
const PERSONA_KEY = Object.fromEntries(Object.entries(PERSONA).map(([k, v]) => [v, k]));
const NETWORK = INF.authors.map(a => a.name);
const WORK_AUTHORS = [...new Set(works.map(w => w.author))];
const PROSE_AUTHORS = [...PR.authors, ...Object.values(PERSONA).filter(n => !PR.authors.includes(n))];
const workTitle = w => ({ title: w.title, author: w.author, year: w.year });
const r5 = x => +(+x).toFixed(5);

// ------------------------------------------------------------------ fuzzy matching
const norm = s => String(s == null ? "" : s).normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/&/g, " and ").replace(/[^a-z0-9]+/g, " ").trim();
const noArticle = s => s.replace(/^(the|a|an) /, "");
function bigrams(s) { s = ` ${s} `; const m = new Map(); for (let i = 0; i < s.length - 1; i++) { const b = s.slice(i, i + 2); m.set(b, (m.get(b) || 0) + 1); } return m; }
function dice(a, b) {
  const A = bigrams(a), B = bigrams(b); let inter = 0, n = 0;
  for (const v of A.values()) n += v; for (const v of B.values()) n += v;
  for (const [k, v] of A) inter += Math.min(v, B.get(k) || 0);
  return n ? (2 * inter) / n : 0;
}
// 1 exact; .99 exact without a leading article; .90-.99 the query sits whole inside the name
// ("tristram shandy", "melville"); .88 the name sits inside the query; else bigram/word overlap.
function score(q, c) {
  if (!q || !c) return 0;
  if (q === c) return 1;
  const qa = noArticle(q), ca = noArticle(c);
  if (qa === ca) return 0.99;
  if (qa.length >= 4 && ` ${ca} `.includes(` ${qa} `)) return 0.9 + 0.09 * (qa.length / ca.length);
  if (ca.length >= 4 && ` ${qa} `.includes(` ${ca} `)) return 0.88;
  const qt = qa.split(" ").filter(t => t.length >= 3), ct = new Set(ca.split(" "));
  const cover = qt.length ? qt.filter(t => ct.has(t)).length / qt.length : 0;
  return Math.max(0.87 * dice(qa, ca), cover === 1 ? 0.85 : 0.6 * cover);
}
const ACCEPT = 0.62;
// -> { hit, ambiguous: [names] | null, closest: [names] }
function match(query, items, nameOf = x => x) {
  const q = norm(query);
  const ranked = items.map(x => ({ x, s: score(q, norm(nameOf(x))) })).sort((a, b) => b.s - a.s);
  const closest = [...new Set(ranked.filter(r => r.s > 0.2).map(r => nameOf(r.x)))].slice(0, 5);
  const top = ranked[0];
  if (!top || top.s < ACCEPT) return { hit: null, ambiguous: null, closest };
  const tied = ranked.filter(r => r.s >= ACCEPT && top.s - r.s < 0.02 && norm(nameOf(r.x)) !== norm(nameOf(top.x)));
  if (top.s < 0.99 && tied.length) return { hit: null, ambiguous: [nameOf(top.x), ...tied.map(r => nameOf(r.x))].slice(0, 6), closest };
  return { hit: top.x, ambiguous: null, closest };
}

// The corpus holds a few books twice under two list titles ("The Sign of Four" / "The Sign of the
// Four"): same author, same year, near-identical title. Lists show each book once.
function sameBook(a, b) {
  if (a.author !== b.author || a.year !== b.year) return false;
  const x = noArticle(norm(a.title)), y = noArticle(norm(b.title));
  return ` ${x} `.includes(` ${y} `) || ` ${y} `.includes(` ${x} `) || dice(x, y) >= 0.75;
}
const onePerBook = list => list.reduce((kept, w) => (kept.some(k => sameBook(k, w)) ? kept : [...kept, w]), []);

// ------------------------------------------------------------------ links
function link(params) {
  const p = new URLSearchParams(Object.entries(params).filter(([, v]) => v != null && v !== ""));
  return `${SITE}/?src=mcp#${p.toString()}`;
}

function notFound(kind, query, m, extra = {}) {
  const out = { found: false, query, kind };
  if (m.ambiguous) { out.answer = `"${query}" matches more than one ${kind}.`; out.did_you_mean = m.ambiguous; }
  else { out.answer = `No ${kind} matching "${query}".`; out.closest_matches = m.closest; }
  return { ...out, ...extra };
}

// ------------------------------------------------------------------ tool: mood arc
function findWork(title, author) {
  let q = String(title || "").trim(), a = String(author || "").trim();
  let split = false;
  if (!a && / by /i.test(q)) { const k = q.toLowerCase().lastIndexOf(" by "); a = q.slice(k + 4); q = q.slice(0, k); split = true; }
  let pool = works, authorNote = null;
  if (a) {
    const am = match(a, WORK_AUTHORS);
    if (am.hit) pool = works.filter(w => w.author === am.hit);
    else if (split) { q = String(title).trim(); a = ""; }
    else authorNote = `No author matching "${a}" among the ${WORK_AUTHORS.length} novelists; matched on title alone.`;
  }
  let m = match(q, pool, w => w.title);
  if (!m.hit && pool !== works) m = match(q, works, w => w.title);
  if (m.ambiguous) m.ambiguous = m.ambiguous.map(t => { const w = works.find(x => x.title === t); return `${t} (${w.author}, ${w.year})`; });
  return { m, authorNote, query: q };
}

const SCORED = SEN.arcs.length;
const ARC_YEARS = SEN.arcs.map(a => works[a.work].year);
const SPAN = `${Math.min(...ARC_YEARS)}-${Math.max(...ARC_YEARS)}`;
const changeOf = a => r5(a.end - a.start);
const byChange = SEN.arcs.map((a, i) => [i, changeOf(a)]).sort((x, y) => y[1] - x[1]).map(x => x[0]);
const shapeCounts = Object.fromEntries(SHAPES.map(s => [s, SEN.arcs.filter(a => a.shape === s).length]));

function moodArc(args) {
  if (!String(args.title || "").trim()) return err("Pass the novel's title as title.");
  const { m, authorNote, query } = findWork(args.title, args.author);
  if (!m.hit) return notFound("novel in this corpus", query, m, { browse: link({ p: "sentiment" }) });
  const w = m.hit, ai = arcIndex.get(w.id);
  if (ai == null) return { found: true, novel: workTitle(w), scored: false, answer: `${w.title} is in the corpus but its sentiment arc was not scored (${works.length - SCORED} of ${works.length} novels were not).`, open_on_site: link({ p: "genres", work: w.title }) };
  const a = SEN.arcs[ai];
  const alike = onePerBook(GR.arc.edges.filter(e => e[0] === ai || e[1] === ai).sort((x, y) => y[2] - x[2])
    .map(e => { const b = SEN.arcs[e[0] === ai ? e[1] : e[0]], bw = works[b.work]; return { ...workTitle(bw), shape: b.shape, r: e[2] }; })
    .filter(x => !sameBook(x, w))).slice(0, GR.arc.k);
  const rank = byChange.indexOf(ai) + 1;
  const out = {
    found: true,
    novel: { ...workTitle(w), genre_from_prose: genreName(w.genre), words_scored: a.words },
    shape: a.shape,
    shape_means: SHAPE_MEANING[a.shape],
    start: a.start, end: a.end, change_end_minus_start: changeOf(a),
    ends: a.end < a.start ? "lower than it begins" : "higher than it begins",
    change_rank: `${rank} of ${SCORED} (1 = the biggest rise from start to end, ${SCORED} = the biggest fall)`,
    mean_polarity: a.mean, emotional_range: a.range,
    sharpest_turn_at_pct: a.turn,
    arc_every_10pct: Object.fromEntries([0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 99].map(i => [`${i}%`, a.smooth[i]])),
    ...(args.full_arc ? { full_arc_100_parts: a.smooth } : {}),
    shapes_among_all_scored: shapeCounts,
    novels_whose_arcs_move_most_alike: alike,
    how_alike_is_measured: `r = Pearson correlation of the two z-scored smoothed arcs (1 = they move identically). Linking each novel to its ${GR.arc.k} most alike, ${Math.round(GR.arc.same_shape_neighbours * 100)}% of neighbours share its shape, against ${Math.round(GR.arc.same_shape_chance * 100)}% by chance.`,
    method: `${SEN.method}. Polarity runs -1 to 1. start/end = mean of the first/last 10% of the smoothed arc; range = max - min; shape compares the mean of each third; sharpest turn = the % point where the arc changes most over 10 parts. Full Gutenberg text, ${SEN.parts} parts per novel.`,
    open_on_site: link({ p: "sentiment", work: w.title }),
  };
  if (authorNote) out.note = authorNote;
  return out;
}

// ------------------------------------------------------------------ tool: writers who sound like
function soundsLike(args) {
  if (!String(args.author || "").trim()) return err("Pass the writer's name as author.");
  const lim = Math.max(1, Math.min(20, args.limit || 8));
  const m = match(args.author, PROSE_AUTHORS);
  if (!m.hit) {
    const nov = match(args.author, WORK_AUTHORS);
    const extra = nov.hit ? { note: `${nov.hit} is in the novel corpus but not among the ${PR.authors.length} writers scored for prose similarity. genre_of_book with author="${nov.hit}" gives their genre neighbours instead.` } : {};
    return notFound("writer in the prose-similarity set", args.author, m, { ...extra, browse: link({ p: "prose" }) });
  }
  const name = m.hit, i = PR.authors.indexOf(name), out = { found: true, writer: name };
  if (i >= 0) {
    const nearest = M => M[i].map((v, j) => [j, v]).filter(([j, v]) => j !== i && v != null).sort((a, b) => b[1] - a[1]).slice(0, lim)
      .map(([j, v]) => ({ writer: PR.authors[j], similarity: v, form: PR.forms[j] }));
    const lab = GR.prose.stylistic;
    out.form = PR.forms[i]; out.earliest_work_year = PR.earliest[i];
    out.closest_by_vocabulary = nearest(PR.stylistic);
    out.closest_by_ideas = nearest(PR.conceptual);
    out.prose_circle = PR.authors.filter((a, j) => j !== i && lab[j] === lab[i]).sort((a, b) => (PR.stylistic[i][PR.authors.indexOf(b)] || 0) - (PR.stylistic[i][PR.authors.indexOf(a)] || 0));
    out.measures = `closest_by_vocabulary: TF-IDF cosine similarity of distinctive vocabulary (stylistic). closest_by_ideas: embedding similarity of ideas and imagery (conceptual). prose_circle: the writer's Louvain community on the ${GR.prose.k}-nearest-neighbour vocabulary graph (modularity ${GR.prose.modularity.stylistic}), closest first. Scored over the ${PR.authors.length} writers whose texts are in the corpus.`;
  } else out.note = `${name} is not among the ${PR.authors.length} writers in the TF-IDF / embedding matrix (the novels are in copyright); the character-GPT results below are all there is.`;
  const k = PERSONA_KEY[name];
  if (k) {
    const P = PR.persona, others = P.authors.filter(x => x !== k);
    out.character_gpt = {
      what: `A small GPT (${P.params.toLocaleString("en-US")} parameters) trained on one author's text alone, then made to read the others. Lower bits per character = that prose is more predictable to the model, i.e. closer to what it learned.`,
      reads_its_own_author: P.cross_bpc[k][k],
      reads_others: others.map(o => ({ writer: PERSONA[o], bits_per_char: P.cross_bpc[k][o] })).sort((a, b) => a.bits_per_char - b.bits_per_char),
      read_by_others: others.map(o => ({ model_of: PERSONA[o], bits_per_char: P.cross_bpc[o][k] })).sort((a, b) => a.bits_per_char - b.bits_per_char),
      overuses: P.tells[k].over, underuses: P.tells[k].under,
      tells_measure: `highest and lowest mean z-score among the ${P.n_vocab} most frequent words, across the author's books`,
      generated_text_lands_nearest: P.nearest_book["model:" + k],
      works_that_cluster_with_their_author: P.per_author_purity[k],
      clustering_measure: `share of this author's works that Burrows Delta places with the author (all ${P.n_texts} texts: ${P.purity.delta})`,
    };
  }
  out.open_on_site = link({ p: "prose", author: name });
  return out;
}

// ------------------------------------------------------------------ tools: influence
function findPath(a, b) {
  const nb = new Map();
  INF.documented.forEach(d => { for (const [x, y] of [[d.from, d.to], [d.to, d.from]]) { if (!nb.has(x)) nb.set(x, []); nb.get(x).push([y, d]); } });
  const prev = new Map([[a, null]]); const q = [a];
  while (q.length) { const x = q.shift(); if (x === b) break; for (const [y, d] of nb.get(x) || []) if (!prev.has(y)) { prev.set(y, [x, d]); q.push(y); } }
  if (!prev.has(b) || a === b) return null;
  const nodes = [b], edges = []; let cur = b;
  while (prev.get(cur)) { const [x, d] = prev.get(cur); edges.unshift(d); nodes.unshift(x); cur = x; }
  return { nodes, edges };
}
const linkOut = d => ({ influence: d.from, influenced: d.to, sources: d.sources, conceptual_similarity: d.conceptual, stylistic_similarity: d.stylistic });
const NET_NOTE = () => { const v = INF.validation.known; return `Documented pairs vs random pairs: conceptual similarity z ${v.conceptual.z} (mean ${v.conceptual.real_mean} vs ${v.conceptual.null_mean}), stylistic z ${v.stylistic.z} (mean ${v.stylistic.real_mean} vs ${v.stylistic.null_mean}): influence shows in ideas far more than in prose.`; };
function inNetwork(q) { const m = match(q, NETWORK); return m; }

function influenceChain(args) {
  if (!String(args.from_author || "").trim() || !String(args.to_author || "").trim()) return err("Pass from_author and to_author.");
  const a = inNetwork(args.from_author), b = inNetwork(args.to_author);
  if (!a.hit) return notFound("author in the influence network", args.from_author, a, { network_size: NETWORK.length, browse: link({ p: "influence" }) });
  if (!b.hit) return notFound("author in the influence network", args.to_author, b, { network_size: NETWORK.length, browse: link({ p: "influence" }) });
  if (a.hit === b.hit) return { found: true, answer: `Both names are ${a.hit}.`, open_on_site: link({ p: "influence", author: a.hit }) };
  const p = findPath(a.hit, b.hit);
  if (!p) return { found: true, from: a.hit, to: b.hit, chain: null, answer: `No chain of documented influence links connects ${a.hit} and ${b.hit} among the ${NETWORK.length} authors.`, open_on_site: link({ p: "influence", author: a.hit }) };
  return {
    found: true, from: a.hit, to: b.hit,
    chain: p.nodes, links: p.edges.length,
    each_link: p.edges.map(linkOut),
    how: `Shortest chain of documented influence links (${INF.documented.length} links among ${NETWORK.length} authors), following a link in either direction; when several chains tie, this is the one the site draws. Sources: Wikidata P737 'influenced by', or model-attested (Claude and/or Gemini). Similarities are between the two authors' texts.`,
    open_on_site: link({ p: "influence", author: a.hit, chain: `${a.hit}|${b.hit}` }),
  };
}

function authorInfluences(args) {
  if (!String(args.author || "").trim()) return err("Pass the author's name as author.");
  const m = inNetwork(args.author);
  if (!m.hit) return notFound("author in the influence network", args.author, m, { network_size: NETWORK.length, browse: link({ p: "influence" }) });
  const name = m.hit, A = INF.authors.find(x => x.name === name), i = NETWORK.indexOf(name);
  const into = INF.documented.filter(d => d.to === name).sort((x, y) => y.conceptual - x.conceptual);
  const out = INF.documented.filter(d => d.from === name).sort((x, y) => y.conceptual - x.conceptual);
  const deg = {}; INF.documented.forEach(d => { deg[d.from] = (deg[d.from] || 0) + 1; deg[d.to] = (deg[d.to] || 0) + 1; });
  const rank = Object.entries(deg).sort((x, y) => y[1] - x[1]).findIndex(([n]) => n === name) + 1;
  const comm = GR.influence.community;
  return {
    found: true, author: name, form: A.form, earliest_work_year: A.earliest_year, books_in_corpus: A.n_books_total,
    influenced_by: into.map(d => ({ author: d.from, sources: d.sources, conceptual_similarity: d.conceptual })),
    influenced: out.map(d => ({ author: d.to, sources: d.sources, conceptual_similarity: d.conceptual })),
    documented_links: deg[name] || 0,
    connectedness_rank: deg[name] ? `${rank} of ${Object.keys(deg).length} linked authors` : "no documented links",
    same_influence_circle: NETWORK.filter((n, j) => j !== i && comm[j] === comm[i]).sort((x, y) => (deg[y] || 0) - (deg[x] || 0)),
    how: `Documented influences only (Wikidata P737 or model-attested), among ${NETWORK.length} authors whose texts are in the corpus; ranked by conceptual similarity of the two authors' texts. same_influence_circle = Louvain community of the network (modularity ${GR.influence.modularity}).`,
    network_finding: NET_NOTE(),
    open_on_site: link({ p: "influence", author: name }),
  };
}

// ------------------------------------------------------------------ tools: genres
const clockOf = name => G.clock.communities.find(c => CLOCK_TO_GENRE[c.key] === name) || null;
function genreBlock(g) {
  return {
    name: g.name, novels_in_cluster: g.size, novels_span: `${g.year_min}–${g.year_max}`, cluster_first_forms: g.birth_year,
    distinctive_words: g.top_terms, held_out_library_label: g.held_out_label,
  };
}
function clockBlock(c) {
  const Y = G.clock.years;
  return {
    name: c.name, search_terms: c.terms,
    first_attested: c.first_attestation, reached_10pct_of_its_mentions_by: c.takeoff_10pct, half_of_its_mentions_by: c.mass_median,
    peak_year: c.peak_year, peak_mentions_per_billion_words: +c.series[Y.indexOf(c.peak_year)].toFixed(1),
    mentions_per_billion_words_every_20_years: Object.fromEntries(Y.map((y, i) => [y, +c.series[i].toFixed(1)]).filter(([y]) => y % 20 === 0)),
    // first_attestation, the takeoffs and the peak are computed inside the research clock's own
    // window, which opens at 1800 (literature-mutations reception_clock.json, method.window).
    measure: `Google Books mentions per billion words of the genre's own names, ${G.clock.smoothing_years}-year centred mean, ${Y[0]}–${Y[Y.length - 1]}. First attested, the 10% and half years and the peak are measured inside the research clock's window, which opens in 1800: a 1800 there means by 1800 at the latest.`,
  };
}
const GENRE_HOW = `Genres recovered from prose alone: TF-IDF of each novel's distinctive vocabulary, a k-nearest-neighbour graph, Louvain communities, each named from its titles and vocabulary. Library subject labels were held out and only used to check the clusters. ${G.n_books} novels, 8 genres.`;

function genreOfBook(args) {
  const t = String(args.title || "").trim(), a = String(args.author || "").trim();
  if (!t && !a) return err("Pass a title, an author, or both.");
  if (t) {
    const { m, authorNote, query } = findWork(t, a);
    if (!m.hit) return notFound("novel in this corpus", query, m, { browse: link({ p: "genres" }) });
    const w = m.hit, g = G.genres[w.genre];
    const peers = onePerBook(works.filter(x => x.genre === w.genre && !sameBook(x, w)).sort((x, y) => Math.abs(x.year - w.year) - Math.abs(y.year - w.year))).slice(0, 8).map(workTitle);
    const c = clockOf(g.name);
    return {
      found: true, novel: workTitle(w), genre: genreBlock(g),
      nearest_in_time_same_genre: peers,
      when_the_genres_name_caught_on: c ? clockBlock(c) : null,
      ...(c ? {} : { clock_note: `No name clock is tied to ${g.name}; genre_history lists the eight that exist.` }),
      how: GENRE_HOW, ...(authorNote ? { note: authorNote } : {}),
      open_on_site: link({ p: "genres", work: w.title }),
    };
  }
  const m = match(a, WORK_AUTHORS);
  if (!m.hit) return notFound("novelist in this corpus", a, m, { browse: link({ p: "genres" }) });
  const mine = works.filter(w => w.author === m.hit).sort((x, y) => x.year - y.year);
  const counts = {}; mine.forEach(w => (counts[genreName(w.genre)] = (counts[genreName(w.genre)] || 0) + 1));
  return {
    found: true, author: m.hit, novels_in_corpus: mine.length,
    genres: Object.entries(counts).sort((x, y) => y[1] - x[1]).map(([name, n]) => ({ ...genreBlock(G.genres.find(g => g.name === name)), novels_by_this_author: n })),
    novels: mine.map(w => ({ ...workTitle(w), genre: genreName(w.genre) })),
    how: GENRE_HOW,
    open_on_site: link({ p: "genres", author: m.hit }),
  };
}

// A genre can be named by its cluster, its clock, a search term, or the clock's short key.
const GENRE_NAMES = [];
G.genres.forEach(g => GENRE_NAMES.push({ label: g.name, genre: g, clock: clockOf(g.name) }));
G.clock.communities.forEach(c => {
  const g = G.genres.find(x => x.name === CLOCK_TO_GENRE[c.key]) || null;
  for (const l of [c.name, c.key.replace("_", " "), ...c.terms, ...c.name.split(" / ")]) GENRE_NAMES.push({ label: l, genre: g, clock: c });
});
GENRE_NAMES.push({ label: "mystery story", genre: G.genres.find(x => x.name === "Detective fiction"), clock: G.clock.communities.find(c => c.key === "detective"), mystery: true });

function genreHistory(args) {
  const q = String(args.genre || "").trim();
  if (!q) return {
    found: true,
    genres_recovered_from_prose: G.genres.map(g => ({ name: g.name, novels: g.size, novels_span: `${g.year_min}–${g.year_max}`, cluster_first_forms: g.birth_year })),
    genre_name_clocks: G.clock.communities.map(c => ({ name: c.name, search_terms: c.terms, reached_10pct_of_its_mentions_by: c.takeoff_10pct, half_of_its_mentions_by: c.mass_median })),
    how: GENRE_HOW, open_on_site: link({ p: "genres" }),
  };
  const m = match(q, GENRE_NAMES, x => x.label);
  if (m.ambiguous) { const uniq = [...new Set(m.ambiguous.map(l => { const e = GENRE_NAMES.find(x => x.label === l); return (e.genre && e.genre.name) || e.clock.name; }))]; if (uniq.length === 1) m.hit = GENRE_NAMES.find(x => x.label === m.ambiguous[0]); else m.ambiguous = uniq; }
  m.closest = [...new Set(m.closest.map(l => { const e = GENRE_NAMES.find(x => x.label === l); return (e.genre && e.genre.name) || e.clock.name; }))];
  if (!m.hit) return notFound("genre in this corpus", q, m, { available: [...G.genres.map(g => g.name), ...G.clock.communities.filter(c => !CLOCK_TO_GENRE[c.key]).map(c => c.name)], browse: link({ p: "genres" }) });
  const e = m.hit, g = e.genre, c = e.clock;
  const out = { found: true, genre: g ? g.name : c.name };
  if (g) {
    const mine = onePerBook(works.filter(w => w.genre === g.id).sort((x, y) => x.year - y.year));
    out.recovered_from_prose = { ...genreBlock(g), earliest_novels: mine.slice(0, 5).map(workTitle), latest_novels: mine.slice(-5).map(workTitle) };
  } else out.recovered_from_prose = null;
  out.when_the_name_caught_on = c ? clockBlock(c) : null;
  if (!g) out.note = `${c.name} has a name clock but no prose cluster among the 8 recovered genres.`;
  if (!c) out.note = `No name clock is tied to ${g.name}.`;
  if (c && c.key === "detective") {
    const ts = G.term_split;
    out.detective_vs_mystery = { question: ts.question, answer: ts.settled, detective_story_growth_1890s_to_1920s: `${ts.detective_growth_1890s_to_1920s}x`, mentions_per_million_by_decade: ts.decade_means_per_million };
  }
  out.books_vs_name = `Across the clocks, the year a genre's novels first appear correlates with its name's takeoff at r = ${G.clock.r_year_min_vs_name_takeoff}.`;
  out.how = GENRE_HOW;
  out.open_on_site = link(g ? { p: "genres", genre: g.name } : { p: "genres" });
  return out;
}

// ------------------------------------------------------------------ theme doors
// One named tool per kind of question people ask, each a thin wrapper over the engines above
// (QUESTIONS.md; ~/.claude/CLAUDE.md "Every question theme gets a tool", 2026-11-22).
function booksLike(args) {
  if (!String(args.title || "").trim()) return err("Pass the novel's title as title.");
  const { m, authorNote, query } = findWork(args.title, args.author);
  if (!m.hit) return notFound("novel in this corpus", query, m, { browse: link({ p: "genres" }) });
  const w = m.hit, g = G.genres[w.genre], ai = arcIndex.get(w.id);
  const arcAlike = ai == null ? [] : onePerBook(GR.arc.edges.filter(e => e[0] === ai || e[1] === ai).sort((x, y) => y[2] - x[2])
    .map(e => { const b = SEN.arcs[e[0] === ai ? e[1] : e[0]]; return { ...workTitle(works[b.work]), shape: b.shape, r: e[2] }; })
    .filter(x => !sameBook(x, w))).slice(0, GR.arc.k);
  const genrePeers = onePerBook(works.filter(x => x.genre === w.genre && !sameBook(x, w)).sort((x, y) => Math.abs(x.year - w.year) - Math.abs(y.year - w.year))).slice(0, 8).map(workTitle);
  const both = arcAlike.filter(a => genrePeers.some(p => sameBook(p, a)));
  return {
    found: true, novel: workTitle(w), genre_from_prose: g.name,
    alike_in_both_genre_and_arc: both,
    same_genre_by_prose_nearest_in_time: genrePeers,
    emotional_arc_moves_most_alike: arcAlike,
    ...(ai == null ? { arc_note: `${w.title}'s sentiment arc was not scored, so only genre neighbours are listed.` } : {}),
    how: `Two measured kinds of alike. Genre: the cluster the novel's own vocabulary places it in (${G.genres.length} genres over ${G.n_books} pre-1929 novels), nearest in year. Arc: Pearson r between z-scored sentiment arcs (1 = they move identically). Only novels in this corpus are listed.`,
    ...(authorNote ? { note: authorNote } : {}),
    open_on_site: link({ p: "genres", work: w.title }),
  };
}

// Under this start-to-end change a novel reads as ending where it began (the smallest ~11%, measured 2026-11-22).
const LEVEL = 0.005, LEVEL_SHARE = Math.round(100 * SEN.arcs.filter(a => Math.abs(changeOf(a)) < 0.005).length / SCORED);
function bookEndsHappy(args) {
  const out = moodArc({ title: args.title, author: args.author });
  if (out.__error || !out.found || out.scored === false) return out;
  const d = out.change_end_minus_start, level = Math.abs(d) < LEVEL;
  const verdict = level ? "about level" : d > 0 ? "happier" : "sadder";
  return { answer: `${out.novel.title} ${level ? `ends about where it begins (a change under ${LEVEL}; ${LEVEL_SHARE}% of novels move this little)` : `ends ${verdict} than it begins`}: sentiment ${out.start} at the start, ${out.end} at the end (change ${out.change_end_minus_start}; rank ${out.change_rank}). Shape: ${out.shape}, ${out.shape_means}.`, ...out, ends_happier_or_sadder: verdict };
}

const MEASURES = {
  overall: { key: a => a.mean, label: "mean polarity across the whole text" },
  ending: { key: a => a.end, label: "polarity of the last 10% of the text" },
  change: { key: a => changeOf(a), label: "end minus start (how far the mood moves by the last page)" },
};
function saddestHappiest(args) {
  const measure = MEASURES[args.measure] ? args.measure : "overall";
  const dir = ["saddest", "happiest"].includes(args.direction) ? args.direction : "both";
  const lim = Math.max(1, Math.min(25, args.limit || 10));
  const from = Number.isFinite(+args.from_year) && args.from_year != null ? +args.from_year : -Infinity;
  const to = Number.isFinite(+args.to_year) && args.to_year != null ? +args.to_year : Infinity;
  const k = MEASURES[measure].key;
  const pool = SEN.arcs.filter(a => works[a.work].year >= from && works[a.work].year <= to)
    .map(a => ({ ...workTitle(works[a.work]), genre_from_prose: genreName(works[a.work].genre), shape: a.shape, start: a.start, end: a.end, change_end_minus_start: changeOf(a), mean_polarity: a.mean, _v: k(a) }));
  if (!pool.length) return { found: false, answer: `No scored novel falls between ${args.from_year} and ${args.to_year}. Scored novels run ${SPAN}.` };
  const asc = onePerBook([...pool].sort((x, y) => x._v - y._v)), clean = l => l.slice(0, lim).map(({ _v, ...r }) => r);
  return {
    found: true, measure, measure_means: MEASURES[measure].label, novels_ranked: asc.length,
    ...(dir !== "happiest" ? { saddest: clean(asc) } : {}),
    ...(dir !== "saddest" ? { happiest: clean([...asc].reverse()) } : {}),
    how: `${SEN.method}. Polarity runs -1 to 1 and measures the words, not the plot: a novel told in warm language can still end in a death. ${SCORED} novels scored, ${SPAN}. Other measures: overall, ending, change.`,
    open_on_site: link({ p: "sentiment" }),
  };
}

function novelsByAuthor(args) {
  if (!String(args.author || "").trim()) return err("Pass the novelist's name as author.");
  return genreOfBook({ author: args.author });
}

function novelsFromEra(args) {
  const from = args.from_year != null && args.from_year !== "" ? +args.from_year : null;
  const to = args.to_year != null && args.to_year !== "" ? +args.to_year : null;
  if (from == null && to == null && !String(args.genre || "").trim()) return err("Pass from_year and/or to_year (e.g. 1840 and 1849), a genre, or both.");
  let gid = null, gname = null;
  if (String(args.genre || "").trim()) {
    const m = match(args.genre, GENRE_NAMES, x => x.label);
    if (m.ambiguous) { const g = GENRE_NAMES.find(x => x.label === m.ambiguous[0]); if (m.ambiguous.every(l => GENRE_NAMES.find(x => x.label === l).genre === g.genre)) m.hit = g; }
    if (!m.hit) return notFound("genre among the prose clusters", args.genre, m, { available: G.genres.map(g => g.name) });
    if (!m.hit.genre) return { found: false, answer: `${m.hit.clock.name} is tracked as a genre name in print but is not one of the ${G.genres.length} genres the novels' prose separates into.`, available: G.genres.map(g => g.name) };
    gid = m.hit.genre.id; gname = m.hit.genre.name;
  }
  const lim = Math.max(1, Math.min(100, args.limit || 40));
  const hits = onePerBook(works.filter(w => (from == null || w.year >= from) && (to == null || w.year <= to) && (gid == null || w.genre === gid)).sort((x, y) => x.year - y.year));
  const yrs = works.map(w => w.year);
  if (!hits.length) return { found: false, answer: `No novel in this corpus matches. The corpus runs ${Math.min(...yrs)}-${Math.max(...yrs)}.`, genres: G.genres.map(g => g.name) };
  const byGenre = {}; hits.forEach(w => (byGenre[genreName(w.genre)] = (byGenre[genreName(w.genre)] || 0) + 1));
  return {
    found: true, from_year: from, to_year: to, genre: gname, novels_matching: hits.length,
    by_genre: Object.entries(byGenre).sort((x, y) => y[1] - x[1]).map(([genre, n]) => ({ genre, novels: n })),
    novels: hits.slice(0, lim).map(w => ({ ...workTitle(w), genre: genreName(w.genre), arc_scored: arcIndex.has(w.id) })),
    ...(hits.length > lim ? { more: `${hits.length - lim} more; raise limit (max 100) or narrow the years.` } : {}),
    how: `The ${G.n_books} pre-1929 novels in this corpus, one row per book; genre is the cluster each novel's own prose places it in. A curated research corpus, not every novel published.`,
    open_on_site: link({ p: "genres" }),
  };
}

function didInfluence(args) {
  const out = influenceChain(args);
  if (out.__error || !out.found || !out.from) return out;
  const direct = INF.documented.find(d => d.from === out.from && d.to === out.to), reverse = INF.documented.find(d => d.from === out.to && d.to === out.from);
  const answer = direct ? `Yes: ${out.from} influenced ${out.to} directly (sources: ${direct.sources.join(", ")}).`
    : reverse ? `Not that way round: the documented link runs from ${out.to} to ${out.from} (sources: ${reverse.sources.join(", ")}).`
    : out.chain ? `No direct documented link. They connect through ${out.links} links: ${out.chain.join(" → ")}.`
    : `No documented link and no chain connects them in this network.`;
  return { answer, direct_link: !!direct, reverse_link: !!reverse, ...out };
}

const listGenres = () => genreHistory({});

// ------------------------------------------------------------------ MCP surface
const err = msg => ({ __error: msg });
const T = (name, title, description, properties, required = []) => ({ name, title, description, inputSchema: { type: "object", properties, required, additionalProperties: false }, annotations: { title, ...ANN } });

const TOOLS = [
  T("novel_mood_arc", "The emotional arc of a classic novel, its shape, and the novels whose arcs move most alike",
    `For 'what is the emotional arc of X', 'does X end happier or sadder than it begins', 'where does X turn', 'which novels feel like X as they go'. Sentiment of the full Gutenberg text of ${SCORED} classic novels (${SPAN}), scored in 100 parts and smoothed: start, end, the change and its rank among all ${SCORED}, the shape by thirds (Rise, Fall, Rise–fall, Fall–rise), where the sharpest turn falls, the arc every 10%, and the ${GR.arc.k} novels whose arcs correlate most closely. Fuzzy-matches the title; if the novel is not in the corpus it says so and lists the closest titles.`,
    { title: { type: "string", description: "The novel's title, e.g. 'Moby-Dick', 'Pride and Prejudice'" }, author: { type: "string", description: "Optional author, to pick between similar titles" }, full_arc: { type: "boolean", description: "true = also return all 100 points of the smoothed arc" } }, ["title"]),
  T("writers_who_sound_like", "Writers whose prose and ideas sit closest to a given writer",
    `For 'who writes like X', 'which authors sound like X', 'who is closest to X in style / in ideas'. Over ${PR.authors.length} writers from Homer to Joyce: nearest by distinctive vocabulary (TF-IDF) and nearest by ideas and imagery (embeddings), plus the writer's prose circle. For Cormac McCarthy, Herman Melville and William Shakespeare it adds the character-GPT cross-reading: a small GPT trained on each one reading the others (bits per character), each author's word tells, and which book a model's generated text lands nearest.`,
    { author: { type: "string", description: "The writer, e.g. 'Herman Melville', 'Nietzsche'" }, limit: { type: "integer", minimum: 1, maximum: 20, description: "How many nearest writers per measure (default 8)" } }, ["author"]),
  T("influence_chain", "The shortest documented chain of literary influence between two authors",
    `For 'how is X connected to Y', 'did X influence Y', 'trace the influence from X to Y'. Shortest chain of documented influence links (Wikidata 'influenced by' plus model-attested) through ${NETWORK.length} authors, each link with its direction, source and how alike the two authors' texts are. Says plainly when no chain exists or an author is not in the network.`,
    { from_author: { type: "string", description: "First author, e.g. 'Plato'" }, to_author: { type: "string", description: "Second author, e.g. 'James Joyce'" } }, ["from_author", "to_author"]),
  T("author_influences", "Who influenced an author, and whom they influenced",
    `For 'who influenced X', 'who did X influence', 'X's literary influences'. Documented influences in and out for one of ${NETWORK.length} authors, ranked by conceptual similarity of their texts, with sources, the author's influence circle and how connected they are.`,
    { author: { type: "string", description: "The author, e.g. 'Ralph Waldo Emerson'" } }, ["author"]),
  T("genre_of_book", "The genre a novel's own prose places it in (or an author's novels)",
    `For 'what genre is X by its prose', 'which genre does X belong to', 'what genres did Y write in'. Genres recovered from the words alone across ${G.n_books} pre-1929 novels: the cluster's name, size, span, distinctive words and held-out library label, the novels nearest in time in the same cluster, and when the genre's name caught on where a name clock exists. Pass a title, or an author for all their novels.`,
    { title: { type: "string", description: "A novel's title, e.g. 'Dracula'" }, author: { type: "string", description: "An author: alone for all their novels, or with title to disambiguate" } }),
  T("genre_history", "When a genre formed in the prose, and when its name caught on",
    "For 'when did detective fiction emerge', 'when did people start saying \"Gothic novel\"', 'is mystery fiction just detective fiction renamed', 'what genres are there'. The prose cluster (when it first forms, its novels, earliest and latest) and the genre-name clock from Google Books (first attested, the years it reached 10% and half of its mentions, the peak, mentions per billion words every 20 years). Leave genre empty to list every genre and clock.",
    { genre: { type: "string", description: "A genre or its name, e.g. 'detective fiction', 'gothic novel', 'sea story', 'western'. Empty = list all." } }),
  T("books_like", "Novels like a given classic, by genre and by emotional arc",
    `Novels in this corpus most like a given one, two measured ways: the same genre by the novel's own prose (nearest in year) and the emotional arcs that move most alike, plus the ones that are alike both ways. Over ${G.n_books} pre-1929 novels.\n\nExample questions:\n- "Books like Dracula"\n- "If I loved Jane Eyre, what should I read next?"\n- "Novels similar to The Count of Monte Cristo"`,
    { title: { type: "string", description: "The novel's title, e.g. 'Dracula'" }, author: { type: "string", description: "Optional author, to pick between similar titles" } }, ["title"]),
  T("does_book_have_a_happy_ending", "Whether a classic novel ends happier or sadder than it begins",
    `A one-line verdict on whether a novel ends happier or sadder than it begins, from the sentiment of its full text, then the full arc reading (start, end, change and its rank, shape, sharpest turn, alike novels). ${SCORED} novels scored, ${SPAN}.\n\nExample questions:\n- "Does Great Expectations have a happy ending?"\n- "Is Tess of the d'Urbervilles sad?"\n- "How does Wuthering Heights end, emotionally?"`,
    { title: { type: "string", description: "The novel's title, e.g. 'Great Expectations'" }, author: { type: "string", description: "Optional author" } }, ["title"]),
  T("saddest_and_happiest_novels", "The saddest and happiest classic novels, ranked by measured sentiment",
    `Classic novels ranked by the sentiment of their full text: overall mood, mood of the ending, or how far the mood moves from first page to last. Optional year range. ${SCORED} novels scored, ${SPAN}.\n\nExample questions:\n- "What is the saddest classic novel?"\n- "Which Victorian novels have the happiest endings?"\n- "Novels that get darker as they go"`,
    { direction: { type: "string", enum: ["saddest", "happiest", "both"], description: "Default both" }, measure: { type: "string", enum: ["overall", "ending", "change"], description: "overall = whole text (default), ending = last 10%, change = end minus start" }, from_year: { type: "integer" }, to_year: { type: "integer" }, limit: { type: "integer", minimum: 1, maximum: 25, description: "Default 10" } }),
  T("novels_by_author", "A novelist's books in this corpus, with the genre each one's prose falls in",
    `Every novel by one author in this corpus, in order of year, with the genre its prose places it in and how the author's novels split across genres.\n\nExample questions:\n- "What novels did Charles Dickens write?"\n- "Which Jane Austen books are covered?"\n- "Did Walter Scott write in more than one genre?"`,
    { author: { type: "string", description: "The novelist, e.g. 'Charles Dickens'" } }, ["author"]),
  T("classic_novels_from_era", "Classic novels from a year range, a decade or a genre",
    `The novels in this corpus from a year range and/or a prose genre, oldest first, with each one's genre, how many match by genre, and whether its arc was scored. Corpus: ${G.n_books} pre-1929 novels.\n\nExample questions:\n- "Classic novels from the 1840s"\n- "Detective novels written before 1900"\n- "What sea stories were published between 1850 and 1900?"`,
    { from_year: { type: "integer", description: "First year, e.g. 1840" }, to_year: { type: "integer", description: "Last year, e.g. 1849" }, genre: { type: "string", description: "Optional prose genre, e.g. 'Detective fiction', 'sea story', 'Historical romance'" }, limit: { type: "integer", minimum: 1, maximum: 100, description: "Default 40" } }),
  T("did_author_influence", "Whether one author influenced another, directly or through a chain",
    `A yes/no answer on whether one author influenced another: a direct documented link, a link running the other way, or the chain that connects them, then each link with its sources. ${NETWORK.length} authors.\n\nExample questions:\n- "Did Poe influence Arthur Conan Doyle?"\n- "Was Melville influenced by Shakespeare?"\n- "Did Dostoevsky read Dickens?"`,
    { from_author: { type: "string", description: "The possible influence, e.g. 'Edgar Allan Poe'" }, to_author: { type: "string", description: "The possibly influenced author, e.g. 'Arthur Conan Doyle'" } }, ["from_author", "to_author"]),
  T("what_genres_are_there", "Every genre recovered from the novels' prose, and every genre-name clock",
    `The genres recovered from the prose of ${G.n_books} pre-1929 novels (size, span, when each cluster first forms) and the genre names tracked through Google Books (when each caught on).\n\nExample questions:\n- "What genres did 19th-century novels fall into?"\n- "When did the word 'western' catch on?"`,
    {}),
];

const HANDLERS = { novel_mood_arc: moodArc, writers_who_sound_like: soundsLike, influence_chain: influenceChain, author_influences: authorInfluences, genre_of_book: genreOfBook, genre_history: genreHistory,
  books_like: booksLike, does_book_have_a_happy_ending: bookEndsHappy, saddest_and_happiest_novels: saddestHappiest, novels_by_author: novelsByAuthor, classic_novels_from_era: novelsFromEra, did_author_influence: didInfluence, what_genres_are_there: listGenres };

const INSTRUCTIONS = `Classic Literature answers questions about classic novels and writers from measurements of their full texts: a novel's emotional arc (novel_mood_arc), writers whose prose or ideas sit closest (writers_who_sound_like), documented influence between authors (influence_chain, author_influences), and genres recovered from prose plus when each genre's name caught on (genre_of_book, genre_history). Shortcuts for common questions: books_like, does_book_have_a_happy_ending, saddest_and_happiest_novels, novels_by_author, classic_novels_from_era, did_author_influence, what_genres_are_there. Quote numbers exactly as returned and never estimate one the tools did not return, including for a novel whose arc was not scored. A result with found: false is an answer: say the book or writer is not in this corpus and offer the closest matches; never substitute another. When did_you_mean lists several names, ask which one. Always give the open_on_site link.`;

function callTool(name, args = {}) {
  const h = HANDLERS[name];
  if (!h) return { out: { ok: false, error: "Unknown tool " + name }, isError: true };
  const out = h(args || {});
  if (out && out.__error) return { out: { ok: false, error: out.__error }, isError: true };
  return { out };
}

async function logCall(tool, ok, ms, meta, attempted) {
  if (process.env.CL_NO_ANALYTICS || meta.test) return;
  try {
    await fetch("https://us.i.posthog.com/capture/", { method: "POST", headers: { "content-type": "application/json" }, signal: AbortSignal.timeout(1500),
      body: JSON.stringify({ api_key: PH_KEY, event: "mcp_tool_call", distinct_id: "classic-literature-mcp",
        properties: { tool, ok, ms, ...(attempted ? { attempted } : {}), site: "classic-literature", $process_person_profile: false, $geoip_disable: true, $lib: "classic-literature-mcp" } }) });
  } catch (e) {}
}

const asContent = obj => ({ content: [{ type: "text", text: JSON.stringify(obj, null, 1) }], structuredContent: obj });

async function handleOne(msg, meta = {}) {
  const { id, method, params } = msg || {};
  const ok = result => ({ jsonrpc: "2.0", id, result });
  if (method === "initialize") return ok({ protocolVersion: (params && params.protocolVersion) || "2025-06-18", capabilities: { tools: { listChanged: false } }, serverInfo: { name: "classic-literature", title: "Classic Literature: arcs, influence, prose, genres", version: VERSION, websiteUrl: SITE }, instructions: INSTRUCTIONS });
  if (method === "ping") return ok({});
  if (method === "tools/list") return ok({ tools: TOOLS });
  if (method === "tools/call") {
    const t0 = Date.now(), tool = String((params && params.name) || "");
    let r;
    try { r = callTool(tool, (params && params.arguments) || {}); }
    catch (e) { r = { out: { ok: false, error: "Error: " + e.message }, isError: true }; }
    await logCall(HANDLERS[tool] ? tool : "unknown", !r.isError, Date.now() - t0, meta, HANDLERS[tool] ? null : tool.replace(/[^A-Za-z0-9_.-]/g, "").slice(0, 60));
    return ok({ ...asContent(r.out), ...(r.isError ? { isError: true } : {}) });
  }
  if (method === "resources/list") return ok({ resources: [] });
  if (method === "prompts/list") return ok({ prompts: [] });
  if (method && method.startsWith("notifications/")) return null;
  return { jsonrpc: "2.0", id, error: { code: -32601, message: "Method not found: " + method } };
}

async function readBody(req) {
  if (req.body && typeof req.body === "object") return req.body;
  if (typeof req.body === "string") return JSON.parse(req.body);
  const chunks = [];
  for await (const c of req) chunks.push(c);
  return JSON.parse(Buffer.concat(chunks).toString("utf8") || "null");
}

module.exports = async function handler(req, res) {
  res.setHeader("access-control-allow-origin", "*");
  res.setHeader("access-control-allow-headers", "content-type, mcp-session-id, mcp-protocol-version, authorization, x-cl-test");
  res.setHeader("access-control-allow-methods", "POST, GET, OPTIONS, DELETE");
  if (req.method === "OPTIONS") { res.statusCode = 204; return res.end(); }
  if (req.method === "GET") { res.statusCode = 405; res.setHeader("allow", "POST"); res.setHeader("content-type", "application/json"); return res.end(JSON.stringify({ name: "Classic Literature MCP", transport: "streamable-http", url: SITE + "/api/mcp", tools: TOOLS.map(t => t.name), site: SITE })); }
  if (req.method === "DELETE") { res.statusCode = 204; return res.end(); }
  let body;
  try { body = await readBody(req); } catch (e) { res.statusCode = 400; res.setHeader("content-type", "application/json"); return res.end(JSON.stringify({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } })); }
  const meta = { test: !!req.headers["x-cl-test"] };
  const batch = Array.isArray(body);
  const out = (await Promise.all((batch ? body : [body]).map(m => handleOne(m, meta)))).filter(Boolean);
  if (!out.length) { res.statusCode = 202; return res.end(); }
  res.setHeader("content-type", "application/json");
  res.end(JSON.stringify(batch ? out : out[0]));
};
module.exports.TOOLS = TOOLS;
module.exports.callTool = callTool;
module.exports.handleOne = handleOne;
module.exports.match = match;
module.exports.SITE = SITE;
