# Keeping drafts on mobile

Status: proposal, 2026-11-02, awaiting the operator. Nothing built.

## Scope

An unsent message survives the composer going away. The mobile app keeps
each draft on the device, brings it back when its channel or thread opens
again, and lets it expire after a time.

Out of scope: syncing drafts between devices, drafts on web, saving an edit
in progress, keeping attachments, and session length, which needs its own
work. Nothing here changes the server.

## What exists

A draft lives only in the composer's state
(`mobile/src/screens/Channel/Composer.tsx`, `useState`), held as Markdown.
The Channel and Thread screens key the composer by channel and by root, so
anything that unmounts it loses the words. Nothing is stored. Web holds its
drafts the same way.

Several ordinary things unmount it: going back, the app being killed, and a
screen swapping to its "ended" or "gone" state. Since #654, a session ending
can do that with no action by the person, even while they are typing.

## Desired behaviour

The rule: **a draft belongs to one account, in one channel or thread, on this
device, and only that account sees it.**

| When | What happens |
| --- | --- |
| Typing | Saved shortly after typing stops, on going to the background, and as the composer goes away |
| Opening the channel or thread | The draft is back, merged with anything already typed |
| The draft has a quote | The quote comes back if its message is in what's loaded. Otherwise the words come back without it |
| Pressing Send | The field clears and the words are held as sending, apart from the draft. Typing carries on as a new draft |
| The send succeeds | The sending words are deleted. A newer draft stays |
| The send is refused or fails, on screen | As today: the words go back in the field with the reason |
| The send is refused or fails, after leaving | The words join the stored draft and are there on return |
| Returning while a send is still out | The field doesn't show the sending words, so they can't be sent twice |
| The app died during a send | The sending words return as a draft on next open |
| The field is cleared | The draft is deleted, unless it has a quote, which is kept until cancelled |
| Editing a message | The edit isn't saved. The draft set aside for it is what's stored |
| The session ends or is revoked | The draft is kept, hidden, and returns when the same account signs in again |
| Signing in as a different account | Nothing of the other account's shows. Its drafts stay hidden until they expire |
| Signing out, or removing the server | All of that server's drafts are deleted, whichever account they belong to |
| The channel is gone, or access is lost | Nothing shows. The draft waits, and expires if access never returns |
| Posting closes (an announcement channel, a closed thread) | The composer isn't shown. The draft waits, and returns if posting reopens |
| 30 days since the last edit | The draft is deleted by the sweep below |
| Reading or writing the store fails | The composer works as it does today, for that session, with no message |

Not kept: Also send, so a restored thread draft comes back unchecked. And
files: a restored draft has its words and no files, because an upload is
unclaimed until it is sent and the server sweeps unclaimed files after a grace
period (24 hours by default, [files.md](../architecture/files.md)), so a saved
file ID can go stale.

## How it would work

- **Key:** server ID, account ID, channel ID, and thread root if any. The
  account matters most: a server ID alone would hand one account's words to
  another, the same class of leak #646 fixed. The session is deliberately not
  part of the key, because a draft has to outlive one.
- **Storage:** a small file per server and account, through `expo-file-system`,
  which the app already uses. The documents folder, not the cache, which the
  system may purge. Not SecureStore, which is meant for small secrets, not
  message text of any length.
- **Two slots per key:** `draft`, which the field shows, and `sending`, which it
  doesn't. Words in `sending` from an earlier run of the app mean it died during
  the send, so they join the draft on open.
- **The sweep:** on every app start, delete expired drafts and any file whose
  server ID isn't in the saved list. Without it a draft would only expire if its
  channel were opened again, and a removed server's file would never be read,
  because a server added again gets a new ID.
- **Late writes:** deleting happens after the server is forgotten, and a write
  checks the server is still saved, so a composer saving as it goes away, or a
  send failing late, can't recreate a removed server's file.
- **Who writes:** only a composer with unsaved changes, and the last edit wins.
  The same channel can be open twice in a stack, through channel links, and a
  screen beneath must not overwrite the newer draft or bring back a sent one.
- **During an edit:** saves read the draft set aside, not the field, which holds
  the edit. Starting an edit drops a quote today, so the stored quote goes too.
- **Timing:** the composer only mounts once the screen's header has loaded, so
  the account (`header.myUserId`) is known. The read is still asynchronous, so
  someone can type first: it merges, using the same path a refused send does.
- **Logic:** what a draft is, when it has expired, and how slots merge go in
  `web/src/core`, as pure functions with unit tests, so web can adopt them
  later. Reading and writing files stays in `mobile/src`.

## What this is expected to fix

| Today | With this |
| --- | --- |
| Going back loses a draft, with no warning | The draft is there on return |
| Killing the app loses a draft | The draft is there, up to the last moment saved |
| A session ending replaces Channel or Thread and loses the draft (#654) | The screen still changes, but the words return after signing in again |
| A screen going to "gone" loses the draft | The words wait, and return if access does |
| A send that fails after leaving loses the words and files | The words wait. This is half of STOOPMOBIL-20; the notice that it failed is still needed, and the files are still lost |
| A page failure on `PermissionDenied` keeps a retry row, because going to "gone" would lose a draft (STOOPMOBIL-18) | It can go to "gone" like catch-up, header refresh and jump to latest already do, with the words safe |

It doesn't fix these:

- a screen swap still loses held files and an edit in progress
- a draft on one device reaching another
- attachments on a draft
- the same gap on web

## Risks

- **Words left on the device.** After "Log out everywhere", which someone may
  use because a device is lost, a draft stays on that device, unencrypted in
  the app's private storage, until the app next starts after it expires. If the
  app is never opened again, it stays. Signing out on the device itself deletes
  it. The alternative is deleting drafts on any ended session, which brings back
  the loss this proposal exists to fix. Recommended: accept it.
- **Device backups.** Files in the documents folder may be included in device
  backups. The first step should check this on both platforms, and exclude
  drafts if that's simple.
- **A send killed part way.** If the app dies after the server accepted a
  message but before the answer arrived, the words return though the message
  was sent. The person sees both and can clear it. Recommended: accept it.
- **A quote can go missing.** A quoted message outside what's loaded reads as
  gone, so a draft can come back without a quote whose message still exists.
  Telling the two apart would need a snapshot and a request. Recommended: accept
  it for a first version, since the words are what matter.

## Decisions for the operator

1. **Expiry:** 30 days since the last edit, matching the default session
   length (`DefaultSessionLifetimeDays`). Recommended, since quietly losing
   someone's words is worse than an old draft reappearing.
2. **An ended session keeps its drafts until they expire,** and only signing
   out or removing the server deletes them. Recommended, with the risk above.
3. **Words only, no files.** Recommended for a first version.
4. **Mobile first,** with the logic in `core` for web to follow. Recommended.
5. **Page failures on `PermissionDenied` go to "gone"** once this is in, which
   settles the open decision on STOOPMOBIL-18. Recommended.

## Build order

1. The draft rules in `core`, the store and the sweep, with tests. Check backups.
2. The composer saves and restores on Channel and Thread, including a send's
   failure after leaving.
3. Sign-out and removing a server delete drafts.
4. STOOPMOBIL-18: page failures on `PermissionDenied` go to "gone", if decision 5
   stands, and the comment on `pageOutcome` changes with them.

One pull request per step.
