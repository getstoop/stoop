# The voice bar, the mic level, and evening out voices

Status: approved 2026-10-29 (the designs and every recommendation
below). Nothing is built. Follows the voice volume work in 0.17.0
(server #596, desktop #51), which added the 0 to 200% slider, the Web
Audio mix and the volume keys.
Design: the "Voice volume design" canvas, row "Round two": "Sidebar
voice bar · stacked pickers, meter under the mic" (the bar, with
talking/quiet/muted and camera on/off tweaks), "Mic level meter · the
three states", "Popover · slider to 300%, word marks (decided)" and
"How each voice is processed".

## Scope

Four changes to the web app's voice bar and playback, all client-side,
none touching the server, the protocol or the desktop shell:

1. **The sidebar voice bar is restyled** as a status row, a device
   list and a row of toggle tiles (below, The bar).
2. **Your mic's level shows in the bar**, inside the mic's row, and
   says when your mic is quiet (The mic level).
3. **The volume slider goes to 300%**, its marks become words, and a
   limiter after the slider keeps a boosted shout from clipping (The
   chain).
4. **"Even out voices"**, a compressor per speaker behind a switch in
   the volume popover (The chain).

Out of scope: noise suppression beyond the browser's default (LiveKit's
own filter is Cloud-only; an open-source model in a worklet is a later
project), per-speaker volume, a mic gain slider on the sending side,
and any change to the stage bar beyond what the shared controls need.

## Why

Playing games over voice, the game drowns the call out at 200%, and
one quiet friend is harder to hear than the rest however far the
slider goes. The level meter answers "is it me or them": a quiet mic
is visible to its owner before anyone has to say so.

## What exists

- **The bar** (`components/VoiceBar.tsx`, `styles/voice.css`): a
  wrapping flex row of status, a device row and the shared controls
  (`VoiceActions`, also rendered by the stage's `StageBar`, so the two
  never drift). The device row holds `DevicePicker` selects for the
  mic and, only while the camera is on, the camera; a picker with one
  device is not shown at all ([voice.md](../architecture/voice.md) →
  Devices). With the camera on, the two selects share one row and
  truncate at about twelve characters.
- **Your own speaking ring** is measured locally
  (`api/voiceLevel.ts`): LiveKit's `createAudioAnalyser` on the
  published mic track, an averaged FFT magnitude against a fixed
  threshold with a hold, tuned for a yes/no decision. It stops while
  muted.
- **Playback** (`api/voice.ts`): the room is created with
  `webAudioMix`, so LiveKit plays each remote track through its own
  gain node and keeps the `<audio>` elements muted. `playbackGain`
  returns the chosen volume as a gain, or 0 while deafened, and
  `track.setVolume` applies it. `api/voiceVolume.ts` holds the value
  (`stoop.voiceVolume`, ceiling `MAX_VOLUME` 200, step 10) and the
  keys switch; `components/VoiceVolume.tsx` is the popover.
- **LiveKit's per-track hook.** `RemoteAudioTrack.setWebAudioPlugins`
  takes nodes it wires between the track's source and its own gain
  node: source → plugins → gain → destination. Nothing can follow
  LiveKit's gain node.
- **Capture** uses LiveKit's defaults: the browser's echo
  cancellation, noise suppression and automatic gain control are all
  on. The meter reads the track after that processing.
- **The browser spec** (`web/e2e-pw/voice.spec.ts`) finds the bar by
  `.voice-bar` and its controls by `aria-label` ("Mute", "Unmute",
  "Deafen", "Turn camera on", "Disconnect"); `push-to-talk.spec.ts`
  reads `.voice-bar strong`.

## The bar

From the top:

- **Status row.** "Voice connected" and "channel · space" at the left,
  as today. **Disconnect** moves up to the right of it as a tile,
  wider and a little taller than the toggles, the handset in danger
  red on a faint danger fill. It is the one destructive action in the
  bar, which is why it sits apart from the toggles.
- **Device list.** One rounded group on the panel colour holding two
  rows with a hairline between them, no borders, no focus ring at
  rest: a small muted icon, the full device name, and a chevron at the
  right. The group replaces the `DevicePicker` selects visually; each
  row is still a native select underneath, styled, so the keyboard and
  the browser's own device menu stay as they are.
  - **The mic row is always there**, even with one device (it is the
    meter's home). With one device the chevron is left off and the row
    does not open.
  - **The camera row is always there too**, so the bar never changes
    height when the camera is turned on. Off, it reads "Camera off"
    in muted text with a crossed camera icon and no chevron; on, it
    is the camera's name and opens the picker. "Camera off" rather
    than a remembered name, because the browser gives no camera names
    until the camera has been on once (Open questions → 2).
- **Toggle tiles.** Camera, screen, mute, deafen and volume as five
  equal tiles across the width on the panel colour, 32px tall. Camera
  on tints its icon ok green; muted tints the mic tile's fill and icon
  danger red, as the ⓘ"on" state does today.

The stage bar keeps its pill of icon buttons: it sits on video, where
tiles would be heavy. So `VoiceActions` gains a `layout` prop (`"row"`
for the stage, `"tiles"` for the sidebar) and renders Disconnect only
in the row, the sidebar drawing its own. One component still, two
arrangements. The `aria-label`s do not change, so the browser specs
need only follow the new Disconnect placement.

## The mic level

Ten small segments inside the mic row, before the chevron, like a
signal indicator: lit from the left as you talk, with the highest
recent segment holding for a moment and sliding down. Three looks:

- **Talking:** lit segments ok green.
- **Quiet:** your mic is live but has not reached the speaking level
  for a while. Lit segments and the mic icon turn warn amber, and the
  row's tooltip reads "Your mic is quiet. Move closer or turn it up
  in your system settings." The ring threshold is the natural line:
  if the ring never lights, nobody hears you well.
- **Muted:** segments dark, the mic icon danger red (the tile already
  says why).

How it is measured:

- **A loudness, not the ring's decision.** The ring's reader averages
  FFT magnitudes over a fixed band and compares to one threshold. The
  meter wants an RMS over the time-domain samples, smoothed, with a
  separate peak hold, so the segments move with the voice and the
  quiet judgement is fair. Same analyser node, a second read of it, in
  `api/voiceLevel.ts` beside the ring: one meter, two readings, so the
  ring and the segments can never disagree about what is being heard.
- **Quiet is sustained, not instant.** Gain control hides a quiet mic
  for a few seconds and every pause between words dips under the
  line, so the amber state waits for about four seconds of sound above
  the noise floor that never reaches the speaking level. Pure silence
  (nobody talking) is not quiet. Numbers are tunable constants with
  the reasoning beside them, as the ring's are.
- **What it shows is what others hear.** The published track is
  post-processing, so the browser's gain control is already applied.
  Turning a hardware input down dips the segments, which then creep
  back as the browser compensates, until it cannot. That is the
  honest reading and the one the meter is for.
- **Cost.** One analyser is already running for the ring. The meter
  adds a store write per animation frame while unmuted; the component
  reads it with a selector and renders ten spans. Muted, nothing runs.

## The chain

Every remote voice passes through, in order:

1. **Even out voices** (optional): a `DynamicsCompressorNode` with a
   low threshold and a moderate ratio (around −24 dB and 4:1, knee 30,
   attack 3 ms, release 250 ms), which the Web Audio spec gives
   automatic make-up gain, so quiet talkers come up and loud ones come
   down. Off, the node is bypassed (not in the chain), so the call
   sounds exactly as it does today.
2. **Volume:** the slider's gain, 0 to 3, or 0 while deafened.
3. **Keep from clipping** (always): a second compressor set as a
   limiter (threshold about −3 dB, ratio 20:1, knee 0, attack 1 ms,
   release 50 ms). It does nothing until a peak would clip, so it is
   inaudible at normal volume and has no setting.

Then LiveKit's own gain node, left at 1, and the destination.

Why the order matters, and why this needs our own gain node: a
compressor evens the signal before the slider and cannot know how far
the boost was turned up, so only a stage after the slider stops the
peaks. LiveKit's plugin hook puts every node before its gain, so the
slider's gain becomes a node of ours inside the plugin list and
`setVolume` is no longer used for volume or deafen; `playbackGain`
keeps its meaning and drives our node instead. One chain per track, so
a loud friend is tamed on their own chain and never ducks a quiet one.

- **300%.** `MAX_VOLUME` becomes 300. The slider's marks become words:
  "Off" at 0, "Normal" at 100, "Loudest" at 300; the readout stays a
  number, since the keys step by 10 and the number is what moves. A
  stored value from before is still valid.
- **The switch.** "Even out voices" with the subtext "Louder volumes
  may distort sound." sits under the marks in the popover, a switch at
  its right, above Reset. It lives in the popover and not on Account
  → Voice because that tab is hidden inside the desktop app; the
  popover reaches both. Kept on this device as `stoop.voiceEvenOut`,
  off by default, like the other voice choices. Reset touches only
  the volume.
- **Rebuilding the chain.** The plugin list is set when a track is
  attached and again when the switch changes; LiveKit reconnects the
  nodes. Volume changes only set the gain node's value, as now.

## Pull requests

In this order, each on main, each reviewed by a fresh agent before it
opens:

1. **`voice-bar-layout`** — the restyled sidebar bar: status row with
   Disconnect, the device list (both rows always present, styled
   selects), the toggle tiles, `VoiceActions` `layout`, stylesheet,
   the specs' Disconnect selector, voice.md → Devices. No meter yet:
   the mic row has the space for it.
2. **`voice-mic-level`** — the loudness reading in `voiceLevel.ts`
   with its tests (RMS, peak hold, the quiet rule against fed
   samples), the store fields, the segments component in the mic row,
   voice.md → Speaking rings gains the meter.
3. **`voice-chain`** — our gain node in the plugin list, deafen and
   volume through it, the limiter, `MAX_VOLUME` 300, the word marks,
   tests for the chain's construction (which nodes, in which order,
   against a stubbed AudioContext), voice.md → Voice volume.
4. **`voice-even-out`** — the compressor, the stored switch, the
   popover row with its subtext, tests, docs.

1 and 2 are independent of 3 and 4. Each is listened to on the dev
server before it merges: the chain PRs change what every call sounds
like, and unit tests cannot hear.

## Decisions

- **No stage-bar meter.** The stage shows the speaker's video; a level
  for your own mic belongs with your mic's name.
- **Words for the marks, a number for the readout.** Five named steps
  were drawn and rejected: too coarse for the keys, and every word
  hides a number we chose.
- **The limiter has no switch.** Without it, 300% of a shout crackles;
  with it, nothing changes until that moment.
- **The compressor is off by default.** It changes the sound of every
  call; people turn it on for the friend who mumbles.
- **No desktop change.** The keys, the bridge level and the voice
  actions are untouched.

## Open questions

1. **Quiet after how long?** Four seconds of sound that never reaches
   the ring's threshold is the starting point; tune by ear.
2. **"Camera off" or the remembered camera?** Once the camera has been
   on in a session its name is known. Start with "Camera off"; show
   the name later if it is missed.
3. **Where the limiter bites.** A −3 dB threshold leaves headroom; if
   the top of the slider still sounds squashed, lower the compressor's
   make-up by a fixed gain instead of moving the limiter.
