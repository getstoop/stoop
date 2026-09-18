# Working on Stoop with a coding agent

How work gets handed to a coding agent, whichever harness runs it, and
the traps this codebase has that an agent will fall into unless told.
Keep it current when a new one bites. "The maintainer" below is whoever is
directing the agent.

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
4. **Tests** — the browser spec to write (`web/e2e-pw/<name>.spec.ts`,
   modelled on an existing spec) and what it must check. Say what the
   spec *cannot* see (pixel alignment, scroll position) and demand a
   direct measurement for those.
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
- Go tests need Postgres (`STOOP_TEST_DATABASE_URL`, set by `.env`).
  Dev services (Postgres on host port **5440**, LiveKit natively on 7880 via
  `scripts/dev-livekit.sh`): `make dev-services`. When starting `bin/stoop`
  by hand, voice needs `STOOP_LIVEKIT_URL` from the tracked `.env.dev`
  (`source .env.dev` after `.env`); there is no key pair to pass
  ([architecture/voice.md](architecture/voice.md#development)).
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
- **Pure logic gets a unit test, not a browser.** `cd web && pnpm test`
  runs Vitest over `web/src/**/*.test.ts` in a node environment — no
  browser, no server, milliseconds per case. Run it as often as you
  like; it is also part of `make test` and the CI Web job.

- **Access rules get an end-to-end test over HTTP, not a browser.**
  `go test ./internal/app -run TestE2E` boots the whole binary in-process
  against a throwaway database and drives it the way curl would: mint an
  identity or a credential, make requests, assert the status, the Connect
  code and the sentence a person reads. The harness and its helpers are
  in `internal/app/e2e_harness_test.go`. It needs only
  `STOOP_TEST_DATABASE_URL`, runs in about a second, and is part of
  `make test` and the Go CI job. Bots, tokens and webhooks belong here;
  the browser suite is for what a person sees and clicks.

  Anything that is input-in, output-out belongs there rather than in a
  browser spec: the Markdown parser, shortcodes, member grouping. A
  parser case exercised through Chrome, a login and a composer is a slow
  and flaky way to catch what a named test case catches directly.

  `web/src/api/markdown.ts` mirrors `plainText` in
  `internal/chat/markdown.go`; they generate the same previews on
  opposite sides of the wire, so a case added to one belongs in the
  other.

- **The browser suite is Playwright** (`web/e2e-pw/*.spec.ts`,
  `npx playwright test`). `web/e2e/seed.mjs` builds an instance over RPC
  (`seed()`, `joinSpace()`), typed by `seed.d.mts`. Both the specs and
  that directory are typechecked (`tsconfig.e2e.json`) and linted.

  `fill()` sets a value in one event; anything whose subject is typing
  (an autocomplete opening per keystroke, the composer's overlay tracking
  the caret) needs `pressSequentially`. And `reload(page)` from
  `web/e2e-pw/lib.ts`, never `page.reload()`: a channel URL meets the
  desktop-app gate on reload and a plain reload walks into it.

- **Reading only counts while a page has attention.** Both
  `useMarkChannelRead` and `useAutoReadActivity` gate on `hasAttention()`
  — `document.visibilityState === "visible" && document.hasFocus()` — so
  that an unfocused tab still raises a desktop alert. That is deliberate
  product behaviour, and it makes every "…clears the badge", "…is read
  immediately" assertion depend on *which page is at the front*.

  A spec with two or three pages has only one at the front, so give the
  page focus (`focus(page)` from `web/e2e-pw/lib.ts`) before asserting
  that something it viewed became read:

  ```ts
  await focus(B);
  await expect(B.locator(".pill-badge")).toHaveCount(0);
  ```

  A longer timeout never fixes a failure here: focus never arrives.

- **A page's socket subscribes after its first queries land.** The
  channel list, the messages and the DM list are fetched as the page
  mounts, in parallel with the WebSocket handshake, and only the socket
  carries what happens next. Anything another page does in that window
  reaches this one by refetch alone. Two guards: the app refetches
  whatever it fetched before the gateway's Ready (`api/ws.ts` through
  `api/stale.ts`, which waits for a load still in flight to land and
  then goes again, because a refetch asked of a load with no data yet is
  deduped onto it rather than restarting it), and
  `signIn()`/`reload()` in `web/e2e-pw/lib.ts` wait for the rail's status
  icon to read connected before returning, so a spec never talks to a
  page that cannot hear yet. The symptom is a second page missing exactly
  what was sent right after it landed.

- **Wait for a navigation the app starts on its own.** Message on a
  member's card opens the conversation only once the server has
  answered; a `.composer textarea` reached before that is still the
  channel's, and the text typed into it is gone when the route changes.
  `await expect(page).toHaveURL(/\/dm\//)` first.

- **The server admits three uploads per account at a time**
  (`files.MaxInflightUploads`); the client queues the rest
  (`api/files.ts`). A spec that attaches many files waits for
  `.pending.ready` to count them all before moving on, or the next upload
  meets the ones still in flight.

- **Assertions poll; they never sleep a fixed time.** Playwright's
  `expect(locator)` assertions retry on their own; `expect.poll(fn)` wraps
  anything else, and `page.waitForFunction` waits on an in-page predicate
  that no locator covers. A fixed sleep before an assertion is a coin
  flip weighted by machine load.

  One exception, and it matters: an assertion that something has **not**
  happened, or has stayed unchanged, must not be polled — polling
  returns the instant it is true, which is immediately, so the assertion
  stops meaning anything. Those keep their sleep.

- **The browser suite runs in CI, on the pull request.** Don't run it
  locally before a push. Iterate with `make lint`, `make test`,
  `make build`, a restarted `bin/stoop`, and (for UI work) your own
  screenshots; the maintainer reviews the change on their dev instance.
  To debug a spec CI failed, `make e2e specs="replies edits"` builds, then
  runs those specs on a throwaway instance: `scripts/e2e-scratch.sh`
  recreates the `stoop_e2e` database on the dev Postgres, starts a second
  `bin/stoop` on :8092 with its own storage under `tmp/e2e-storage`, and
  stops it when done. The dev server on :8091 and its data are untouched;
  the server log is `tmp/e2e-server.log`. Without `specs=` it runs every
  spec (~7 minutes).
- **`make dev-reset` wipes the dev database** and seeds the cast: eight
  named accounts plus eighteen extras in The Stoop, password `password1`,
  `casey` the server admin, in "The Stoop" and "Basement Arcade". It
  prints who they are. The server must be up on `STOOP_URL` (the seed goes
  through the API); it checks first and refuses before wiping anything.
  The maintainer often tries a change live on that instance, so say so
  before running it. `node scripts/dev-reset.mjs --append` only adds
  missing extras to a running instance that still has the cast.
  `make dev-flood count=20000` fills The Stoop with generated messages
  straight into Postgres (authors are its members, spread over the last
  60 days) for trying search and history at size; reload the tab to see
  them.
- Iterate on `make lint` until clean: it runs golangci-lint, Biome, tsc
  and the theme and stylesheet checks.

## How a change lands

`main` is protected by a repository ruleset: no direct pushes, no
force-pushes, and a pull request can only merge once every CI job is green
(Protobuf, Go, Web, Browser E2E, and both cross-compiles).

- Branch from an up-to-date `main`: `git switch -c <short-name> main`.
  One ticket per branch. Branch **in the checkout the maintainer runs**,
  not a worktree: their
  `make dev` rebuilds live, so they review the change as it is made, and
  the running instance is never quietly on another branch. A branch that
  adds a migration lives there too: the dev database runs a migration
  ahead of `main` until it lands, and that is accepted. A separate
  worktree only when the maintainer asks for one, because another session
  holds the checkout. After the merge, `git switch main && git pull` in
  that checkout; `make dev` prints what it runs and warns when
  `origin/main` is ahead.
- Commit with `git commit -F <file>` and the trailer, push with
  `git push -u origin HEAD`, then `gh pr create` with a body that follows
  `.github/pull_request_template.md` (What changed and why / How it was
  verified / Checklist, ticked truthfully) — not `--fill`, which copies the
  commit log instead and skips the template entirely. The ticket id goes in
  the title.
- CI runs the same jobs it runs on `main`, including the browser suite —
  on its own throwaway Postgres, so it never touches the dev database.
  Local `make lint` / `make test` / `make build` before pushing keep the
  round-trips short.
- To land it: `gh pr merge --squash --auto` queues the merge for when the
  checks pass; `--merge` keeps the branch's commits when they tell a story.
  The branch is deleted on merge. Never `--admin`, and never push to `main`
  — if the ruleset ever needs bypassing that is the user's call, made in the
  repository settings, not from a session.
- A red check on the PR is the work not being done yet. Fix it on the
  branch and push; don't ask for the check to be skipped.

## Traps

- **The binary embeds `web/dist` at `make build`.** After any change under
  `web/`, `make build` and restart `bin/stoop` before running a browser spec,
  or the spec tests the old code. The symptom is a fix that "doesn't work"
  while the source is plainly right.
- **Enter sends.** A newline in the composer is Shift+Enter. A script that
  types `"…\n…"` posts a message per line (as the seeded user) instead of
  building a multi-line draft.
- **`npx playwright test` on its own wipes whatever
  `STOOP_E2E_DATABASE_URL` names, and `.env` names the dev database.**
  `make e2e` uses its own.
- **A tab opened before a rebuild keeps the old JavaScript until it
  navigates.** `index.html` is served `Cache-Control: no-cache` with an
  ETag, so any reload picks up a new build — but a tab
  that just sits there doesn't reload itself. If a UI fix "doesn't show"
  for a human while your own fresh-context screenshot shows it, ask for a
  reload before touching the code again.
- **Profile-page specs reach cards by content, not position**:
  `.card:has(input[autocomplete="current-password"])`, never the second
  `.card`. A card added to `/profile` should not be able to break an
  unrelated spec.
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
- **Any server the suite runs against needs `STOOP_UNFURL_ALLOW_PRIVATE=true`
  and `STOOP_AUTH_RATE_LIMIT=0`** — a hand-started `bin/stoop`, and CI's
  too. The unfurl spec serves its page from 127.0.0.1, and the auth limit
  (20 calls per IP per minute) is cleared in about twenty specs now that
  each one seeds its cast over RPC. A throttled run does not look like
  throttling: specs that seed fail in under a second on a 429, and specs
  that drive the signup form hang until they time out.
  `scripts/e2e-scratch.sh` and `.github/workflows/ci.yml` both set them.
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
- **Run specs through `make e2e` or `scripts/e2e-scratch.sh <spec>`**
  (the same thing minus the build), never a hand-made scratch database.
  The script sets `STOOP_STORAGE_DIR` for both the server and the runner
  (the `uploads` and `attachments` specs stat blobs on disk themselves)
  and hands the server the dev LiveKit's key pair when one is running,
  which is what lets the `voice` spec run rather than skip. A scratch
  database that outlives a branch can carry goose rows for migration
  numbers another branch used for something else — the specs then fail in
  their preamble while the server log says `relation … does not exist`.
  The script recreates it on every run.
- **CI runs the suite in one job**, against a single server, database and
  LiveKit. The branch ruleset requires only the roll-up job named
  "Browser E2E", so what runs under it can change freely; Playwright has
  `--shard N/M` when there is enough work to need it.
- **The voice spec runs with the rest.** CI starts LiveKit on the host
  network beside the server and hands both the same key pair, so voice is
  covered on every PR rather than opted into. Without a LiveKit the spec
  skips itself, which is what happens on a machine that has not run
  `make dev-services`.
- **Adding a theme is four touches plus the prose that counts them.**
  A block in `web/src/themes.css`, an entry in `THEMES` in
  `src/api/theme.ts` (biome formats it one field per line — edit it, don't
  pattern-match one-line objects), the id in `index.html`'s inline
  pre-mount list (must stay in step with `theme.ts` or a saved choice is
  ignored before React mounts; `api/theme.test.ts` checks), and the card
  list in `e2e-pw/themes.spec.ts`. Every entry needs a `tier`; only the
  accessible ones take `tags` and `why`.
  `pnpm check:themes` (part of `make lint`) must pass; the checker's
  regex allows hyphenated ids. Then the places that name the count:
  `docs/vision.md`, `docs/architecture/web.md` and the spec's own check
  message. Grep the current number word across the repo before you call
  it done — and again if you remove one.
- **Run the browser suite against a server without `STOOP_TAILSCALE`.**
  With the built-in Tailscale listener on, the public URL defaults to the
  tailnet address and invite links use it — the `setup` and `invites`
  specs then fail on the link origin. That is the feature working, not a bug;
  start the E2E server the way CI and `scripts/e2e-scratch.sh` do (no
  Tailscale, no trust-proxy).
- **Leave 8091 free when you're done.** `make dev` refuses to start
  (`dev-port-check`) while anything holds the port or Vite's 5173: a stale
  `bin/stoop` started by hand serves the web app embedded at its `make
  build` and carries only `.env`, not `.env.dev`'s `STOOP_LIVEKIT_URL`, so
  the maintainer's browser and desktop shell (saved against :8091) would
  show old code on a server that says "voice is not configured". Stop your
  background `bin/stoop` before ending a session.
- **`make dev`'s :8091 is live; a hand-started `bin/stoop` is a snapshot.**
  `make dev` passes `STOOP_DEV_WEB_URL=http://localhost:5173` to air, so
  that server proxies the web app to Vite; `bin/stoop` serves the copy
  embedded at its last `make build`. Never put `STOOP_DEV_WEB_URL` in
  `.env.dev`: every hand-started server and the E2E scratch server would
  then need Vite running, and the suite would test the source rather than
  the build that ships.
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
  `rtc.ips.excludes` covering every real range — `node_ip` alone isn't enough, pion still offers the
  host's own interfaces. The join must fail with the media-path message
  within ~16 s, never hang on "Connecting…".
- **A styled overlay must not change glyph metrics.** Real bold and a bare
  `<code>` (browser default monospace) are wider than the textarea's text —
  measured +7 px and +29 px — so the caret drifts. Emphasis in the composer
  overlay is paint-only; see the comment in `web/src/styles/composer.css`
  and the width checks in `web/e2e-pw/composer-styling.spec.ts`.

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
  (`make: *** [e2e] Terminated: 15` is what that looks like).
  `nohup`/`setsid` wrappers may be rejected by the harness.
