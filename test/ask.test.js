const test = require("node:test");
const assert = require("node:assert");
const { validate } = require("../api/ask.js");

test("unknown names and out-of-range decades are dropped", () => {
  const v = validate({ page: "influence", focus: "i-ego", filters: { author: "Herman Melville", work: "Not A Book", genre: "Space opera", from: 1850, to: 2500 }, highlight: ["Nobody"], answer: "x", cannot_answer: false });
  assert.deepStrictEqual(v.filters, { author: "Herman Melville", work: null, genre: null, from: 1850, to: null });
  assert.deepStrictEqual(v.highlight, []);
});

test("focus must belong to the page", () => {
  assert.strictEqual(validate({ page: "prose", focus: "g-clock", filters: {}, highlight: [], answer: "" }).focus, "p-nn");
});

test("a sentence with a number not in the data is removed", () => {
  const v = validate({ page: "genres", focus: "g-null", filters: {}, highlight: [], answer: "There were 88 mutation events. That is 41.7% fewer than you'd think." });
  assert.strictEqual(v.answer, "There were 88 mutation events.");
  assert.strictEqual(v.dropped, 1);
});
