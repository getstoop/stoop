# Proposal: the channel log

Approved 2026-10-21; built in seven pull requests the same week, with the
contract half of its migration one release later. Replaces
the client's request bookkeeping with a per-channel sequence, makes
deletes tombstones, moves messages out of the query cache into their own
store, and virtualises the message list. This document is the record:
what was planned, what was built, where the two differ and why, and what
is still open. The architecture docs describe the result
([architecture/messaging.md](../architecture/messaging.md#history),
[architecture/realtime.md](../architecture/realtime.md#the-channel-log-on-the-client),
[architecture/web.md](../architecture/web.md#the-channel-log-store),
[architecture/data.md](../architecture/data.md#chat)).

## Why

Realtime was best-effort with no position: no replay, no sequence number,
and recovery was "invalidate every query". The client reconstructed
ordering by bookkeeping about requests (events kept per in-flight request
and replayed over its answer, a reconnect counter that invalidated pages
asked for before it). That was about 1,200 lines of reducer and store code
and 1,100 lines of tests, all compensating for one number the server never
handed out.

## The contract, as built

```sql
ALTER TABLE channels ADD COLUMN seq bigint NOT NULL DEFAULT 0;
ALTER TABLE channels ADD COLUMN swept_seq bigint NOT NULL DEFAULT 0;
ALTER TABLE messages ADD COLUMN seq bigint;            -- 00068, 0.14.0
CREATE INDEX messages_channel_seq_idx ON messages (channel_id, seq);
ALTER TABLE messages ALTER COLUMN seq SET NOT NULL;    -- 00069, 0.15.0
```

- **Every render-affecting write stamps the row** in its own transaction:
  send, edit, delete, reaction, pin, link preview arrival, and the root's
  summary when a reply lands or goes. The seq comes from
  `UPDATE channels SET seq = seq + 1 WHERE id = $1 RETURNING seq`. The row
  lock is the point: a global sequence hands out numbers in allocation
  order but rows commit in another order, so a client could skip one. The
  lock makes "next seq" exact per channel, and every transaction that
  writes message rows takes the channel row first, the retention sweep
  included.
- **`Message.seq`** on the proto, and **`channel_seq`** on
  `ListMessagesResponse`. The server reads the counter *before* running the
  page query, so anything committing after it has a higher seq and arrives
  as a change. A row in the page with a seq above `channel_seq` is
  harmless: the client keeps the higher.
- **`ListChanges(channel_id, since_seq, limit)`** returns rows with a
  higher seq in seq order, tombstones and thread replies included, plus
  `channel_seq` and `has_more`.
- **The retention floor instead of `too_old`.** The plan had `ListChanges`
  answer `too_old` when `since_seq` fell below `channels.swept_seq`, the
  highest seq the sweep had hard-deleted. As built nothing reads
  `swept_seq` (the sweep raised it through 0.14.0; step 8 stopped that,
  and the column goes a release later). Instead
  `ListChanges` and `ListMessages` both carry `retention_floor_id`, the
  sweep's own cutoff from one helper so the two never disagree (empty with
  retention off), and the client drops a held row below it unless it is
  pinned, and a reply whose root is below it unless the root is pinned,
  since the sweep keeps a pinned root and its thread (`Message.pinned` is
  on the row). A hard delete leaves no tombstone and no event, and the
  floor is how it reaches a client. This is simpler than a `too_old`
  branch (no second code path on the client) and exact where `swept_seq`
  would only have been a hint.
- **Deletes are tombstones.** One path for roots, replies and top-level
  messages: set `deleted_at`, blank the content, drop reactions,
  attachments, mentions and links, delete the files through the port,
  bump the seq. The retention sweep hard-deletes tombstones with
  everything else. Every read that hands rows to a client skips them,
  except `ListChanges`. A root deleted while its thread has live replies
  stays shown as a placeholder with its summary; a quote of a deleted
  message reads as deleted rather than disappearing, since
  `reply_to_message_id` is kept.
- **Every socket event about a message carries its seq, under its own
  kind.** The plan was to shrink the events to `message_created` and
  `message_updated`, both carrying the full row. That was dropped at step
  4: the integrations subscriber forwards every `message_updated` to
  outgoing webhooks as `message.updated`, and full-row updates for
  reactions, pins and deletes would have changed what hooks receive. So
  the events keep their kinds, and `reactions_changed`, `message_pinned`,
  `thread_changed` and `message_deleted` each gained a `seq`: the row's
  position after that change. Webhook payloads are unchanged.
- **Per-viewer fields stay an overlay.** A thread's `unread_count`,
  `muted` and `participating` are not row facts; the server adds them per
  request (`addThreadViewerStates`) and the client applies its own read
  and mute events on top.

Gaps in the sequence are fine (a rolled-back transaction, a hard delete
during a rollback to an older binary). The client rule needs monotonic,
not dense.

## The client, as built

One store per channel (`web/src/core/channelLog/`, the pure model;
`web/src/api/channelLog.ts`, the loader): a seq, a map of rows by id, and
views that range over it. The merge rule is one comparison: a row that
arrives replaces the held copy when its seq is higher, and the server's
whole row also wins a tie with a copy an event patched partially. A live
event whose seq is exactly next is applied; any other gap triggers one
`ListChanges` from the held seq. Reconnect is that call for every channel
with a store, followed by each view's newest page for the per-viewer
fields no seq carries.

The channel view tracks a contiguous range of top-level rows with
`hasOlder`/`hasNewer`; a thread view tracks its own range of its root's
replies. A jump loads a page around a message and sets a range that does
not reach the newest row; rows beyond the range are still merged into the
map and counted on the "Jump to latest" pill. A view holds at most
`LOG_CAP` (2,000) shown rows; past that the end away from the reader is
pruned, so liveness never flips because of pruning, only because of
paging. The DOM is bounded separately by the virtualised list.

**No pending sends.** The plan kept pending sends in a separate list with
no seq. As built there are none in the model: the composer awaits
`SendMessage` and merges the answer's row (`holdRow`) exactly as an
event's, which is what the client did before and needs no second kind of
row. The reader's own reaction, pin or delete is written to the held row
at its own seq (`patchRow`) so the event that follows replaces it.

The query cache keeps everything else. `member_updated` and
`groups_changed` no longer touch the messages: `core/author.ts` overlays
the member on the row's embedded author, and an author off the members
list (left, or deleted their account) is shown from their profile
(`api/authors.ts`, fetched once per departed author and asked for again
on `member_removed`), since the deleted mark lives there and no page is
fetched again to bring it.

## The steps and their pull requests

1. **Virtualise `MessageList`** against the then-current cache, the 300
   cap still on. [#525](https://github.com/getstoop/stoop/pull/525). As
   planned.
2. **Server: the sequence.** Migration 00068, backfill (each row's rank by
   id in its channel), seq stamping on every write; `Message.seq` and
   `channel_seq`. No behaviour change.
   [#523](https://github.com/getstoop/stoop/pull/523). As planned.
3. **Server: tombstones.** One delete path, `DeleteThread` as its bulk
   form, recomputes that skip tombstones, the sweep recording
   `swept_seq`. [#524](https://github.com/getstoop/stoop/pull/524).
   Deviation: the plan had it publish `message_updated` alongside
   `message_deleted` "for now"; as built the events were exactly the
   previous ones (a row that used to vanish still sends
   `message_deleted`, a root kept as a placeholder sends
   `message_updated` with `deleted` set), `GetMessage` hides every other
   tombstone so each RPC answers as before, and a quote of a deleted
   message reads as deleted rather than disappearing.
4. **Server: `ListChanges`, and a seq on every realtime event about a
   message.** [#526](https://github.com/getstoop/stoop/pull/526).
   Deviations: the events keep their kinds with `seq` added (see The
   contract); `retention_floor_id` on `ListChanges` and `ListMessages` in
   place of `too_old`, `swept_seq` left informational.
5. **Web: the store and loader, unit-tested, unwired.**
   [#527](https://github.com/getstoop/stoop/pull/527). Decisions made
   here: the floor spares pinned rows, and a reply under a root below the
   floor only when the root is held and unpinned, as the sweep does; a
   catch-up page moves the log's seq only when `has_more` is false and the
   loader continues from the last row's seq meanwhile; `opened` moves a
   view's generation like `jumped`, since both replace the range; no
   pending sends in the model; an event before a log's first page is kept
   without judging the gap, and the page's `channel_seq` sets the
   position; the floor never tightens a view's range, since a pinned row
   may still lie below it.
6. **Web: the switch.** [#528](https://github.com/getstoop/stoop/pull/528).
   `api/history.ts`, `api/timelineLoads.ts` and their tests went; the
   message list, the composer, the thread panel, reactions, pins, threads
   and the realtime client run on the channel log. The loader gained
   `holdRow`, `patchRow` and `useOpenView` (a channel's log is held while
   a page or a panel shows it and forgotten when the last holder leaves;
   a first page that fails is asked for again three times, as the query
   it replaced was). The thread viewer-half arithmetic stayed in
   `api/threads.ts` on top of `patchThread`. A deep link is the list's
   jump, not an opening around it, so one page is asked for. The
   one-message copies (`useLinkedMessage`, `useThreadRoot`) stay in the
   query cache under `linkedMessageKey`, refetched when an event names
   the message. A browser spec posts while a page's socket is held and
   sees the message arrive on reconnection without a reload; it found a
   flaw in step 5's model (position 0 stood for "no page yet", so a
   channel opened while empty never caught up), fixed with `hasPage`.
   `window.spec.ts` no longer asserts the 300 cap (2,000 is beyond what a
   spec can seed; pruning is the model's unit tests') and reloads before
   its second jump, since a jump to a held row is a scroll now. A later
   commit on the same pull request shows an author off the members list
   from their profile (see The client, as built), since the old client's
   refetch on `member_removed` was what brought the deleted mark.
   Review of the switch added three things to the model: `seenSeq`, the
   highest seq any event carried, so a load that sets the position below
   it (the first page, a catch-up's last page) leaves the catch-up owed and
   the loader runs another pass; the server's whole row wins a tie with a
   held copy, since a partial event (a reaction) can stamp a row with the
   seq under which the full row, with an edit the socket missed, then
   arrives, and a partial event about a row not held marks a gap rather
   than advancing past it; and `reconnected` follows the catch-up with
   each view's newest page and an open thread's root, since a thread's
   reads and mutes changed elsewhere bump no seq. A page's rows are
   judged against the floor held or the answer's, whichever is higher, and
   `jumpToLatest` opens a view not yet held, so a thread opened on a reply
   since deleted shows its remaining replies.
   Deviation: the old timeline reducer modules under `core/` were not
   deleted, since the mobile app imports them (see Open).
7. **Cleanup** ([#529](https://github.com/getstoop/stoop/pull/529)). The docs no longer describe the
   cache-era client; `closeThread` drops a thread's view from its
   channel's log when the panel closes, with the rows only that view kept
   (the core's `referenced` rule, as pruning uses), and a page still out
   for it answers to nobody; the one unused export left by the switch
   went; the `formatting` browser spec finds its first row by text
   (`rowByText` in `e2e-pw/lib.ts`) rather than by position near the
   virtualised list's bound. Nothing was found dead on the server: every
   chat query has a caller, and the helpers steps 2 to 4 replaced went in
   those steps. Deviation: the plan had this step re-point the mobile
   app and delete the reducer modules; that is left open, below, since
   the mobile channel screen is built one screen per pull request on its
   own track.
8. **The contract, one release later** (this PR; ships in 0.15.0, after
   0.14.0 carried steps 1 to 7). Migration 00069 makes `messages.seq`
   `NOT NULL` and raises the schema floor to 68, so 0.14.0, whose code
   always stamps the column, still starts against the result and 0.13.0
   is refused. Before tightening, it fills any row still without a seq:
   those are rows a 0.13.0 binary wrote during a rollback from 0.14.0,
   and they take positions *above* the channel's counter, in id order,
   with the counter moved past them, rather than 00068's rank by id. The
   reason is the client rule: a client holding the channel at its old
   position sees them in its next `ListChanges` only if their seq is
   higher than what it holds. The view `message_with_reply` is not
   recreated (a constraint is not a change to its definition), so sqlc
   is told the view's `seq` is not null in `sqlc.yaml`; the generated
   `Seq` fields went from `*int64` to `int64` and the nil branches with
   them. Decided here: `channels.swept_seq` goes. Nothing read it, and
   the two cases it would have served (below) cost one stale row until
   reload. The sweep's `UPDATE` of it, its query and its test went in
   this step; the column stays one more release because 0.14.0's sweep
   still writes it, and dropping it now would break a rollback there.
   `make dev-flood`, which writes rows straight into Postgres, now stamps
   them the same way the backfill does.

## Known and left as is

Behaviour that is understood and accepted, so that nobody rediscovers it
as a bug:

- `pendingNewer` counts any row new to the log beyond a non-live range,
  not only created ones (an edit's row that first reaches the log that
  way counts too).
- Rows outside every view's range are never pruned, so memory there is
  bounded only by the retention floor until the log is forgotten.
  `closeThread` (step 7) drops only what the closed view kept, by the same
  rule.
- A held reply whose root was never held survives the floor until reload
  (had the root been swept the reply would not have come, so this is
  conservative, not wrong).
- `hasPage` can flip back to false when a swept root's thread view was the
  only view with a page (`floor.ts` drops the view), reachable only with a
  swept root whose panel already says it is not available.
- A refused reaction is reverted to the list as it was at the click, not
  the latest held (as before the switch).
- A page that answers between the reader's own reaction and its event
  shows the row without it for that moment, since the server's copy at
  the same seq wins.
- A page requested from an edge that pruning moved meanwhile can leave an
  interior hole when the view is at its 2,000-row cap.
- Two jumps in flight land on the first to answer rather than the latest.
- A deletion above the viewport shifts the view by the row's height,
  because browser scroll anchoring is off in the virtualised list.
- An audio attachment restarts when its row leaves the rendered range and
  returns.
- A thread read marker (`MarkThreadRead`) can land on a root deleted
  between the handler's check and its insert. The insert is not made
  conditional: it returns the marker, so a condition would change what
  the RPC and the send's transaction read back. A stray `thread_reads`
  row is shown to nobody and goes with the root when the sweep
  hard-deletes it.
- A link preview is a cached card shared per URL: a refresh reached by a
  later send changes how older messages linking that URL render without
  those rows' seq moving, and the preview rows commit before the stamping
  transaction, so a process stopping between the two leaves a card
  changed without a new seq. Either reads as a stale card until the row
  is next fetched.
- A quote and a thread-root excerpt are rendered from the referenced
  message's current content and are not part of the quoting row's
  versioned facts: a deletion blanks held quotes on the client, but an
  edit of the quoted message leaves older quotes showing the old excerpt
  until the quoting row is fetched again, as before the channel log.
- `DeleteThread` reads its root outside the transaction
  (`internal/chat/threads.go`, `GetMessage` before `inTx`), so a root
  deleted or edited in between returns `NotFound` once, or is tombstoned
  from a stale copy.
- The `ListChanges` gate test does not cover a DM; it is the same code
  path as `ListMessages`, which is covered.
- Browser specs still use `.nth(n)` on `.message` rows at about 21 sites
  (`attachments`, `edits`, `media-preview`, `pins`, `unfurl`, `usercard`,
  `reachability`, `search`, `shortcodes`), safe while each addresses the
  first or last of a handful of on-screen rows.
- `closedThread` (step 7) can drop a row that `stretched` would have
  needed: a thread closes while the channel's first page is still out and
  an also-sent reply arrived by event in between. The row is missing
  until the next event about the channel brings a gap and a catch-up.

## Open

- **Drop `channels.swept_seq`, the release after 0.15.0.** Step 8
  stopped writing it; 0.14.0's sweep still does, so the column stays
  until no shipped binary writes it, then one migration drops it. For the
  record, what it would have served, and why it was not kept: two cases
  the retention floor cannot reach — a client offline while the retention
  policy is lengthened or turned off keeps a row the old policy swept,
  and one offline while a pinned root is unpinned, deleted and swept
  keeps that root; a position below `swept_seq` would have told the
  client to reopen. Both are rare and cost one stale row until reload.
- **The mobile re-point.** The mobile app's channel screen still runs the
  timeline reducer (`core/timelineState.ts`, `timelinePaging.ts`,
  `timelineEvents.ts`, `channelTimeline.ts`, `timelineItems.ts`,
  `messageList.ts`, each headed with a note saying the web app no longer
  uses it, and `timelineTesting.ts`, their tests' fixtures). When that
  screen is next touched it re-points at
  `core/channelLog` and those modules go with their tests
  (`mobile/README.md` → Code shared with web).
