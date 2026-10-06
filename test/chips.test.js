// Every example chip must resolve, on the free local parser, to a page and a non-empty readout.
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const SITE = path.join(__dirname, "..", "site");
const load = n => JSON.parse(fs.readFileSync(path.join(SITE, "data", n + ".json"), "utf8"));
const ctx = { window: {} };
vm.createContext(ctx);
for (const f of ["ask-local.js", "chips.js"]) vm.runInContext(fs.readFileSync(path.join(SITE, f), "utf8"), ctx);
const { QA, CHIPS } = ctx.window;

// The same D the page builds in app.js.
const G = load("genres"), SEN = load("sentiment"), INF = load("influence"), PR = load("prose"), GR = load("graphs");
const works = G.works; const arc = new Map(SEN.arcs.map(a => [a.work, a])); works.forEach(w => (w.arc = arc.get(w.id) || null));
const genreName = i => (i == null ? "Unassigned" : G.genres[i].name);
const authorsAll = [...new Set([...works.map(w => w.author), ...INF.authors.map(a => a.name), "Cormac McCarthy", "William Shakespeare", "Herman Melville"])];
const filterWorks = f => works.filter(w => (!f.author || w.author === f.author) && (!f.genre || genreName(w.genre) === f.genre) && (!f.from || w.year >= +f.from) && (!f.to || w.year <= +f.to + 9));
function findPath(a, b) {
  const nb = new Map(); INF.documented.forEach(d => { for (const [x, y] of [[d.from, d.to], [d.to, d.from]]) { if (!nb.has(x)) nb.set(x, []); nb.get(x).push([y, d]); } });
  const prev = new Map([[a, null]]); const q = [a];
  while (q.length) { const x = q.shift(); if (x === b) break; for (const [y, d] of nb.get(x) || []) if (!prev.has(y)) { prev.set(y, [x, d]); q.push(y); } }
  if (!prev.has(b) || a === b) return null;
  const nodes = [b], edges = []; let cur = b; while (prev.get(cur)) { const [x, d] = prev.get(cur); edges.unshift(d); nodes.unshift(x); cur = x; }
  return { nodes, edges };
}
const cohortWorks = c => { const s = new Set(INF.documented.filter(d => (c.rel === "heirs" ? d.from === c.author : d.to === c.author)).map(d => (c.rel === "heirs" ? d.to : d.from))); return works.filter(w => s.has(w.author)); };
const D = { works, authorsAll, genres: G, influence: INF, prose: PR, graphs: GR, sentiment: SEN, filterWorks, findPath, cohortWorks };

const EMPTY = /no scored|not one of|no chain|none of the|no data|^\s*$/i;
test(`between 10 and 20 chips (${CHIPS.length})`, () => assert.ok(CHIPS.length >= 10 && CHIPS.length <= 20));
for (const c of CHIPS) {
  test(c.q, () => {
    const spec = QA.localAsk(c.q, D);
    const out = QA.readout(spec, D);
    assert.ok(QA.PAGES.includes(spec.page), "page " + spec.page);
    assert.ok(out && !EMPTY.test(out), `empty readout: ${out}`);
    assert.strictEqual(spec.page, c.p || c.f, `routed to ${spec.page}/${spec.focus}: ${out}`);
    console.log(`  ${spec.page}/${spec.focus} :: ${out}`);
  });
}
