# Stoop for phones

> [!CAUTION]
> **Work in progress. Do not build or install this app.**
>
> It is not a usable Stoop client: it has no sign-in and one test screen,
> it talks to a development server over plain HTTP, and it is not
> released, signed for distribution or supported. Use Stoop in the
> browser. The steps below are only for people developing the app
> itself.

The React Native app, built with Expo as a **development build**: a native
app of our own (not Expo Go) that installs from a Mac onto a real iPhone or
Android phone and loads its JavaScript from Metro on that Mac. Everything
builds locally; no Expo cloud services are used.

So far it is one smoke-test screen (STOOP-501): the dev server's
`GET /version`, and `InstanceService.GetInstanceStatus` called through the
generated client in `web/src/gen`, which the app shares as source.

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

The server address is read from `mobile/.env.local`, which is gitignored:

```sh
EXPO_PUBLIC_STOOP_URL=http://192.168.1.20:8091
```

Use the Mac's LAN address (`ipconfig getifaddr en0`), not `localhost`,
which on a phone is the phone. Expo inlines the value when Metro bundles,
so restart Metro after changing it.

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
| `make mobile-prebuild` | Regenerates `ios/` and `android/` from `app.json` |
| `make mobile-typecheck` | `tsc --noEmit` over `mobile/`, generated client included |

`mobile/ios` and `mobile/android` are generated (Expo's continuous native
generation) and gitignored. Native settings go in `app.json` or a config
plugin, never into those folders by hand.

After the first install, `pnpm start` in `mobile/` serves JavaScript to a
build already on the phone, with no native rebuild.

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
