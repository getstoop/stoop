# Proposal: the channel log

Approved 2026-10-21. Replaces the client's request bookkeeping with a
per-channel sequence, makes deletes tombstones, moves messages out of the
query cache into their own store, and virtualises the message list.

## Why

Realtime today is best-effort with no position: no replay, no sequence
number, and recovery is "invalidate every query". The client reconstructs
ordering by bookkeeping about requests (events kept per in-flight request
and replayed over its answer, a reconnect counter that invalidates pages
asked for before it). That is about 1,200 lines of reducer and store code
and 1,100 lines of tests, all compensating for one number the server never
hands out.

## The contract

```sql
ALTER TABLE channels ADD COLUMN seq bigint NOT NULL DEFAULT 0;
ALTER TABLE channels ADD COLUMN swept_seq bigint NOT NULL DEFAULT 0;
ALTER TABLE messages ADD COLUMN seq bigint;            -- NOT NULL one release later
CREATE INDEX messages_channel_seq_idx ON messages (channel_id, seq);
```

- **Every render-affecting write stamps the row** in its own transaction:
  send, edit, delete, reaction, pin, link preview arrival, and the root's
  summary when a reply lands or goes. The seq comes from
  `UPDATE channels SET seq = seq + 1 WHERE id = $1 RETURNING seq`. The row
  lock is the point: a global sequence hands out numbers in allocation
  order but rows commit in another order, so a client could skip one. The
  lock makes "next seq" exact per channel.
- **`Message.seq`** on the proto, and **`channel_seq`** on
  `ListMessagesResponse`. The server reads the counter *before* running the
  page query, so anything committing after it has a higher seq and arrives
  as a change. A row in the page with a seq above `channel_seq` is
  harmless: the client keeps the higher.
- **`ListChanges(channel_id, since_seq, limit)`** returns rows with a
  higher seq in seq order, tombstones and thread replies included, plus
  `channel_seq` and `has_more`. As built there is no `too_old`: the sweep
  still records the highest seq it hard-deleted in `swept_seq`, but
  nothing reads it. Instead `ListChanges` and `ListMessages` both carry
  `retention_floor_id`, the sweep's own cutoff (one helper, so they never
  disagree; empty with retention off), and the client drops a held row
  below it unless it is pinned, and a reply whose root is below it unless
  the root is pinned, since the sweep keeps a pinned root and its thread
  (`Message.pinned` is on the row). A hard delete leaves no tombstone and
  no event, and the floor is how it reaches a client.
- **Deletes are tombstones.** One path for roots, replies and top-level
  messages: set `deleted_at`, blank the content, drop reactions,
  attachments, mentions and links, delete the files through the port,
  bump the seq. The retention sweep hard-deletes tombstones with
  everything else. Every read that hands rows to a client skips them,
  except `ListChanges`.
- **Every socket event about a message carries its seq.** The plan was
  to shrink the events to `message_created` and `message_updated`, both
  carrying the full row; that was dropped at step 4, because the
  integrations subscriber forwards every `message_updated` to outgoing
  webhooks as `message.updated`, and full-row updates for reactions,
  pins and deletes would have changed what hooks receive. So the events
  keep their kinds, and `reactions_changed`, `message_pinned`,
  `thread_changed` and `message_deleted` each gained a `seq`: the row's
  position after that change. Webhook payloads are unchanged.
- **Per-viewer fields stay an overlay.** A thread's `unread_count`,
  `muted` and `participating` are not row facts; the server adds them per
  request (as `addThreadViewerStates` does) and the client applies its
  own read events on top.

Gaps in the sequence are fine (a rolled-back transaction, a hard delete
during a rollback to an older binary). The client rule needs monotonic,
not dense.

## The client

One store per channel: a seq, a map of rows by id, a sorted order. The
merge rule is one comparison: a row that arrives replaces the held copy
when its seq is higher (as built, the server's whole row also wins a tie
with a copy an event patched partially). A live event whose seq is exactly
next is applied; any other gap triggers one `ListChanges` from the held
seq. Reconnect is that call for every channel with a store, followed by
each view's newest page for the per-viewer fields no seq carries.

Views are ranges over the store. The channel view tracks a contiguous
range of top-level rows with `hasOlder`/`hasNewer`; a thread view tracks
its own range of its root's replies. A jump loads a page around a message
and sets a range that does not reach the newest row; rows beyond the
range are still merged into the map and counted on the "Jump to latest"
pill. Pending sends live in a separate list with no seq.

With a virtualised list the DOM is no longer a constraint. Rows are
pruned from memory only past a large cap (about 2,000) and only at the
older end in normal reading, so liveness never flips because of pruning.

The query cache keeps everything else. Member profile changes stop
invalidating messages: `MessageRow` renders the author from the members
query with the embedded author as fallback.

## Steps, one pull request each

1. Virtualise `MessageList` against the current cache, 300 cap still on.
2. Server: migration, backfill, seq stamping on every write; `Message.seq`
   and `channel_seq`. No behaviour change.
3. Server: tombstones. One delete path; `DeleteThread` as its bulk form;
   recomputes skip tombstones; sweep records `swept_seq`; publish
   `message_updated` alongside `message_deleted` for now. As built: the
   events are exactly today's (no `message_updated` for a row that used
   to vanish; that is step 4's job), a tombstone is shown only as the
   placeholder of a thread with live replies, `GetMessage` hides every
   other tombstone so each RPC answers as before, and a quote of a
   deleted message now reads as deleted rather than disappearing, since
   `reply_to_message_id` is kept.
4. Server: `ListChanges`, and a seq on every realtime event about a
   message. As built: the events keep their kinds, with `seq` added to
   `reactions_changed`, `message_pinned`, `thread_changed` and
   `message_deleted` (no `message_updated` for those, see The contract);
   `retention_floor_id` on `ListChanges` and `ListMessages` in place of
   `too_old`, with `swept_seq` left informational.
5. Web: the new store and loader, unit-tested, unwired. As built
   (`web/src/core/channelLog/`, `web/src/api/channelLog.ts`;
   `web.md` → The channel log store): the floor spares pinned rows, and
   a reply under a root below the floor only when the root is held and
   unpinned, as the sweep does; a catch-up page moves the log's seq only
   when `has_more` is false and the loader continues from the last row's
   seq meanwhile; `opened` moves a view's generation like `jumped`, since
   both replace the range; there are no pending sends in the model (the
   composer awaits the answer and merges its row, as today); an event
   before a log's first page is kept without judging the gap, and the
   page's `channel_seq` sets the position; the floor never tightens a
   view's range, since a pinned row may still lie below it. Known and
   left as is: `pendingNewer` counts any row new to the log beyond a
   non-live range, not only created ones; rows outside every range are
   never pruned, so memory there is bounded only by the floor; a held
   reply whose root was never held survives the floor until reload.
6. Web: the switch. As built: `api/history.ts`, `api/timelineLoads.ts`
   and their tests are gone and the message list, the composer, the
   thread panel, reactions, pins, threads and the realtime client run on
   the channel log (`web.md` → State, `realtime.md` → The channel log on
   the client). The loader gained `holdRow` (a send's or edit's answer,
   a thread's root fetched for the panel, merged by seq like an event's
   row, the position left alone), `patchRow` (a reaction, a pin or the
   reader's own delete before the server answers, at the row's own seq so
   the event replaces it) and `useOpenView`, which holds a channel's log
   while a page or a panel shows it and forgets it when the last holder
   leaves (so what is held is what is on screen, as the cache's GC did
   before; a first page that fails is asked for again three times, as
   the query it replaced was). The thread viewer-half arithmetic stayed
   in `api/threads.ts` on top of `patchThread`, computed from the held
   root before the event and only when the log applied it. A deep link
   is the list's jump, not an opening around it, so one page is asked
   for. `member_updated` and `groups_changed` no longer touch the
   messages: `core/author.ts` overlays the member on the row's embedded
   author (the quotes' authors too), and a group's handle already came
   from the groups list. The one-message copies (`useLinkedMessage`,
   `useThreadRoot`) stay in the query cache under `linkedMessageKey` and
   are refetched when an event names the message. The cap is the log's
   `LOG_CAP` (2,000). Reconnect is `ListChanges` from the held seq; a
   browser spec posts while a page's socket is held and sees the message
   arrive on reconnection without a reload. That spec found a flaw in
   step 5's model: the position 0 stood for "no page yet", so a channel
   opened while empty (`channel_seq` 0) never moved its position on an
   event and never caught up; `hasPage` (whether a view's generation has
   moved) now says a page has been taken, and the position is judged
   only then. `window.spec.ts` no longer asserts the 300 cap (2,000 is
   beyond what a spec can seed; pruning is the model's unit tests') and
   reloads before its second jump, since a jump to a held row is a
   scroll now. An author off the members list (left, or deleted their
   account) is shown from their profile, fetched once per departed author
   and asked for again on `member_removed`, since the deleted mark lives
   there and no page is fetched again to bring it. Review of the switch
   added three things to the model: `seenSeq`, the highest seq any event
   carried, so a load that sets the position below it (the first page, a
   catch-up's last page, each read at a seq the server took before the
   rows) leaves the catch-up owed and the loader runs another pass, where
   before a message missed while the load was out was lost; the server's
   whole row wins a tie with a held copy, since a partial event (a
   reaction) can stamp a row with the seq under which the full row, with
   an edit the socket missed, then arrives, and a partial event about a
   row not held marks a gap rather than advancing past it; and
   `reconnected` follows the catch-up with each view's newest page and an
   open thread's root, since a thread's reads and mutes changed elsewhere
   bump no seq and `ListChanges` carries nothing for them (rows outside
   those pages keep the old reader's half until paged in again). A page's
   rows are judged against the floor held or the answer's, whichever is
   higher, so a page asked for before a sweep cannot bring back a row a
   catch-up dropped, and `jumpToLatest` opens a view not yet held, so a
   thread opened on a reply since deleted shows its remaining replies
   instead of nothing.
   Known and left as is: `hasPage` can flip
   back to false when a swept root's thread view was the only view with
   a page (`floor.ts` drops the view), reachable only with a swept root
   whose panel already says it is not available; a refused reaction is
   reverted to the list as it was at the click, not the latest held
   (as before the switch); a page requested from an edge that pruning
   moved meanwhile can leave an interior hole when the view is at its
   2,000-row cap; two jumps in flight land on the first to answer rather
   than the latest; a deletion above the viewport shifts the view by the
   row's height, because browser scroll anchoring is off in the list; an
   audio attachment restarts when its row leaves the rendered range and
   returns; and a page that answers between the reader's own reaction and
   its event shows the row without it for that moment, since the server's
   copy at the same seq now wins. The timeline reducer modules under
   `core/` were not deleted: see step 7.
7. Cleanup: the mobile app's channel screen still runs the timeline
   reducer (`core/timelineState.ts`, `timelinePaging.ts`,
   `timelineEvents.ts`, `channelTimeline.ts`, `timelineItems.ts`,
   `messageList.ts`, each headed with a note saying the web app no longer
   uses it); re-point it at `core/channelLog` and delete them with their
   tests. A thread's view stays in its channel's log after the panel
   closes (its rows kept until the channel is forgotten): add a
   `closeThread` that drops the view. Then drop the old queries the
   switched client no longer calls (the socket events stay, see The
   contract) and rewrite the history and state sections of
   `messaging.md` and `data.md` (`realtime.md` and `web.md` were done at
   step 6).
8. Next release: backfill any `NULL` seq, set `NOT NULL`, raise the floor.

The mobile app's shared reducer import did not break at step 6, since
the modules stayed; its contract is still open and it re-points at the
new store when its channel screen is next touched (step 7).

## Known and left as is

- A thread read marker (`MarkThreadRead`) can land on a root deleted
  between the handler's check and its insert. The insert is not made
  conditional: it returns the marker, so a condition would change what
  the RPC and the send's transaction read back. A stray `thread_reads`
  row is shown to nobody (`ThreadViewerStates` runs only over roots a
  page holds) and goes with the root when the sweep hard-deletes it.
