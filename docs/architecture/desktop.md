# The desktop client

**The desktop app is a browser with opinions.** It lives in its own
repository, `getstoop/desktop`, and loads the web app this server already
serves; nothing from `web/` is compiled into it. So there is no client
version to keep in step with the server, and the whole contract between
the two is what this page lists. Every item here is something the shell
relies on. Change one and bump the bridge level.

The design and the reasoning are in
[../proposals/desktop-client.md](../proposals/desktop-client.md). This is
the contract.

## `GET /version`

Unauthenticated JSON, served by `internal/app` beside `/healthz`:

```json
{ "name": "stoop", "version": "0.4.0", "bridge": 1 }
```

| Field | Source | What the shell does with it |
| --- | --- | --- |
| `name` | constant | Confirms a typed address is a Stoop server before showing a login page. Anything else is refused with the response it got. |
| `version` | `buildinfo.Version` without the `v`; `dev` in a dev build | Compared with the shell's minimum. An older server gets a page that names both versions and says the operator needs to update. |
| `bridge` | `webui.Bridge` | The `window.stoop` level the served web app speaks. Above what the shell knows, the app still works (it feature-detects) and the shell offers an update. |

The shell asks on add, on every reconnect and on focus, not only once.
Disclosing the version is deliberate; the web app's asset names change
with every release anyway (`docs/self-hosting.md` → Security headers).

## `window.stoop`

The shell's preload script exposes one object through `contextBridge`.
The web app's side is `web/src/api/platform.ts`, which feature-detects the
object and never reads the user agent: absent bridge means a browser or an
installed PWA, and every wrapper there is a no-op. Version 1:

| Member | Type | Purpose |
| --- | --- | --- |
| `bridge` | `1` | The contract level this shell implements. |
| `version` | string | The shell's own version, for the profile page and bug reports. |
| `platform` | `"darwin" \| "win32" \| "linux"` | Keyboard hints, title-bar padding. |
| `setBadge(count)` | `(n: number) => void` | The unread total for this server. `routes/Root.tsx` sends `alertingCount` off the activity cache; the shell sums across servers for the dock and tray. |
| `onShortcut(name, handler)` | `(name: "pushToTalk", h: (down: boolean) => void) => () => void` | Global shortcuts the shell captured while the window was not focused. Returns the unsubscribe. |

Two rules keep the number honest. **Adding a member is a bump**, so a
shell can tell an app that expects more than it has. **The app checks
for a member before calling it** and treats absence as "not in this
shell", so a newer server never breaks an older shell.

`BRIDGE` in `platform.ts` and `Bridge` in `internal/webui/bridge.go` are
the same number and move in the same pull request.

## The theme tokens

The shell paints its own pages — the screen picker, the add-server page,
settings, the gate page — in the colours of the page in front, so a window
the shell draws over the app does not look like a different app. Those
colours are the theme that view is wearing, which is a per-viewer choice
in its own `localStorage`, not something the server publishes.
It reads them off the page it is already showing, with
`getComputedStyle(document.documentElement)` on load and again whenever
`theme-color` changes:

`--canvas`, `--surface`, `--panel`, `--raised`, `--border`, `--text`,
`--text-muted`, `--accent`, `--accent-soft`, `--on-accent`, `--danger`,
and `color-scheme`.

`web/src/themes.css` defines all of them for every theme. Renaming or
dropping one is a change to this contract, so it bumps the bridge.
Nothing breaks in the meantime: a colour the shell cannot read it
derives from `theme-color` instead, the same fallback it uses for a page
that has not loaded yet.

Reading them rather than being handed them is deliberate. It works
against a server nobody will ever update, which a `window.stoop` member
would not.

## What needs no bridge

Chromium already does these, so the shell does not wrap them and the web
app does not special-case them:

- **Notifications.** The Notification API shows native banners and
  delivers the click to the page, which already navigates on click. The
  shell grants the permission itself and may be reaching a LAN server
  over plain HTTP, so `desktopPermission()` answers `granted` inside the
  shell without the HTTPS check.
- **Screen share.** `getDisplayMedia` reaches the shell's own picker
  through `setDisplayMediaRequestHandler`.
- **External links.** Anything that opens a new window goes to the
  system browser through `setWindowOpenHandler`; navigation off the
  server's origin is refused and opened outside.
- **Attention.** `document.hasFocus()` answers the attention check in
  `api/notifications.ts`, so a banner fires only when the window is not
  in front.

## Sessions

One Electron session partition per server (`persist:server-<id>`), so
cookies, storage and permission grants never cross servers. The session
cookie in it behaves as in a browser: 30 days, renewed on use. Switching
servers never prompts for a password.

## Deep links

```
stoop://open?server=https://chat.example.com&path=/join/CODE
```

The shell picks the server whose origin matches, offers to add it if
unknown, and navigates its view to `path`. Every path the web app routes
is a valid target; the shell never interprets it.

## The user agent

The shell sends a standard Chrome user agent with `Stoop-Desktop/<version>`
appended, so a server log can tell the two apart and identity providers
see a browser they accept. The web app does not read it.

## Two repositories

| Here | In `getstoop/desktop` |
| --- | --- |
| `GET /version` and `webui.Bridge` | The compatibility gate |
| `api/platform.ts` and everything routed through it | The preload that fills `window.stoop` |
| `web/public/manifest.webmanifest` and the icons | Server list, sessions, views, tray, badge, picker, deep links, updater |
| This page | A README that points here |
