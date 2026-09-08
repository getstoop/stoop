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
installed PWA, and every wrapper there is a no-op. Version 2:

| Member | Type | Purpose |
| --- | --- | --- |
| `bridge` | `1` | The contract level this shell implements. |
| `version` | string | The shell's own version, for the profile page and bug reports. |
| `platform` | `"darwin" \| "win32" \| "linux"` | Keyboard hints, title-bar padding. |
| `setBadge(count)` | `(n: number) => void` | The unread total for this server. `routes/Root.tsx` sends `alertingCount` off the activity cache; the shell sums across servers for the dock and tray. |
| `onShortcut(name, handler)` | `(name: "pushToTalk", h: (down: boolean) => void) => () => void` | Global shortcuts the shell captured while the window was not focused. Returns the unsubscribe. |
| `theme` | `ShellTheme` | Bridge 2. The theme the shell wears now, whole: `{ scheme, tokens }`, tokens keyed by CSS name. Set before the page's first script runs, so `index.html` paints it with no flash. |
| `onTheme(handler)` | `(h: (theme: ShellTheme) => void) => () => void` | Bridge 2. The shell changed theme. Returns the unsubscribe. |

Two rules keep the number honest. **Adding a member is a bump**, so a
shell can tell an app that expects more than it has. **The app checks
for a member before calling it** and treats absence as "not in this
shell", so a newer server never breaks an older shell.

`BRIDGE` in `platform.ts` and `Bridge` in `internal/webui/bridge.go` are
the same number and move in the same pull request.

## The theme

**The shell owns the theme.** Someone using the desktop app chooses a
theme once, under App settings → Appearance, and everything they see
wears it: the strip, the screen picker, the add-server and settings and
gate pages, and the web app of every server they have added. Nothing a
server does changes it, and leaving a server for one of the shell's own
pages, or for a server that has never been themed, leaves the colours
where they were. The shell keeps the preference in its own settings file
and resolves "follow system" itself, from the OS.

That is why the shell carries its own copy of the themes
(`src/shared/themes.ts` in `getstoop/desktop`: the ids, names and every
token of `web/src/themes.css`). Its own pages have to paint with no
server in front, and a page it has not loaded has no colours to read.

**The contract is the shape of a theme, not the list of them.** The
shell hands the page the whole theme as `window.stoop.theme` and again
through `onTheme` when it changes:

```ts
interface ShellTheme {
  scheme: "dark" | "light";       // color-scheme
  tokens: Record<string, string>; // "--canvas": "#141517", … by CSS name
}
```

No name crosses: a theme is what it is made of. `api/theme.ts` (and the
inline stamp in `index.html`, before React mounts) puts every token it
knows on `<html>` as it is, sets `color-scheme`, stamps none of its own
themes, and hides the Appearance tab, since the picker for a shell user
is the shell's. A theme the shell has and this build does not renders
the same as one it has; a theme this build has and the shell does not
simply cannot be picked from the shell. The two lists need not match.
The token names are the part that must: a token this build uses and
the shell did not send takes the default's value, and renaming or
dropping one in `themes.css` changes what a page expects to be handed,
so it bumps the bridge. `TOKEN_NAMES` in `api/theme.ts` is the list.

The browser's picker and its `localStorage` preference are untouched:
the same server opened in a browser keeps the theme chosen there. A
bridge-1 shell has no `theme` member; against one, the page behaves as
a browser too.

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
stoop://auth?server=https://chat.example.com&code=CODE
```

The shell picks the server whose origin matches and navigates its view.
`open` offers to add a server it does not have, and every path the web app
routes is a valid target; the shell never interprets it. `auth` resolves
to `/auth/desktop/complete?code=` on the named server and is **dropped
when that server is not already in the list**, so a page cannot walk
someone into adding a server and signing in on it.

An `auth` link is the last leg of provider sign-in, and of connecting a
provider to an account already signed in. Providers refuse either inside
an embedded view, so the app opens the provider in the system browser and
the outcome comes back through the link: `docs/architecture/identity.md` →
Sign-in from the desktop app has the whole flow. Two things the shell
holds up its end of:

- **The link loads in the view already open for that server**, because the
  page's `sessionStorage` holds the verifier that redeems the code — and,
  for a link, because that view holds the session the identity attaches
  to.
- **The server is matched by exact origin string**, so the address the
  person typed and the server's `public_url` have to agree. When they do
  not, the hand-back is dropped and the app looks like it did nothing.

The code says which it was: `/auth/desktop/complete` answers a sign-in with
a token and a link with the identity it found, and the page lands on the
redirect or on `/profile?linked=<provider>`. A link takes one more step —
the app names the address that came back and waits to be told to attach it,
because nothing else in the round trip proves *whose* identity it is
(`identity.md` → What a stolen attempt id can do).

A start URL is good for one start. Reloading it in the browser, or a
speculative prefetch reaching it first, spends the attempt and sends the
person back to the app to begin again.

A round trip that fails comes back the same way, as an `open` link — to
`/login?error=<code>` for a sign-in, `/profile?error=<code>` for a link —
so the message lands in the app instead of on a form in the browser.

Nothing here needs a bridge member: the outbound leg is `window.open`,
which `setWindowOpenHandler` already sends to the system browser, and
linking reuses the `auth` link unchanged.

### An invite link opens the app

An invite stays `https://server/join/CODE`, so it keeps working with no
app, on a phone, in any browser. The `stoop://` attempt is made by the
page the link lands on, never by the link.

**In a browser, an invite link lands on a choice.** `Root` gates the
whole route tree on it (`components/InviteHandoff.tsx`): the app, or this
browser. It fires `stoop://open` for the same path — `?space=` hint and
all — as soon as it renders, and says "Opening Stoop… Open in the Stoop
app / Continue in this browser".

**That page does nothing with the invite.** It never looks the code up
and never redeems it: it sits above `AppShell`, so nothing beneath it has
mounted. A dead code fails where it always did, on the page that handles
it, and a person who came for the app is never joined in a browser they
did not mean to use. "Continue in this browser" drops the gate and the
app carries on exactly as it would have — a stranger to the invite
landing, someone signed in to `/join`, which redeems on mount as before.
The answer lasts as long as the page is loaded; nothing is stored, so a
fresh load asks again.

It fires for everyone, because a browser cannot tell whether the app is
installed: there is no API, and the user agent is off limits
(`api/platform.ts`). The cost is borne by the people it cannot help —
Firefox opens an app chooser and iOS Safari an error — and it is paid
once per invite.

Inside the shell there is no gate at all: `canOpenInApp` is false there,
and the invite goes straight through.

The server is matched by exact origin, as everywhere else here: someone
who added the server by its LAN address while `public_url` is the public
hostname is offered a second entry rather than the one they have.

**A browser under automation is never reached for** (`underAutomation`,
on `navigator.webdriver`). Chrome answers a `stoop://` navigation with an
external-protocol prompt, and that prompt is not scriptable: it swallows
every event aimed at the page for as long as it stands, so a spec that
landed on an invite could no longer be driven at all. The choice still
renders and its button still fires — a spec must never click it. Nearly
every spec joins its second user by following an invite link, so they go
through `gotoInvite` in `e2e/lib.mjs`, which takes the way past.

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
