# The server switcher

Status: proposed 2026-09-07 (STOOP-210); placement decided the same day —
option B, the overlay view. Mockups of the options and the row states live
as a design page in the maintainer's tooling; the reasoning is all here.
Open decisions at the end.

The desktop shell switches servers through a native menu popped from the
title strip. This is the design for replacing it with a panel the shell
draws itself, now that the shell's own pages follow the theme of the page
in front (STOOP-208).

## The problem

`popupServerMenu()` builds an Electron `Menu` and pops it under the strip
button. A native menu is drawn by the OS, so:

- **It cannot take the theme.** macOS draws it in the system appearance,
  Windows in Win32 grey. Every other surface the shell draws — the strip,
  the screen picker, add-server, settings, the gate page — now paints in
  the colours of the page in front. The switcher is the one thing that
  does not, and it is the piece someone opens most.
- **It can only say words.** Unread is the string `"(3)"` appended to the
  name. A server that cannot be reached reads exactly like one that is
  fine: the shell knows it is gated, and the menu has nowhere to put that.
- **It cannot show a server.** No icon, no colour, no host. Two servers
  called "The Stoop" are two identical rows.

The tray menu has the same limits and will keep them; see below.

## What the panel should say

Everything here is already in main, on the slot: `name`, `server.url`,
`badge`, `gated` and the gate reason, `version`, `newer`, and since
STOOP-208 the colour tokens read off each page. Nothing new is asked of
the server, and the bridge does not move.

```
┌────────────────────────────────────┐
│ ▌ ⬤  The Stoop                  3  │  current: accent bar, unread pill
│      chat.example.com          ⌘1  │
│                                    │
│   ⬤  Neighbours                    │
│      stoop.example.net         ⌘2  │
│                                    │
│   ◌  Old Box                    ⚠  │  cannot be reached
│      192.168.1.9:8080          ⌘3  │
├────────────────────────────────────┤
│  +   Add a server…                 │
│  ⚙   App settings…                 │
└────────────────────────────────────┘
```

- **The tile** carries a monogram on a colour derived from the server's
  origin: the hue from a hash of it, saturation and lightness fixed by the
  scheme so it reads in a light theme and a dark one. Stable per server,
  and the same on every machine, which is the point — a server has no
  colour of its own to borrow. The theme is a per-viewer choice living in
  that view's `localStorage` (`stoop.theme`), so an accent says what the
  person picked while they were in that server, not whose server it is,
  and most people pick one theme and keep it: tiles taken from the theme
  would be three identical squares. When instance branding ships an icon
  (STOOP-104) the tile becomes the icon and the monogram is the fallback.
- **The host** under the name is what actually distinguishes two servers
  with the same name, and it is the thing someone checks before typing a
  password.
- **The right edge** carries one thing at a time: an unread pill, or a
  warning glyph for a server the shell cannot reach or that needs
  updating, or the `⌘n` hint for the rest.
- **A gated server** keeps its row and stays clickable — clicking it goes
  to the gate page as it does today, which is where Try again and Remove
  live. The row says the state; the page explains it.

## Where it is drawn

**A. A frameless `BrowserWindow` popover**, as the screen picker already
does. Real shadow, rounded corners, free to overhang the window edge.
Against it: a second window to position against display bounds by hand,
Wayland where a window cannot always place itself, a beat of latency on
first open unless it is kept warm, and focus leaving the page's
`webContents` to another window every time someone glances at the list.

**B. A `WebContentsView` overlay inside the window** — a third shell view
beside the strip and the page view, spanning the content area, its
background transparent, hidden until the strip button is clicked. Chosen.
It costs no new window and no positioning maths, opens instantly once
loaded, dismisses by a click anywhere on its own transparent backdrop, and
behaves identically on all three platforms.
It paints in the theme through the same `followTheme()` every other shell
page uses. The panel is clipped to the window, which is not a constraint
in practice: the strip is at the top-left and the window's minimum is
720×480, while the panel is about 300px wide and capped at 60% of the
content height.

The one thing to prove first is a transparent `WebContentsView` over a
live page view (`setBackgroundColor("#00000000")`); if that will not
composite cleanly, the fallback within option B is a solid panel with no
backdrop and dismissal on `blur` and `Escape` only.

**C. Keep the native menu and dress it up** with a 16px `nativeImage` per
row. Cheapest, and it keeps the radio marks and accelerators for free. It
does not answer the ask: still OS-coloured, still no badge that is not a
string.

**D. A permanent server rail down the left edge**, Discord-style, and no
menu at all. One click to switch, unread always visible. Rejected for now:
the web app already draws a spaces rail hard against the left edge, so
this puts two vertical rails side by side, and it charges every
single-server person horizontal space forever for a feature only
multi-server people use. Worth revisiting as a setting once someone runs
five servers.

## Keyboard, focus and dismissal

- `⌘1`–`⌘9` keep working and stay where they are, in the app menu's
  Servers submenu. The panel is a second way in, not a replacement for the
  accelerators, and the submenu is also what makes servers findable in the
  macOS Help menu's search.
- Opening moves focus into the panel; `↑`/`↓` move, `Enter` switches,
  `Escape` closes, `Tab` reaches the two footer actions.
- Closing returns focus to the front server's `webContents`. Without that
  the composer loses its caret and the next keystroke goes nowhere — the
  thing a native menu gets right for free and a panel has to do by hand.
- The panel closes on: a choice, `Escape`, a click on the backdrop, and
  the window losing focus.

## What main has to hand it

One push, `shell:servers`, of the rows the panel draws: id, name, host,
badge, state (`ok` | `unreachable` | `too-old` | `not-stoop`), the tile
hue derived from the origin, whether it is the current one, and its
accelerator. Sent when the list changes, when a badge changes, and when a
probe answers. The panel's own colours are not in this push — they arrive
through `followTheme()` like every other shell page, from whichever view
is in front.

`SettingsView.servers` already carries a thinner version of the same list
for the settings page. Both should come from one `serverRows()` in
`MainWindow`, so the settings list and the switcher can never disagree
about what is reachable.

## The tray stays native

`Tray.setContextMenu` is drawn by the OS and there is no themed version of
it — a custom window hung off a tray icon has to position itself against a
menu bar it cannot measure, and on Linux the tray may be an XEmbed icon or
a StatusNotifierItem depending on the desktop. The tray menu keeps the
plain list it has. This is a decision, not an oversight: the tray is the
OS's furniture, the window is ours.

## Rollout

1. The overlay view and the panel: rows, current server, unread, gate
   state, footer actions. The strip button opens it; the native popup goes
   away.
2. Keyboard, focus return, and the dismissal rules above.
3. Drag to reorder, persisted as the order of `servers.json` — which the
   accelerators, the tray and the settings list all already follow.
4. Icons in the tiles when instance branding lands them.

## Open decisions

1. **The host line**: always under the name, or only when two servers
   would otherwise read the same?
2. **Reorder**: step 3 above, or not until someone asks?
3. **The rail** (option D): never, or a setting once there is a person
   with five servers to prove it on?

Settled: **option B**, the overlay view, subject to the transparency spike
in step 1 — if a transparent view will not composite over a live page view,
the fallback inside B is a solid panel dismissed on `blur` and `Escape`.
