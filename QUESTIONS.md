# Questions people bring, and the tool that answers each

Per `~/.claude/CLAUDE.md`, *Every question theme gets a tool* (2026-11-22). Counts are PostHog
`mcp_tool_call`, `site = classic-literature`, all time to 2026-11-22. The volume is small (40
calls) and includes the directory filing's own test runs, so it ranks themes rather than proving
demand. Themes with no call on record are marked **inferred**: they come from what a reader asks a
chatbot about classic books, not from our logs.

## From the logs

| theme | user's words | calls | tool |
|---|---|---|---|
| an author's influences | "who influenced Emerson", "who did Poe influence" | 9 | `author_influences` |
| who writes like X | "authors like Melville", "who sounds like Nietzsche" | 7 | `writers_who_sound_like` |
| what genre is this book | "what genre is Dracula" | 7 | `genre_of_book` |
| how two authors connect | "how is Plato connected to Joyce" | 7 | `influence_chain` |
| a novel's emotional arc | "the emotional arc of Moby-Dick" | 7 | `novel_mood_arc` |
| when a genre began | "when did detective fiction start" | 3 | `genre_history` |

Unknown tool names were logged only as `unknown` until 2026-11-22. **Now logged:** `attempted`, the
tool name a caller reached for (letters, digits, `_.-` only, 60 characters). Read it before the next
pass: it is the cheapest list of missing doors there is.

## Inferred themes, each with a door (shipped 2026-11-22)

| theme | user's words | tool | engine |
|---|---|---|---|
| what to read next | "books like Dracula", "if I loved Jane Eyre" | `books_like` | genre_of_book peers + novel_mood_arc neighbours |
| happy or sad ending | "does Great Expectations end happily", "is Tess sad" | `does_book_have_a_happy_ending` | novel_mood_arc, one-line verdict first |
| saddest / happiest | "the saddest classic novel", "happiest Victorian endings" | `saddest_and_happiest_novels` | sentiment arcs ranked by mean, ending or change |
| an author's books | "what did Dickens write" | `novels_by_author` | genre_of_book by author |
| books from a period | "novels from the 1840s", "sea stories 1850-1900" | `classic_novels_from_era` | the corpus filtered by year and prose genre |
| did X influence Y | "did Poe influence Conan Doyle" | `did_author_influence` | influence_chain, yes/no first |
| the genre map | "what genres are there" | `what_genres_are_there` | genre_history, empty |

## Gaps left, and why

| theme | user's words | why not yet |
|---|---|---|
| plot, characters, summary | "what happens in Middlemarch", "who is Heathcliff" | the user's own model answers this; we hold measurements, not summaries |
| quotes and passages | "famous lines from Moby-Dick" | full texts are behind the data build, not served; a passage tool would need a text index on the server |
| a book outside the corpus | "books like Harry Potter" | 343 pre-1929 novels by design; the tools say so and name the closest |
| Gothic as a prose genre | "Gothic novels before 1820" | Gothic is tracked as a name in print but the prose doesn't separate it into its own cluster; the tool says so |
| reading level, length | "how long is War and Peace" | word counts exist for scored novels (`words_scored`) but no door ranks by length yet |
