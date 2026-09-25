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

The brand colours are deliberately the app's accent tokens in `web/src/themes.css`, so there is one red per theme, not a brand red and a UI red.

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

## Where every asset lives

Served files and the masters are in this repo; the desktop repo carries only
what electron-builder and the tray read.

**`web/brand/` — masters, not served.**

| File | What it is |
| --- | --- |
| `mark.svg` | the bare path, no fill |
| `icon-square.svg` | full-bleed brownstone tile, sandstone mark — the web icons and the Windows `.ico` |
| `icon-maskable.svg` | same tile, mark inside the 66 % safe circle |
| `icon-rounded.svg` | tile with transparent rounded corners (r 22.5 %) — the Linux icon |
| `icon-macos.svg` | Apple's app-icon template: the tile on 824/1024 of the canvas, transparent margin |
| `menubar-template.svg` | the path in black; macOS reads only its alpha |

**`web/public/` — served as-is from the root** (`docs/architecture/web.md`).

| File | Cut from | Size |
| --- | --- | --- |
| `favicon.svg` | hand-written: the mark in brownstone, ember under `prefers-color-scheme: dark` | — |
| `favicon-live.svg` | the same with a transparent ring at the bubble's shoulder and the live dot; `Root.tsx` swaps to it while the mic or screen is captured | — |
| `apple-touch-icon.png` | `icon-square` | 180 |
| `icon-192.png`, `icon-512.png` | `icon-square` | 192, 512 |
| `icon-maskable-512.png` | `icon-maskable` | 512 |

`web/index.html` and `manifest.webmanifest` reference these by name and did
not change.

**Desktop repo (`getstoop/desktop`).**

| File | Cut from | Read by |
| --- | --- | --- |
| `resources/icon.icns` | `icon-macos`, ten sizes 16..1024 via `iconutil` | electron-builder, mac (found by name in `buildResources`) |
| `resources/icon.ico` | `icon-square` at 16, 24, 32, 48, 64, 128, 256 | electron-builder, win |
| `resources/icon.png` | `icon-rounded` | electron-builder, linux |
| `resources/tray/trayTemplate.png`, `@2x` | `menubar-template`: the mark at 16 pt on the 22 pt canvas, 3 pt margins | `src/main/trayIcon.ts`, `setTemplateImage(true)` |
| `src/renderer/mark.svg` | the bare mark in ember (the shell is dark-only) | `add/index.html`, `gate/index.html` at 40 × 40 beside the `<h1>` |

The tray has no image-level state: unread is `setTitle` text and the dock
badge, live capture is the tooltip and the renderer strip. A template image
carries no colour, so a live tray dot would need a non-template image picked
per `nativeTheme`. Not built.

## Regenerating

```sh
node scripts/brand-icons.mjs                     # web/public/*.png
node scripts/brand-icons.mjs ../stoop-desktop    # + resources/icon.*, tray/*
```

Edit the master, run the script, commit the rasters. The `.icns` step needs
macOS. `favicon.svg`, `favicon-live.svg` and the desktop `mark.svg` are
hand-written from the path above; change them by hand.

## Not done, on purpose

- The web login card shows no mark, only the `<h1>`. Adding one is part of
  the instance-branding decision, not the icon swap.
- `web/src/api/notifications.ts` passes no `icon:`; browser banners use the
  browser's default. Worth doing when notifications get attention.
- No OG/social image. The repo has never had one.
