# The mark

Stoop's logo is a speech bubble whose tail is two stone steps: the talk, and
the place it happens. It is one path, one colour, on an 8-unit grid inside a
64-unit box, so it stays crisp from a 16 px favicon to a 1024 px app icon
without a size-specific redraw.

```svg
<svg viewBox="0 0 64 64">
  <path d="M28 8H44A12 12 0 0 1 56 20V28A12 12 0 0 1 44 40H32V48H24V56H8V48H16V20A12 12 0 0 1 28 8Z"/>
</svg>
```

Rules that keep it working:

- **One path, one colour.** No strokes, no gradients, no second colour. The
  live dot (below) is a state, not part of the mark.
- **Every coordinate is a multiple of 4.** At 16 px each step is exactly two
  device pixels. Don't nudge points off the grid.
- **The tail juts 8 units past the bubble's left edge.** Flush with the
  edge, the silhouette collapses into a letter P.
- **Round where it speaks, square where it stands.** Three rounded corners
  (r 12) on the bubble, square steps. Don't round the steps.
- The mark's box is 8..56 on both axes (48 × 48). In a tile it sits at
  scale 0.72 translated (9.5, 9); in the Android maskable safe circle at
  scale 0.56 translated (14.5, 13.5).

## Colour

| Name | Hex | Where |
| --- | --- | --- |
| Brownstone | `#b5482f` | the mark on light grounds, the icon tile; the light theme's `--accent` |
| Ember | `#e2725b` | the mark on dark grounds; the dark theme's `--accent` |
| Sandstone | `#f6f1e8` | the mark knocked out of the tile |
| Asphalt | `#1f1d1a` | the mark as plain ink |
| Live | `#2f9e6b` | the capture dot only |

The brand colours are deliberately the app's accent tokens in
`web/src/themes.css`, so there is one red per theme, not a brand red and a
UI red.

## Wordmark

Today the name is set as text: `<h1>Stoop</h1>` in the pre-login card
(`web/src/routes/Login.tsx`, `Setup/index.tsx`, `LinkHandoff.tsx`,
`DesktopAuthComplete.tsx`; `.login-card h1` in `web/src/styles/login.css`)
and in the desktop shell's add-a-server and gate pages. That stays as it is:
the app is system-font only (`--font-ui`), `scripts/check-styles.mjs` refuses
other families, and the CSP is `font-src 'self'`. The proposed wordmark
(lowercase `stoop`, Rubik SemiBold, tracked −0.035 em) would ship as outlined
SVG, not a webfont, and waits on the decision in
[proposals/instance-branding.md](proposals/instance-branding.md), which
replaces that same `<h1>` slot with the operator's own icon and name. The
mark is the *default* identity there, not a fixed one.

## Where it lives

`brand/` in this repo is the home: the masters, the pipeline and the files
other consumers copy out. It stays here while the consumers are this repo
and the desktop shell; a third (a website) is the point to move it to its
own repository, and the layout is meant to move as one directory.

```
brand/masters/   hand-drawn SVGs, the only files edited by hand
brand/build.mjs  `make brand`: cuts everything below
brand/dist/      committed outputs for other repos (desktop/, press/)
web/public/      the web icon set, written directly, served from the root
```

**Masters.**

| File | What it is |
| --- | --- |
| `mark.svg` | the bare path, no fill |
| `mark-ember.svg` | the path in ember with a title — the desktop shell's in-app mark |
| `favicon.svg` | the mark in brownstone, ember under `prefers-color-scheme: dark` |
| `favicon-live.svg` | the same with a transparent ring at the bubble's shoulder and the live dot |
| `badge.svg` | the path in white — the notification badge (alpha only) |
| `icon-square.svg` | full-bleed brownstone tile, sandstone mark |
| `icon-maskable.svg` | same tile, mark inside the 66 % safe circle |
| `icon-rounded.svg` | tile with transparent rounded corners (r 22.5 %) |
| `icon-macos.svg` | Apple's app-icon template: the tile on 824/1024 of the canvas, transparent margin |
| `menubar-template.svg` | the path in black; macOS reads only its alpha |

**`web/public/`** — served as-is from the root (`docs/architecture/web.md`).

| File | From | Read by |
| --- | --- | --- |
| `favicon.svg` | copied | `index.html`; `Root.tsx` swaps to `favicon-live.svg` while the mic or screen is captured |
| `favicon.ico` | `favicon` at 16, 32, 48 | browsers without SVG favicons, and anything that fetches `/favicon.ico` unasked; no `<link>` needed |
| `apple-touch-icon.png` | `icon-square` at 180 | iOS home screen, Safari |
| `icon-192.png`, `icon-512.png` | `icon-square` | the manifest; `icon-192` is also the banner icon in `web/src/api/notifications.ts` |
| `icon-maskable-512.png` | `icon-maskable` | the manifest, `purpose: maskable` |
| `badge-96.png` | `badge` | `notifications.ts` `badge:` — the monochrome status-bar glyph on Android |

`manifest.webmanifest` lists the SVG (`sizes: any`), the two PNGs and the
maskable one.

**`brand/dist/desktop/`** — the desktop shell runs `make brand` to copy
these in (`scripts/brand-sync.mjs` there; a sibling checkout by default).

| File | From | Read by |
| --- | --- | --- |
| `icon.icns` | `icon-macos`, ten sizes 16..1024 via `iconutil` | electron-builder, mac (by name in `buildResources`) |
| `icon.ico` | `icon-square` at 16..256 | electron-builder, win |
| `icon.png`, `icons/NNxNN.png` | `icon-rounded` | electron-builder, linux (`linux.icon: icons`); `icons/256x256.png` also ships as the window icon |
| `tray/trayTemplate.png`, `@2x` | `menubar-template`: the mark at 16 pt on the 22 pt canvas, 3 pt margins | `src/main/trayIcon.ts`, macOS, `setTemplateImage(true)` |
| `tray/tray.ico`, `tray/tray.png` | the tile at 16..48 / at 32 | `trayIcon.ts`, Windows / Linux — those trays draw the image as-is, so a template glyph would be invisible on a dark tray |
| `mark.svg` | `mark-ember` copied | `add/index.html`, `gate/index.html` at 40 × 40 beside the `<h1>` |

The tray has no image-level state: unread is `setTitle` text and the dock
badge, live capture is the tooltip and the renderer strip. A template image
carries no colour, so a live tray dot would need a non-template image picked
per `nativeTheme`. Not built.

**`brand/dist/press/`** — the mark in each colour as SVG and the rounded
icon at 256 and 1024, for a README, a site, a listing.

## Regenerating

```sh
make brand                       # here: web/public and brand/dist
cd ../stoop-desktop && make brand   # there: copies dist/desktop in
```

Edit a master, run both, commit the outputs in both repos. The `.icns`
step needs macOS. Outputs are deterministic, so a clean run on an unchanged
master leaves the tree clean.

## Not done, on purpose

- The web login card shows no mark, only the `<h1>`. Adding one is part of
  the instance-branding decision, not the icon swap.
- No OG/social image. That is the website's, when there is one.
- No DMG background or installer art; electron-builder's defaults carry
  the app icon.
