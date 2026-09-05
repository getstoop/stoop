# Desktop client

Status: decided 2026-09-05. The desktop app is an Electron shell in its own
repository, `getstoop/desktop`. It loads the web app each server already
serves rather than bundling a copy. This file records the shape, the
contract between the two repositories, and what has to change here before
the shell can be built. The Plane epic is STOOP-180.

Give people a real app on the dock: a tray icon, an unread badge, a
screen-share picker that can choose a window, a global push-to-talk key,
and several servers side by side. Do it without a second client to keep in
step with the server.

## Decisions at a glance

| | |
| --- | --- |
| Runtime | Electron. Tauri's system webviews cannot capture the screen on Linux and are unreliable for WebRTC on macOS, and voice is half the product. |
| Shape | A thin shell. Each server's own web app is loaded from its URL. Nothing from `web/` is compiled into the desktop app. |
| Repository | `getstoop/desktop`, separate. The shell has no build dependency on this repo, ships on its own cadence, and needs macOS runners and signing secrets the server's CI should not carry. |
| Servers | Several from day one. One Electron session per server, so cookies and logins never mix. |
| Compatibility | Every server publishes `GET /version`. The shell carries a minimum server version and tells the user when a server is older than that. |
| Updates | The shell updates itself through its own GitHub releases. The server keeps its no-self-update rule. |
| Bridge | A small `window.stoop` object injected by the shell. The web app feature-detects it and never imports Electron. |
| PWA | A web manifest served by the server, in this repo. No service worker. |
| Signing | Apple Developer ID with notarization, and a Windows certificate. Applied for once there is a build to submit. |

## Why a thin shell

`docs/architecture/web.md` promises no version skew between the API and
the client that calls it, because the web app is embedded in the binary. A
desktop app that bundles its own copy of `web/dist` would break that
promise on the first release: every server would have to keep serving old
clients, and the shell would have to know about every server's API level.
Loading the server's own web app keeps the promise. The shell is a browser
with opinions, and the only contract it depends on is the one below.

That contract is deliberately small so the shell rarely needs a release
when the server does, and the other way round.

```
┌───────────────────────── getstoop/desktop ──────────────────────────┐
│  main process                                                       │
│    server list · one session per server · tray · badge · updater    │
│    deep links (stoop://) · screen picker · global shortcuts         │
│                                                                     │
│  one WebContentsView per server ──► https://chat.example.com/       │
│    preload: window.stoop = { bridge, version, platform, setBadge }  │
└──────────────────────────────┬──────────────────────────────────────┘
                               │ ordinary HTTPS, cookies, /ws, /livekit
                               ▼
┌────────────────────────── stoop (this repo) ────────────────────────┐
│  GET /version         { name, version, bridge }                     │
│  GET /                the web app, which feature-detects the bridge │
│  web/public/manifest  the PWA manifest                              │
└─────────────────────────────────────────────────────────────────────┘
```

Because the shell loads the real origin, the session cookie, the
Content-Security-Policy, the WebSocket origin check and the OIDC redirect
flow all see an ordinary browser. No server setting changes for the
desktop app to work against an instance that works in Chrome today.

## The contract

Everything the shell relies on, in one place. Changes to any of this bump
the `bridge` number. The full text lives in
`docs/architecture/desktop.md` once the first pieces land; this is the
design.

### `GET /version`

Unauthenticated, JSON, served beside `/healthz`:

```json
{ "name": "stoop", "version": "0.4.0", "bridge": 1 }
```

- `name` lets the shell confirm a typed URL is a Stoop server before it
  shows a login page.
- `version` is `buildinfo.Version` without the `v`. The shell compares it
  with the minimum it supports and refuses older servers with a message
  that names both versions and says the operator needs to update.
- `bridge` is the version of `window.stoop` the served web app speaks.
  A newer server against an older shell keeps working, because the web app
  feature-detects each bridge method; the shell uses the number to offer an
  update. An older server against a newer shell is what the minimum
  version is for.

Publishing the version to anyone who asks is deliberate. The shell needs
it before login, and the web app's asset hashes already disclose it.

### `window.stoop`

The preload script exposes it through `contextBridge`. Version 1:

| Member | Type | Purpose |
| --- | --- | --- |
| `bridge` | `1` | The contract version this shell implements. |
| `version` | string | The shell's own version, for the profile page and bug reports. |
| `platform` | `"darwin" \| "win32" \| "linux"` | Keyboard hints, title-bar padding. |
| `setBadge(count)` | `(n: number) => void` | The unread total for this server. The shell sums across servers for the dock and tray. |
| `onShortcut(name, handler)` | `(name: "pushToTalk", h: (down: boolean) => void) => () => void` | Global shortcuts the shell captured while unfocused. |

Absent bridge means a browser. The web app never branches on a user
agent string. The shell does send `Stoop-Desktop/<version>` in the user
agent so a server log can tell the two apart.

What the shell does without the bridge, because Chromium already does it:
the Notification API shows native banners and delivers clicks to the page;
`getDisplayMedia` reaches the shell's own picker through
`setDisplayMediaRequestHandler`; `target="_blank"` links reach the system
browser through `setWindowOpenHandler`; `document.hasFocus()` answers the
attention check in `api/notifications.ts`.

### Deep links

`stoop://open?server=https://chat.example.com&path=/join/CODE`. The shell
picks the matching server, adds it if unknown, and navigates its view to
the path. Every path the web app already routes is a valid target.
Invite pages get a "Open in the app" link once the manifest and the
scheme exist; that is a later slice.

## What changes in this repository

1. **One origin helper.** The WebSocket URL, the LiveKit signaling URL,
   file links and invite links each read `location` on their own. One
   function in `api/` computes the origin; every caller uses it. Harmless
   today and the one change that keeps a bundled client possible later.
2. **A platform seam.** `api/platform.ts` with the bridge type above and a
   browser implementation. Notifications, the badge count and the
   push-to-talk hook go through it. The count already drives the page
   title in `routes/Root.tsx`; it also calls `setBadge` when a bridge is
   present.
3. **`GET /version`** in `internal/app`, from `buildinfo`, with the
   bridge constant next to the seam it describes.
4. **The web manifest** in `web/public`, plus icons. `display:
   standalone`, `theme_color` from the default theme, `start_url: /`.
   The CSP already permits `manifest-src 'self'`. No service worker: the
   app is not useful offline, and a worker that cached the shell of the
   SPA would reintroduce the skew the whole design avoids.
5. **`docs/architecture/desktop.md`** with the contract, written as the
   pieces land.

Each is a small pull request that improves the browser app on its own.

## What lives in `getstoop/desktop`

- Electron, TypeScript, `electron-builder`. Targets: macOS universal DMG,
  Windows NSIS installer, Linux AppImage and `.deb`.
- The server list: a name, a URL, an icon fetched from the instance status
  once logged in. Adding a server normalises the URL and fetches
  `/version`; a wrong URL is refused with the response it got.
- One `session.fromPartition("persist:server-<id>")` per server. One
  `WebContentsView` per server, one shown at a time, a server strip in the
  shell's own chrome to switch. Views stay alive so voice keeps running in
  a server that is not in front.
- Tray with the summed badge, minimise to tray, launch at login as
  options.
- The screen picker window, listing screens and windows from
  `desktopCapturer`, and on macOS 15 and later the system picker.
- `stoop://` registration on all three platforms.
- `electron-updater` against the repository's GitHub releases.
- The compatibility gate: a per-server "this server needs updating" page
  when `/version` is below the minimum, and an "update the app" hint when
  `bridge` is above what the shell knows.

## Risks

- **Identity providers in a webview.** Google refuses sign-in from
  anything it recognises as an embedded browser. The shell sends a
  standard Chrome user agent with the desktop marker appended, which is
  what other Electron chat clients do. If a provider still refuses, the
  fallback is the system browser handing the session back over a deep
  link, which is a server change: the server already accepts bearer
  tokens, but the OIDC state cookie binds the flow to one browser and
  would need a second binding.
- **Screen capture on Linux under Wayland** goes through PipeWire and
  needs the portal. Electron supports it; the picker must fall back to the
  portal's own dialog.
- **Media ports are unchanged.** The shell does not fix a server that has
  no reachable UDP; `docs/architecture/voice.md` still applies.

## Out of scope

Mobile, offline reading, a bundled client that talks to a server over
CORS, and end-to-end encryption. `docs/vision.md` lists the last two as
non-goals; the first two wait for demand.

## Tickets

STOOP-180 is the epic. Children by title prefix: Web 1–7 are STOOP-181,
182, 183, 184, 187, 188 and 189; Server 1 is STOOP-185; Docs is STOOP-186;
Desktop 1–12 are STOOP-190 through 201.
