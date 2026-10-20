# Stoop for phones

> [!CAUTION]
> **Work in progress. Do not build or install this app.**
>
> It is not a usable Stoop client: it signs in and stops there,
> it talks to a development server over plain HTTP, and it is not
> released, signed for distribution or supported. Use Stoop in the
> browser. The steps below are only for people developing the app
> itself.

The React Native app, built with Expo as a **development build**: a native
app of our own (not Expo Go) that installs from a Mac onto a real iPhone or
Android phone and loads its JavaScript from Metro on that Mac. Everything
builds locally; no Expo cloud services are used.

So far it is the welcome screen, Add a server, which checks a typed
address, and Sign in, by password, a login provider, or a new account
where the server takes them without an invite, with Forgot password
asking the server for a reset link, and joining from an invite link,
pasted or handed over by the web's open-in-app page. A signed-in server opens
on a stand-in that says who you are, until the Spaces tab replaces it.
The screens follow the mobile mockups, one at a time.

## Screens and routes

Navigation is [Expo Router](https://docs.expo.dev/router/introduction/):
each file under `src/app` is a route, and `_layout.tsx` files arrange
them into stacks (and later tabs). Route files are a few lines that
import a screen; the screens themselves live in `src/screens`, so
`src/app` stays a map of the app.

- A screen gets IDs from its route and looks the rest up; never pass an
  object through route parameters. A notification or a link can open any
  screen cold, so it must work that way anyway.
- A screen that needs something first (a server, a session) gets a
  redirect in its folder's `_layout.tsx`, not a check in the screen. A
  layout sees only its own path segments (`[id]`), never the `?query`:
  a guard on a query parameter goes in the route file instead
  (`src/app/sign-in/index.tsx`).
- Buttons navigate with `useRouter()` in `onPress`, not by sitting inside
  `<Link asChild>`: the link hands its own props down and drops a
  `Pressable`'s style function, so the button loses its look.
- Typed routes are off for now: Expo generates their types only while
  Metro runs, and `make mobile-typecheck` runs without it.

## Themes

The app wears the web app's themes. `src/theme/generated.ts` is written
from `web/src/themes.css` and `web/src/tokens.css` by `make mobile-theme`;
never edit it by hand. Screens read colours through `useTheme()` and sizes
from `tokens`, the same names as the CSS custom properties in camel case
(`--text-muted` is `textMuted`).

`ThemeProvider`, around the whole app in `src/app/_layout.tsx`, holds the current
theme, Brownstone to start, and sets the status bar to match;
`useThemeName()` reads and changes it. Nothing offers a choice yet, and
the choice is not saved across launches.

The Stoop mark is `assets/mark.png` (with `@2x` and `@3x`), cut by
`make brand` and tinted with the theme's accent.

## Prerequisites

- Node 22 and pnpm 11. `mobile/` has its own lockfile and is not a pnpm
  workspace with `web/`.
- **iPhone:** Xcode and CocoaPods. On the phone, Developer Mode on
  (Settings → Privacy & Security); in Xcode, the team that signs the app.
- **Android:** Android Studio, which brings the SDK, `adb` and a JDK, with
  `ANDROID_HOME` set (usually `~/Library/Android/sdk`). On the phone, USB
  debugging on.
- The phone and the Mac on the same Wi-Fi, with the dev server running
  (`make dev`, on :8091). Allow the macOS firewall prompt the first time.

## Point it at the server

Type the dev server's address into Add a server, with the scheme, since
the app otherwise adds `https://`: `http://192.168.1.20:8091`. Use the
Mac's LAN address (`ipconfig getifaddr en0`), not `localhost`, which on a
phone is the phone.

The check follows the desktop app's (`docs/architecture/desktop.md` →
`GET /version`): the server must answer as Stoop and be at least
`MIN_SERVER_VERSION` (`src/api/probe.ts`). A dev build reports `dev`,
which always passes.

## Signing for iOS

The committed bundle ID is `org.getstoop.app`. A bundle ID belongs to
the first Apple team that builds it, so until the project's own team
is set up, build under your own ID and team by adding two lines to
`mobile/.env.local` (read by `app.config.js`):

```sh
STOOP_IOS_BUNDLE_ID=org.getstoop.dev
STOOP_APPLE_TEAM_ID=ABCDE12345
```

Re-run `make mobile-prebuild` after changing either. The first build of
a new ID fails with "No profiles for …". Either open
`ios/Stoop.xcworkspace` in Xcode, pick the team under Signing &
Capabilities and let it register the device and ID, or build once from
`mobile/ios` with `xcodebuild -workspace Stoop.xcworkspace -scheme Stoop
-destination id=<phone UDID> -allowProvisioningUpdates`. Then build
again as usual.

## Make targets

From the repo root; none of them joins `make lint`, `make test` or
`make build`.

| Target | What it does |
| --- | --- |
| `make mobile-ios` | Builds onto a connected iPhone and starts Metro |
| `make mobile-android` | The same for a connected Android phone |
| `make mobile-metro` | Starts Metro for a build already on the phone |
| `make mobile-prebuild` | Regenerates `ios/` and `android/` from `app.json` |
| `make mobile-theme` | Regenerates `src/theme/generated.ts` from the web themes |
| `make mobile-typecheck` | `tsc --noEmit` over `mobile/`, generated client included |
| `make mobile-sim` | A release build onto the iPhone simulator (`sim="iPhone 16 Pro"` for another) |
| `make mobile-e2e` | The Maestro flows on a throwaway server (below) |

`mobile/ios` and `mobile/android` are generated (Expo's continuous native
generation) and gitignored. Native settings go in `app.json` or a config
plugin, never into those folders by hand.

After the first install, `make mobile-metro` (or `pnpm start` in
`mobile/`) serves JavaScript to a build already on the phone, with no
native rebuild.

## Tests

The happy paths are [Maestro](https://maestro.dev) flows in `mobile/e2e/`,
one YAML file each, driving the app on the iPhone simulator: add a server
and sign in, create an account from a pasted invite link, and open an
invite the way the web's open-in-app page does, then sign in and join.
They find things by the words on screen and, for text fields, a
`testID`.

`make mobile-e2e` runs them as `make e2e` runs the browser suite, on a
throwaway server: a fresh `stoop_mobile_e2e` database, `bin/stoop` on
:8093, and `e2e/seed.mjs` making the accounts, space and invite over RPC
with the browser suite's seed. What it made is handed to each flow as
`${MEMBER}`, `${INVITE_LINK}` and the rest. `make mobile-e2e
flows=mobile/e2e/sign-in.yaml` runs one.

Before the flows, `e2e/setup/autofill-off.yaml` turns off the
simulator's password AutoFill in Settings. Left on, iOS takes Maestro's
fast typing into a new-password field for AutoFill and covers the field
with a strong password, so the typed one never lands. The app keeps its
real password hints; only the test simulator changes.

Once per machine:

1. Maestro and a Java runtime (17 or newer). Install the Maestro CLI from
   its [release page](https://github.com/mobile-dev-inc/maestro/releases)
   into `~/.maestro`, with Java from `brew install openjdk@17`, and put
   both on the path:
   `export PATH="$HOME/.maestro/bin:/opt/homebrew/opt/openjdk@17/bin:$PATH"`.
2. `make build`, for `bin/stoop`, and `make dev-services` for Postgres.
3. `make mobile-sim`: a release build, with its JavaScript inside, so the
   flows need no Metro. Build again after changing the app.

The flows are not in CI yet: that needs a simulator or an emulator on
the runner.

## Plain HTTP to the dev server

The dev server speaks plain HTTP on the LAN. Expo's native template
already allows that in development, so nothing in `app.json` adds it:

- **iOS:** the generated `Info.plist` sets `NSAllowsLocalNetworking`,
  which permits HTTP to local addresses (Metro relies on it too). It is
  in the one `Info.plist` every configuration uses, so a release build
  carries it as well; the release work removes it or accepts it.
- **Android:** cleartext is allowed only in the debug manifest
  (`src/debug/AndroidManifest.xml`); a release build refuses it.

## The shared generated client

`@stoop/gen/*` maps to `../web/src/gen/*` (`tsconfig.json`; Metro reads
the same mapping). `metro.config.js` makes every package resolve from
`mobile/node_modules`, so the generated files use this app's
`@bufbuild/protobuf`, never a second copy from `web/node_modules`.
