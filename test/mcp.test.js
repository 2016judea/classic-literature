// The MCP server: protocol, every tool on a real example, not-found and ambiguous names, links.
process.env.CL_NO_ANALYTICS = "1";
const test = require("node:test");
const assert = require("node:assert");
const mcp = require("../api/mcp.js");
const SEN = require("../site/data/sentiment.json");
const G = require("../site/data/genres.json");
const INF = require("../site/data/influence.json");
const PR = require("../site/data/prose.json");

const rpc = async (method, params, id = 1) => (await mcp.handleOne({ jsonrpc: "2.0", id, method, params }, { test: true })).result;
const call = async (name, args) => { const r = await rpc("tools/call", { name, arguments: args }); return { ...r, out: JSON.parse(r.content[0].text) }; };
const links = (o, acc = []) => { if (typeof o === "string" && o.startsWith("http")) acc.push(o); else if (o && typeof o === "object") Object.values(o).forEach(v => links(v, acc)); return acc; };

test("initialize names the server and carries instructions", async () => {
  const r = await rpc("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "test", version: "0" } });
  assert.strictEqual(r.serverInfo.name, "classic-literature");
  assert.strictEqual(r.protocolVersion, "2025-06-18");
  assert.ok(r.capabilities.tools);
  assert.match(r.instructions, /found: false/);
});

test("tools/list: six read-only tools with schemas", async () => {
  const { tools } = await rpc("tools/list", {});
  assert.deepStrictEqual(tools.map(t => t.name), ["novel_mood_arc", "writers_who_sound_like", "influence_chain", "author_influences", "genre_of_book", "genre_history"]);
  for (const t of tools) {
    assert.strictEqual(t.annotations.readOnlyHint, true, t.name);
    assert.strictEqual(t.inputSchema.type, "object", t.name);
    assert.ok(t.description.length > 80, t.name);
  }
});

test("annotations: all four hints are explicit booleans, every tool read-only", async () => {
  const { tools } = await rpc("tools/list", {});
  for (const t of tools) {
    for (const h of ["readOnlyHint", "destructiveHint", "openWorldHint", "idempotentHint"]) assert.strictEqual(typeof t.annotations[h], "boolean", `${t.name}.${h}`);
    assert.strictEqual(t.annotations.readOnlyHint, true, t.name);
    assert.strictEqual(t.annotations.destructiveHint, false, t.name);
    assert.ok(t.annotations.title, t.name);
  }
});

test("tool descriptions describe the tool, not how the model should behave", async () => {
  const { tools } = await rpc("tools/list", {});
  for (const t of tools) assert.doesNotMatch(t.description, /\b(never|always|do not|don't|you must|make sure|be sure|quote|tell the user|ask the user)\b/i, t.name);
});

test("novel_mood_arc: Moby-Dick, numbers straight from sentiment.json", async () => {
  const { out, isError } = await call("novel_mood_arc", { title: "moby dick" });
  assert.ok(!isError);
  const w = G.works.find(x => x.title === "Moby-Dick"), a = SEN.arcs.find(x => x.work === w.id);
  assert.strictEqual(out.novel.title, "Moby-Dick");
  assert.strictEqual(out.shape, a.shape);
  assert.strictEqual(out.start, a.start);
  assert.strictEqual(out.end, a.end);
  assert.strictEqual(out.emotional_range, a.range);
  assert.strictEqual(out.sharpest_turn_at_pct, a.turn);
  assert.strictEqual(out.arc_every_10pct["50%"], a.smooth[50]);
  assert.strictEqual(out.novels_whose_arcs_move_most_alike.length, 5);
  assert.ok(out.novels_whose_arcs_move_most_alike.every((n, i, l) => !i || l[i - 1].r >= n.r));
  assert.match(out.change_rank, / of 339 /);
  assert.match(out.open_on_site, /src=mcp#p=sentiment&work=Moby-Dick$/);
});

test("novel_mood_arc: 'Title by Author' and an unscored novel", async () => {
  assert.strictEqual((await call("novel_mood_arc", { title: "Pride and Prejudice by Jane Austen" })).out.novel.author, "Jane Austen");
  const { out } = await call("novel_mood_arc", { title: "The Waste Land" });
  assert.strictEqual(out.found, true);
  assert.strictEqual(out.scored, false);
});

test("not found: says so and lists the closest titles", async () => {
  const { out, isError } = await call("novel_mood_arc", { title: "Harry Potter" });
  assert.ok(!isError);
  assert.strictEqual(out.found, false);
  assert.ok(out.closest_matches.length > 0);
  assert.match(out.answer, /No novel in this corpus matching "Harry Potter"/);
});

test("ambiguous: 'Bronte' asks which one", async () => {
  const { out } = await call("genre_of_book", { author: "Bronte" });
  assert.strictEqual(out.found, false);
  assert.deepStrictEqual([...out.did_you_mean].sort(), ["Anne Brontë", "Charlotte Brontë", "Emily Brontë"]);
});

test("writers_who_sound_like: Melville by vocabulary, by ideas, and his character GPT", async () => {
  const { out } = await call("writers_who_sound_like", { author: "Melville", limit: 5 });
  const i = PR.authors.indexOf("Herman Melville");
  const best = PR.stylistic[i].map((v, j) => [j, v]).filter(([j, v]) => j !== i && v != null).sort((x, y) => y[1] - x[1])[0];
  assert.strictEqual(out.writer, "Herman Melville");
  assert.strictEqual(out.closest_by_vocabulary.length, 5);
  assert.strictEqual(out.closest_by_vocabulary[0].writer, PR.authors[best[0]]);
  assert.strictEqual(out.closest_by_vocabulary[0].similarity, best[1]);
  assert.strictEqual(out.closest_by_ideas.length, 5);
  assert.strictEqual(out.character_gpt.reads_its_own_author, PR.persona.cross_bpc.melville.melville);
  assert.match(out.open_on_site, /src=mcp#p=prose&author=Herman\+Melville$/);
});

test("writers_who_sound_like: McCarthy has only the character GPT; Twain points elsewhere", async () => {
  const mc = (await call("writers_who_sound_like", { author: "Cormac McCarthy" })).out;
  assert.strictEqual(mc.found, true);
  assert.strictEqual(mc.closest_by_vocabulary, undefined);
  assert.strictEqual(mc.character_gpt.reads_others[0].bits_per_char, PR.persona.cross_bpc.mccarthy.melville);
  const tw = (await call("writers_who_sound_like", { author: "Mark Twain" })).out;
  assert.strictEqual(tw.found, false);
  assert.match(tw.note, /genre_of_book/);
});

test("influence_chain: Plato to James Joyce, every link documented", async () => {
  const { out } = await call("influence_chain", { from_author: "Plato", to_author: "joyce" });
  assert.strictEqual(out.chain[0], "Plato");
  assert.strictEqual(out.chain[out.chain.length - 1], "James Joyce");
  assert.strictEqual(out.links, out.chain.length - 1);
  for (const l of out.each_link) assert.ok(INF.documented.some(d => d.from === l.influence && d.to === l.influenced && d.conceptual === l.conceptual_similarity));
  assert.match(out.open_on_site, /chain=Plato%7CJames\+Joyce$/);
});

test("author_influences: Emerson in and out, from influence.json", async () => {
  const { out } = await call("author_influences", { author: "Emerson" });
  assert.strictEqual(out.author, "Ralph Waldo Emerson");
  assert.strictEqual(out.influenced_by.length, INF.documented.filter(d => d.to === "Ralph Waldo Emerson").length);
  assert.strictEqual(out.influenced.length, INF.documented.filter(d => d.from === "Ralph Waldo Emerson").length);
  assert.ok(out.influenced_by.every((n, i, l) => !i || l[i - 1].conceptual_similarity >= n.conceptual_similarity));
  const nf = (await call("author_influences", { author: "Zzyzx Qwerty" })).out;
  assert.strictEqual(nf.found, false);
});

test("genre_of_book: The Sign of Four is detective fiction, with its name clock", async () => {
  const { out } = await call("genre_of_book", { title: "Sign of Four" });
  assert.strictEqual(out.genre.name, "Detective fiction");
  const c = G.clock.communities.find(x => x.key === "detective");
  assert.strictEqual(out.when_the_genres_name_caught_on.reached_10pct_of_its_mentions_by, c.takeoff_10pct);
  assert.ok(!out.nearest_in_time_same_genre.some(w => /Sign of (the )?Four/.test(w.title)), "the same book twice");
});

test("genre_history: Gothic has a clock and no cluster; mystery leads to detective; empty lists all", async () => {
  const go = (await call("genre_history", { genre: "gothic novel" })).out;
  assert.strictEqual(go.recovered_from_prose, null);
  assert.strictEqual(go.when_the_name_caught_on.peak_year, G.clock.communities.find(x => x.key === "gothic").peak_year);
  const my = (await call("genre_history", { genre: "mystery" })).out;
  assert.strictEqual(my.genre, "Detective fiction");
  assert.strictEqual(my.detective_vs_mystery.answer, G.term_split.settled);
  const all = (await call("genre_history", {})).out;
  assert.strictEqual(all.genres_recovered_from_prose.length, G.genres.length);
  const sf = (await call("genre_history", { genre: "science fiction" })).out;
  assert.strictEqual(sf.found, false);
});

test("every link handed out points at the site and carries src=mcp", async () => {
  const cases = [["novel_mood_arc", { title: "Emma" }], ["writers_who_sound_like", { author: "Kant" }], ["influence_chain", { from_author: "Homer", to_author: "Virginia Woolf" }], ["author_influences", { author: "Plato" }], ["genre_of_book", { author: "Jane Austen" }], ["genre_history", { genre: "western" }], ["novel_mood_arc", { title: "Les Miserables" }]];
  for (const [n, a] of cases) {
    const ls = links((await call(n, a)).out);
    assert.ok(ls.length, n);
    for (const l of ls) assert.ok(l.startsWith(mcp.SITE + "/?src=mcp#"), `${n}: ${l}`);
  }
});

test("bad calls are errors, not crashes", async () => {
  assert.strictEqual((await call("novel_mood_arc", {})).isError, true);
  assert.strictEqual((await call("no_such_tool", {})).isError, true);
  const r = await mcp.handleOne({ jsonrpc: "2.0", id: 9, method: "nope" }, { test: true });
  assert.strictEqual(r.error.code, -32601);
  assert.strictEqual(await mcp.handleOne({ jsonrpc: "2.0", method: "notifications/initialized" }, { test: true }), null);
});

test("HTTP: POST answers JSON-RPC, GET is 405 with the URL", async () => {
  const run = (method, body) => new Promise(resolve => {
    const res = { statusCode: 200, headers: {}, setHeader(k, v) { this.headers[k] = v; }, end(b) { resolve({ status: this.statusCode, headers: this.headers, body: b ? JSON.parse(b) : null }); } };
    mcp(Object.assign({ method, headers: { "x-cl-test": "1" }, body }), res);
  });
  const post = await run("POST", { jsonrpc: "2.0", id: 1, method: "tools/list" });
  assert.strictEqual(post.status, 200);
  assert.strictEqual(post.body.result.tools.length, 6);
  const get = await run("GET");
  assert.strictEqual(get.status, 405);
  assert.match(get.body.url, /\/api\/mcp$/);
});

test("/connect/ lists every tool and states counts that match the data", () => {
  const html = require("fs").readFileSync(require("path").join(__dirname, "..", "site", "connect", "index.html"), "utf8");
  for (const t of mcp.TOOLS) assert.ok(html.includes(`<code>${t.name}</code>`), t.name);
  const ys = SEN.arcs.map(a => G.works[a.work].year);
  assert.ok(html.includes(`${SEN.arcs.length} novels, ${Math.min(...ys)} to ${Math.max(...ys)}`));
  assert.ok(html.includes(`out of ${PR.authors.length} from Homer`));
  assert.ok(html.includes(mcp.SITE + "/api/mcp"));
});
