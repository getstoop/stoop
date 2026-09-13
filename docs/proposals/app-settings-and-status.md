# App settings, and a status that belongs to the app

Status: proposed and decided 2026-09-12 (STOOP-251). App settings leaves
the server dropdown for a button of its own in the title strip; status and
desktop banners become the app's rather than each server's; the muted list
becomes a section of its own in account settings, in a browser and in the
shell alike. Placement renderings live as a design page in the
maintainer's tooling; the reasoning is all here. The one decision that was
argued out — global status rather than per-server — is at the end with its
evidence, because the rest of the design rests on it.

The shell owns the window, the theme and the servers. Until now it has
only owned the theme visibly: App settings is a line at the bottom of the
server menu, and everything that feels like a preference still lives on
whichever server happens to be in front. This finishes the thought. The
things that are true of the whole app get a door of their own; the things
that are true of one server stay where they are.

## Four moves

- **The gear.** App settings leaves the server dropdown for its own icon
  button at the right of the title strip. The dropdown becomes what its
  `aria-label` already claims: servers.
- **Status goes app-wide.** A Notifications section in App settings sets
  Online / Away / Do not disturb once, for every connected server.
- **Desktop notifications join it.** The banner switch moves into that
  same section, where it can speak for all servers at once, and the test
  notification is fired by the shell rather than by whichever page is in
  front — which is the plumbing that was actually in doubt.
- **Muted becomes a section.** The list of silenced spaces, channels and
  conversations leaves the Notifications tab for one of its own.

The middle two are moves *within the desktop shell*, and it is worth
being blunt about what that does not mean: **the web app loses nothing.**
Appearance and Notifications stay in account settings in a browser,
whole. They are hidden only while the page runs inside a shell that has
taken those settings over, on what the bridge hands across and never on
"is this the desktop app". Muted is the one change a browser sees.

## Why status belongs to the app

A person is *away*, or *not to be disturbed*. Neither is a fact about a
server. Today, setting Do not disturb on one server leaves you cheerfully
Online on the other two, and their banners keep coming.

Stoop's architecture is against this: separate identities on separate
servers, each with its own connection, none of them aware of the others.
Per-server presence is what falls out if nobody decides otherwise. The
shell is the only component in the system that knows you are one person
at one computer — if it does not assert that, nothing can.

## Bridge 3

`docs/architecture/desktop.md` carries the contract; in short, three
members, handed across the way the theme already is:

```ts
type PresenceChoice = "online" | "away" | "dnd";

status?: PresenceChoice;
onStatus?(handler: (status: PresenceChoice) => void): () => void;
notificationsAllowed?(): boolean;
```

Strings rather than the realtime enum, because the shell has no protos
and the page can map them. `notificationsAllowed` is a function rather
than a value because `contextBridge` copies values across once, at load,
and the answer changes while the page is open; it is asked at the moment
a banner would fire.

`shellStatus()` being defined is the whole test. Defined means something
else is keeping the status: the page seeds `myStatus` from it, follows
`onStatus`, does not start its own idle watch, and does not offer the
Notifications tab. Undefined means a browser, a PWA, or a shell older
than bridge 3, and everything behaves exactly as it does today.

| Shell | Server | Status decided by | What the person sees |
| --- | --- | --- | --- |
| bridge 3 | bridge 3 | the shell | One choice in App settings, obeyed everywhere. |
| bridge 3 | bridge 2 | that page | An older server keeps its own Status section and its own `localStorage` choice. App settings says so under Status. |
| bridge 2 | bridge 3 | that page | An older app: the page finds no `status` and keeps the Notifications tab. |
| none | any | that page | A browser. Unchanged, apart from Muted. |

The middle two rows are why every check is for a member rather than for
a shell. A server behind the app is normal in a self-hosted world, and
the setting should admit its reach rather than lie about it.

## Where idle is decided

`startIdleWatch()` reports Away after ten minutes without input **to its
own page**. A shell holds several servers and only one is in front, so a
page's own events cannot tell "this person has gone" from "this person is
reading something else": a page that is not in front sees no events
either way. Under a bridge-3 shell the shell asks the computer instead,
through `powerMonitor.getSystemIdleTime()`, and decides once for every
server. In a browser nothing changes.

This also closes, for the desktop app, a bug that predates the change: a
background page announcing Away while the person is plainly using Stoop
in another server or another tab. It is older and wider than this work —
it reaches a browser with two Stoop tabs open, where no amount of
`powerMonitor` can help — so it is ticketed on its own and picked up
after this lands. Nothing here should be taken as fixing the browser case.

## Rollout

Three pull requests, in this order, because the page has to tolerate a
bridge it has not met before the shell starts handing it one.

1. **`stoop`** — the page learns bridge 3 and grows a Muted section.
   Optional members, feature detection, the new tab. Useful on its own:
   Muted works in a browser immediately.
2. **`desktop`** — the gear, and the dropdown loses its last row. No
   contract change, nothing to coordinate.
3. **`desktop`** — Notifications in App settings: status, the banner
   switch, the OS idle watch, the fan-out to every loaded server.

Then, once a shell that implements bridge 3 has shipped, a fourth change
raises `BRIDGE` and `webui.Bridge` together. The constants are the
announcement, not the contract — raising them earlier would tell every
desktop user to update to an app that does not exist yet, because
`GET /version` is what the shell reads to offer the update. See the note
under the member table in `docs/architecture/desktop.md`.

## The decision: global status, not per-server

The alternative was presence per server — Online only on the server you
are looking at, Away on the rest. It was considered and rejected.

**Voice settles it.** Background server views keep running; that is
deliberate, and voice survives even closing the window. So a person could
be talking in a voice channel on one server, glance at another for thirty
seconds, and be shown Away in the channel they are audibly speaking in.
Preventing that needs a carve-out, and a presence rule that needs
carve-outs to stop contradicting what is plainly happening is the wrong
rule.

Three more, each enough on its own:

- It would silently override the app-wide choice the same screen just
  offered — a manual Online demoted to Away by which window has focus.
- It would give one dot two meanings, "not at the computer" and "at the
  computer, reading something else", which imply opposite things about
  whether to write to someone.
- It would make the shell worse than three browser tabs for exactly the
  multi-server person the shell exists to serve.

**What other apps do.** Discord keeps status global across every server
and sets idle from client inactivity — and they clearly had no objection
to per-server variation, having built per-server nicknames, avatars,
banners, bios, theme colours and decorations. Status is conspicuously not
among them, and a standing request for it in their own community forum
remains unbuilt. Slack states both rules at client level: active "when
Slack is open on your desktop", away after "10 minutes of desktop
inactivity"; which workspace is in front is never mentioned. Microsoft
Teams is the one major product whose presence really does differ per
tenant — not by design, but as a side effect of guest access and
federation — and the documented result is guests appearing offline while
active, which people experience as the product being broken.

The two products that chose deliberately both chose global. The one that
ended up per-tenant did so by accident, and is the cautionary tale.

## Open

- **How App settings admits a server it cannot reach** — proposed as a
  line of copy under Status ("Servers running an older Stoop keep their
  own status setting"). The alternative is listing each server and
  marking the ones too old, which is more truthful and more machinery.
- **Whether a hidden window should count as away.** Today a hidden page's
  ten-minute timer keeps running, so a minimised Stoop drifts to Away.
  Under OS idle it would not. If presence should track engagement with
  Stoop rather than with the computer, the honest version is: window
  hidden or minimised for ten minutes reports Away on every server — one
  rule, applied once, with voice exempt.
