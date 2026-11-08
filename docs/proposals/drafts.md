# Keeping drafts

Status: proposal, 2026-11-08, awaiting the operator. Nothing built. The
first version (2026-11-02) covered mobile only; the operator widened it to
every client and shortened the expiry.

## Scope

An unsent message survives the composer going away. Every client keeps each
draft on the device it was typed on, brings it back when its channel or
thread opens again, and lets it expire after a time. "Every client" is the
web app in a browser, the desktop shell (which runs the web app, one
storage partition per server), and the mobile app.

Out of scope: syncing drafts between devices, saving an edit in progress,
keeping attachments, a drafts marker in the sidebar or channel list, and
session length, which needs its own work. Nothing here changes the server:
a draft never leaves the device, so unsent words don't land in the database
or its backups.

## What exists

A draft lives only in the composer's state, held as Markdown: `useState` in
`web/src/routes/Channel/Composer.tsx` and in
`mobile/src/screens/Channel/Composer.tsx`. Nothing is stored. The one piece
of draft logic the clients share is `web/src/core/unsent.ts`, which puts a
refused send back ahead of anything typed since.

On web, the composer clears itself whenever its channel changes
(`Composer.tsx`, the effect on `channelId`), and the thread composer goes
with its side panel, so every switch of channel or thread loses the words.
So do a reload, a closed tab and a session ending.
[messaging.md](../architecture/messaging.md) records this as deliberate ("a
draft stays in its conversation"), to keep unsent text from being sent
somewhere else; the words were never meant to be lost, only kept apart.

On mobile, the Channel and Thread screens key the composer by channel and by
root, so anything that unmounts it loses the words: going back, the app being
killed, and a screen swapping to its "ended" or "gone" state. Since #654, a
session ending can do that with no action by the person, even while they are
typing.

## Desired behaviour

The rule: **a draft belongs to one account, in one channel or thread, on this
device, and only that account sees it.**

| When | What happens |
| --- | --- |
| Typing | Saved shortly after typing stops, as the page or app goes to the background, and as the composer goes away |
| Opening the channel or thread | The draft is back, merged with anything already typed |
| The draft has a quote | The quote comes back if its message is in what's loaded. Otherwise the words come back without it |
| Pressing Send | The field clears and the words are held as sending, apart from the draft. Typing carries on as a new draft |
| The send succeeds | The sending words are deleted. A newer draft stays |
| The send is refused or fails, on screen | As today: the words go back in the field with the reason |
| The send is refused or fails, after leaving | The words join the stored draft and are there on return |
| Returning while a send is still out | The field doesn't show the sending words, so they can't be sent twice |
| The app or tab died during a send | The sending words return as a draft once the send has had its time |
| The sending words are older than the expiry | Deleted by the sweep, like any draft. They are not brought back |
| The field is cleared | The draft is deleted, unless it has a quote, which is kept until cancelled. **This is how a draft is discarded:** empty the field and leave, and nothing comes back |
| Editing a message | The edit isn't saved. On mobile, where the edit takes over the field, the draft set aside for it is what's stored |
| The same channel is open twice (two tabs, or twice in a stack) | The last edit wins. A composer with nothing new to say never writes, and on web it takes the newer draft when the other tab saves, so the same words can't be sent from both |
| The session ends or is revoked | The draft is kept, hidden, and returns when the same account signs in again |
| Signing in as a different account | Nothing of the other account's shows. Its drafts stay hidden until they expire |
| Signing out, or removing the server | All of that server's drafts are deleted, whichever account they belong to. "Log out everywhere" pressed on this device is signing out here; on the other devices it's a session ending |
| The channel is gone, or access is lost | Nothing shows. The draft waits, and expires if access never returns |
| Posting closes (an announcement channel, a closed thread) | The composer isn't shown. The draft waits, and returns if posting reopens |
| 7 days since the last edit | The draft is deleted by the sweep below |
| Reading or writing the store fails | The composer works as it does today, for that session, with no message |

Not kept: Also send, so a restored thread draft comes back unchecked. And
files: a restored draft has its words and no files, because an upload is
unclaimed until it is sent and the server sweeps unclaimed files after a grace
period (24 hours by default, [files.md](../architecture/files.md)), so a saved
file ID can go stale.

## How it would work

### Shared

- **Key:** account ID, channel ID, and thread root if any; on mobile, the
  server ID too, since one app holds several servers. The account matters
  most: a key without it would hand one account's words to another, the same
  class of leak #646 fixed. The session is deliberately not part of the key,
  because a draft has to outlive one.
- **Two slots per key:** `draft`, which the field shows, and `sending`,
  which it doesn't. Each carries the time it was last written.
- **A stalled send is told by age, not by run.** A second tab, or the app
  after a restart, can't tell whether the composer that sent is dead or still
  waiting, so `sending` words older than a stall age count as lost and join
  the draft on open. Younger ones stay hidden. The stall age is a named
  constant in `core`, and both clients' `sendMessage` calls get a timeout
  equal to it (mobile's is 10 seconds today, `mobile/src/api/messages.ts`;
  web's transport has none), so "the send has had its time" means the same
  thing everywhere and a hung send can't keep its words hidden for good.
- **Expiry:** 7 days since the last edit, one named constant in `core`, so
  changing it is one line.
- **The sweep:** at every start of the app or page, delete expired entries.
  Without it a draft would only expire if its channel were opened again.
- **When it's written:** a short while after typing stops (a debounce of
  about a second), as the page or app goes to the background, and as the
  composer goes away. The debounce is the save that matters: a killed app, a
  crash and a closed tab never unmount anything, so a save on unmount alone
  would lose the words in exactly the cases this exists for. Background and
  unmount only catch the keystrokes since the last debounce. (An ended
  session does unmount the composer, on both clients, so that case gets the
  unmount save too.)
- **Who writes:** only a composer with unsaved changes, and the last edit
  wins. The same channel can be open in two tabs on web, or twice in a stack
  on mobile through channel links, and a composer that hasn't changed must
  not overwrite the newer draft or bring back a sent one. Keeping a second
  tab's field live as the first one types is not a goal.
- **Deleting beats a late write.** Signing out, or removing a server, closes
  the store before deleting: a store that has been closed refuses writes, so
  the composer's own unmount save, an armed debounce, or a send failing late
  can't recreate what was just deleted. Mobile's version of this checks the
  server is still saved; web's is a flag the store keeps.
- **Logic:** what a draft is, when it has expired, when a send has stalled,
  and how slots merge go in `web/src/core` beside `unsent.ts`, as pure
  functions with unit tests. Each client supplies a small store with the same
  shape (read, write, delete, sweep) over its own storage.

### Web and desktop

- **Storage:** `localStorage`, under a key per account and conversation. The
  browser already scopes it to the server by origin, and the desktop shell
  keeps one partition per server
  ([desktop.md](../architecture/desktop.md)), so the server isn't in the
  key. The same storage holds the theme and voice switches today.
- **Timing:** `AppShell` holds the account before a channel renders, and
  `localStorage` reads are synchronous, so the draft is in the field on the
  first render, with nothing to merge at mount. The merge path still exists
  for a send that fails after leaving, and for the other tab (below).
- **The quote belongs to the screen, not the composer.** `replyTo` is state
  of `ChannelView` and `ThreadView`, passed down as a prop, so restoring a
  quote means the screen reads the stored quote's message ID, finds it in
  the log, and sets the reply. The composer restores the words; the screen
  restores the quote.
- **Saves:** the debounce above; `visibilitychange` to hidden and
  `pagehide`, which between them cover a tab switch, a minimise, a close and
  a navigation away (the read hooks already use `visibilitychange`); and the
  composer's channel changing or it unmounting, which is the save that
  replaces the clear on switching. The channel composer is one instance
  across channels, and its effect runs after `channelId` has changed, so
  that save has to write under the key it had, not the new one.
  `beforeunload` isn't used: it's unreliable and stops the page going into
  the back-forward cache.
- **The other tab.** `localStorage` fires a `storage` event in every other
  tab on write. A composer with nothing unsaved takes the newer draft when
  the event names its key, and empties when the draft is deleted, so after
  one tab sends, the other tab's field doesn't still hold the words ready to
  send again. A composer with unsaved changes ignores the event; last edit
  wins.
- **Sign-out:** both paths, `LogoutButton` and "Log out everywhere" in
  `SessionsSection`, close the store and delete the drafts once the server
  has answered, before navigating to `/login`. A logout the server refuses
  leaves the drafts alone, since the person is still signed in. A browser has
  no "remove the server"; the desktop shell's removal of a server lives in
  its own repository, and the first step should check that it clears the
  partition's storage.
- **Editing** is a separate box in the message list, not the composer, so
  nothing about the draft changes during an edit.

### Mobile

- **Storage:** a small file per server and account, through
  `expo-file-system`, which the app already uses. The documents folder, not
  the cache, which the system may purge. Not SecureStore, which is meant for
  small secrets, not message text of any length.
- **Timing:** the composer only mounts once the screen's header has loaded,
  so the account (`header.myUserId`) is known. The read is asynchronous, so
  someone can type first: it merges, using the same path a refused send does.
- **Saves:** the debounce above, the app state turning inactive or
  background, and the composer going away.
- **The sweep also deletes any file whose server ID isn't in the saved
  list**, because a removed server's file would never be read again: a server
  added again gets a new ID.
- **Late writes:** deleting happens after the server is forgotten, and a
  write checks the server is still saved, so a composer saving as it goes
  away, or a send failing late, can't recreate a removed server's file.
- **During an edit:** saves read the draft set aside, not the field, which
  holds the edit. Starting an edit drops a quote today, so the stored quote
  goes too.

## What this is expected to fix

| Today | With this |
| --- | --- |
| Web: switching channel or thread clears the box | The draft is there on return, and never in another conversation |
| Web: a reload or a closed tab loses a draft | The draft is there, up to the last moment saved |
| Mobile: going back loses a draft, with no warning | The draft is there on return |
| Mobile: killing the app loses a draft | The draft is there, up to the last moment saved |
| Both: a session ending loses the draft (#654 on mobile, the redirect to `/login` on web) | The screen still changes, but the words return after signing in again |
| Mobile: a screen going to "gone" loses the draft | The words wait, and return if access does |
| Both: a send that fails after leaving loses the words and files | The words wait. This is half of STOOPMOBIL-20; the notice that it failed is still needed, and the files are still lost |
| Mobile: a page failure on `PermissionDenied` keeps a retry row, because going to "gone" would lose a draft (STOOPMOBIL-18) | It can go to "gone" like catch-up, header refresh and jump to latest already do, with the words safe |

It doesn't fix these:

- a screen swap still loses held files and an edit in progress
- a draft on one device reaching another
- attachments on a draft
- a second tab's field changing live as the first one types

## Risks

- **Words left on the device.** After "Log out everywhere", which someone may
  use because a device is lost, a draft stays on that device, unencrypted in
  the app's private storage, until the app next starts after it expires. If
  the app is never opened again, it stays. Signing out on the device itself
  deletes it. The alternative is deleting drafts on any ended session, which
  brings back the loss this proposal exists to fix. Recommended: accept it.
- **The same risk is heavier on web.** A shared or public browser keeps a
  draft readable in `localStorage` after the session expires, by anyone at
  that machine with the developer tools, where the mobile app's storage is
  sandboxed to the app. The 7-day expiry shortens the window, and signing out
  deletes it. The same rule everywhere is still recommended; the help text
  for shared computers, if there ever is any, should say to sign out.
- **Device backups.** Files in the documents folder may be included in device
  backups. The first mobile step should check this on both platforms, and
  exclude drafts if that's simple.
- **A send killed part way.** If the app or tab dies after the server accepted
  a message but before the answer arrived, the words return though the
  message was sent. The person sees both and can clear it. Recommended:
  accept it.
- **A quote can go missing.** A quoted message outside what's loaded reads as
  gone, so a draft can come back without a quote whose message still exists.
  Telling the two apart would need a snapshot and a request. Recommended:
  accept it for a first version, since the words are what matter.
- **Storage limits on web.** `localStorage` holds a few megabytes per origin,
  shared with the other switches kept there. Drafts are short and expire, so
  this isn't expected to bite; a write that fails falls back to today's
  behaviour, as the table says.

## Decisions

Taken by the operator on 2026-11-08:

1. **Every client, each keeping its own drafts.** No syncing between devices
   and nothing on the server.
2. **Expiry: 7 days since the last edit,** everywhere. The 30 days first
   proposed matched the default session length, but a draft untouched for a
   week is a stale fragment to clear, not a help, and a shorter window
   narrows the shared-browser risk.
3. **An ended session keeps its drafts until they expire,** and only signing
   out or removing the server deletes them.
4. **Words only, no files.**
5. **No drafts marker** in the sidebar or channel list for a first version.
6. **Web first, then mobile.** Web is the simplest case (synchronous storage,
   no merge at mount, no server in the key) and the browser suite covers it in CI,
   while mobile flows aren't being run. The cost is that STOOPMOBIL-18's
   page-failure decision waits one step longer.
7. **Page failures on `PermissionDenied` go to "gone"** once mobile has
   drafts, which settles the open decision on STOOPMOBIL-18.

## Build order

1. The draft rules in `core`: the key, the slots, expiry, the stalled-send
   rule and how slots merge, with tests. The web store over `localStorage`
   and the sweep at page start.
2. The web composer saves and restores on Channel and Thread, the screens
   restore the quote, a send's failure after leaving joins the draft, and the
   other tab follows `storage` events. `LogoutButton` and `SessionsSection`
   close the store and delete drafts. Web's `sendMessage` gets the stall age
   as its timeout.
   [messaging.md](../architecture/messaging.md) and
   [data.md](../architecture/data.md) change with it: a draft stays in its
   conversation and is there on return, and drafts move out of the "not in
   the database" table's component-state row to the client's own storage.
3. The mobile store and sweep, reusing the rules. Check backups.
4. The mobile composer saves and restores on Channel and Thread, including a
   send's failure after leaving. The two comments that say a draft is lost
   "for good" (`screens/Channel/index.tsx`, `useMessageActions.ts`) go.
5. Sign-out and removing a server delete drafts on mobile.
6. STOOPMOBIL-18: page failures on `PermissionDenied` go to "gone", and the
   comment on `pageOutcome` changes with them.

One pull request per step.
