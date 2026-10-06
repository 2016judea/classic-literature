/* Example questions under the Ask bar. Each one is run through the local parser by
 * test/chips.test.js and must land on a non-empty answer. */
window.CHIPS = [
  { q: "Do detective novels end darker than they begin?", f: "sentiment" },
  { q: "Does Moby-Dick end happier than it starts?", f: "sentiment" },
  { q: "Which novels have an arc shaped like Great Expectations?", f: "sentiment" },
  { q: "How did Gothic fiction's name change after 1850?", f: "genres" },
  { q: "Is there a real rate at which genres mutate?", f: "genres" },
  { q: "Which authors cross more than one genre?", f: "genres" },
  { q: "Who influenced Herman Melville?", f: "influence" },
  { q: "How do you get from Plato to Conan Doyle?", f: "influence" },
  { q: "What circles form in the influence network?", f: "influence" },
  { q: "Whose prose is closest to Melville?", f: "prose" },
  { q: "Which writers cluster together by prose style?", f: "prose" },
  { q: "Which character GPT finds Shakespeare hardest to read?", f: "prose" },
  { q: "Show the atlas of detective fiction", f: "atlas" },
  { q: "Do the writers Poe influenced end their novels darker?", f: "cross", p: "sentiment" },
  { q: "Do the writers Hawthorne influenced end their novels darker?", f: "cross", p: "sentiment" },
  { q: "Who links Homer to Virginia Woolf?", f: "cross", p: "influence" },
];
