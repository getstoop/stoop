# The live capture indicator

Status: proposed and decided 2026-09-14 (STOOP-254). Renderings of every
option live as a design page in the maintainer's tooling; the decisions
and the reasoning are here.

Join voice, open your DMs, and nothing on screen says your microphone is
live. The voice bar is the only thing that says you are connected, and it
renders only inside a space (`routes/Space.tsx`). DMs, Activity, Search,
Profile, Admin and space settings show no voice state at all, while the
people in the channel can still see your camera and your screen.

## What it says

One pure function, `captureState()` in `web/src/api/capture.ts`, reads the
voice store and returns one state. Every surface draws that state and
nothing else, so the rail, the header, the tab and the desktop strip can
never disagree.

| State | Look | Rule |
| --- | --- | --- |
| Not in voice | Absent | Absent, never greyed out. |
| Joining | Pulses | Nothing is capturing yet. Steady under reduced motion. |
| Connected, muted | Quiet: struck-through mic, muted text | Connected, not capturing. Not an alarm. Deafened counts as muted. |
| Mic live | Green | The green the voice bar uses for "Voice connected". |
| Camera on | Green, camera icon | The mic rides along in a small bubble: green when live, grey and struck through when muted. |
| Sharing screen | Solid red | The loudest state, and Stop is in the pill itself. |
| Couldn't join | Red outline | The voice bar's own error text. Dismissing in either place dismisses both, because both call `leaveVoice()`. |

When more than one thing is live, the loudest decides the look:
screen, then camera, then mic.

## Where it lives

- **Browser: a pill at the top of the rail**, above Direct messages, on
  every signed-in page. The same 44px pill as its neighbours. It shows
  inside the space you are in voice for too; an indicator that comes and
  goes as you navigate is one people learn not to trust.
- **Phones: beside the menu button in the page header.** The rail is
  inside the drawer below 768px, so it would be hidden exactly when it
  matters.
- **The tab.** While anything is capturing, the title starts with `●` and
  the favicon carries a red dot. It is all a background tab has.
- **Desktop app: centred in the title strip.** The one stretch nothing
  else claims; it stays put whichever side the window buttons are on, and
  a screen share has room to widen. It is the only place that can say
  voice is live on a server other than the one in front. The rail pill
  hides when the shell draws the strip; an older shell falls back to it.
- **Desktop app: the tray.** Live items at the top of the tray menu, and
  the tooltip says what is live. A muted mic adds nothing there.

Rejected: the voice bar in every left column (Activity and Search have
none), and a bar across the top of the page (it moves the layout on every
join and leave). The top bar is the runner-up if the pill proves too easy
to miss.

## Clicking it

A popover lists the call, one action each (Mute or Unmute, Turn the
camera off or on, Stop sharing), and ends with **Go to channel**. It has no
Disconnect: a global control is easy to hit by accident, and the channel
is one click from its own. Revisit if people ask.

In the desktop app the shell draws the popover itself, over whichever
server is in front, from the report the page already sends. Its buttons
act on the call in the background, and only Go to channel switches
servers. A popover drawn by the page would have to bring that server
forward first, and controlling a call should never cost the page you are
reading.

## Drawing the eye

The first time the indicator appears for a call it moves once, so people
learn there are controls there: the rail pill grows in and pushes the rest
of the rail down, the strip pill drops into the strip, the phone header
pill pops in, and each then pings twice. Once per call, not on every page
change, and not at all under reduced motion.

## The bridge (level 3)

Two members, beside the status members already listed under bridge 3 in
`docs/architecture/desktop.md`:

- `setVoice(report | null)`: the page's voice state, sent whenever it
  changes and `null` on leave. The shell knows which server sent it.
- `onVoiceAction(handler)`: the shell asks the page to `show` the channel
  (after bringing that server forward), `mute`, `unmute`, turn the
  camera on or off (`camera-on`, `camera-off`), or `stop-screen`. Each is
  a request for a state, not a toggle, so a late click cannot flip it
  back.

STOOP-255 (joining voice on one server leaves it on another) needs the
shell to know the same fact, so it builds on `setVoice` rather than adding
its own.

## Not in scope

- What other people see. `VoiceState.camera` and `screen_sharing` already
  carry it.
- Push to talk (STOOP-126). When it lands, a push-to-talk mic reads as
  muted until the key is held, so the indicator does not flicker.
