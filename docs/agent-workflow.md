# Working on Stoop with a coding agent

How work gets handed to a coding agent, whichever harness runs it, and
the traps this codebase has that an agent will fall into unless told.
Everything below was paid for on real sessions; keep it current when a
new one bites. "The maintainer" below is whoever is directing the agent.

## The brief

One ticket per session, one phase per ticket. A brief that works has these
sections, in this order:

1. **The ticket** — what to build, in prose the agent can act on. Name the
   issue or tracker item, and say that the agent must not create new ones.
2. **Orientation (read before writing code)** — the 4–6 files that matter,
   with one line each on *why* (e.g. "`useFormatting` relies on the
   textarea's own selection").
3. **Non-negotiables** — module boundaries
   (`docs/architecture/modules.md`), file
   layout (`docs/conventions.md`: one component per file, one stylesheet
   per feature), "don't touch the message format / server / protos", no
   new dependencies, Biome rules that bite (`aria-hidden` on SVGs, no ARIA
   roles on divs, index keys need a `biome-ignore`), no `console.log`.
4. **Tests** — the browser spec to write (`web/e2e/<name>.mjs`, added to
   `SPECS` in `web/e2e/run.mjs`, modelled on an existing spec) and what it
   must check. Say what the spec *cannot* see (pixel alignment, scroll
   position) and demand a direct measurement for those.
5. **How to build, run, and verify** — copy the block below verbatim.
6. **Housekeeping** — work on a branch and open a pull request (see "How
   a change lands" below; `main` refuses direct pushes), commit via
   `git commit -F <file>` with the trailer
   `Co-Authored-By: <the agent's own name>`, doc updates, and "report
   faithfully: if a spec fails or you skipped a step, say so rather than
   declaring done".

## How to build, run, and verify (paste into every brief)

- First, in every new shell: `cd <repo> && set -a && source .env && set +a`.
  The gitignored `.env` at the repo root sets `STOOP_DATABASE_URL`,
  `STOOP_TEST_DATABASE_URL`, `STOOP_E2E_DATABASE_URL`, `STOOP_E2E_BASE_URL`,
  `STOOP_URL`, `STOOP_LISTEN_ADDR` (`:8091`) and `STOOP_ALLOWED_WS_ORIGINS`
  to the dev-compose defaults. Never type a DB URL or password into a
  command — use the variables (see the redaction trap below). If the file
  is missing, this is it for the dev compose stack:

  ```sh
  STOOP_DATABASE_URL=postgres://stoop:stoop@localhost:5440/stoop?sslmode=disable
  STOOP_TEST_DATABASE_URL=postgres://stoop:stoop@localhost:5440/stoop?sslmode=disable
  STOOP_E2E_DATABASE_URL=postgres://stoop:stoop@localhost:5440/stoop?sslmode=disable
  STOOP_E2E_BASE_URL=http://localhost:8091
  STOOP_URL=http://localhost:8091
  STOOP_LISTEN_ADDR=:8091
  STOOP_ALLOWED_WS_ORIGINS=localhost:*,127.0.0.1:*
  ```
- Run everything from the repo root: `make lint`, `make test`, `make build`.
  There is no Makefile inside `web/`.
- Go tests need Postgres (`STOOP_TEST_DATABASE_URL`, set by `.env`; the dev
  value is `postgres://stoop:stoop@localhost:5440/stoop?sslmode=disable`).
  Dev services (Postgres on host port **5440**, LiveKit natively on 7880 via
  `scripts/dev-livekit.sh`): `make dev-services`. When starting `bin/stoop`
  by hand, voice needs `STOOP_LIVEKIT_URL` from the tracked `.env.dev`
  (`source .env.dev` after `.env`) in its environment — there is no key
  pair to pass. The server mints one on
  first boot and writes `data/livekit/keys.yaml`, which the dev
  `livekit-server` is started against with `--key-file`; it waits for that
  file when the checkout is fresh. A database wipe drops the saved pair,
  and the next boot adopts the one in the file rather than minting a new
  one the running LiveKit would reject.
- To test in a browser do **not** use `air` or `pnpm dev`. `make build`, then
  start the binary with an absolute path as a background process (the
  `.env` already provides `STOOP_DATABASE_URL`, `STOOP_LISTEN_ADDR=:8091` and
  `STOOP_ALLOWED_WS_ORIGINS`): `/abs/path/to/bin/stoop`.
  Before starting, `lsof -nP -iTCP:8091 -sTCP:LISTEN` and stop **only** a
  previous `bin/stoop` there.
- **Never kill a listener you did not start.** On a developer's machine
  the neighbouring ports (8080, 5173, 5432, 443) are other projects'
  containers, and a `kill -9` there can take down Docker Desktop. If a
  port you need is taken, pick another.
- **Do not run any browser spec — `make e2e`, `scripts/e2e-scratch.sh` or
  `node e2e/run.mjs <spec>` — until the maintainer has reviewed the change
  on their running dev instance and said so.** Iterate with `make lint`, `make test`,
  `make build`, a restarted `bin/stoop`, and (for UI work) your own
  puppeteer screenshots; then present the change set and wait. Once
  approved, `make e2e` builds, then runs every spec (~7 minutes) on a
  throwaway instance: `scripts/e2e-scratch.sh` recreates the `stoop_e2e`
  database on the dev Postgres, starts a second `bin/stoop` on :8092 with
  its own storage under `tmp/e2e-storage`, points the runner at both and
  stops the server when done. The dev server on :8091 and its data are
  untouched. `make e2e specs="replies edits"` runs a subset; the server
  log is `tmp/e2e-server.log`. Only `make dev-reset` wipes the dev
  database (it needs the server running — the wipe is `psql`, the seed
  goes through the API) to get back to the seeded cast: eight named
  accounts plus eighteen extras in The Stoop, password `password1`,
  `casey` the server admin, in "The Stoop" and "Basement Arcade". It
  prints who they are. `node scripts/dev-reset.mjs --append` only adds
  missing extras to a running instance that still has the cast.
  `make dev-flood count=20000` fills The Stoop with generated messages
  straight into Postgres (authors are its members, spread over the last
  60 days) for trying search and history at size; reload the tab to see
  them.
- Iterate on `make lint` until clean: it runs golangci-lint, Biome and tsc.

## How a change lands

`main` is protected by a repository ruleset: no direct pushes, no
force-pushes, and a pull request can only merge once every CI job is green
(Protobuf, Go, Web, Browser E2E, and both cross-compiles). This is deliberate
— it replaced committing straight to `main` on 2026-09-01, when the project
got big enough that a red `main` cost more than the round-trip saves.

- Branch from an up-to-date `main`: `git switch -c <short-name> main`.
  One ticket per branch.
- Commit as before (`git commit -F <file>` with the trailer), push with
  `git push -u origin HEAD`, then `gh pr create --fill` (or with a body that
  says what changed and why; the ticket id goes in the title).
- CI runs the same jobs it runs on `main`, including the browser suite —
  on its own throwaway Postgres, so it never touches the dev database.
  Local `make lint` / `make test` / `make build` before pushing keep the
  round-trips short; the E2E rule above (wait for the user) still applies
  locally, but the CI run needs no permission.
- To land it: `gh pr merge --squash --auto` queues the merge for when the
  checks pass; `--merge` keeps the branch's commits when they tell a story.
  The branch is deleted on merge. Never `--admin`, and never push to `main`
  — if the ruleset ever needs bypassing that is the user's call, made in the
  repository settings, not from a session.
- A red check on the PR is the work not being done yet. Fix it on the
  branch and push; don't ask for the check to be skipped.

## Traps (each of these has cost a real session time)

- **The binary embeds `web/dist` at `make build`.** After any change under
  `web/`, `make build` and restart `bin/stoop` before running a browser spec,
  or the spec tests the old code. The symptom is a fix that "doesn't work"
  while the source is plainly right.
- **Enter sends.** A newline in the composer is Shift+Enter. A puppeteer
  script that does `page.type("…\n…")` posts a message per line (as the
  seeded user) instead of building a multi-line draft.
- **The e2e suite needs the maintainer's go-ahead.** Don't run it per-iteration;
  rebuild, restart, and let a human look. Run it once, as the gate before
  commit, after the change has been approved. `make e2e` no longer touches
  the dev database, but `node e2e/run.mjs` on its own still wipes whatever
  `STOOP_E2E_DATABASE_URL` names, and `.env` names the dev one.
- **A tab opened before a rebuild keeps the old JavaScript until it
  navigates.** `index.html` is served `Cache-Control: no-cache` with an
  ETag (since 2026-08-27), so any reload picks up a new build — but a tab
  that just sits there doesn't reload itself. If a UI fix "doesn't show"
  for a human while your own fresh-context screenshot shows it, ask for a
  reload before touching the code again.
- **Profile-page specs reach cards by content, not position.** They used
  to take the password form as `$$(".card")[1]`, which broke the day a card
  was inserted above it (About you, 2026-08-31); it is now
  `.card:has(input[autocomplete="current-password"])`. Keep it that way —
  a card added to `/profile` should not be able to break an unrelated spec.
  The display-name form is still `.card input`, i.e. the first card, so
  nothing goes *above* Name.
- **`setQueryData` bumps `dataUpdatedAt`.** An effect keyed on a query's
  `dataUpdatedAt` to detect "a fresh fetch happened" also fires on every
  cache write (the realtime client's appends, history prepends). Put
  fetch-only side effects in the `queryFn` (see `useMessages` seeding the
  history store), not in an effect.
- **The timeline is a window, not "everything since the top".** A jump
  (reply quote, `?m=`) can replace `["messages", channelId]` wholesale,
  and a non-live window never contains the newest message. Code that
  appends realtime events must go through `appendMessage` (which defers
  to the history store), and a `queryFn` refetch must keep a non-live
  window rather than swap the newest page in under the reader.
- **Dividers are siblings of message rows, not children.** `.new-divider`
  and `.day-divider` sit between `.message` elements in `.message-list`
  (so the row's absolutely positioned avatar stays aligned). From a
  divider, the message it introduces is `nextElementSibling`, not
  `closest(".message")`.
- **Below 768px the rail and channel sidebar are a transformed drawer.**
  `position: fixed` elements rendered inside `.channel-sidebar` (the invite
  modal) are positioned relative to the sidebar while it is translated, so
  never close the drawer from code while one is open. Drive phone-width
  specs with `isMobile: true, hasTouch: true` and `page.tap()`:
  `page.click()` under mobile emulation misses buttons it had to scroll
  to (the setup wizard's "Skip for now"), and `tap(selector)` aims at the
  element's centre — for the scrim that is under the drawer panel, so tap
  the strip beside it by coordinates. A tap that lands under the scrim
  hangs `Input.dispatchTouchEvent`; make sure the drawer is closed first.
- **A hand-started `bin/stoop` for the E2E suite needs `.env.dev` too**,
  not just `.env`: `STOOP_UNFURL_ALLOW_PRIVATE=true` (the unfurl spec
  serves its page from 127.0.0.1) and `STOOP_AUTH_RATE_LIMIT=0` (dozens of
  sign-ins from one IP). Without them `unfurl` fails with no card and late
  specs can be throttled. `scripts/e2e-scratch.sh` sets both itself.
- **Message actions live in one floating toolbar per row** (`.message-toolbar`,
  top-right, visible on hover/focus; continued rows show the time there
  too). `page.$$(".message-action")` inside a row finds exactly one of
  each; hover the row first so it's clickable. Nothing about time or
  actions is in `.message-content`.
- **The shell's working directory persists between tool calls.** A `cd web`
  in one command leaves the next one relative to `web/`, where `.env`,
  `make`, and `internal/…` don't exist. Start commands from the repo root
  (`cd /abs/path/to/stoop && …`) or use absolute paths.
- **pnpm/corepack re-adds `"packageManager"` to `web/package.json`** on every
  run (build, e2e). Revert it as the last step before committing:
  `git checkout -- web/package.json`.
- **`make dev-reset` needs the server up** on `STOOP_URL` (default :8091):
  the seed goes through the API. It checks first and refuses before
  wiping anything, so start the server, then reset.
- **Run specs through `scripts/e2e-scratch.sh <spec>` to keep the dev
  data.** It is what `make e2e` runs, minus the build: a second server on
  :8092 against a freshly recreated `stoop_e2e` database, with
  `STOOP_STORAGE_DIR` set for both the server and the runner (the
  `uploads` and `attachments` specs stat blobs on disk themselves) and
  `STOOP_UNFURL_ALLOW_PRIVATE` on the server (`unfurl` serves its fixture
  site on 127.0.0.1). Pointing `pnpm e2e` at a hand-made scratch database
  instead needs all of that by hand, and a scratch database that outlives
  a branch can carry goose rows for migration numbers another branch used
  for something else — the specs then fail in their preamble while the
  server log says `relation … does not exist`. Recreate it; the script
  does so on every run.
- **CI runs the suite as four parallel shards**, each against its own
  server and database: `pnpm e2e --shard N/4`. The split is by the
  seconds in `WEIGHT` in `web/e2e/run.mjs`, not by count, so a new or
  much slower spec belongs there; the run summary prints every spec's
  seconds to copy from. The branch ruleset requires only the roll-up job
  named "Browser E2E" — add or remove shards without touching it.
- **`make dev-reset` wipes whatever the maintainer typed on the dev
  instance.** They often try a change live; say so before running, and expect the
  seeded cast ("The Stoop" and "Basement Arcade") afterwards — their test
  messages and channels are gone. `make e2e` does not do this any more.
- **Adding a theme is four touches plus the prose that counts them.**
  A block in `web/src/themes.css`, an entry in `THEMES` in
  `src/api/theme.ts` (biome formats it one field per line — edit it, don't
  pattern-match one-line objects), the id in `index.html`'s inline
  pre-mount list (must stay in step with `theme.ts` or a saved choice is
  ignored before React mounts), and the card list in `e2e/themes.mjs`.
  `pnpm check:themes` (part of `make lint`) must pass; the checker's
  regex allows hyphenated ids. Then the places that name the count:
  `README.md`, `docs/conventions.md`, `docs/self-hosting.md` and the
  spec's own check message all still said "eight" when Night Bus made
  nine (2026-08-31). Grep the current number word across the repo before
  you call it done — and again if you remove one.
- **Run the browser suite against a server without `STOOP_TAILSCALE`.**
  With the built-in Tailscale listener on, the public URL defaults to the
  tailnet address and invite links use it — `setup.mjs` and `invites.mjs`
  then fail on the link origin. That is the feature working, not a bug;
  start the E2E server the way CI and `scripts/e2e-scratch.sh` do (no
  Tailscale, no trust-proxy).
- **Leave 8091 free when you're done.** `make dev` refuses to start
  (`dev-port-check`) while anything holds the port: a stale `bin/stoop`
  started by hand carries only `.env`, not `.env.dev`'s `STOOP_LIVEKIT_URL`,
  so Vite would proxy the user to a server that says "voice is not configured".
  Stop your background `bin/stoop` before ending a session.
- **`air` means `$(go env GOPATH)/bin/air`.** Homebrew's `air` formula is an
  unrelated R language server that shadows it on PATH; `make dev` calls the
  Go one by path. And air ≥ 1.67 reads env only from `env_files`, never
  from an `[env]` table in `.air.toml` — put dev settings in `.env.dev`.
- **Voice needs LiveKit on the host network.** Browsers hide local IPs
  behind mDNS names a bridge-networked container can't resolve; the
  symptom is "Connecting…" forever and `removing participant without
  connection` in `tmp/livekit.log`. `make dev-services` starts the native
  `livekit-server` on macOS; don't reintroduce a bridged container for it.
  The compose files pin LiveKit to one exact version and the script warns
  when the brew binary differs; bump `deploy/docker-compose.yml`,
  `deploy/docker-compose.dev.yml` and `LIVEKIT_VERSION` in
  `scripts/dev-livekit.sh` together.
- **To reproduce "voice ports unreachable" locally**, run `livekit-server`
  with a config that sets `rtc.node_ip` to an unroutable address *and*
  `rtc.ips.excludes` covering every real range (see the join-error work
  on 2026-08-27) — `node_ip` alone isn't enough, pion still offers the
  host's own interfaces. The join must fail with the media-path message
  within ~16 s, never hang on "Connecting…".
- **A styled overlay must not change glyph metrics.** Real bold and a bare
  `<code>` (browser default monospace) are wider than the textarea's text —
  measured +7 px and +29 px — so the caret drifts. Emphasis in the composer
  overlay is paint-only; see the comment in `web/src/styles/composer.css` and the width
  checks in `web/e2e/composer-styling.mjs`.

### Harness traps

- **Secrets in the brief may be redacted to `***` in the agent's own
  transcript and replayed literally after a context compaction.** Seen as
  `make test` failing with `password authentication failed for user
  "stoop"` after an agent had passed the DB URL inline for an hour — it
  was now sending the string `***`. It then "fixed" the database
  (`ALTER ROLE`). Give secrets as environment variables the agent can
  `source` (a `.env`), not as inline text, and if this symptom appears
  tell it the literal value and to re-type the command — never to change
  Postgres.
- **Long commands die at the harness's foreground timeout.** `make e2e`
  takes ~7 min; run it in the background with completion notification, or
  raise the timeout, rather than letting the harness kill the suite
  (`make: *** [e2e] Terminated: 15` plus a puppeteer "detached Frame"
  error is what that looks like). `nohup`/`setsid` wrappers may be
  rejected by the harness.
