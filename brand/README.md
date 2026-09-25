# brand/

The mark's masters and everything cut from them. `docs/brand.md` is the
design: the path, the grid rules, the colours, and who reads each file.

```
masters/   hand-drawn SVGs; the only files edited by hand
build.mjs  cuts the rest: `make brand`
dist/      what other consumers copy out (committed, so nobody needs the
           pipeline to build)
  desktop/ the desktop shell's icons and tray glyphs — `make brand` in
           that repo copies them in from this checkout
  press/   the mark in each colour and the icon at 1024, for a README,
           a site, a listing
```

The web icon set goes straight to `web/public/`, not through `dist/`.
