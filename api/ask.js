// POST /api/ask {q} -> {spec}
// Claude reads the question plus a compact block of the site's own data and returns a VIEW over
// that data (page, visual, filters, highlight) and a one- or two-sentence answer. The page renders
// the view with its own charts and prints figures computed from its JSON under the sentence.
// With no ANTHROPIC_API_KEY set this returns 503 and the page answers with its local parser.
const Anthropic = require("@anthropic-ai/sdk");
const CTX = require("./_context.json");

const MODEL = "claude-sonnet-5-5";
const MAX_TOKENS = 700;
const PER_IP = { n: 8, windowMs: 10 * 60 * 1000 };
const PER_INSTANCE_DAY = 300;

const VISUALS = {
  sentiment: ["s-arc", "s-shape", "s-mom", "s-scatter", "s-table"],
  genres: ["g-bands", "g-terms", "g-density", "g-events", "g-null", "g-clock"],
  influence: ["i-graph", "i-ego", "i-valid", "i-pairs"],
  prose: ["p-nn", "p-heat", "p-bpc", "p-map", "p-tells"],
};
const ALL_VISUALS = Object.values(VISUALS).flat();
const nullable = t => ({ anyOf: [{ type: t }, { type: "null" }] });
const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["answer", "page", "focus", "filters", "highlight", "cannot_answer"],
  properties: {
    answer: { type: "string" },
    page: { type: "string", enum: Object.keys(VISUALS) },
    focus: { type: "string", enum: ALL_VISUALS },
    filters: {
      type: "object", additionalProperties: false, required: ["author", "work", "genre", "from", "to"],
      properties: { author: nullable("string"), work: nullable("string"), genre: nullable("string"), from: nullable("integer"), to: nullable("integer") },
    },
    highlight: { type: "array", items: { type: "string" } },
    cannot_answer: { type: "boolean" },
  },
};

const SYSTEM = `You answer questions about a classic-literature analytics site by choosing a VIEW of its data. You never invent data.

Pages and visuals:
- sentiment: s-arc (sentiment arc across a novel; set filters.work to show one novel), s-shape (counts of arc shapes), s-mom (momentum: slope of the arc), s-scatter (start vs end sentiment per novel), s-table (novels list)
- genres: g-bands (when each of 8 prose-recovered genres lives), g-terms (a genre's distinctive words), g-density (novels per decade by genre), g-events (genre births/splits/merges), g-null (mutation-rate null model), g-clock (Google Books frequency of a genre's NAME over time; put the clock name in highlight)
- influence: i-graph (network of documented influences), i-ego (who influenced / was influenced by filters.author), i-valid (does influence show in text), i-pairs (prose vs idea similarity for each documented pair)
- prose: p-nn (nearest writers to filters.author by prose), p-heat (all-pairs similarity), p-bpc (character GPTs for McCarthy, Melville, Shakespeare reading each other), p-map (stylometric map of those three), p-tells (their over/under-used words)

Filters: author, work and genre must be copied EXACTLY from the data block's names (genre is one of the 8 GENRES; clock names go in highlight, not genre). from/to are decades (e.g. 1850). Use null for anything not asked.

Answer: one or two plain sentences, at most 45 words. Only state a number if it appears verbatim in the data block; the interface prints computed figures under your sentence, so you rarely need numbers. If the data cannot answer (an author, work or topic not present), set cannot_answer true, say what the data does cover, and pick the nearest useful view.

DATA BLOCK
${CTX.context}`;

const hits = new Map();
let day = { d: new Date().toISOString().slice(0, 10), n: 0 };

function limited(ip) {
  const now = Date.now();
  const arr = (hits.get(ip) || []).filter(t => now - t < PER_IP.windowMs);
  if (arr.length >= PER_IP.n) return true;
  arr.push(now); hits.set(ip, arr);
  const today = new Date().toISOString().slice(0, 10);
  if (day.d !== today) day = { d: today, n: 0 };
  if (++day.n > PER_INSTANCE_DAY) return true;
  return false;
}

// Numbers the model may quote: every number that appears in the data block.
const CTX_NUMS = new Set((CTX.context.match(/-?\d+(?:\.\d+)?/g) || []).map(x => String(+x)));
function numbersAreSourced(sentence) {
  const nums = sentence.replace(/(\d),(\d{3})/g, "$1$2").match(/-?\d+(?:\.\d+)?/g) || [];
  return nums.every(n => CTX_NUMS.has(String(+n)) || CTX_NUMS.has(String(+(+n).toFixed(3))));
}

function validate(raw) {
  const pick = (v, list) => (typeof v === "string" && list.includes(v) ? v : null);
  const dec = v => (Number.isInteger(v) && v >= 1660 && v <= 1960 ? Math.floor(v / 10) * 10 : null);
  const page = VISUALS[raw.page] ? raw.page : "genres";
  const focus = VISUALS[page].includes(raw.focus) ? raw.focus : VISUALS[page][0];
  const f = raw.filters || {};
  const filters = { author: pick(f.author, CTX.authors), work: pick(f.work, CTX.works), genre: pick(f.genre, CTX.genres), from: dec(f.from), to: dec(f.to) };
  const highlight = (Array.isArray(raw.highlight) ? raw.highlight : []).filter(h => CTX.clock.includes(h) || CTX.authors.includes(h) || CTX.genres.includes(h)).slice(0, 4);
  // Drop any sentence that states a number the data block does not contain.
  const sentences = String(raw.answer || "").slice(0, 400).split(/(?<=[.!?])\s+/);
  const kept = sentences.filter(numbersAreSourced);
  const answer = kept.join(" ");
  return { page, focus, filters, highlight, answer, cannot_answer: !!raw.cannot_answer, dropped: sentences.length - kept.length };
}

module.exports = async function handler(req, res) {
  if (req.method !== "POST") { res.status(405).json({ error: "POST only" }); return; }
  if (!process.env.ANTHROPIC_API_KEY) { res.status(503).json({ error: "ask is running on the local parser" }); return; }
  const ip = String(req.headers["x-forwarded-for"] || "").split(",")[0].trim() || "unknown";
  if (limited(ip)) { res.status(429).json({ error: "too many questions, try again in a few minutes" }); return; }
  let body = req.body;
  if (typeof body === "string") { try { body = JSON.parse(body); } catch { body = {}; } }
  const q = String((body && body.q) || "").trim().slice(0, 300);
  if (!q) { res.status(400).json({ error: "empty question" }); return; }

  const client = new Anthropic();
  try {
    const msg = await client.messages.create({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      system: [{ type: "text", text: SYSTEM, cache_control: { type: "ephemeral" } }],
      output_config: { effort: "low", format: { type: "json_schema", schema: SCHEMA } },
      messages: [{ role: "user", content: q }],
    });
    if (msg.stop_reason !== "end_turn") { res.status(502).json({ error: "no view: " + msg.stop_reason }); return; }
    const text = msg.content.filter(b => b.type === "text").map(b => b.text).join("");
    const spec = validate(JSON.parse(text));
    res.status(200).json({ spec, usage: { in: msg.usage.input_tokens, cached: msg.usage.cache_read_input_tokens, out: msg.usage.output_tokens } });
  } catch (err) {
    const status = err instanceof Anthropic.RateLimitError ? 429 : err instanceof Anthropic.APIError ? 502 : 500;
    res.status(status).json({ error: "ask failed" });
  }
};

module.exports.validate = validate;
module.exports.SYSTEM = SYSTEM;
module.exports.SCHEMA = SCHEMA;
