/* Q&A over the extracted data, two halves.
 *
 * localAsk(q, D)  -> a view spec, parsed without a model (the free path, and the fallback).
 * readout(spec,D) -> the numbers for that view, computed from the JSON. Whatever produced
 *                    the spec (this parser or Claude via /api/ask), every figure the visitor
 *                    reads under the answer comes from here, never from generated text.
 *
 * Spec: {page, focus, filters:{author,work,genre,from,to}, highlight:[], answer}
 */
(function () {
  const PAGES = ["sentiment", "genres", "influence", "prose", "atlas"];
  const GENRE_WORDS = {
    detective: ["detective", "mystery", "crime", "sherlock", "holmes", "police"],
    gothic: ["gothic", "sensation", "ghost", "horror"],
    historical: ["historical", "romance"],
    nautical: ["nautical", "sea ", "sea-", "sailor", "ship", "maritime"],
    western: ["western", "cowboy", "frontier"],
    religious: ["religious", "catholic", "ecclesiastical"],
    domestic: ["domestic"],
    early_novel: ["manners", "early english", "early novel"],
  };
  const CLOCK_TO_GENRE = { detective: "Detective fiction", historical: "Historical romance", nautical: "Nautical adventure", early_novel: "Early English novel" };

  function norm(s) { return (s || "").toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, ""); }

  function findAuthor(q, D) {
    const qq = " " + norm(q).replace(/[^a-z\s'-]/g, " ") + " ";
    let best = null, bestLen = 0;
    for (const a of D.authorsAll) {
      const n = norm(a);
      if (qq.includes(" " + n + " ") && n.length > bestLen) { best = a; bestLen = n.length; continue; }
      const toks = n.split(/\s+/); const last = toks.length > 1 && toks[toks.length - 1].length > 2 && !["the", "great"].includes(toks[toks.length - 1]) ? toks[toks.length - 1] : null;
      if (last && qq.includes(" " + last + " ") && last.length > bestLen) {
        // prefer authors with more data behind them when a surname is shared
        best = a; bestLen = last.length;
      }
    }
    return best;
  }

  // Every author named in the question, in the order they appear ("from Plato to Doyle").
  function findAuthors(q, D) {
    const qq = " " + norm(q).replace(/[^a-z\s'-]/g, " ") + " ";
    const STOP = ["john", "william", "thomas", "henry", "charles", "george", "robert", "james", "mary", "lord", "the", "great"];
    const hits = [];
    for (const a of D.authorsAll) {
      const n = norm(a);
      let at = qq.indexOf(" " + n + " ");
      if (at < 0) { const toks = n.split(/\s+/); const last = toks.length > 1 && toks[toks.length - 1].length > 2 && !STOP.includes(toks[toks.length - 1]) ? toks[toks.length - 1] : null; if (last) at = qq.indexOf(" " + last + " "); }
      if (at >= 0) hits.push([at, a, D.influence.authors.some(x => x.name === a) ? 1 : 0]);
    }
    hits.sort((x, y) => x[0] - y[0] || y[2] - x[2]);
    const out = []; for (const [at, a] of hits) if (!out.some(([b]) => Math.abs(b - at) < 3)) out.push([at, a]);
    return out.map(x => x[1]);
  }

  function findWork(q, D) {
    const qq = norm(q);
    let best = null;
    for (const w of D.works) {
      const t = norm(w.title).replace(/^the /, "");
      if (t.length > 4 && qq.includes(t) && (!best || t.length > norm(best.title).length)) best = w;
    }
    return best;
  }

  function findClock(q, D) {
    const qq = norm(q) + " ";
    for (const [k, words] of Object.entries(GENRE_WORDS)) if (words.some(w => qq.includes(w))) return D.genres.clock.communities.find(c => c.key === k);
    return null;
  }

  function findGenre(q, D) {
    const qq = norm(q);
    for (const g of D.genres.genres) if (qq.includes(norm(g.name))) return g.name;
    const c = findClock(q, D);
    return c && CLOCK_TO_GENRE[c.key] ? CLOCK_TO_GENRE[c.key] : null;
  }

  function years(q) {
    const out = { from: null, to: null };
    const re = /(after|since|from|before|until|to|by|in|-|–)?\s*(1[5-9]\d0|1[5-9]\d\d)s?/gi;
    let m, n = 0, lastWord = "";
    while ((m = re.exec(q))) {
      n++; lastWord = (m[1] || "").toLowerCase();
      const y = +m[2], dec = Math.floor(y / 10) * 10, w = (m[1] || "").toLowerCase();
      if (["before", "until", "to", "by", "-", "–"].includes(w)) out.to = dec;
      else if (out.from === null) out.from = dec;
      else out.to = dec;
    }
    // "in the 1890s", "novels from 1850": one decade, no direction word -> that decade alone
    if (n === 1 && out.from !== null && !["after", "since"].includes(lastWord)) out.to = out.from;
    return out;
  }

  function localAsk(q, D) {
    const qq = norm(q);
    const author = findAuthor(q, D);
    const work = findWork(q, D);
    const clock = findClock(q, D);
    const genre = findGenre(q, D);
    const y = years(q);
    const named = findAuthors(q, D);
    let page = "genres", focus = "g-bands", path = null, cohort = null, color = null;
    const darkQ = /dark|end|sentiment|mood|happ|sad|bleak|grim|tone/.test(qq);
    if (/atlas|everything|every entity|one graph|whole map/.test(qq)) { page = "atlas"; focus = "a-graph"; }
    else if (named.length >= 2 && /path|chain|connect|link|get from|route|between|lead to|to get/.test(qq)) { page = "influence"; focus = "i-graph"; path = [named[0], named[1]]; }
    else if (author && darkQ && /influenc|heirs|disciples|followers|inspired/.test(qq)) {
      page = "sentiment"; focus = "s-scatter";
      const heirs = new RegExp("(writers|authors|those|who|ones)\\s+(that\\s+)?" + norm(author).split(" ").pop() + "\\s+influenc|influenced by|heirs|disciples|followers|inspired by").test(qq);
      cohort = { rel: heirs ? "heirs" : "influences", author };
    }
    else if (/communit|circle|clique|cluster|group|famil|camp/.test(qq) && /influenc/.test(qq)) { page = "influence"; focus = "i-graph"; color = "community"; }
    else if (/cluster|communit|circle|clique|group|famil|camp/.test(qq) && /prose|style|writ|sound/.test(qq)) { page = "prose"; focus = "p-graph"; }
    else if (/famil|cluster|similar arc|arcs? like|move like|same shape|shaped like|kin/.test(qq) && (work || /arc|shape|novel/.test(qq))) { page = "sentiment"; focus = "s-graph"; }
    else if (/cross|bridge|more than one genre|several genres|multiple genres|span|which genres did|genres did/.test(qq)) { page = "genres"; focus = "g-graph"; }
    else if (/influenc|inspired|mentor|disciple|admired|read by|lineage|descend/.test(qq)) { page = "influence"; focus = "i-ego"; }
    else if (/prose|style|stylist|writes like|write like|closest|similar|resembl|sound like|voice|predictab|perplex|transformer|gpt/.test(qq)) { page = "prose"; focus = /predictab|perplex|transformer|gpt|model/.test(qq) ? "p-bpc" : "p-nn"; }
    else if (/sentiment|mood|arc|dark|happ|sad|emotion|end |ending|ends|momentum|turn|feel|tone|positive|negative|shape/.test(qq) || work) { page = "sentiment"; focus = work ? "s-arc" : "s-shape"; }
    else if (clock && /name|word|called|term|label|ngram|rise|mutat|after|since|before|change|grow|evolv/.test(qq)) { page = "genres"; focus = "g-clock"; }
    else if (/decade|era|century|density|how many|count/.test(qq)) { page = "genres"; focus = "g-density"; }
    else if (/null|random|shuffl|rate|acceler/.test(qq)) { page = "genres"; focus = "g-null"; }
    else if (author && !genre) { page = "prose"; focus = "p-nn"; }
    const spec = {
      page, focus, source: "local", path, cohort, color,
      filters: { author: author || null, work: work ? work.title : null, genre: page === "genres" && focus === "g-clock" ? null : genre, from: y.from, to: y.to },
      highlight: clock ? [clock.name] : [],
      answer: "",
    };
    if (page === "prose" || page === "influence") spec.filters.genre = null;
    if (path || cohort) spec.filters.author = null;
    if (focus === "g-graph" && !author) spec.filters.author = null;
    return spec;
  }

  const fmt = (x, n = 3) => (x == null ? "–" : (+x).toFixed(n));
  const pct = x => Math.round(x * 100) + "%";

  function readout(spec, D) {
    const f = spec.filters || {};
    if (spec.path && spec.path[0] && spec.path[1]) {
      const p = D.findPath(spec.path[0], spec.path[1]);
      return p ? `${p.nodes.join(" → ")}: ${p.edges.length} documented link${p.edges.length > 1 ? "s" : ""}.` : `No chain of documented influences joins ${spec.path[0]} and ${spec.path[1]}.`;
    }
    if (spec.cohort) {
      const set = D.cohortWorks(spec.cohort).filter(w => w.arc);
      const all = D.works.filter(w => w.arc);
      const lowAll = all.filter(w => w.arc.end < w.arc.start).length / all.length;
      if (!set.length) return `None of the writers ${spec.cohort.rel === "heirs" ? `${spec.cohort.author} influenced` : `who influenced ${spec.cohort.author}`} have novels in the sentiment corpus.`;
      const low = set.filter(w => w.arc.end < w.arc.start).length;
      return `${set.length} novels by ${new Set(set.map(w => w.author)).size} writers ${spec.cohort.rel === "heirs" ? `${spec.cohort.author} influenced` : `who influenced ${spec.cohort.author}`} (${[...new Set(set.map(w => w.author))].join(", ")}): ${pct(low / set.length)} end lower than they begin, against ${pct(lowAll)} of all ${all.length}.`;
    }
    if (spec.focus === "a-graph") {
      const set = D.filterWorks(f);
      return `${set.length} novels by ${new Set(set.map(w => w.author)).size} novelists across ${(n => n + (n === 1 ? " genre" : " genres"))(new Set(set.map(w => w.genre).filter(g => g != null)).size)}, with ${D.influence.documented.length} influence links in the full model.`;
    }
    if (spec.focus === "i-graph" && spec.color === "community") {
      const lab = D.graphs.influence.community; const k = new Set(lab).size;
      const deg = {}; D.influence.documented.forEach(d => { deg[d.from] = (deg[d.from] || 0) + 1; deg[d.to] = (deg[d.to] || 0) + 1; });
      const groups = [...Array(k).keys()].map(c => D.influence.authors.filter((a, i) => lab[i] === c).sort((a, b) => (deg[b.name] || 0) - (deg[a.name] || 0)).map(a => a.name.split(" ").pop()));
      return `${k} communities (modularity ${D.graphs.influence.modularity}): ` + groups.map(g => g.slice(0, 4).join(", ")).join(" | ") + ".";
    }
    if (spec.focus === "s-graph") {
      const A = D.graphs.arc;
      if (f.work) {
        const i = D.sentiment.arcs.findIndex(a => D.works[a.work].title === f.work);
        if (i >= 0) { const nb = A.edges.filter(e => e[0] === i || e[1] === i).sort((a, b) => b[2] - a[2]).slice(0, 4).map(e => { const w = D.works[D.sentiment.arcs[e[0] === i ? e[1] : e[0]].work]; return `${w.title} (r ${fmt(e[2], 2)})`; });
          return `${f.work} has a ${D.sentiment.arcs[i].shape.toLowerCase()} arc; it moves most like ${nb.join(", ")}.`; }
      }
      return `Each novel is linked to the ${A.k} whose arcs move most like it: ${pct(A.same_shape_neighbours)} of those neighbours share its shape, against ${pct(A.same_shape_chance)} by chance.`;
    }
    if (spec.focus === "g-graph") {
      const by = {}; D.filterWorks(f).forEach(w => { if (w.genre != null) (by[w.author] = by[w.author] || new Set()).add(w.genre); });
      if (f.author && by[f.author]) return `${f.author} writes in ${by[f.author].size} genre${by[f.author].size > 1 ? "s" : ""}: ${[...by[f.author]].map(g => D.genres.genres[g].name).join(", ")}.`;
      const multi = Object.entries(by).filter(([, g]) => g.size > 1).sort((a, b) => b[1].size - a[1].size);
      return `${multi.length} of ${Object.keys(by).length} novelists write in more than one genre. Widest: ${multi.slice(0, 4).map(([a, g]) => `${a} (${g.size})`).join(", ")}.`;
    }
    if (spec.focus === "p-bpc") {
      const P = D.prose.persona, M = P.authors, NM = { mccarthy: "McCarthy", melville: "Melville", shakespeare: "Shakespeare" };
      const t = f.author && M.find(m => f.author.toLowerCase().includes(m));
      if (t) { const rows = M.filter(m => m !== t).map(m => [m, P.cross_bpc[m][t]]).sort((a, b) => b[1] - a[1]);
        return `${NM[rows[0][0]]}'s model finds ${NM[t]} hardest: ${fmt(rows[0][1], 2)} bits per character, against ${fmt(rows[1][1], 2)} for ${NM[rows[1][0]]}'s and ${fmt(P.cross_bpc[t][t], 2)} for ${NM[t]}'s own.`; }
      return `Each model reads its own author best: McCarthy ${fmt(P.cross_bpc.mccarthy.mccarthy, 2)}, Melville ${fmt(P.cross_bpc.melville.melville, 2)}, Shakespeare ${fmt(P.cross_bpc.shakespeare.shakespeare, 2)} bits per character. The farthest pair is McCarthy's model reading Shakespeare (${fmt(P.cross_bpc.mccarthy.shakespeare, 2)}).`;
    }
    if (spec.focus === "p-graph") {
      const lab = D.graphs.prose.stylistic; const a = f.author; const i = D.prose.authors.indexOf(a);
      if (i >= 0) { const mates = D.prose.authors.filter((x, j) => lab[j] === lab[i] && x !== a); return `${a}'s prose community (${mates.length + 1} writers): ${mates.slice(0, 8).join(", ")}.`; }
      const k = new Set(lab).size;
      const deg = {}; D.influence.documented.forEach(d => { deg[d.from] = (deg[d.from] || 0) + 1; deg[d.to] = (deg[d.to] || 0) + 1; });
      return `${k} prose communities (modularity ${D.graphs.prose.modularity.stylistic}): ` + [...Array(k).keys()].map(c => D.prose.authors.filter((x, j) => lab[j] === c).sort((a, b) => (deg[b] || 0) - (deg[a] || 0)).slice(0, 4).map(x => x.split(" ").pop()).join(", ")).join(" | ") + ".";
    }
    if (spec.page === "influence") {
      const a = f.author;
      if (!a) return `Influence network: ${D.influence.authors.length} authors, ${D.influence.documented.length} documented influence pairs.`;
      if (!D.influence.authors.some(x => x.name === a)) return `${a} is not one of the ${D.influence.authors.length} authors in the influence network.`;
      const into = D.influence.documented.filter(d => d.to === a).sort((x, y) => y.conceptual - x.conceptual);
      const out = D.influence.documented.filter(d => d.from === a).sort((x, y) => y.conceptual - x.conceptual);
      const l = arr => arr.slice(0, 6).map(d => `${d === undefined ? "" : (d.to === a ? d.from : d.to)} (${fmt(d.conceptual, 2)})`).join(", ");
      return `${a}: influenced by ${into.length ? l(into) : "no documented author in the network"}` + (out.length ? `; influenced ${l(out)}` : "") + ". Numbers are conceptual similarity of the two authors' texts.";
    }
    if (spec.page === "prose") {
      const a = f.author;
      const i = D.prose.authors.indexOf(a);
      if (i < 0) {
        const P = D.prose.persona;
        if (a && /mccarthy|melville|shakespeare/i.test(a)) { /* fall through to persona */ }
        else if (a) return `${a} is not one of the ${D.prose.authors.length} authors with a stylistic profile.`;
        return `Character GPTs: McCarthy ${fmt(P.val_loss.mccarthy)} nats/char, Melville ${fmt(P.val_loss.melville)}, Shakespeare ${fmt(P.val_loss.shakespeare)} (lower = more predictable prose).`;
      }
      const m = D.prose.stylistic[i].map((v, j) => [D.prose.authors[j], v]).filter(([n, v]) => n !== a && v != null).sort((x, y) => y[1] - x[1]).slice(0, 5);
      return `Closest prose to ${a} (TF-IDF stylistic similarity): ` + m.map(([n, v]) => `${n} ${fmt(v)}`).join(", ") + ".";
    }
    if (spec.page === "sentiment") {
      const set = D.filterWorks(f).filter(w => w.arc);
      if (f.work) {
        const w = D.works.find(x => x.title === f.work && x.arc);
        if (w) return `${w.title} (${w.author}): ${w.arc.shape.toLowerCase()} arc, starts at ${fmt(w.arc.start)} and ends at ${fmt(w.arc.end)}; the sharpest turn is ${w.arc.turn}% of the way in.`;
      }
      if (!set.length) return "No scored novels match those filters.";
      const lower = set.filter(w => w.arc.end < w.arc.start).length;
      const shapes = {}; set.forEach(w => (shapes[w.arc.shape] = (shapes[w.arc.shape] || 0) + 1));
      const top = Object.entries(shapes).sort((a, b) => b[1] - a[1])[0];
      return `${set.length} novels: ${pct(lower / set.length)} end lower than they begin; commonest shape ${top[0]} (${top[1]}).`;
    }
    // genres
    const hl = (spec.highlight || [])[0];
    const c = D.genres.clock.communities.find(x => x.name === hl);
    if (c && spec.focus === "g-clock") {
      const yrs = D.genres.clock.years;
      const from = f.from || 1780, to = f.to ? f.to + 9 : 1960;
      const seg = yrs.map((y, i) => [y, c.series[i]]).filter(([y]) => y >= from && y <= to);
      const peak = seg.reduce((a, b) => (b[1] > a[1] ? b : a), seg[0] || [0, 0]);
      const first = seg[0], last = seg[seg.length - 1];
      return `${c.name} ("${c.terms.join('", "')}"): ${first ? `${fmt(first[1], 1)} per billion words in ${first[0]}, ${fmt(last[1], 1)} by ${last[0]}, peak ${fmt(peak[1], 1)} in ${peak[0]}` : "no data in range"}. Name first attested ${c.first_attestation}; 10% takeoff ${c.takeoff_10pct}.`;
    }
    const set = D.filterWorks(f);
    const g = D.genres.genres.find(x => x.name === f.genre);
    if (g) return `${g.name}: ${g.size} novels, ${g.year_min}–${g.year_max}, first forms ${g.birth_year}; distinctive words: ${g.top_terms.slice(0, 6).join(", ")}. ${set.length} match the current filters.`;
    return `${set.length} novels match. Mutation events: ${D.genres.null_model.real_total} observed vs ${D.genres.null_model.shuffled_mean} expected with dates shuffled (z ${D.genres.null_model.z}).`;
  }

  window.QA = { localAsk, readout, PAGES };
})();
