/* Classic Literature — a report workspace over four bodies of research.
 * Every number is read from data/*.json (built by scripts/build_data.py). */
(async function () {
  const $ = s => document.querySelector(s);
  const el = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; };
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const css = v => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
  const fmt = (x, n = 3) => (x == null ? "–" : (+x).toFixed(n));
  const pct = x => Math.round(x * 100) + "%";
  const median = a => { const s = [...a].sort((x, y) => x - y); return s.length ? (s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2) : null; };

  // Chrome first, before the data lands, so nothing shifts when it does.
  const dataP = Promise.all(["genres", "sentiment", "influence", "prose", "graphs"].map(n => fetch(`data/${n}.json`).then(r => r.json())));
  let READY = false;
  const PAGES = [
    { id: "sentiment", name: "Sentiment momentum", short: "Sentiment", sub: "Feeling across a novel" },
    { id: "genres", name: "Genre mutations", short: "Genres", sub: "Genres from prose alone" },
    { id: "influence", name: "Influence network", short: "Influence", sub: "Who shaped whom" },
    { id: "prose", name: "Prose similarity", short: "Prose", sub: "Who writes like whom" },
    { id: "atlas", name: "Atlas", short: "Atlas", sub: "Everything, one graph" },
  ];
  const ICON = { sentiment: "M3 17l5-6 4 3 6-8 3 4", genres: "M5 4v16M12 4v16M19 4v16M5 9h7M12 15h7", influence: "M6 6a2 2 0 1 0 0 .1M18 6a2 2 0 1 0 0 .1M12 18a2 2 0 1 0 0 .1M7.5 7.5l3.5 9M16.5 7.5l-3.5 9M8 6h8", prose: "M4 7h10M4 12h16M4 17h7", atlas: "M12 3l8 4.5v9L12 21l-8-4.5v-9z M12 3v18 M4 7.5l16 9 M20 7.5l-16 9" };
  const rail = $("#rail");
  PAGES.forEach(p => { const b = el("button", "", `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${ICON[p.id]}"/></svg><b>${p.name}</b><i>${p.short}</i><small>${p.sub}</small>`); b.dataset.p = p.id; b.onclick = () => READY && go(p.id); rail.append(b); });
  const initialPage = (() => { try { return new URLSearchParams(location.hash.slice(1)).get("p") || "sentiment"; } catch (e) { return "sentiment"; } })();
  function setTitle(id) { const p = PAGES.find(x => x.id === id) || PAGES[0]; $("#ptitle").innerHTML = `<h1>${p.name}</h1><span>${p.sub}</span>`; rail.querySelectorAll("button").forEach(b => b.classList.toggle("on", b.dataset.p === id)); }
  setTitle(initialPage);
  // Chips: one scrollable row on a phone; on desktop the first four, then "More". The order rotates
  // daily so a returning visitor sees different questions first.
  const chips = $("#chips");
  const rot = Math.floor(Date.now() / 864e5) % CHIPS.length;
  const order = [...CHIPS.slice(rot), ...CHIPS.slice(0, rot)];
  order.forEach((c, k) => { const b = el("button", k >= 4 ? "extra" : "", esc(c.q)); b.onclick = () => { $("#askq").value = c.q; if (READY) ask(c.q); }; chips.append(b); });
  const more = el("button", "more", `More questions (${order.length - 4})`); more.onclick = () => { chips.classList.toggle("open"); more.textContent = chips.classList.contains("open") ? "Fewer" : `More questions (${order.length - 4})`; }; chips.append(more);

  const [G, SEN, INF, PR, GR] = await dataP;
  const works = G.works;
  SEN.arcs.forEach(a => (a.momentum = a.smooth.map((v, i) => (i ? +((v - a.smooth[i - 1]) * 100).toFixed(3) : 0))));
  let RAW = null, rawLoading = false;
  const needRaw = () => { if (RAW || rawLoading) return; rawLoading = true; fetch("data/sentiment_raw.json").then(r => r.json()).then(j => { RAW = j; SEN.arcs.forEach(a => (a.raw = RAW[a.work])); if (READY) refresh(); }); };
  const arcBy = new Map(SEN.arcs.map(a => [a.work, a]));
  works.forEach(w => (w.arc = arcBy.get(w.id) || null));
  const genreName = i => (i == null ? "Unassigned" : G.genres[i].name);
  const authorsAll = [...new Set([...works.map(w => w.author), ...INF.authors.map(a => a.name), "Cormac McCarthy", "William Shakespeare", "Herman Melville"])].sort((a, b) => a.split(" ").pop().localeCompare(b.split(" ").pop()));
  const DECADES = []; for (let d = 1670; d <= 1920; d += 10) DECADES.push(d);
  const CLOCK_TO_GENRE = { detective: "Detective fiction", historical: "Historical romance", nautical: "Nautical adventure", early_novel: "Early English novel" };
  const FORMS = ["prose_fiction", "poetry", "drama", "philosophy", "other"];
  const FORM_LABEL = { prose_fiction: "Prose fiction", poetry: "Poetry", drama: "Drama", philosophy: "Philosophy", other: "Other" };
  const PERSONA = { mccarthy: "Cormac McCarthy", melville: "Herman Melville", shakespeare: "William Shakespeare" };

  // ------------------------------------------------------------------ state
  const S = { page: "sentiment", f: { author: "", work: "", genre: "", from: "", to: "" }, shape: "", metric: "stylistic", hl: [], focus: null, lit: null, path: null, infColor: "form", top: 5, atlasWorks: false };
  try { const p = new URLSearchParams(location.hash.slice(1)); if (p.get("p")) S.page = p.get("p"); for (const k of Object.keys(S.f)) if (p.get(k)) S.f[k] = p.get(k); } catch (e) {}

  function inRange(y) { return (!S.f.from || y >= +S.f.from) && (!S.f.to || y <= +S.f.to + 9); }
  function filterWorks(f = S.f, opts = {}) {
    return works.filter(w => (!f.author || w.author === f.author) && (!f.genre || genreName(w.genre) === f.genre) &&
      (!f.from || w.year >= +f.from) && (!f.to || w.year <= +f.to + 9) && (opts.ignoreWork || !f.work || w.title === f.work) &&
      (opts.noCohort || !S.cohort || cohortSet().has(w.author)));
  }
  let _cs = null, _ck = "";
  function cohortSet() { const k = JSON.stringify(S.cohort); if (k !== _ck) { _ck = k; _cs = cohortAuthors(S.cohort); } return _cs; }
  // A cohort is a cross-page filter: the writers who influenced X, or the writers X influenced.
  function cohortAuthors(c) { return new Set(INF.documented.filter(d => (c.rel === "heirs" ? d.from === c.author : d.to === c.author)).map(d => (c.rel === "heirs" ? d.to : d.from))); }
  const D = { works, authorsAll, genres: G, influence: INF, prose: PR, graphs: GR, sentiment: SEN, filterWorks: f => filterWorks({ ...f, work: "" }, { noCohort: true }), cohortWorks: c => { const s = cohortAuthors(c); return works.filter(w => s.has(w.author)); } };

  // ------------------------------------------------------------------ chrome

  function fillSelect(sel, opts, val, all) {
    sel.innerHTML = `<option value="">${all}</option>` + opts.map(o => `<option value="${esc(o[0])}">${esc(o[1])}</option>`).join("");
    sel.value = val || ""; sel.classList.toggle("active", !!val);
  }
  function syncSlicers() {
    fillSelect($("#f-author"), authorsAll.map(a => [a, a]), S.f.author, "All authors");
    const ws = filterWorks({ ...S.f, work: "" }).filter(w => w.arc || S.page !== "sentiment");
    const seen = new Set();
    fillSelect($("#f-work"), ws.filter(w => !seen.has(w.title) && seen.add(w.title)).sort((a, b) => a.title.localeCompare(b.title)).map(w => [w.title, `${w.title} (${w.year})`]), S.f.work, "All works");
    fillSelect($("#f-genre"), G.genres.map(g => [g.name, g.name]), S.f.genre, "All genres");
    fillSelect($("#f-from"), DECADES.map(d => [d, d + "s"]), S.f.from, "Any");
    fillSelect($("#f-to"), DECADES.map(d => [d, d + "s"]), S.f.to, "Any");
    const c = $("#crumbs"); c.innerHTML = "";
    for (const [k, v] of Object.entries(S.f)) if (v) { const s = el("span", "", `${k === "from" || k === "to" ? k : k}: <b>${esc(k === "from" || k === "to" ? v + "s" : v)}</b>`); const x = el("button", "", "✕"); x.setAttribute("aria-label", "Remove filter"); x.onclick = () => { S.f[k] = ""; refresh(); }; s.append(x); c.append(s); }
    if (S.cohort) { const s = el("span", "", `cohort: <b>${S.cohort.rel === "heirs" ? "writers " + esc(S.cohort.author) + " influenced" : "writers who influenced " + esc(S.cohort.author)}</b>`); const x = el("button", "", "✕"); x.onclick = () => { S.cohort = null; refresh(); }; s.append(x); c.append(s); }
    if (S.path) { const s = el("span", "", `chain: <b>${esc(S.path[0])} → ${esc(S.path[1] || "…")}</b>`); const x = el("button", "", "✕"); x.onclick = () => { S.path = null; refresh(); }; s.append(x); c.append(s); }
    if (S.shape) { const s = el("span", "", `shape: <b>${S.shape}</b>`); const x = el("button", "", "✕"); x.onclick = () => { S.shape = ""; refresh(); }; s.append(x); c.append(s); }
    const nF = Object.values(S.f).filter(Boolean).length + (S.cohort ? 1 : 0) + (S.path ? 1 : 0) + (S.shape ? 1 : 0);
    $("#mfilters").textContent = nF ? `Filters (${nF})` : "Filters";
    try { const p = new URLSearchParams({ p: S.page, ...Object.fromEntries(Object.entries(S.f).filter(([, v]) => v)) }); history.replaceState(null, "", "#" + p); } catch (e) {}
  }
  for (const k of ["author", "work", "genre", "from", "to"]) $("#f-" + k).onchange = e => { S.f[k] = e.target.value; if (k === "author" || k === "genre") { if (S.f.work && !filterWorks({ ...S.f, work: "" }).some(w => w.title === S.f.work)) S.f.work = ""; } S.hl = []; refresh(); };
  // Phone: the slicers live in a bottom sheet behind one "Filters (n)" button.
  $("#mfilters").onclick = () => { $("#slicers").classList.add("open"); $("#scrim-f").hidden = false; };
  const closeFilters = () => { $("#slicers").classList.remove("open"); $("#scrim-f").hidden = true; };
  $("#sdone").onclick = closeFilters; $("#scrim-f").onclick = closeFilters;
  $("#mstory").onclick = () => $("#story").click();
  $("#clear").onclick = () => { S.f = { author: "", work: "", genre: "", from: "", to: "" }; S.shape = ""; S.hl = []; S.path = null; S.cohort = null; refresh(); };
  $("#theme").onclick = () => {
    const dark = document.documentElement.dataset.theme ? document.documentElement.dataset.theme === "dark" : matchMedia("(prefers-color-scheme: dark)").matches;
    document.documentElement.dataset.theme = dark ? "light" : "dark";
    try { localStorage.setItem("theme", document.documentElement.dataset.theme); } catch (e) {}
    render(true);
  };
  try { const t = localStorage.getItem("theme"); if (t) document.documentElement.dataset.theme = t; } catch (e) {}

  // ------------------------------------------------------------------ tiles + charts
  const charts = new Map();
  let lastPage = null;
  function base() {
    return {
      animationDuration: 600, animationDurationUpdate: 700, animationEasingUpdate: "cubicInOut",
      textStyle: { fontFamily: "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif", color: css("--ink-2") },
      grid: { left: 44, right: 14, top: 18, bottom: 34, containLabel: false },
      tooltip: { backgroundColor: css("--surface"), borderColor: css("--border"), textStyle: { color: css("--ink"), fontSize: 12 }, extraCssText: "box-shadow:0 4px 16px rgba(0,0,0,.15);border-radius:6px" },
    };
  }
  const axis = (o = {}) => ({ axisLine: { lineStyle: { color: css("--axis") } }, axisTick: { show: false }, axisLabel: { color: css("--muted"), fontSize: 11 }, splitLine: { lineStyle: { color: css("--grid") } }, nameTextStyle: { color: css("--muted"), fontSize: 11 }, ...o });
  // On a touch screen a one-finger drag must still scroll the page, so graphs pinch-zoom only.
  const ROAM = matchMedia("(pointer: coarse)").matches ? "scale" : true;
  const SER = () => [1, 2, 3, 4, 5, 6, 7, 8].map(i => css("--s" + i));

  function tile(id, title, sub, cls, kind = "chart") {
    let t = document.getElementById("t-" + id);
    if (!t) {
      t = el("div", "tile " + cls); t.id = "t-" + id;
      const h = el("header", "", `<h3></h3>`); const tools = el("div", "tools");
      const fb = el("button", "", '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14 4h6v6M10 20H4v-6M20 4l-7 7M4 20l7-7"/></svg>'); fb.title = "Focus mode"; fb.setAttribute("aria-label", "Focus mode"); fb.onclick = () => focus(id);
      const rb = el("button", "reset", '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 12a8 8 0 1 0 2.3-5.6M4 4v4h4"/></svg>'); rb.title = "Reset view"; rb.setAttribute("aria-label", "Reset view"); rb.onclick = () => resetView(id);
      tools.append(rb, fb); h.append(tools); t.append(h);
      t.append(el("div", "sub", sub || ""));
      t.append(el("div", kind === "chart" ? "chart" : "body"));
      $("#grid").append(t);
    }
    t.querySelector("h3").textContent = title;
    t.querySelector(".sub").textContent = PHONE() ? (sub || "").replace(/(Pinch or scroll to zoom|[Pp]inch to zoom)\.?/, "Open full screen to pinch and pan.") : sub || "";
    t.classList.toggle("lit", S.lit === id);
    return t.querySelector(kind === "chart" ? ".chart" : ".body");
  }
  // Charts render lazily: a tile's latest option waits until echarts has loaded and the tile is
  // within 300px of the viewport. A slicer change only re-renders tiles already drawn.
  const PHONE = () => matchMedia("(max-width: 760px)").matches;
  const pending = new Map(), visible = new Set();
  // echarts (330 KB) is requested only once the data has landed, so on a slow phone link the
  // numbers and titles paint first and the charts follow.
  const echartsReady = new Promise(res => { const t = document.createElement("script"); t.src = "https://cdnjs.cloudflare.com/ajax/libs/echarts/5.5.0/echarts.min.js"; t.onload = res; document.head.append(t); });
  let EC = false; echartsReady.then(() => { EC = true; pending.forEach((_, id) => flush(id)); });
  const io = new IntersectionObserver(es => es.forEach(e => { if (e.isIntersecting) { visible.add(e.target.dataset.id); flush(e.target.dataset.id); } }), { rootMargin: "300px 0px" });
  function chart(id, title, sub, cls, opt, onClick) {
    const node = tile(id, title, sub, cls);
    if (!node.dataset.id) { node.dataset.id = id; io.observe(node); }
    pending.set(id, { opt, onClick });
    flush(id);
  }
  // A tile that changes height (story mode, focus, rotation) redraws its chart to fit.
  const ro = new ResizeObserver(es => es.forEach(e => { const c = charts.get(e.target.dataset.id); if (c && !c.isDisposed()) { c.resize(); if (PHONE() && isGraph(c.getOption())) fitGraph(c); } }));
  const isGraph = o => o.series && o.series.some(se => se.type === "graph");
  function flush(id) {
    const job = pending.get(id); if (!job || !EC || !visible.has(id)) return;
    const node = document.querySelector(`#t-${id} .chart`); if (!node) { pending.delete(id); return; }
    pending.delete(id);
    let c = charts.get(id);
    if (!c || c.getDom() !== node) { c = echarts.init(node, null, { renderer: "canvas" }); charts.set(id, c); ro.observe(node); }
    const { __replace, ...o } = job.opt;
    const graph = isGraph(o), phone = PHONE(), focused = S.focus === id;
    node.closest(".tile").classList.toggle("is-graph", graph);
    if (graph) {
      o.series.forEach(se => {
        if (se.type !== "graph") return;
        // A force layout tuned for a 900px tile flies off a phone: scale its springs to the tile.
        if (se.force && node.clientWidth < 600) { const k = Math.max(0.45, node.clientWidth / 900);
          se.force = { ...se.force, repulsion: Math.round(se.force.repulsion * k), edgeLength: Array.isArray(se.force.edgeLength) ? se.force.edgeLength.map(v => Math.round(v * k)) : Math.round(se.force.edgeLength * k), gravity: (se.force.gravity || 0.1) * 1.4 }; }
        if (phone) {
          // Phone: the page scrolls past a graph; pinch and pan only inside focus mode. Labels
          // only on the biggest nodes and anything already emphasised, until the graph is focused.
          se.roam = focused ? true : false; se.draggable = focused && se.draggable;
          if (!focused && se.data) {
            const sizes = se.data.map(d => (Array.isArray(d.symbolSize) ? 999 : d.symbolSize || 0)).sort((a, b) => b - a);
            const cut = sizes[Math.min(sizes.length - 1, 7)] || 0;
            se.data.forEach(d => { if (d.label && d.label.show && !Array.isArray(d.symbolSize) && (d.symbolSize || 0) < cut && !((d.itemStyle || {}).borderWidth > 2)) d.label = { ...d.label, show: false }; });
          }
          // Small graphs lay out in one synchronous pass so the fit is exact; big ones animate,
          // which splits the simulation across frames instead of one long blocking task.
          if (se.force) se.force = { ...se.force, layoutAnimation: (se.data || []).length > 150 };
        }
      });
      if (phone) o.tooltip = { ...(o.tooltip || {}), show: false, __fmt: (o.tooltip || {}).formatter };
    }
    const fmtFn = o.tooltip && o.tooltip.__fmt; if (o.tooltip) delete o.tooltip.__fmt;
    c.setOption({ ...base(), ...o }, { notMerge: !!__replace, lazyUpdate: false, replaceMerge: ["series", "xAxis", "yAxis", "visualMap"] });
    c.off("click"); c.getZr().off("click");
    if (graph && phone) {
      fitGraph(c);
      if ((o.series[0].data || []).length > 150) [700, 1800, 3500].forEach(t => setTimeout(() => { if (!c.isDisposed()) fitGraph(c); }, t));
      // A tap picks the nearest node within 26px (a 52px target) and opens its card.
      c.getZr().on("click", ev => {
        const se = c.getModel().getSeriesByIndex(0); if (!se) return; const data = se.getData();
        let best = -1, bd = 26;
        for (let i = 0; i < data.count(); i++) { const l = data.getItemLayout(i); if (!l) continue; const pt = c.convertToPixel({ seriesIndex: 0 }, l); const d = Math.hypot(pt[0] - ev.offsetX, pt[1] - ev.offsetY); if (d < bd) { bd = d; best = i; } }
        if (best < 0) return;
        const raw = o.series[0].data[best];
        const params = { dataType: "node", data: raw, name: raw.name, dataIndex: best };
        sheet(fmtFn ? fmtFn(params) : esc(raw.name), job.onClick ? () => job.onClick(params) : null);
      });
    } else if (job.onClick) c.on("click", job.onClick);
  }
  // Fit the whole laid-out graph inside its tile: pan its centre to the tile's, then zoom.
  function fitGraph(c) {
    const se = c.getModel().getSeriesByIndex(0); if (!se) return; const data = se.getData();
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (let i = 0; i < data.count(); i++) { const l = data.getItemLayout(i); if (!l) continue; const p = c.convertToPixel({ seriesIndex: 0 }, l); x0 = Math.min(x0, p[0]); x1 = Math.max(x1, p[0]); y0 = Math.min(y0, p[1]); y1 = Math.max(y1, p[1]); }
    if (!isFinite(x0)) return;
    const W = c.getWidth(), H = c.getHeight(), top = 34;
    const z = Math.min(1.6, (W - 36) / Math.max(1, x1 - x0), (H - top - 24) / Math.max(1, y1 - y0));
    c.dispatchAction({ type: "graphRoam", seriesIndex: 0, dx: W / 2 - (x0 + x1) / 2, dy: (H + top) / 2 - (y0 + y1) / 2 });
    c.dispatchAction({ type: "graphRoam", seriesIndex: 0, zoom: z, originX: W / 2, originY: (H + top) / 2 });
  }
  function resetView(id) { const c = charts.get(id); if (!c) return; const s = c.getOption().series[0]; c.setOption({ series: [{ zoom: 1, center: null }] }); fitGraph(c); }
  // Bottom sheet: graph node cards on a phone, and the filter panel.
  function sheet(html, action) {
    let sh = $("#sheet");
    if (!sh) { sh = el("div", "sheet"); sh.id = "sheet"; sh.setAttribute("role", "dialog"); document.body.append(sh); }
    sh.innerHTML = `<div class="sheet-body">${html}</div><div class="sheet-act">${action ? '<button class="primary" id="sheet-go">Focus on this</button>' : ""}<button class="ghost" id="sheet-x">Close</button></div>`;
    sh.classList.add("open");
    $("#sheet-x").onclick = () => sh.classList.remove("open");
    if (action) $("#sheet-go").onclick = () => { sh.classList.remove("open"); action(); };
  }
  function focus(id) {
    const t = document.getElementById("t-" + id);
    const redraw = i => { const c = charts.get(i); if (!c) return; c.resize(); if (PHONE() && isGraph(c.getOption())) { refresh(); } };
    if (S.focus) { document.querySelector(".scrim")?.remove(); document.querySelector(".tile.focus")?.classList.remove("focus"); const was = S.focus; S.focus = null; setTimeout(() => redraw(was), 20); if (was === id) return; }
    S.focus = id; t.classList.add("focus");
    const sc = el("div", "scrim"); sc.onclick = () => focus(id); document.body.append(sc);
    setTimeout(() => redraw(id), 20);
  }
  document.addEventListener("keydown", e => { if (e.key === "Escape" && S.focus) focus(S.focus); });
  window.addEventListener("resize", () => charts.forEach(c => c.resize()));

  // A tile's control strip (toggles, sliders) sits between its subtitle and its plot.
  function controls(id, html, bind) {
    const t = document.getElementById("t-" + id); let c = t.querySelector(".ctl");
    if (!c) { c = el("div", "ctl"); t.querySelector(".sub").after(c); }
    c.innerHTML = html; if (bind) bind(c);
  }
  // A community is named after its best-connected member, so the legend reads "Nietzsche's circle".
  function communityNames(lab, names, deg) {
    const best = {};
    lab.forEach((k, i) => { const d = (deg && deg[names[i]]) || 0; if (!best[k] || d > best[k][1]) best[k] = [names[i], d]; });
    return Object.keys(best).sort((a, b) => a - b).map(k => `${best[k][0].split(" ").pop()}'s circle`);
  }
  // Fewest documented links between two authors, either direction (BFS).
  function findPath(a, b, docs) {
    const nb = new Map();
    docs.forEach(d => { for (const [x, y] of [[d.from, d.to], [d.to, d.from]]) { if (!nb.has(x)) nb.set(x, []); nb.get(x).push([y, d]); } });
    const prev = new Map([[a, null]]); const q = [a];
    while (q.length) { const x = q.shift(); if (x === b) break; for (const [y, d] of nb.get(x) || []) if (!prev.has(y)) { prev.set(y, [x, d]); q.push(y); } }
    if (!prev.has(b) || a === b) return null;
    const nodes = [b], edges = []; let cur = b;
    while (prev.get(cur)) { const [x, d] = prev.get(cur); edges.unshift(d); nodes.unshift(x); cur = x; }
    return { nodes, edges };
  }
  D.findPath = (a, b) => findPath(a, b, INF.documented);

  function kpis(items) {
    let k = $("#kpis"); if (!k) { k = el("div", "kpis"); k.id = "kpis"; $("#page").prepend(k); }
    k.innerHTML = items.map(i => `<div class="kpi"><div class="v">${i.v}</div><div class="l">${i.l}</div>${i.s ? `<div class="s">${i.s}</div>` : ""}</div>`).join("");
  }

  // ------------------------------------------------------------------ page: sentiment
  function pageSentiment() {
    const scored = works.filter(w => w.arc);
    const setAll = filterWorks(S.f, { ignoreWork: true }).filter(w => w.arc);
    const set = S.shape ? setAll.filter(w => w.arc.shape === S.shape) : setAll;
    const sel = S.f.work ? scored.find(w => w.title === S.f.work) : null;
    const lower = set.filter(w => w.arc.end < w.arc.start).length;
    const shapes = ["Rise", "Fall", "Rise–fall", "Fall–rise"];
    const cnt = Object.fromEntries(shapes.map(s => [s, setAll.filter(w => w.arc.shape === s).length]));
    const topShape = shapes.slice().sort((a, b) => cnt[b] - cnt[a])[0];
    kpis([
      { v: `${set.length}<span style="font-size:14px;color:var(--muted)"> / ${scored.length}</span>`, l: "Novels scored in view", s: `Full Gutenberg text, ${SEN.parts} parts each` },
      { v: set.length ? pct(lower / set.length) : "–", l: "End lower than they begin", s: "Mean of last 10% vs first 10%" },
      { v: set.length ? fmt(median(set.map(w => w.arc.range))) : "–", l: "Median emotional range", s: "Polarity, smoothed arc max − min" },
      { v: set.length ? topShape : "–", l: "Commonest shape", s: set.length ? `${cnt[topShape]} of ${setAll.length}` : "" },
    ]);
    const x = Array.from({ length: SEN.parts }, (_, i) => i);
    const mean = x.map(i => set.length ? set.reduce((s, w) => s + w.arc.smooth[i], 0) / set.length : null);
    const q = (p) => x.map(i => { const v = set.map(w => w.arc.smooth[i]).sort((a, b) => a - b); return v.length ? v[Math.floor(p * (v.length - 1))] : null; });
    const lo = q(0.25), hi = q(0.75);
    const C = SER();
    const series = [
      { name: "p25", type: "line", data: lo, stack: "band", lineStyle: { opacity: 0 }, symbol: "none", silent: true, tooltip: { show: false } },
      { name: "Middle 50%", type: "line", data: hi.map((h, i) => h - lo[i]), stack: "band", lineStyle: { opacity: 0 }, symbol: "none", areaStyle: { color: C[0], opacity: 0.12 }, silent: true, tooltip: { show: false } },
      { name: `Mean of ${set.length}`, type: "line", data: mean, symbol: "none", lineStyle: { width: 2, color: C[0] }, itemStyle: { color: C[0] } },
    ];
    if (sel && !sel.arc.raw) needRaw();
    if (sel) {
      if (sel.arc.raw) series.push({ name: `${sel.title} (raw)`, type: "line", data: sel.arc.raw, symbol: "none", lineStyle: { width: 1, color: css("--muted"), opacity: 0.7 }, itemStyle: { color: css("--muted") } });
      series.push({ name: sel.title, type: "line", data: sel.arc.smooth, symbol: "none", lineStyle: { width: 2.5, color: C[1] }, itemStyle: { color: C[1] },
        markPoint: { symbol: "circle", symbolSize: 10, itemStyle: { color: C[1], borderColor: css("--surface"), borderWidth: 2 }, label: { show: true, position: "top", color: css("--ink"), fontSize: 11, formatter: `sharpest turn ${sel.arc.turn}%` }, data: [{ coord: [sel.arc.turn, sel.arc.smooth[sel.arc.turn]] }] } });
    }
    chart("s-arc", "Sentiment arc across the book", "Polarity (−1 to +1) at each 1% of the text, 9-part rolling mean. Pick a work to overlay it and its unsmoothed score.", "w8 h2", {
      tooltip: { ...base().tooltip, trigger: "axis", valueFormatter: v => fmt(v) },
      legend: { top: 0, right: 8, textStyle: { color: css("--ink-2"), fontSize: 11 }, data: series.filter(s => !["p25"].includes(s.name)).map(s => s.name), itemWidth: 14, itemHeight: 3 },
      grid: { left: 48, right: 16, top: 30, bottom: 36 },
      xAxis: axis({ type: "category", data: x, name: "% of the book", nameLocation: "middle", nameGap: 24, axisLabel: { color: css("--muted"), interval: 9 }, boundaryGap: false, splitLine: { show: false } }),
      yAxis: axis({ type: "value", scale: true, axisLabel: { color: css("--muted"), formatter: v => v.toFixed(2) } }),
      series,
    });
    chart("s-shape", "Arc shapes", "Thirds of the smoothed arc. Click a bar to filter.", "w4 h2", {
      tooltip: { ...base().tooltip, trigger: "item", formatter: p => `${p.name}: ${p.value} novels` },
      grid: { left: 80, right: 30, top: 8, bottom: 26 },
      xAxis: axis({ type: "value", minInterval: 1 }), yAxis: axis({ type: "category", data: shapes, inverse: true, axisLabel: { color: css("--ink-2") } }),
      series: [{ type: "bar", barWidth: "55%", data: shapes.map(s => ({ value: cnt[s], itemStyle: { color: !S.shape || S.shape === s ? C[0] : css("--grid"), borderRadius: [0, 4, 4, 0] } })), label: { show: true, position: "right", color: css("--ink-2"), fontSize: 11 } }],
    }, p => { S.shape = S.shape === p.name ? "" : p.name; refresh(); });
    const mom = sel ? sel.arc.momentum : x.map(i => set.length ? set.reduce((s, w) => s + w.arc.momentum[i], 0) / set.length : 0);
    chart("s-mom", "Momentum", (sel ? sel.title : `Mean of ${set.length} novels`) + ": change in smoothed polarity per 1% of the book (×100). Blue lifts, red sinks.", "w6", {
      tooltip: { ...base().tooltip, trigger: "axis", valueFormatter: v => fmt(v) },
      xAxis: axis({ type: "category", data: x, axisLabel: { color: css("--muted"), interval: 9 }, splitLine: { show: false } }),
      yAxis: axis({ type: "value", axisLabel: { color: css("--muted"), formatter: v => v.toFixed(1) } }),
      series: [{ type: "bar", name: "Momentum", barCategoryGap: "15%", data: mom.map(v => ({ value: v, itemStyle: { color: v >= 0 ? css("--div-pos") : css("--div-neg"), borderRadius: v >= 0 ? [2, 2, 0, 0] : [0, 0, 2, 2] } })) }],
    });
    const inSet = new Set(set.map(w => w.id));
    const pts = scored.map(w => ({ value: [w.arc.start, w.arc.end], id: w.id, name: w.title, a: w.author, y: w.year, g: genreName(w.genre) }));
    chart("s-scatter", "Where each novel starts vs ends", "First 10% vs last 10% of the smoothed arc. Below the line ends darker. Click a point to pick the work.", "w6", {
      tooltip: { ...base().tooltip, trigger: "item", formatter: p => p.data.name ? `<b>${esc(p.data.name)}</b><br>${esc(p.data.a)}, ${p.data.y}<br>${esc(p.data.g)}<br>start ${fmt(p.data.value[0])} → end ${fmt(p.data.value[1])}` : "" },
      grid: { left: 48, right: 16, top: 14, bottom: 38 },
      xAxis: axis({ type: "value", name: "start", nameLocation: "middle", nameGap: 24, min: -0.05, max: 0.25, axisLabel: { color: css("--muted"), formatter: v => v.toFixed(2) } }),
      yAxis: axis({ type: "value", name: "end", min: -0.05, max: 0.3, axisLabel: { color: css("--muted"), formatter: v => v.toFixed(2) } }),
      series: [
        { type: "scatter", name: "Other novels", symbolSize: 7, data: pts.filter(p => !inSet.has(p.id)), itemStyle: { color: css("--grid"), borderColor: css("--surface"), borderWidth: 1 } },
        { type: "scatter", name: "In view", symbolSize: 8, data: pts.filter(p => inSet.has(p.id)), itemStyle: { color: C[0], borderColor: css("--surface"), borderWidth: 1.5, opacity: 0.85 },
        },
        { type: "line", name: "start = end", data: [[-0.1, -0.1], [0.4, 0.4]], symbol: "none", silent: true, lineStyle: { color: css("--axis"), type: "dashed", width: 1 }, tooltip: { show: false }, z: 1 },
        { type: "scatter", name: "Selected", symbolSize: 14, data: sel ? pts.filter(p => p.id === sel.id) : [], itemStyle: { color: C[1], borderColor: css("--surface"), borderWidth: 2 }, label: { show: true, position: "right", formatter: p => p.data.name, color: css("--ink"), fontSize: 11 } },
      ],
    }, p => { if (p.data && p.data.name) { S.f.work = S.f.work === p.data.name ? "" : p.data.name; refresh(); } });
    // Arc-shape families: each novel linked to the 5 whose smoothed arcs correlate best with it.
    const AG = GR.arc; const SH = ["Rise", "Fall", "Rise–fall", "Fall–rise"];
    const inSetG = new Set(set.map(w => w.id));
    const anyFilter = S.f.author || S.f.genre || S.f.from || S.f.to || S.shape;
    const gNodes = SEN.arcs.map((a, i) => { const w = works[a.work]; const on = inSetG.has(w.id); const me = sel && sel.id === w.id;
      return { id: String(i), name: w.title, value: a.shape, category: SH.indexOf(a.shape), symbolSize: me ? 16 : on && anyFilter ? 9 : 6,
        a: w.author, y: w.year, g: genreName(w.genre), wid: w.id,
        itemStyle: { opacity: !anyFilter && !sel ? 0.9 : on || me ? 1 : 0.1, borderColor: me ? css("--ink") : css("--surface"), borderWidth: me ? 2.5 : 0.8 },
        label: { show: !!me, color: css("--ink"), fontSize: 11 } }; });
    const nbr = sel ? new Set(AG.edges.filter(e => works[SEN.arcs[e[0]].work].id === sel.id || works[SEN.arcs[e[1]].work].id === sel.id).flatMap(e => [e[0], e[1]])) : null;
    if (nbr) nbr.forEach(i => { gNodes[i].itemStyle.opacity = 1; gNodes[i].label.show = true; });
    const gLinks = AG.edges.map(([a, b, r]) => ({ source: String(a), target: String(b), value: r, lineStyle: { width: nbr && nbr.has(a) && nbr.has(b) ? 1.8 : 0.6, opacity: nbr ? (nbr.has(a) && nbr.has(b) ? 0.8 : 0.03) : anyFilter ? (inSetG.has(works[SEN.arcs[a].work].id) && inSetG.has(works[SEN.arcs[b].work].id) ? 0.4 : 0.03) : 0.18, color: css("--muted") } }));
    chart("s-graph", "Families of arc shapes", `Each novel joined to the ${AG.k} novels whose arcs move most like it (correlation, median r ${fmt(AG.median_r, 2)}). ${pct(AG.same_shape_neighbours)} of those neighbours share its shape, against ${pct(AG.same_shape_chance)} by chance. Tap a novel to pick it; pinch to zoom.`, "w12 h2", {
      __replace: true,
      tooltip: { ...base().tooltip, trigger: "item", formatter: p => p.dataType === "edge" ? `arc correlation r ${fmt(p.data.value, 2)}` : `<b>${esc(p.data.name)}</b><br>${esc(p.data.a)}, ${p.data.y}<br>${esc(p.data.g)}<br>shape: ${p.data.value}` },
      legend: { top: 0, left: 8, data: SH, textStyle: { color: css("--ink-2"), fontSize: 11 }, itemWidth: 10, itemHeight: 10 },
      series: [{ type: "graph", layout: "force", roam: ROAM, draggable: false, top: 30, bottom: 6, data: gNodes, links: gLinks, categories: SH.map((n, i) => ({ name: n, itemStyle: { color: C[i] } })),
        force: { repulsion: 48, edgeLength: 22, gravity: 0.05, friction: 0.3, layoutAnimation: true }, emphasis: { focus: "adjacency" }, labelLayout: { hideOverlap: true } }],
    }, p => { if (p.dataType === "node") { S.f.work = S.f.work === p.data.name ? "" : p.data.name; refresh(); } });
    const body = tile("s-table", "Novels in view", "Click a row to pick the work. Sorted by how far the ending falls from the start.", "w12", "body");
    const rows = set.slice().sort((a, b) => (a.arc.end - a.arc.start) - (b.arc.end - b.arc.start)).slice(0, 150);
    body.innerHTML = `<table class="t"><thead><tr><th>Title</th><th>Author</th><th class="num">Year</th><th>Genre</th><th>Shape</th><th class="num">Start</th><th class="num">End</th><th class="num">Δ</th></tr></thead><tbody>` +
      rows.map(w => `<tr data-t="${esc(w.title)}" class="${sel && sel.id === w.id ? "sel" : ""}"><td>${esc(w.title)}</td><td>${esc(w.author)}</td><td class="num">${w.year}</td><td>${esc(genreName(w.genre))}</td><td>${w.arc.shape}</td><td class="num">${fmt(w.arc.start)}</td><td class="num">${fmt(w.arc.end)}</td><td class="num">${fmt(w.arc.end - w.arc.start)}</td></tr>`).join("") + `</tbody></table>`;
    body.querySelectorAll("tr[data-t]").forEach(tr => (tr.onclick = () => { S.f.work = S.f.work === tr.dataset.t ? "" : tr.dataset.t; refresh(); }));
    $("#foot").innerHTML = `Sentiment is computed for this site: TextBlob polarity over each 1% of the full Project Gutenberg text, ${SEN.window}-part rolling mean, the windowed fix the 2020 Prose Similarities code proposed for the 2019 per-paragraph null result. ${scored.length} of ${works.length} novels scored. Years are the corpus's reconstructed dates, reported as the source has them.`;
  }

  // ------------------------------------------------------------------ page: genres
  function pageGenres() {
    const set = filterWorks(S.f, { ignoreWork: true });
    const C = SER();
    const nm = G.null_model;
    const det = G.controls.emergent[0];
    kpis([
      { v: G.n_books, l: "Novels in the genre corpus", s: `${set.length} match the current filters` },
      { v: G.genres.length, l: "Genres recovered from prose alone", s: "Confirmed by held-out labels" },
      { v: `${nm.real_total} <span style="font-size:14px;color:var(--muted)">vs ${nm.shuffled_mean}</span>`, l: "Mutations vs shuffled-date null", s: `z ${nm.z}: no real mutation rate` },
      { v: det ? `z ${det.concentration_z}` : "–", l: "Detective fiction clusters in time", s: det ? `${det.n} books, ${det.year_min}–${det.year_max}` : "" },
    ]);
    const gsel = S.f.genre;
    chart("g-bands", "When each genre lives", "Span of its novels; the dot marks when the cluster first forms. Click a genre to filter.", "w7 h2", {
      tooltip: { ...base().tooltip, trigger: "item", formatter: p => { const g = G.genres[p.dataIndex]; return `<b>${g.name}</b><br>${g.size} novels, ${g.year_min}–${g.year_max}<br>forms ${g.birth_year}<br>held-out label: ${esc(g.held_out_label)}`; } },
      grid: { left: 150, right: 20, top: 10, bottom: 28 },
      xAxis: axis({ type: "value", min: 1670, max: 1930, axisLabel: { color: css("--muted"), formatter: v => String(v) } }),
      yAxis: axis({ type: "category", data: G.genres.map(g => g.name), inverse: true, axisLabel: { color: css("--ink-2"), fontSize: 11.5 } }),
      series: [
        { type: "bar", stack: "s", silent: true, data: G.genres.map(g => g.year_min), itemStyle: { color: "transparent" }, tooltip: { show: false } },
        { type: "bar", stack: "s", barWidth: "52%", data: G.genres.map((g, i) => ({ value: g.year_max - g.year_min, itemStyle: { color: C[i], opacity: !gsel || gsel === g.name ? 1 : 0.18, borderRadius: 4 } })),
          markArea: S.f.from || S.f.to ? { silent: true, itemStyle: { color: css("--sel") }, data: [[{ xAxis: +S.f.from || 1670 }, { xAxis: (+S.f.to || 1920) + 9 }]] } : undefined },
        { type: "scatter", symbolSize: 9, data: G.genres.map((g, i) => [g.birth_year, i]), itemStyle: { color: css("--surface"), borderColor: css("--ink"), borderWidth: 1.5 }, tooltip: { show: false }, silent: true },
      ],
    }, p => { if (p.seriesIndex === 1) { const n = G.genres[p.dataIndex].name; S.f.genre = gsel === n ? "" : n; refresh(); } });
    const tb = tile("g-terms", gsel ? gsel : "Distinctive vocabulary", gsel ? "Words that separate this genre from every other, and the held-out label that confirms it." : "Top words per genre. Pick a genre for its novels.", "w5 h2", "body");
    if (gsel) {
      const g = G.genres.find(x => x.name === gsel);
      const ws = set.filter(w => genreName(w.genre) === gsel).sort((a, b) => a.year - b.year);
      tb.innerHTML = `<div class="terms">${g.top_terms.map(t => `<span>${esc(t)}</span>`).join("")}</div><p class="note" style="margin-top:8px">Held-out label: <b>${esc(g.held_out_label)}</b>. ${g.size} novels, ${g.year_min}–${g.year_max}.</p><div class="list"><h4>${ws.length} novels in view</h4>${ws.map(w => `<div class="note">${w.year} · ${esc(w.title)}, ${esc(w.author)}</div>`).join("")}</div>`;
    } else {
      tb.innerHTML = G.genres.map((g, i) => `<div class="list" style="cursor:pointer" data-g="${esc(g.name)}"><h4 style="color:var(--ink-2)"><span style="display:inline-block;width:8px;height:8px;border-radius:2px;background:${C[i]};margin-right:6px"></span>${esc(g.name)}</h4><div class="note">${g.top_terms.slice(0, 6).map(esc).join(" · ")}</div></div>`).join("");
      tb.querySelectorAll("[data-g]").forEach(d => (d.onclick = () => { S.f.genre = d.dataset.g; refresh(); }));
    }
    const decs = DECADES;
    // Genre and author as one bipartite graph: genres pinned along the timeline at the year each
    // cluster forms, authors pulled toward every genre they wrote in. A bridge author sits between.
    const gEl = tile("g-graph", "Genres and the authors who cross them", "Genres pinned at the year their cluster forms (left to right); authors pulled toward each genre they wrote in. Authors between two genres are the bridges. Tap a genre or an author to filter.", "w12 h2");
    gEl.style.minHeight = "440px";
    const W = Math.max(320, gEl.clientWidth || 800), H = Math.max(300, gEl.clientHeight || 340);
    const y0 = Math.min(...G.genres.map(g => g.birth_year)), y1 = Math.max(...G.genres.map(g => g.birth_year));
    const rank = []; G.genres.map((g, i) => [g.birth_year, i]).sort((a, b) => a[0] - b[0]).forEach(([, i], k) => (rank[i] = k));
    const byAuthor = {}; set.forEach(w => { if (w.genre == null) return; (byAuthor[w.author] = byAuthor[w.author] || {})[w.genre] = ((byAuthor[w.author] || {})[w.genre] || 0) + 1; });
    const bridges = Object.entries(byAuthor).filter(([, gs]) => Object.keys(gs).length > 1).length;
    const gN = G.genres.map((g, i) => ({ id: "g" + i, name: g.name, category: i, symbol: "roundRect", symbolSize: [Math.min(130, 30 + g.name.replace(" fiction", "").length * 5.6), 22], fixed: true,
      x: W * (0.09 + 0.82 * (rank[i] / (G.genres.length - 1))), y: H * [0.22, 0.78, 0.5][rank[i] % 3], kind: "genre", n: set.filter(w => w.genre === i).length, born: g.birth_year,
      itemStyle: { color: C[i], opacity: !gsel || gsel === g.name ? 1 : 0.25, borderRadius: 4 }, label: { show: true, color: "#fff", fontSize: 10.5, fontWeight: 600, formatter: g.name.replace(" fiction", "") }, z: 10 }));
    const aN = Object.entries(byAuthor).map(([a, gs]) => { const n = Object.values(gs).reduce((x, y) => x + y, 0); const multi = Object.keys(gs).length > 1;
      const top = +Object.entries(gs).sort((x, y) => y[1] - x[1])[0][0];
      return { id: "a:" + a, name: a, category: top, symbolSize: 4 + Math.sqrt(n) * 3, kind: "author", gs, n, multi,
        itemStyle: { opacity: S.f.author ? (S.f.author === a ? 1 : 0.2) : 0.85, borderColor: S.f.author === a ? css("--ink") : css("--surface"), borderWidth: S.f.author === a ? 2 : 0.6 },
        label: { show: S.f.author === a || (multi && n >= 4), color: css("--ink"), fontSize: 10.5 } }; });
    const gL = aN.flatMap(a => Object.entries(a.gs).map(([gi, k]) => ({ source: a.id, target: "g" + gi, value: k, lineStyle: { color: C[+gi], width: Math.min(4, 0.6 + k * 0.5), opacity: S.f.author ? (S.f.author === a.name ? 0.9 : 0.05) : 0.35 } })));
    chart("g-graph", "", "", "w12 h2", {
      __replace: true,
      tooltip: { ...base().tooltip, trigger: "item", formatter: p => p.dataType === "edge" ? `${esc(p.data.source.slice(2))}: ${p.data.value} novel${p.data.value > 1 ? "s" : ""} in this genre` : p.data.kind === "genre" ? `<b>${esc(p.data.name)}</b><br>forms ${p.data.born}<br>${p.data.n} novels in view` : `<b>${esc(p.data.name)}</b><br>${p.data.n} novels in view<br>${Object.entries(p.data.gs).map(([g, k]) => `${esc(G.genres[g].name)}: ${k}`).join("<br>")}` },
      series: [{ type: "graph", layout: "force", roam: ROAM, top: 10, bottom: 10, data: [...gN, ...aN], links: gL, categories: G.genres.map((g, i) => ({ name: g.name, itemStyle: { color: C[i] } })),
        force: { repulsion: 22, edgeLength: [16, 60], gravity: 0.06, friction: 0.25 }, emphasis: { focus: "adjacency" }, labelLayout: { hideOverlap: true } }],
    }, p => { if (p.dataType !== "node") return; if (p.data.kind === "genre") S.f.genre = gsel === p.data.name ? "" : p.data.name; else S.f.author = S.f.author === p.data.name ? "" : p.data.name; refresh(); });
    document.querySelector("#t-g-graph h3").textContent = "Genres and the authors who cross them";
    document.querySelector("#t-g-graph .sub").textContent = `Genres in the order their clusters form, left to right (${y0}–${y1}); ${aN.length} authors pulled toward each genre they wrote in. ${bridges} write in more than one: the bridges. Tap a genre or author to filter.`;
    chart("g-density", "Novels per decade, by genre", "Corpus density. Most of the apparent 'acceleration' in genre change is this curve. Click a decade to filter to it.", "w12", {
      tooltip: { ...base().tooltip, trigger: "axis", axisPointer: { type: "shadow" } },
      legend: { top: 0, type: "scroll", textStyle: { color: css("--ink-2"), fontSize: 11 }, itemWidth: 10, itemHeight: 10 },
      grid: { left: 40, right: 12, top: 30, bottom: 30 },
      xAxis: axis({ type: "category", data: decs.map(d => d + "s"), splitLine: { show: false } }),
      yAxis: axis({ type: "value", minInterval: 1 }),
      series: G.genres.map((g, i) => ({ name: g.name, type: "bar", stack: "d", barCategoryGap: "20%", itemStyle: { color: C[i], borderColor: css("--surface"), borderWidth: 1, opacity: !gsel || gsel === g.name ? 1 : 0.18 },
        emphasis: { focus: "series" }, data: decs.map(d => set.filter(w => w.genre === i && w.decade === d).length) })),
    }, p => { const d = decs[p.dataIndex]; if (S.f.from == d && S.f.to == d) { S.f.from = S.f.to = ""; } else { S.f.from = S.f.to = String(d); } refresh(); });
    const tl = G.timeline.filter(t => inRange(t.year));
    const byDec = {}; tl.forEach(t => { const d = Math.floor(t.year / 10) * 10; byDec[d] = byDec[d] || { births: 0, splits: 0, merges: 0 }; for (const k of ["births", "splits", "merges"]) byDec[d][k] += t[k]; });
    const dk = Object.keys(byDec).map(Number).sort();
    chart("g-events", "Mutation events per decade", "Births, splits and merges of genre clusters in the temporal network.", "w6", {
      tooltip: { ...base().tooltip, trigger: "axis", axisPointer: { type: "shadow" } },
      legend: { top: 0, right: 8, textStyle: { color: css("--ink-2"), fontSize: 11 }, itemWidth: 10, itemHeight: 10 },
      grid: { left: 36, right: 12, top: 30, bottom: 30 },
      xAxis: axis({ type: "category", data: dk.map(d => d + "s"), splitLine: { show: false } }), yAxis: axis({ type: "value", minInterval: 1 }),
      series: ["births", "splits", "merges"].map((k, i) => ({ name: k[0].toUpperCase() + k.slice(1), type: "bar", stack: "e", itemStyle: { color: C[i], borderColor: css("--surface"), borderWidth: 1 }, data: dk.map(d => byDec[d][k]) })),
    });
    const bins = {}; nm.draws.forEach(v => { const b = Math.floor(v / 10) * 10; bins[b] = (bins[b] || 0) + 1; });
    const bk = []; for (let b = Math.min(...Object.keys(bins).map(Number), Math.floor(nm.real_total / 10) * 10); b <= Math.max(...Object.keys(bins).map(Number)); b += 10) bk.push(b);
    chart("g-null", "Is there a mutation rate?", `${nm.trials} runs with publication dates shuffled. The real corpus (line) sits inside the pile: no rate beyond chance.`, "w6", {
      tooltip: { ...base().tooltip, trigger: "axis", axisPointer: { type: "shadow" }, formatter: p => `${p[0].name}: ${p[0].value} shuffled runs` },
      grid: { left: 36, right: 12, top: 24, bottom: 34 },
      xAxis: axis({ type: "category", data: bk.map(b => `${b}–${b + 9}`), name: "total mutations", nameLocation: "middle", nameGap: 24, splitLine: { show: false } }),
      yAxis: axis({ type: "value", minInterval: 1 }),
      series: [{ type: "bar", barCategoryGap: "8%", data: bk.map(b => bins[b] || 0), itemStyle: { color: css("--grid"), borderRadius: [4, 4, 0, 0] },
        markLine: { symbol: "none", lineStyle: { color: C[1], width: 2 }, label: { formatter: `real: ${nm.real_total}`, color: css("--ink"), fontSize: 11 }, data: [{ xAxis: `${Math.floor(nm.real_total / 10) * 10}–${Math.floor(nm.real_total / 10) * 10 + 9}` }] } }],
    });
    const CK = G.clock;
    // Colour follows the entity: a clock community that is one of the eight genres wears that genre's slot.
    const clockSlot = {}; const used = new Set();
    CK.communities.forEach(c => { const gi = G.genres.findIndex(g => g.name === CLOCK_TO_GENRE[c.key]); if (gi >= 0) { clockSlot[c.key] = gi; used.add(gi); } });
    const free = [0, 1, 2, 3, 4, 5, 6, 7].filter(k => !used.has(k)); CK.communities.forEach(c => { if (clockSlot[c.key] == null) clockSlot[c.key] = free.shift(); });
    const hlName = S.hl.find(h => CK.communities.some(c => c.name === h)) || (gsel && CK.communities.find(c => CLOCK_TO_GENRE[c.key] === gsel)?.name);
    const x0 = S.f.from ? CK.years.indexOf(Math.max(+S.f.from, CK.years[0])) : 0, x1 = S.f.to ? CK.years.indexOf(Math.min(+S.f.to + 9, CK.years[CK.years.length - 1])) : CK.years.length - 1;
    chart("g-clock", "When the genre's name catches on", `Google Books mentions per billion words of each genre's own name ("detective story", "Gothic novel"…), ${CK.smoothing_years}-year mean. Click a line to isolate it.`, "w12 h2", {
      tooltip: { ...base().tooltip, trigger: "axis", order: "valueDesc", valueFormatter: v => fmt(v, 1) },
      legend: { top: 0, type: "scroll", textStyle: { color: css("--ink-2"), fontSize: 11 }, itemWidth: 14, itemHeight: 3 },
      grid: { left: 48, right: 16, top: 34, bottom: 30 },
      xAxis: axis({ type: "category", data: CK.years, boundaryGap: false, axisLabel: { color: css("--muted"), interval: 19 }, splitLine: { show: false } }),
      yAxis: axis({ type: "value", axisLabel: { color: css("--muted") } }),
      dataZoom: [{ type: "inside", startValue: x0 < 0 ? 0 : x0, endValue: x1 < 0 ? CK.years.length - 1 : x1 }],
      series: CK.communities.map((c, i) => ({ name: c.name, type: "line", symbol: "none", data: c.series, lineStyle: { width: hlName === c.name ? 3 : 1.6, color: C[clockSlot[c.key]], opacity: !hlName || hlName === c.name ? 1 : 0.15 }, itemStyle: { color: C[clockSlot[c.key]] },
        emphasis: { focus: "series" },
        markLine: hlName === c.name ? { symbol: "none", silent: true, lineStyle: { color: C[clockSlot[c.key]], type: "dashed" }, label: { color: css("--ink"), fontSize: 11, formatter: p => p.name }, data: [{ name: `10% takeoff ${c.takeoff_10pct}`, xAxis: String(c.takeoff_10pct) }, { name: `half its mentions by ${c.mass_median}`, xAxis: String(c.mass_median) }].filter(d => CK.years.includes(+d.xAxis)) } : undefined })),
    }, p => { S.hl = S.hl[0] === p.seriesName ? [] : [p.seriesName]; refresh(); });
    $("#foot").innerHTML = `${esc(G.robust_finding[0].toUpperCase() + G.robust_finding.slice(1))}. Per-book mutation rate by era: ${Object.entries(G.per_book_rate_by_era).map(([k, v]) => `${k} ${v}`).join(", ")} (${esc(G.per_book_rate_verdict)}). Author voice explains ${G.controls.author_confound_pct}% of clustering. Source: literature-mutations.`;
  }

  // ------------------------------------------------------------------ page: influence
  function pageInfluence() {
    const C = SER();
    const A = INF.authors;
    const inView = new Set(A.filter(a => inRange(a.earliest_year) || (!S.f.from && !S.f.to)).map(a => a.name));
    const docs = INF.documented.filter(d => inView.has(d.from) && inView.has(d.to));
    const sel = S.f.author && A.some(a => a.name === S.f.author) ? S.f.author : null;
    const v = INF.validation;
    kpis([
      { v: inView.size, l: "Authors in view", s: `of ${A.length} in the network` },
      { v: docs.length, l: "Documented influences", s: "Wikidata P737 + model-attested" },
      { v: `z ${fmt(v.known.conceptual.z, 1)}`, l: "Ideas carry: conceptual echo", s: `mean ${v.known.conceptual.real_mean} vs null ${v.known.conceptual.null_mean}` },
      { v: `z ${fmt(v.known.stylistic.z, 1)}`, l: "Prose, barely: stylistic echo", s: `mean ${v.known.stylistic.real_mean} vs null ${v.known.stylistic.null_mean}` },
    ]);
    const deg = {}; docs.forEach(d => { deg[d.from] = (deg[d.from] || 0) + 1; deg[d.to] = (deg[d.to] || 0) + 1; });
    const path = S.path && S.path[0] && S.path[1] ? findPath(S.path[0], S.path[1], docs) : null;
    const onPath = new Set(path ? path.nodes : []);
    const pathEdge = new Set(path ? path.edges.map(e => e.from + ">" + e.to) : []);
    const adj = new Set(sel ? [sel, ...docs.filter(d => d.from === sel || d.to === sel).map(d => (d.from === sel ? d.to : d.from))] : []);
    const lit = n => (path ? onPath.has(n) : sel ? adj.has(n) : true);
    const hl = new Set(S.hl);
    const byComm = S.infColor === "community";
    const comm = GR.influence.community;
    const commNames = communityNames(comm, A.map(a => a.name), deg);
    const cats = byComm ? commNames.map((n, i) => ({ name: n, itemStyle: { color: C[i % 8] } })) : FORMS.map((f, i) => ({ name: FORM_LABEL[f], itemStyle: { color: C[i] } }));
    // A chain is pinned in a straight line across the middle so every link of it is on screen.
    const gBox = document.querySelector("#t-i-graph .chart"); const gw = gBox ? gBox.clientWidth : 800, gh = gBox ? gBox.clientHeight : 340;
    const pin = n => { const k = path ? path.nodes.indexOf(n) : -1; if (k < 0) return {}; const t = path.nodes.length > 1 ? k / (path.nodes.length - 1) : 0.5; return { fixed: true, x: gw * (0.14 + 0.64 * t), y: gh * (0.55 + (k % 2 ? -0.12 : 0.12)) }; };
    const nodes = A.filter(a => inView.has(a.name)).map(a => ({
      ...pin(a.name),
      name: a.name, value: deg[a.name] || 0, category: byComm ? comm[A.indexOf(a)] : FORMS.indexOf(a.form), symbolSize: 6 + Math.sqrt(deg[a.name] || 0) * 4.2,
      itemStyle: { opacity: lit(a.name) ? 1 : 0.12, borderColor: a.name === sel || hl.has(a.name) || onPath.has(a.name) ? css("--ink") : css("--surface"), borderWidth: a.name === sel || hl.has(a.name) || onPath.has(a.name) ? 2.5 : 1 },
      label: { show: path ? onPath.has(a.name) : (deg[a.name] || 0) >= 6 || adj.has(a.name) || hl.has(a.name), position: onPath.has(a.name) ? "top" : "inside", color: css("--ink"), fontSize: onPath.has(a.name) ? 12 : 11, fontWeight: onPath.has(a.name) ? 600 : 400, opacity: lit(a.name) ? 1 : 0.2 },
      year: a.earliest_year, form: a.form, comm: commNames[comm[A.indexOf(a)]],
    }));
    const links = docs.map(d => {
      const pe = pathEdge.has(d.from + ">" + d.to) || pathEdge.has(d.to + ">" + d.from);
      const ego = sel && (d.from === sel || d.to === sel);
      return { source: d.from, target: d.to, value: d.conceptual, lineStyle: { opacity: path ? (pe ? 1 : 0.03) : sel ? (ego ? 0.9 : 0.04) : 0.28, width: pe ? 3 : ego ? 2 : 1, color: pe ? C[1] : sel && d.to === sel ? C[1] : sel && d.from === sel ? C[0] : css("--muted") } };
    });
    chart("i-graph", "Influence network", "Arrows run from influence to influenced. Tap an author for their ego network; pick two for the chain between them. Pinch or scroll to zoom.", "w8 h2", {
      __replace: true,
      tooltip: { ...base().tooltip, trigger: "item", formatter: p => p.dataType === "edge" ? `${esc(p.data.source)} → ${esc(p.data.target)}<br>conceptual ${fmt(p.data.value)}` : `<b>${esc(p.data.name)}</b><br>${FORM_LABEL[p.data.form]}, from ${p.data.year}<br>${p.data.value} documented links<br>community: ${esc(p.data.comm)}` },
      legend: { top: 0, left: 8, type: "scroll", data: cats.map(c => c.name), textStyle: { color: css("--ink-2"), fontSize: 11 }, itemWidth: 10, itemHeight: 10 },
      series: [{ type: "graph", layout: "force", roam: ROAM, draggable: true, top: 44, bottom: 10, data: nodes, links, categories: cats,
        edgeSymbol: ["none", "arrow"], edgeSymbolSize: 5, force: { repulsion: 90, edgeLength: [40, 120], gravity: 0.08, friction: 0.2 }, emphasis: { focus: "adjacency", lineStyle: { width: 2 } }, labelLayout: { hideOverlap: true } }],
    }, p => { if (p.dataType === "node") { const n = p.data.name; if (S.path && S.path[0] && !S.path[1] && n !== S.path[0]) S.path = [S.path[0], n]; else { S.path = null; S.f.author = S.f.author === n ? "" : n; } refresh(); } });
    controls("i-graph", `<span class="seg">${["form", "community"].map(m => `<button data-c="${m}" class="${(S.infColor || "form") === m ? "on" : ""}">${m === "form" ? "Colour: form" : "Colour: community"}</button>`).join("")}</span>`, el => el.querySelectorAll("[data-c]").forEach(b => (b.onclick = () => { S.infColor = b.dataset.c; refresh(); })));
    const body = tile("i-ego", path ? "Chain of influence" : sel || "Most connected", path ? `Shortest chain of documented influence links, either direction. Conceptual similarity per link.` : sel ? "Documented influences, ranked by how close the two authors' ideas are (conceptual similarity)." : "Pick an author in the graph or the Author slicer.", "w4 h2", "body");
    const row = (n, val) => `<div class="row" data-a="${esc(n)}"><span>${esc(n)}</span><span class="bar"><i style="width:${Math.max(4, ((val - 0.5) / 0.4) * 100)}%"></i></span><span class="n">${fmt(val, 2)}</span></div>`;
    const others = A.map(a => a.name).filter(n => n !== (path ? S.path[0] : sel)).sort((a, b) => a.split(" ").pop().localeCompare(b.split(" ").pop()));
    const pathPicker = (from) => `<label class="pick">Chain to<select id="i-path">${["<option value=\"\">Pick an author…</option>", ...others.map(n => `<option ${S.path && S.path[1] === n ? "selected" : ""}>${esc(n)}</option>`)].join("")}</select></label>`;
    if (path) {
      body.innerHTML = pathPicker(S.path[0]) + `<div class="list"><h4>${esc(S.path[0])} to ${esc(S.path[1])}: ${path.edges.length} link${path.edges.length === 1 ? "" : "s"}</h4>${path.edges.map(e => `<div class="row" data-a="${esc(e.to === e.next ? e.to : e.next)}"><span>${esc(e.from)} → ${esc(e.to)}</span><span class="bar"><i style="width:${Math.max(4, ((e.conceptual - 0.5) / 0.4) * 100)}%"></i></span><span class="n">${fmt(e.conceptual, 2)}</span></div>`).join("")}</div><button class="ghost" id="i-path-clear" style="margin-top:8px">Clear chain</button>`;
    } else if (S.path && S.path[0] && S.path[1]) {
      body.innerHTML = pathPicker(S.path[0]) + `<p class="note">No chain of documented influences connects ${esc(S.path[0])} and ${esc(S.path[1])} among the authors in view.</p>`;
    } else if (sel) {
      const into = docs.filter(d => d.to === sel).sort((a, b) => b.conceptual - a.conceptual);
      const out = docs.filter(d => d.from === sel).sort((a, b) => b.conceptual - a.conceptual);
      body.innerHTML = pathPicker(sel) + `<div class="list"><h4>Influenced by (${into.length})</h4>${into.map(d => row(d.from, d.conceptual)).join("") || '<div class="note">None documented in the network.</div>'}<h4>Influenced (${out.length})</h4>${out.map(d => row(d.to, d.conceptual)).join("") || '<div class="note">None documented in the network.</div>'}</div>`;
    } else if (S.f.author) {
      body.innerHTML = `<p class="note">${esc(S.f.author)} is not one of the ${A.length} authors in the influence network.</p>`;
    } else {
      const top = Object.entries(deg).sort((a, b) => b[1] - a[1]).slice(0, 15);
      body.innerHTML = `<div class="list">${top.map(([n, k]) => `<div class="row" data-a="${esc(n)}"><span>${esc(n)}</span><span class="bar"><i style="width:${(k / top[0][1]) * 100}%"></i></span><span class="n">${k}</span></div>`).join("")}</div>`;
    }
    body.querySelectorAll("[data-a]").forEach(r => (r.onclick = () => { S.path = null; S.f.author = r.dataset.a; refresh(); }));
    const ps = body.querySelector("#i-path"); if (ps) ps.onchange = e => { const from = path ? S.path[0] : (S.path && S.path[0]) || sel; S.path = e.target.value ? [from, e.target.value] : null; if (!S.path) S.f.author = from; refresh(); };
    const pc = body.querySelector("#i-path-clear"); if (pc) pc.onclick = () => { S.f.author = S.path[0]; S.path = null; refresh(); };
    const tests = [["Known pairs", v.known], ["Wikidata pairs", v.wikidata], ["Well-represented authors", v.well_represented]];
    chart("i-valid", "Does influence show in the text?", "z-score of documented pairs against random author pairs. Past the dashed line is significant.", "w6", {
      tooltip: { ...base().tooltip, trigger: "axis", axisPointer: { type: "shadow" }, valueFormatter: v => "z " + fmt(v, 2) },
      legend: { top: 0, right: 8, textStyle: { color: css("--ink-2"), fontSize: 11 }, itemWidth: 10, itemHeight: 10 },
      grid: { left: 40, right: 12, top: 30, bottom: 30 },
      xAxis: axis({ type: "category", data: tests.map(t => t[0]), splitLine: { show: false } }), yAxis: axis({ type: "value", name: "z" }),
      series: [["Conceptual (ideas)", "conceptual", 0], ["Stylistic (prose)", "stylistic", 1]].map(([n, k, i]) => ({ name: n, type: "bar", barGap: "12%", itemStyle: { color: C[i], borderRadius: [4, 4, 0, 0] }, label: { show: true, position: "top", color: css("--ink-2"), fontSize: 11, formatter: p => fmt(p.value, 1) }, data: tests.map(t => t[1][k].z),
        markLine: i === 0 ? { symbol: "none", silent: true, lineStyle: { color: css("--muted"), type: "dashed" }, label: { show: false }, data: [{ yAxis: 1.96 }] } : undefined })),
    });
    const pts = docs.map(d => ({ value: [d.stylistic, d.conceptual], name: `${d.from} → ${d.to}`, on: sel && (d.from === sel || d.to === sel) }));
    chart("i-pairs", "Each documented pair: prose vs ideas", "Stylistic (TF-IDF) against conceptual (embedding) similarity. Ideas cluster high; prose stays low.", "w6", {
      tooltip: { ...base().tooltip, trigger: "item", formatter: p => `${esc(p.data.name)}<br>stylistic ${fmt(p.data.value[0])}<br>conceptual ${fmt(p.data.value[1])}` },
      grid: { left: 48, right: 16, top: 14, bottom: 38 },
      xAxis: axis({ type: "value", name: "stylistic", nameLocation: "middle", nameGap: 24, min: 0 }), yAxis: axis({ type: "value", name: "conceptual", scale: true }),
      series: [{ type: "scatter", symbolSize: 8, data: pts.filter(p => !p.on), itemStyle: { color: sel ? css("--grid") : C[0], borderColor: css("--surface"), borderWidth: 1, opacity: 0.85 } },
        { type: "scatter", symbolSize: 11, data: pts.filter(p => p.on), itemStyle: { color: C[1], borderColor: css("--surface"), borderWidth: 1.5 } }],
    });
    $("#foot").innerHTML = `${INF.authors.length} authors whose texts are in the corpus; ${INF.n_edges} scored pairs. Stylistic and conceptual signals correlate at ${INF.signal_correlation}. ${esc(v.verdict[0].toUpperCase() + v.verdict.slice(1))}. Source: literature-mutations, Phase 2.`;
  }

  // ------------------------------------------------------------------ page: prose
  function pageProse() {
    const C = SER();
    const P = PR.persona;
    const N = PR.authors.length;
    const sel = S.f.author && PR.authors.includes(S.f.author) ? S.f.author : "Herman Melville";
    const i = PR.authors.indexOf(sel);
    const M = PR[S.metric];
    const inView = PR.authors.map((a, j) => (!S.f.from && !S.f.to) || inRange(PR.earliest[j]));
    const nn = M[i].map((v, j) => [PR.authors[j], v, j]).filter(([n, v, j]) => j !== i && v != null && inView[j]).sort((a, b) => b[1] - a[1]).slice(0, 12);
    kpis([
      { v: nn[0] ? esc(nn[0][0].split(" ").pop()) : "–", l: `Closest prose to ${esc(sel.split(" ").pop())}`, s: nn[0] ? `${S.metric} similarity ${fmt(nn[0][1])}` : "" },
      { v: fmt(P.val_loss.mccarthy, 2), l: "McCarthy: most predictable prose", s: `nats/char vs Melville ${fmt(P.val_loss.melville, 2)}, Shakespeare ${fmt(P.val_loss.shakespeare, 2)}` },
      { v: fmt(P.cross_bpc.mccarthy.shakespeare, 2), l: "Farthest pair: McCarthy reading Shakespeare", s: "bits per character" },
      { v: pct(P.purity.delta), l: "Works that cluster with their author", s: `Burrows Delta; ${pct(P.purity.ncd)} by compression` },
    ]);
    const segHtml = `<span style="display:inline-flex;border:1px solid var(--border);border-radius:4px;overflow:hidden;margin-left:auto">${["stylistic", "conceptual"].map(m => `<button data-m="${m}" style="border:0;padding:7px 10px;font-size:11px;cursor:pointer;background:${S.metric === m ? "var(--accent)" : "var(--surface-2)"};color:${S.metric === m ? "#fff" : "var(--ink-2)"}">${m}</button>`).join("")}</span>`;
    chart("p-nn", `Nearest writers to ${sel}`, (S.metric === "stylistic" ? "TF-IDF similarity of distinctive vocabulary." : "Embedding similarity of ideas and imagery.") + " Click a bar to recentre.", "w5 h2", {
      tooltip: { ...base().tooltip, trigger: "item", formatter: p => `${esc(p.name)}: ${fmt(p.value)}` },
      grid: { left: 150, right: 44, top: 8, bottom: 24 },
      xAxis: axis({ type: "value", axisLabel: { color: css("--muted"), formatter: v => v.toFixed(2) } }),
      yAxis: axis({ type: "category", inverse: true, data: nn.map(x => x[0]), axisLabel: { color: css("--ink-2"), fontSize: 11.5 } }),
      series: [{ type: "bar", barWidth: "60%", data: nn.map(x => ({ value: x[1], itemStyle: { color: S.hl.includes(x[0]) ? C[1] : C[0], borderRadius: [0, 4, 4, 0] } })), label: { show: true, position: "right", color: css("--ink-2"), fontSize: 11, formatter: p => fmt(p.value) } }],
    }, p => { S.f.author = p.name; refresh(); });
    const head = document.querySelector("#t-p-nn header"); if (!head.querySelector("[data-m]")) head.querySelector("h3").insertAdjacentHTML("afterend", segHtml); else head.querySelector("span").outerHTML = segHtml;
    head.querySelectorAll("[data-m]").forEach(b => (b.onclick = () => { S.metric = b.dataset.m; refresh(); }));
    // Similarity graph: an edge for every pair in the top S.top% of the matrix; colour = Louvain
    // community on the 4-nearest-neighbour graph of the same metric, so clusters read as colours.
    const allV = []; for (let a = 0; a < N; a++) for (let b = a + 1; b < N; b++) if (M[a][b] != null && inView[a] && inView[b]) allV.push(M[a][b]);
    allV.sort((x, y) => y - x);
    const thr = allV[Math.max(0, Math.floor(allV.length * S.top / 100) - 1)] ?? 1;
    const lab = GR.prose[S.metric];
    const pE = []; for (let a = 0; a < N; a++) for (let b = a + 1; b < N; b++) if (inView[a] && inView[b] && M[a][b] != null && M[a][b] >= thr) pE.push([a, b, M[a][b]]);
    const pdeg = {}; pE.forEach(([a, b]) => { pdeg[PR.authors[a]] = (pdeg[PR.authors[a]] || 0) + 1; pdeg[PR.authors[b]] = (pdeg[PR.authors[b]] || 0) + 1; });
    const fame = {}; INF.documented.forEach(d => { fame[d.from] = (fame[d.from] || 0) + 1; fame[d.to] = (fame[d.to] || 0) + 1; });
    const pNames = communityNames(lab, PR.authors, fame);
    const egoP = new Set([i, ...pE.filter(e => e[0] === i || e[1] === i).flatMap(e => [e[0], e[1]])]);
    const focusSel = !!S.f.author && PR.authors.includes(S.f.author);
    chart("p-graph", `Who writes like whom: ${S.metric} clusters`, `${pE.length} pairs at similarity ≥ ${fmt(thr)} (the top ${S.top}% of ${allV.length}). Colour = community. Tap a writer to centre the page on them; pinch to zoom.`, "w7 h2", {
      __replace: true,
      tooltip: { ...base().tooltip, trigger: "item", formatter: p => p.dataType === "edge" ? `${esc(p.data.source)} ↔ ${esc(p.data.target)}<br>${S.metric} ${fmt(p.data.value)}` : `<b>${esc(p.data.name)}</b><br>${FORM_LABEL[p.data.form]}, from ${p.data.year}<br>${esc(pNames[p.data.category])}<br>${p.data.value} links at this threshold` },
      legend: { top: 0, left: 8, type: "scroll", data: pNames, textStyle: { color: css("--ink-2"), fontSize: 11 }, itemWidth: 10, itemHeight: 10 },
      series: [{ type: "graph", layout: "force", roam: ROAM, draggable: true, top: 30, bottom: 6,
        data: PR.authors.map((a, j) => ({ name: a, value: pdeg[a] || 0, category: lab[j], form: PR.forms[j], year: PR.earliest[j], symbolSize: 7 + Math.sqrt(pdeg[a] || 0) * 3.4,
          itemStyle: { opacity: !inView[j] ? 0.06 : focusSel ? (egoP.has(j) ? 1 : 0.15) : 0.95, borderColor: j === i && focusSel ? css("--ink") : css("--surface"), borderWidth: j === i && focusSel ? 2.5 : 1 },
          label: { show: (focusSel && egoP.has(j)) || (!focusSel && (pdeg[a] || 0) >= 5), color: css("--ink"), fontSize: 11 } })),
        links: pE.map(([a, b, v]) => ({ source: PR.authors[a], target: PR.authors[b], value: v, lineStyle: { width: 0.5 + ((v - thr) / ((allV[0] - thr) || 1)) * 3, color: css("--muted"), opacity: focusSel ? (a === i || b === i ? 0.9 : 0.06) : 0.45 } })),
        categories: pNames.map((n, k) => ({ name: n, itemStyle: { color: C[k % 8] } })),
        force: { repulsion: 120, edgeLength: [30, 100], gravity: 0.12, friction: 0.25 }, emphasis: { focus: "adjacency" }, labelLayout: { hideOverlap: true } }],
    }, p => { if (p.dataType === "node") { S.f.author = p.data.name; refresh(); } });
    controls("p-graph", `<label>Show top <b>${S.top}%</b> of pairs <input type="range" id="p-top" min="1" max="15" step="1" value="${S.top}" aria-label="Share of most similar pairs to draw"></label>`, c => { const r = c.querySelector("#p-top"); r.oninput = e => { c.querySelector("b").textContent = e.target.value + "%"; }; r.onchange = e => { S.top = +e.target.value; refresh(); }; });
    const order = PR.authors.map((a, j) => j).filter(j => inView[j]).sort((a, b) => PR.earliest[a] - PR.earliest[b]);
    const cells = []; let mx = 0;
    order.forEach((r, yi) => order.forEach((c, xi) => { if (r !== c && M[r][c] != null) cells.push([xi, yi, M[r][c]]); }));
    { const v = cells.map(c => c[2]).sort((a, b) => a - b); mx = v[Math.floor(v.length * 0.98)] || 1; }
    const mn = (() => { const v = cells.map(c => c[2]).sort((a, b) => a - b); return v[Math.floor(v.length * 0.02)] || 0; })();
    chart("p-heat", `Every pair of writers, ${S.metric}`, "Authors ordered by earliest work. Darker = closer. Click a cell to centre on that row's author.", "w6 h2", {
      __replace: true,
      tooltip: { ...base().tooltip, trigger: "item", formatter: p => `${esc(PR.authors[order[p.data[1]]])} ↔ ${esc(PR.authors[order[p.data[0]]])}<br>${S.metric} ${fmt(p.data[2])}` },
      grid: { left: 8, right: 8, top: 8, bottom: 40 },
      xAxis: { type: "category", data: order.map(j => PR.authors[j]), axisLabel: { show: false }, axisTick: { show: false }, axisLine: { show: false } },
      yAxis: { type: "category", data: order.map(j => PR.authors[j]), inverse: true, axisLabel: { show: false }, axisTick: { show: false }, axisLine: { show: false } },
      visualMap: { min: mn, max: mx, orient: "horizontal", left: "center", bottom: 0, itemHeight: 140, itemWidth: 10, calculable: false, textStyle: { color: css("--muted"), fontSize: 10 }, inRange: { color: [css("--seq-0"), css("--seq-1")] }, formatter: v => v.toFixed(2) },
      series: [{ type: "heatmap", data: cells, progressive: 0, emphasis: { itemStyle: { borderColor: css("--ink"), borderWidth: 1 } },
        markArea: order.indexOf(i) >= 0 ? { silent: true, itemStyle: { color: "transparent", borderColor: css("--s2"), borderWidth: 2 }, data: [[{ yAxis: PR.authors[i], xAxis: PR.authors[order[0]] }, { yAxis: PR.authors[i], xAxis: PR.authors[order[order.length - 1]] }]] } : undefined }],
    }, p => { S.f.author = PR.authors[order[p.data[1]]]; refresh(); });
    const ma = P.authors;
    const bc = []; ma.forEach((m, yi) => ma.forEach((t, xi) => bc.push([xi, yi, P.cross_bpc[m][t]])));
    chart("p-bpc", "Character GPTs reading each other", "Rows: a model trained on one author. Columns: held-out text. Bits per character; lower = more natural to that model.", "w6 h2", {
      __replace: true,
      tooltip: { ...base().tooltip, trigger: "item", formatter: p => `${PERSONA[ma[p.data[1]]]} model reading ${PERSONA[ma[p.data[0]]]}: ${fmt(p.data[2])} bits/char` },
      grid: { left: 112, right: 10, top: 10, bottom: 46 },
      xAxis: axis({ type: "category", data: ma.map(m => PERSONA[m].split(" ").pop() + " text"), splitLine: { show: false }, axisLabel: { color: css("--ink-2"), fontSize: 11 } }),
      yAxis: axis({ type: "category", data: ma.map(m => PERSONA[m].split(" ").pop() + " model"), inverse: true, splitLine: { show: false }, axisLabel: { color: css("--ink-2"), fontSize: 11 } }),
      visualMap: { show: false, min: 1.4, max: 3.2, inRange: { color: [css("--seq-1"), css("--seq-0")] } },
      series: [{ type: "heatmap", data: bc, label: { show: true, formatter: p => fmt(p.data[2], 2), color: css("--ink"), fontSize: 12, fontWeight: 600, textBorderColor: css("--surface"), textBorderWidth: 3 }, itemStyle: { borderColor: css("--surface"), borderWidth: 2, borderRadius: 4 } }],
    });
    const selP = Object.entries(PERSONA).find(([, n]) => n === S.f.author)?.[0];
    const nModel = P.map.filter(p => p.author.startsWith("model:")).length;
    chart("p-map", `Stylometric map of ${P.map.length - nModel} works and ${nModel} model samples`, `Burrows Delta on the ${P.n_vocab} most frequent words, projected to two dimensions. Diamonds are text generated by each author's model.`, "w12", {
      tooltip: { ...base().tooltip, trigger: "item", formatter: p => `<b>${esc(p.data.label)}</b><br>${p.data.model ? "generated by the " + esc(p.data.author.replace("model:", "")) + " model" : PERSONA[p.data.author]}` },
      legend: { top: 0, right: 8, textStyle: { color: css("--ink-2"), fontSize: 11 }, itemWidth: 10, itemHeight: 10 },
      grid: { left: 30, right: 16, top: 28, bottom: 24 },
      xAxis: axis({ type: "value", axisLabel: { show: false }, splitLine: { show: false } }), yAxis: axis({ type: "value", axisLabel: { show: false }, splitLine: { show: false } }),
      series: ma.map((m, k) => ({ name: PERSONA[m], type: "scatter",
        data: P.map.filter(p => p.author === m || p.author.startsWith("model:" + m)).map(p => ({ value: [p.x, p.y], label: p.label, author: p.author, model: p.author.startsWith("model:"), symbol: p.author.startsWith("model:") ? "diamond" : "circle", symbolSize: p.author.startsWith("model:") ? 15 : 8 })),
        itemStyle: { color: C[k], borderColor: css("--surface"), borderWidth: 1.2, opacity: !selP || selP === m ? 0.9 : 0.15 } })),
    }, p => { S.f.author = PERSONA[p.data.author.replace("model:", "").split("_")[0]]; refresh(); });
    const tb = tile("p-tells", "The tells", `Highest and lowest mean z-score among the ${P.n_vocab} most frequent words, across the author's books.`, "w12", "body");
    tb.innerHTML = `<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:12px">${ma.map((m, k) => `<div class="list"><h4 style="color:var(--ink-2)"><span style="display:inline-block;width:8px;height:8px;border-radius:2px;background:${C[k]};margin-right:6px"></span>${PERSONA[m]}</h4><div class="note"><b>Over:</b> ${P.tells[m].over.map(esc).join(", ")}</div><div class="note" style="margin-top:4px"><b>Under:</b> ${P.tells[m].under.map(esc).join(", ")}</div></div>`).join("")}</div>`;
    $("#foot").innerHTML = `Writer-to-writer similarity: the ${N}-author TF-IDF and embedding matrices from literature-mutations (successor to the 2020 Prose Similarities graph). Character GPTs: persona-transformers, ${Object.keys(P.val_loss).length} models of ${(P.params / 1e6).toFixed(1)}M parameters, each trained from scratch on one author's text. McCarthy texts are not redistributed; only derived measurements appear here.`;
  }

  // ------------------------------------------------------------------ page: atlas
  // One node model: genres, authors, works and the influences between authors. Works join in
  // once the slicers narrow the view to a readable number of them.
  function pageAtlas() {
    const C = SER();
    const set = filterWorks(S.f, { ignoreWork: true });
    const narrowed = !!(S.f.author || S.f.genre || S.f.from || S.f.to);
    const showWorks = set.length <= 80;
    const inf = new Map(INF.authors.map(a => [a.name, a]));
    const authors = new Map();
    set.forEach(w => { const a = authors.get(w.author) || { name: w.author, works: [], genres: {} }; a.works.push(w); if (w.genre != null) a.genres[w.genre] = (a.genres[w.genre] || 0) + 1; authors.set(w.author, a); });
    const docs = INF.documented.filter(d => !narrowed || authors.has(d.from) || authors.has(d.to) || d.from === S.f.author || d.to === S.f.author);
    docs.forEach(d => { for (const n of [d.from, d.to]) if (!authors.has(n)) authors.set(n, { name: n, works: [], genres: {}, onlyInfluence: true }); });
    const nodes = [], links = [];
    const genresIn = new Set(set.map(w => w.genre).filter(g => g != null));
    G.genres.forEach((g, i) => { if (!narrowed || genresIn.has(i)) nodes.push({ id: "g" + i, name: g.name, kind: "Genre", category: 0, symbol: "roundRect", z: 10, labelLayout: { hideOverlap: false }, symbolSize: [Math.min(140, 30 + g.name.length * 5), 20], itemStyle: { color: C[0], borderRadius: 4 }, label: { show: true, color: "#fff", fontSize: 10.5, fontWeight: 600 }, info: `${g.size} novels, forms ${g.birth_year}` }); });
    for (const a of authors.values()) {
      const me = S.f.author === a.name;
      nodes.push({ id: "a:" + a.name, name: a.name, kind: "Author", category: a.onlyInfluence ? 2 : 1, symbolSize: me ? 16 : 5 + Math.sqrt(a.works.length || 1) * 3, info: a.onlyInfluence ? (inf.has(a.name) ? `${FORM_LABEL[inf.get(a.name).form]}, from ${inf.get(a.name).earliest_year}` : "") : `${a.works.length} novel${a.works.length > 1 ? "s" : ""} in view`,
        itemStyle: { borderColor: me ? css("--ink") : css("--surface"), borderWidth: me ? 2.5 : 0.8 }, label: { show: me || a.works.length >= (narrowed ? 2 : 7) || (narrowed && authors.size < 40), color: css("--ink"), fontSize: 10.5 } });
      Object.entries(a.genres).forEach(([gi, k]) => links.push({ source: "a:" + a.name, target: "g" + gi, value: `${k} novel${k > 1 ? "s" : ""}`, lineStyle: { color: C[0], opacity: 0.3, width: Math.min(3, 0.5 + k * 0.4) } }));
      if (showWorks) a.works.forEach(w => { nodes.push({ id: "w" + w.id, name: w.title, kind: "Work", category: 3, symbolSize: 5, info: `${w.year}${w.arc ? ", " + w.arc.shape.toLowerCase() + " arc" : ""}`, label: { show: set.length <= 25, color: css("--ink-2"), fontSize: 10 } }); links.push({ source: "w" + w.id, target: "a:" + w.author, value: "wrote", lineStyle: { color: C[3], opacity: 0.4 } }); });
    }
    docs.forEach(d => links.push({ source: "a:" + d.from, target: "a:" + d.to, value: `influence, conceptual ${fmt(d.conceptual, 2)}`, lineStyle: { color: C[1], opacity: 0.45, width: 1.2, curveness: 0.15 } }));
    kpis([
      { v: nodes.length, l: "Nodes in view", s: showWorks ? "Genres, authors and works" : `Works join below 80; ${set.length} now` },
      { v: links.length, l: "Links in view", s: "Wrote, belongs to, influenced" },
      { v: [...authors.values()].filter(a => !a.onlyInfluence).length, l: "Novelists in view", s: `${[...authors.values()].filter(a => a.onlyInfluence).length} more reached only by influence` },
      { v: docs.length, l: "Influence links in view", s: "Documented, either direction" },
    ]);
    const aBox = tile("a-graph", "", "", "w12 h2"); aBox.style.minHeight = aBox.clientWidth < 600 ? "460px" : "560px";
    const cats = ["Genre", "Novelist", "Influence-only author", "Work"].map((n, k) => ({ name: n, itemStyle: { color: [C[0], C[2], C[1], C[3]][k] } }));
    chart("a-graph", "Atlas: every entity, one model", `Genres, the novelists in them, the writers who influenced them${showWorks ? ", and each novel" : ""}. Filter with the slicers; tap a node to focus it. Pinch to zoom.`, "w12 h2", {
      __replace: true,
      tooltip: { ...base().tooltip, trigger: "item", formatter: p => p.dataType === "edge" ? esc(p.data.value) : `<b>${esc(p.data.name)}</b><br>${p.data.kind}${p.data.info ? "<br>" + esc(p.data.info) : ""}` },
      legend: { top: 0, left: 8, data: cats.map(c => c.name), textStyle: { color: css("--ink-2"), fontSize: 11 }, itemWidth: 10, itemHeight: 10 },
      series: [{ type: "graph", layout: "force", roam: ROAM, top: 30, bottom: 6, data: nodes, links, categories: cats, edgeSymbol: ["none", "none"],
        force: { repulsion: nodes.length < 70 ? 320 : narrowed ? 110 : 28, edgeLength: nodes.length < 70 ? [50, 120] : narrowed ? [30, 90] : [14, 50], gravity: 0.1, friction: 0.25 }, emphasis: { focus: "adjacency" }, labelLayout: { hideOverlap: true } }],
    }, p => { if (p.dataType !== "node") return; const d = p.data;
      if (d.kind === "Genre") S.f.genre = S.f.genre === d.name ? "" : d.name;
      else if (d.kind === "Author") S.f.author = S.f.author === d.name ? "" : d.name;
      else { S.f.work = d.name; S.page = "sentiment"; render(); return; }
      refresh(); });
    $("#foot").innerHTML = `Joins the corpus of ${works.length} novels to the ${INF.authors.length}-author influence network. Tapping a novel opens its sentiment arc.`;
  }

  // ------------------------------------------------------------------ render loop
  function render(force) {
    if (force || lastPage !== S.page) {
      charts.forEach(c => c.dispose()); charts.clear(); pending.clear(); visible.clear(); io.disconnect();
      $("#page").innerHTML = '<div id="grid" class="grid"></div>';
    }
    setTitle(S.page);
    syncSlicers();
    ({ sentiment: pageSentiment, genres: pageGenres, influence: pageInfluence, prose: pageProse, atlas: pageAtlas })[S.page]();
    lastPage = S.page;
  }
  function refresh() { render(false); }
  function go(p) { if (S.focus) focus(S.focus); S.page = p; S.shape = ""; S.lit = null; S.hl = []; if (p !== "influence") S.path = null; stopStory(); render(); }

  // ------------------------------------------------------------------ stories
  const scoredWorks = () => works.filter(w => w.arc);
  const byTitle = t => works.find(w => w.title === t && w.arc);
  const arcNeighbours = title => { const i = SEN.arcs.findIndex(a => works[a.work].title === title); return GR.arc.edges.filter(e => e[0] === i || e[1] === i).sort((a, b) => b[2] - a[2]).map(e => [works[SEN.arcs[e[0] === i ? e[1] : e[0]].work], e[2]]); };
  const pathText = (a, b) => { const p = findPath(a, b, INF.documented); return p ? p.nodes.join(" → ") + ` (${p.edges.length} links)` : "no chain"; };
  const commOf = (lab, name) => { const i = PR.authors.indexOf(name), k = lab[i]; return PR.authors.map((a, j) => [a, j]).filter(([a, j]) => lab[j] === k && j !== i).sort((x, y) => (PR.stylistic[i][y[1]] || 0) - (PR.stylistic[i][x[1]] || 0)).map(x => x[0]); };
  const STORIES = {
    sentiment: [
      { f: {}, lit: "s-arc", t: () => { const s = scoredWorks(); const l = s.filter(w => w.arc.end < w.arc.start).length; return `Across ${s.length} novels, the average arc drifts down: ${pct(l / s.length)} end lower than they begin.`; } },
      { f: {}, lit: "s-graph", t: () => `Link each novel to the ${GR.arc.k} whose arcs move most like it and families appear: ${pct(GR.arc.same_shape_neighbours)} of neighbours share a shape, against ${pct(GR.arc.same_shape_chance)} by chance.` },
      { f: { work: "Moby-Dick" }, lit: "s-graph", t: () => { const n = arcNeighbours("Moby-Dick"); return `Moby-Dick's arc moves most like ${n.slice(0, 3).map(([w, r]) => `${w.title} (r ${fmt(r, 2)})`).join(", ")}.`; } },
      { f: { work: "This Side of Paradise" }, lit: "s-arc", t: () => { const w = byTitle("This Side of Paradise"); return `The 2019 experiment scored this novel paragraph by paragraph and got noise (grey). Scored in 1% windows and smoothed (orange), it reads: ${fmt(w.arc.start)} at the start, ${fmt(w.arc.end)} at the end, ${w.arc.shape.toLowerCase()} by thirds.`; } },
      { f: { work: "This Side of Paradise" }, lit: "s-mom", t: () => { const w = byTitle("This Side of Paradise"); const m = w.arc.momentum; const k = m.indexOf(Math.min(...m)); return `Momentum is the slope. Its steepest drop comes ${k}% of the way through (${fmt(m[k], 2)}); the sharpest turn overall is at ${w.arc.turn}%.`; } },
      { f: { genre: "Detective fiction" }, lit: "s-scatter", t: () => { const s = filterWorks({ genre: "Detective fiction" }).filter(w => w.arc); const l = s.filter(w => w.arc.end < w.arc.start).length; return `Detective fiction: ${s.length} scored novels, and ${pct(l / s.length)} end darker than they start. Points under the diagonal end lower.`; } },
      { f: { author: "Charles Dickens" }, lit: "s-shape", t: () => { const s = filterWorks({ author: "Charles Dickens" }).filter(w => w.arc); const r = s.filter(w => w.arc.end > w.arc.start).length; return `Dickens runs the other way: ${r} of his ${s.length} scored novels end higher than they begin.`; } },
    ],
    genres: [
      { f: {}, lit: "g-bands", t: () => `Cluster ${G.n_books} novels by their distinctive vocabulary alone and ${G.genres.length} genres fall out, each confirmed by library labels the model never saw.` },
      { f: {}, lit: "g-null", t: () => `Do genres mutate at a rate? ${G.null_model.real_total} mutation events in the real corpus; ${G.null_model.shuffled_mean} on average with the dates shuffled (z ${G.null_model.z}). No.` },
      { f: {}, lit: "g-density", t: () => `What looks like acceleration is this: more books survive from later decades. Per book, the rate is flat at ${Object.values(G.per_book_rate_by_era).join(", ")} across four eras.` },
      { f: { genre: "Detective fiction" }, lit: "g-bands", t: () => { const g = G.genres.find(x => x.name === "Detective fiction"); const e = G.controls.emergent[0]; return `One genre is real in time: detective fiction forms in ${g.birth_year} and its core sits in ${e.year_min}–${e.year_max}, concentration z ${e.concentration_z}. Its words: ${g.top_terms.slice(0, 5).join(", ")}.`; } },
      { f: { author: "Herman Melville" }, lit: "g-graph", t: () => { const by = {}; works.forEach(w => { if (w.genre != null) (by[w.author] = by[w.author] || new Set()).add(w.genre); }); const multi = Object.values(by).filter(x => x.size > 1).length; return `${multi} of ${Object.keys(by).length} novelists write in more than one genre. Melville spans ${by["Herman Melville"].size}: ${[...by["Herman Melville"]].map(g => G.genres[g].name).join(", ")}.`; } },
      { f: {}, hl: ["Detective fiction"], lit: "g-clock", t: () => { const c = G.clock.communities.find(x => x.key === "detective"); const g = G.genres.find(x => x.name === "Detective fiction"); return `The name and the books arrive together: the prose cluster forms in ${g.birth_year}; "detective story" and its kin reach 10% of their mentions by ${c.takeoff_10pct} and half by ${c.mass_median}.`; } },
      { f: { from: "1850" }, hl: ["Gothic / sensation fiction"], lit: "g-clock", t: () => { const c = G.clock.communities.find(x => x.key === "gothic"); const Y = G.clock.years, i0 = Y.indexOf(1850); const seg = c.series.slice(i0); const pk = seg.indexOf(Math.max(...seg)); return `Gothic after 1850: ${fmt(c.series[i0], 1)} mentions per billion words in 1850, peaking at ${fmt(seg[pk], 1)} in ${Y[i0 + pk]}, then ${fmt(c.series[c.series.length - 1], 1)} by ${Y[Y.length - 1]}.`; } },
    ],
    influence: [
      { f: {}, lit: "i-graph", t: () => `${INF.authors.length} authors, ${INF.documented.length} documented influences between them. Size is how many arrows touch a writer.` },
      { f: { author: "Herman Melville" }, lit: "i-ego", t: () => { const into = INF.documented.filter(d => d.to === "Herman Melville").sort((a, b) => b.conceptual - a.conceptual); return `Melville's lineage: ${into.map(d => d.from.split(" ").pop()).join(", ")}. Closest in ideas: ${into[0].from} at ${fmt(into[0].conceptual, 2)}.`; } },
      { f: {}, path: ["Plato", "Arthur Conan Doyle"], lit: "i-graph", t: () => `From Plato to Conan Doyle in documented influence: ${pathText("Plato", "Arthur Conan Doyle")}.` },
      { f: {}, infColor: "community", lit: "i-graph", t: () => `Coloured by community instead of form, the network splits into ${new Set(GR.influence.community).size} circles (modularity ${GR.influence.modularity}). Philosophers and novelists mix inside them.` },
      { f: {}, lit: "i-valid", t: () => `Do documented influences leave a trace in the text? In ideas, strongly (z ${fmt(INF.validation.known.conceptual.z, 1)}). In prose style, barely (z ${fmt(INF.validation.known.stylistic.z, 1)}). Influence shows up in ideas far more than in style.` },
      { f: {}, lit: "i-pairs", t: () => `Every documented pair on one plot: mean conceptual similarity ${fmt(INF.validation.known.conceptual.real_mean, 2)}, mean stylistic ${fmt(INF.validation.known.stylistic.real_mean, 2)}.` },
    ],
    atlas: [
      { f: {}, lit: "a-graph", t: () => `${works.length} novels, ${new Set(works.map(w => w.author)).size} novelists, ${G.genres.length} genres and ${INF.documented.length} influence links in one model.` },
      { f: { author: "Herman Melville" }, lit: "a-graph", t: () => { const ws = works.filter(w => w.author === "Herman Melville"); return `Melville: ${ws.length} novels, ${new Set(ws.map(w => w.genre)).size} genres, ${INF.documented.filter(d => d.from === "Herman Melville" || d.to === "Herman Melville").length} influence links. Tap any novel to open its arc.`; } },
      { f: { genre: "Detective fiction" }, lit: "a-graph", t: () => { const ws = works.filter(w => genreName(w.genre) === "Detective fiction"); return `Detective fiction: ${ws.length} novels by ${new Set(ws.map(w => w.author)).size} authors, with the writers who shaped them.`; } },
    ],
    prose: [
      { f: { author: "Herman Melville" }, lit: "p-nn", t: () => { const i = PR.authors.indexOf("Herman Melville"); const nn = PR.stylistic[i].map((v, j) => [PR.authors[j], v]).filter(x => x[0] !== "Herman Melville" && x[1] != null).sort((a, b) => b[1] - a[1]); return `By distinctive vocabulary, Melville's nearest writer is ${nn[0][0]} (${fmt(nn[0][1])}), then ${nn[1][0]} and ${nn[2][0]}.`; } },
      { f: {}, lit: "p-graph", t: () => `Draw only the closest ${S.top}% of pairs and ${new Set(GR.prose.stylistic).size} prose communities appear. The philosophers find each other: Kant's closest in his community are ${commOf(GR.prose.stylistic, "Immanuel Kant").slice(0, 5).map(a => a.split(" ").pop()).join(", ")}.` },
      { f: { author: "Herman Melville" }, lit: "p-graph", t: () => `Melville's prose circle, closest first: ${commOf(GR.prose.stylistic, "Herman Melville").slice(0, 6).map(a => a.split(" ").pop()).join(", ")}.` },
      { f: {}, lit: "p-bpc", t: () => `Train a small GPT on one author and make it read another. McCarthy's model reads McCarthy at ${fmt(PR.persona.cross_bpc.mccarthy.mccarthy, 2)} bits/char and Shakespeare at ${fmt(PR.persona.cross_bpc.mccarthy.shakespeare, 2)}: the farthest pair.` },
      { f: {}, lit: "p-bpc", t: () => `Melville sits between them: his model reads Shakespeare at ${fmt(PR.persona.cross_bpc.melville.shakespeare, 2)}, closer than it reads McCarthy (${fmt(PR.persona.cross_bpc.melville.mccarthy, 2)}).` },
      { f: { author: "Cormac McCarthy" }, lit: "p-map", t: () => `On the stylometric map, each model's generated text lands among its author's books. McCarthy's sample is nearest to "${PR.persona.nearest_book["model:mccarthy"].split(": ")[1]}".` },
      { f: {}, lit: "p-tells", t: () => `The tells that do it: McCarthy over-uses "${PR.persona.tells.mccarthy.over.slice(0, 4).join('", "')}"; Shakespeare "${PR.persona.tells.shakespeare.over.slice(0, 4).join('", "')}".` },
    ],
  };
  let story = null;
  function showStep() {
    const steps = STORIES[S.page]; const st = steps[story];
    S.f = { author: "", work: "", genre: "", from: "", to: "", ...st.f }; S.hl = st.hl || []; S.shape = ""; S.lit = st.lit; S.path = st.path || null; S.cohort = st.cohort || null; S.infColor = st.infColor || "form";
    refresh();
    $("#story-step").textContent = `Story · ${PAGES.find(p => p.id === S.page).name}`;
    $("#story-text").textContent = st.t();
    $("#story-count").textContent = `${story + 1} of ${steps.length}`;
    requestAnimationFrame(() => document.documentElement.style.setProperty("--card", $("#storybar").offsetHeight + "px"));
    $("#story-prog").style.width = `${((story + 1) / steps.length) * 100}%`;
    document.body.classList.add("story-on");
    $("#story-back").disabled = story === 0;
    $("#story-next").textContent = story === steps.length - 1 ? "Done" : "Next";
    document.getElementById("t-" + st.lit)?.scrollIntoView({ behavior: "smooth", block: PHONE() ? "start" : "center" });
  }
  function stopStory() { story = null; S.lit = null; $("#storybar").hidden = true; document.body.classList.remove("story-on"); document.querySelectorAll(".tile.lit").forEach(t => t.classList.remove("lit")); }
  $("#story").onclick = () => { story = 0; $("#storybar").hidden = false; showStep(); };
  $("#story-next").onclick = () => { if (story >= STORIES[S.page].length - 1) { stopStory(); return; } story++; showStep(); };
  $("#story-back").onclick = () => { if (story > 0) { story--; showStep(); } };
  $("#story-close").onclick = stopStory;

  // ------------------------------------------------------------------ ask
  function clean(spec) {
    const ok = (v, list) => (v && list.includes(v) ? v : "");
    const f = spec.filters || {};
    const dec = v => (v && DECADES.includes(Math.floor(+v / 10) * 10) ? String(Math.floor(+v / 10) * 10) : "");
    return {
      page: QA.PAGES.includes(spec.page) ? spec.page : "genres", focus: spec.focus || null,
      filters: { author: ok(f.author, authorsAll), work: ok(f.work, works.map(w => w.title)), genre: ok(f.genre, G.genres.map(g => g.name)), from: dec(f.from), to: dec(f.to) },
      highlight: (spec.highlight || []).filter(h => authorsAll.includes(h) || G.clock.communities.some(c => c.name === h) || G.genres.some(g => g.name === h)),
      answer: spec.answer || "", source: spec.source || "local",
      path: Array.isArray(spec.path) && spec.path.length === 2 && spec.path.every(a => INF.authors.some(x => x.name === a)) && spec.path[0] !== spec.path[1] ? spec.path : null,
      cohort: spec.cohort && INF.authors.some(x => x.name === spec.cohort.author) && ["heirs", "influences"].includes(spec.cohort.rel) ? { rel: spec.cohort.rel, author: spec.cohort.author } : null,
      color: spec.color === "community" ? "community" : null,
      top: Number.isInteger(spec.top) && spec.top >= 1 && spec.top <= 15 ? spec.top : null,
    };
  }
  function apply(spec) {
    stopStory();
    S.page = spec.page; S.f = { ...spec.filters }; S.hl = spec.highlight; S.shape = ""; S.lit = spec.focus;
    S.path = spec.path; S.cohort = spec.cohort; S.infColor = spec.color || "form"; if (spec.top) S.top = spec.top;
    render(lastPage !== S.page);
    const read = QA.readout(spec, D);
    const a = $("#answer"); a.hidden = false;
    a.innerHTML = `<p>${spec.answer ? esc(spec.answer) + "<br>" : ""}<b>${esc(read)}</b></p><span class="src">${spec.source === "claude" ? "Claude, over this data" : "Parsed locally"}</span><button aria-label="Dismiss answer">✕</button>`;
    a.querySelector("button").onclick = () => { a.hidden = true; S.lit = null; refresh(); };
    if (spec.focus) setTimeout(() => document.getElementById("t-" + spec.focus)?.scrollIntoView({ behavior: "smooth", block: PHONE() ? "start" : "center" }), 150);
  }
  async function ask(q) {
    q = (q || "").trim(); if (!q) return;
    const a = $("#answer"); a.hidden = false; a.innerHTML = `<p class="note">Reading the data…</p>`;
    let spec = null;
    try {
      const r = await fetch("api/ask", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ q }) });
      if (r.ok) { const j = await r.json(); if (j && j.spec) spec = { ...j.spec, source: "claude" }; }
    } catch (e) {}
    if (!spec) spec = QA.localAsk(q, D);
    apply(clean(spec));
  }
  $("#ask").onsubmit = e => { e.preventDefault(); ask($("#askq").value); };

  READY = true;
  render();
})();
