# Message search

Status: decided 2026-09-04 (STOOP-87). This file is the text of a design
page with wireframes that lives in the maintainer's private tooling; the
reasoning is all here, and the decisions are at the end.

Find a message by the words in it, inside one space, without adding a
service and without a query whose cost grows with the archive.

Stoop stores messages in one Postgres table with a plain `content`
column. Today the only way to find something old is to scroll. This adds
word search on top of Postgres 16's built-in full-text machinery, keeps
every query bounded by a scope the caller can already read, and records
the handful of choices that decide whether search stays cheap.

## Decisions at a glance

| | |
| --- | --- |
| Engine | Postgres full-text search. No sidecar, no second index to back up or rebuild. |
| Storage | A new generated `tsvector` column on `messages` plus a GIN index. `content` is untouched. |
| Matching | Whole words and prefixes, case-insensitive, `simple` config. The last term is auto-prefixed once it is three characters long. No stemming, substrings or fuzzy matching. |
| Scope | One space. Never the whole instance. DM search follows in a separate change. |
| Order | Newest first by message id. No relevance ranking. |
| Trigger | Search on Enter. No search-as-you-type. |
| Snippets | None from the server. The client highlights terms in the rendered message. |
| Placement | Option A: a search control in the channel header, results as a route. The least permanent choice. |
| Guards | Per-user rate limit on the RPC and a statement timeout on the query. |

## Why Postgres and not a search engine

`docs/architecture/data.md` promises that Postgres plus the storage
directory is the whole recovery story: no cache to warm, no search index
to rebuild, no queue whose contents matter across a restart. A
Meilisearch or Typesense container would break that promise, add a
service to the compose file, and need a sync path for edits and hard
deletes. Postgres full-text search lives in the same transaction as the
row, so it cannot drift.

| Option | Finds | Cost shape | Verdict |
| --- | --- | --- | --- |
| `ILIKE '%term%'` | Substrings | Scans every message on every query. Grows with the archive. | No. This is the expensive one. |
| `pg_trgm` index | Substrings, typos | Index several times larger; common trigrams produce big recheck sets; queries under 3 chars skip the index. | Later, if substrings prove necessary. Can sit beside the tsvector. |
| `tsvector` + GIN | Words, prefixes, phrases | Index roughly half the text size; query cost tracks the number of matches, not rows. | **Yes.** |
| External engine | Everything, ranked | Another container, another backup, a sync path for edits and deletes. | No. Breaks the data promise. |

## Schema

One migration, expand-only. It adds a column Postgres maintains itself
and an index over it. The application never writes the column.

```sql
-- +goose Up
ALTER TABLE messages
    ADD COLUMN search tsvector
    GENERATED ALWAYS AS (to_tsvector('simple', content)) STORED;

CREATE INDEX messages_search_idx ON messages USING gin (search);

-- +goose Down
DROP INDEX messages_search_idx;
ALTER TABLE messages DROP COLUMN search;
```

- **Edits and deletes need nothing.** An edit recomputes the vector in
  the same UPDATE. Deletes are hard deletes, so nothing stale stays.
- **The ADD COLUMN backfills.** Postgres computes the vector for every
  existing row, which rewrites the table once. Release notes say
  "migration time scales with message count". A million messages is
  seconds.
- **Rollback holds.** Nothing is dropped or renamed, so the previous
  release can be put back and ignores the extra column.

## What the index matches

The `simple` config splits text on whitespace and punctuation,
lowercases each token, and stores it with its position. The message

> Restarted the LiveKit container at 3am, see docker-compose.yml

becomes the lexemes `restarted` `the` `livekit` `container` `at` `3am`
`see` `docker-compose.yml` `docker` `compose.yml`. Hyphenated words are
stored whole and in parts; file names keep their extension. `simple`
keeps stop words like "the", which costs a little index space and avoids
surprising non-English communities.

| Query | Result | Why |
| --- | --- | --- |
| `LiveKit` | Found | Case folds to `livekit`. |
| `restart` | Found | Auto-prefixed to `restart:*`, which matches `restarted`. |
| `"livekit container"` | Found | Phrase: adjacent, in order. |
| `livekit -docker` | Not this one | Negation excludes it; other LiveKit messages still match. |
| `kit` | Not found | Substrings are not indexed. Only prefixes are. |
| `contianer` | Not found | No fuzzy matching. |

**Auto-prefix.** The server appends `:*` to the last bare term once it is
at least three characters, so `restart` behaves like `restart:*`. Earlier
terms and quoted phrases are sent as typed.

- Buys: word variants without stemming, in any language, and half-typed
  words like `live` finding `livekit`. No index cost; a prefix match is a
  range scan the GIN index already supports.
- Costs: a short prefix such as `re:*` is wide, which is what the
  three-character floor prevents; several posting lists merge instead of
  one, which is noise inside a space scope; and only the last term is
  loosened, so `container restart` finds "container restarted" but not
  "containers restart".

## The query

Scope comes first, then the text match, then a recency cursor. The order
matters because the scope is what keeps the candidate set small.

```sql
SELECT m.*
FROM messages m
WHERE m.channel_id IN (SELECT id FROM channels WHERE space_id = @space_id)
  AND m.search @@ (websearch_to_tsquery('simple', @query) && to_tsquery('simple', @prefix))
  AND (@channel_id IS NULL OR m.channel_id = @channel_id)
  AND (@author_id  IS NULL OR m.author_id  = @author_id)
  AND (@before_id  IS NULL OR m.id < @before_id)
ORDER BY m.id DESC
LIMIT @lim;
```

- **Access control reuses what exists.** The caller must be a member of
  the space, the same check ListChannels makes; the channel set is the
  space's own. No new permission concept.
- **Recency, not rank.** Ids already sort by time, which ListMessages
  relies on. Sorting by id lets Postgres stop after the page. `ts_rank`
  would have to score every match first.
- **Cursor paging.** `before_id` is the id of the last result shown. No
  OFFSET, so page ten costs the same as page one.
- **Filters make it cheaper.** `from:@user` becomes the author predicate,
  `in:#channel` narrows to one channel, `before:` and `after:` become
  date bounds. All btree work.
- **Results are ordinary messages.** Rows go through the existing hydrate
  path for authors, attachments, reactions and mentions. Clicking one
  opens the channel with `around_id`, which already exists for reply
  quotes and activity rows.

## Where it gets expensive, and the guard

Text matching against a GIN index is cheap. The cost lives in what
happens to the matches afterwards, and in how often the query runs.

| Hazard | What it costs | Guard |
| --- | --- | --- |
| Relevance ranking | Every match scored before the top 50 can be chosen. | Order by id. Recency is what people expect in chat anyway. |
| Search-as-you-type | Ten queries per search instead of one. | Submit on Enter only. |
| Server snippets | `ts_headline` re-parses each row's text. | None from the server. Client highlights terms in the rendered body. |
| Unbounded scope | A common word across the instance matches tens of thousands of rows: bitmap scan plus a top-N sort. | One space per query, page of 50, cursor paging. |
| Abuse | A script hammering the RPC holds connections. | Per-user limit on the RPC (`STOOP_SEARCH_RATE_LIMIT`, default 30 per minute) and a 2 s `statement_timeout` on the query. |
| Write amplification | One GIN entry per lexeme per message. | Nothing needed. GIN's pending list absorbs chat-rate inserts. |

Each stage narrows the set before the next one touches it: scope
(bounded by the space), GIN lookup (cost proportional to matches, not
rows), top-N by id (stops after the page), hydrate (the same path as
ListMessages). Nothing in the pipeline scales with the total number of
messages on the instance.

Rough sizes, from typical tsvector ratios and a 150-byte average row,
not measurements:

| Messages | Table | GIN index | Rare term | Common term |
| ---: | ---: | ---: | ---: | ---: |
| 100 k | ~15 MB | ~10 MB | <5 ms | ~10 ms |
| 1 M | ~150 MB | ~100 MB | <5 ms | 50 to 200 ms |

## API

One new unary call on ChatService, `SearchMessages`. Scope is a oneof
from the start so the DM change adds a case instead of a field.

```proto
message SearchMessagesRequest {
  oneof scope {
    string space_id = 1;   // every channel in it; caller must be a member
    // bool dms = 2;       reserved for the DM search change
  }
  string query      = 3;   // websearch syntax, plus from:/in:/before:/after:
  string before_id  = 4;   // cursor, empty for the first page
  int32  limit      = 5;   // default 25, max 50
}
message SearchMessagesResponse {
  repeated Message messages = 1;   // newest first
  bool has_older = 2;
}
```

- The server parses `from:`, `in:`, `before:` and `after:` out of the
  query string and passes the remainder to `websearch_to_tsquery`. An
  unknown `in:` channel is `NotFound`, the same as a channel outside the
  space, so ids cannot be probed.
- Empty query after stripping filters is `InvalidArgument`. Query length
  capped at 200 characters.
- The rate limit is per user, keyed by the session's user id, on this
  procedure alone. Existing per-IP limits stay as they are.

## Placement and design

The shell has three columns on a desktop: the space rail, the channel
sidebar with the members panel folded into its bottom, and the channel
view. There is no right-hand column to borrow, and below 768px the rail
and sidebar collapse into one drawer. Search has to fit that, not add to
it.

### Where the entry point goes

Three placements were considered. A is decided, chosen as the least
permanent: a header control and a route can be moved without touching
the shell.

| Option | Entry | Results | Trade |
| --- | --- | --- | --- |
| **A. Channel header** | A search control at the right end of the channel header. Desktop shows a compact field; phone shows the icon. | A page in the channel view, built like Activity. | Always one click away, in the header people already scan. Costs 32px of header width on a phone, which the mobile stylesheet already guards for the topic. |
| B. Sidebar header | A field under the space name, like the members search. | Same results page. | Two search fields in one column would confuse. On a phone the sidebar is a drawer, so search is two taps away. |
| C. Command palette | A keyboard shortcut opens a modal with the field and results inside. | Inside the modal. | Needs the binding layer from STOOP-127 first, and a modal cannot hold "load older" comfortably. Worth adding as a second entry to A later. |

### The results page

It is a route, `/s/$spaceId/search?q=…`, so a search is linkable and the
back button returns to the channel. The page is built the way Activity is
built, because the two solve the same problem: a list of messages from
many channels that opens each one in place.

- **Header.** The menu button on a phone, "Search in *space*", the query
  field, a match count that reads "3 messages" or "50+ messages" when
  there is another page, and a Close chip that returns to the channel the
  search started from.
- **Field behaviour.** Enter searches. Escape clears the field, then
  closes the page. The field keeps the query text so it can be refined.
- **Rows.** Channel, author and date on a small line, then the rendered
  message body with matched terms in `<mark>`. Attachments show the
  existing strip. Clicking anywhere on the row opens the channel at that
  message with `?m=`.
- **Scope chips** under the header: "All channels" and "This channel",
  where the second is only offered when the search started inside a
  channel. It writes `in:#name` into the query so the chip and the syntax
  stay one thing.
- **Paging.** A "Load older" chip at the bottom, the same element
  Activity uses, sends the last id as the cursor and appends.
- **Empty and error states.** "No messages match *query*" with the
  syntax hint under it. A rate-limit rejection reads "Too many searches.
  Try again in a minute." A timeout reads "That search took too long. Add
  a channel or a word."

On a phone the icon sits where the topic would on a desktop. The results
page is full width, with the field in the header and the scope chips
beneath it.

### Visual language

- **Highlight.** A `<mark class="search-hit">` inside MessageBody,
  coloured from the accent tokens so it holds in every theme and never
  uses browser yellow. Highlighting runs on the client from the parsed
  query, so the server sends ordinary messages.
- **Field.** The compact desktop field reuses the members-search styling,
  so the two read as the same control.
- **Rows.** Activity rows with the message body swapped in. Same gutters,
  same day-line type size, same hover.
- **Files.** `routes/Search/`, `components/SearchField.tsx`, and
  `styles/search.css`. The header control is a few lines in
  `routes/Channel/index.tsx`.

## Not in the first cut

- **DM search.** Same page, second scope case, its own change after space
  search lands.
- **Attachment names and link titles.** Cheap to add later as extra
  columns feeding the same vector.
- **Instance-wide search** for admins. An access question before a
  performance one.
- **A language setting.** If English-only communities want stemming, it
  can become an install-time choice. Changing it means rebuilding the
  column, so it is not a runtime toggle.
- **Substring search.** If asked for, a `pg_trgm` index can be added
  beside the tsvector without touching this design.

## Verification

- Unit tests for the query parser: filters extracted, phrase kept intact,
  prefix appended, junk rejected.
- Go tests on the service: a member finds a message in their space, a
  non-member gets `PermissionDenied`, the cursor pages without gaps or
  repeats.
- Migration timing on a scratch database seeded to one million rows,
  recorded in the PR so the release note has a real number.
- A browser spec, `web/e2e/search.mjs`, after the maintainer has reviewed
  the feature on the dev instance. Per the project rule, no spec runs
  before that.
- The next release's verify step includes the rollback dry run with this
  migration applied.

## Decisions taken

Answered by the maintainer on 2026-09-04.

1. **Auto-prefix the last term.** Yes, with a three-character floor.
2. **Space search first.** DM search is a separate change after it lands.
3. **Placement A.** The header control and a results route, as the least
   permanent option. C can join it once the keyboard binding layer exists.

Still open: whether space admins should search channels they have not
joined. Today every member sees every channel, so it only matters once
read-only or private channels exist.
