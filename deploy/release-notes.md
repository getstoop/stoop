Stoop 0.4.0

Stoop 0.4.0 is still a beta: the API and schema may change between minor
versions. It upgrades in place from 0.3.x. **It cannot be rolled back by
putting the previous compose file back:** it changes the database in a way
0.3.x can't read, so going back to 0.3.x means restoring the backup
`stoop upgrade` takes before it starts.

**What's new.** Voice can be turned off: for the whole server, or by a
space's admins for their space (Space settings → General). Voice channels
are then hidden, not deleted. The sweeps and outgoing webhooks run on a
background job queue, which can run in its own container. A burst of
messages no longer drops outgoing webhook deliveries (tested at 150
messages a second with 20 hooks).
Avatars and space icons are processed in the background. An animated WebP
is refused beside the picker, with a reason, rather than accepted and then
discarded. When the server can't reach its database, the web app no
longer signs you out, and a message that was saved is no longer reported
as failed. A Tailscale connection that stops is restarted.

**For operators.**

- **Coming from 0.3, add `bundled-livekit` to `COMPOSE_PROFILES` in
  `.env` before upgrading**, keeping what is already on the line
  (`COMPOSE_PROFILES=bundled-postgres,bundled-livekit` on the default
  install). LiveKit is now a compose profile. Without the line, the
  LiveKit that is running stays on its old version, and the next time the
  stack is recreated there is none: voice joins fail, and Server admin →
  Diagnostics shows `livekit` as not answering. `stoop upgrade` does not
  catch this, because the line is already in `.env`. Take all three
  bundle files from this release (`docker-compose.yml`, `livekit.yaml`,
  `livekit-entrypoint.sh`).
- **Rolling back needs the backup.** `stoop upgrade` says so before it
  upgrades, and `stoop upgrade rollback` refuses afterwards and points at
  the backup; see
  [backups.md → Restoring in place](https://github.com/getstoop/stoop/blob/v0.4.0/docs/self-hosting/backups.md#restoring-in-place).
  0.3.x will not start against a 0.4.0 database.
- **`STOOP_TRUST_PROXY=true` refuses to start.** Name your proxy's
  addresses in `STOOP_TRUSTED_PROXIES` (or under Server admin → Hosting)
  and remove `STOOP_TRUST_PROXY`.
- **Settings in `.env` are copied into the database once.** The public
  URL, trusted proxies, TURN, Cloudflare, Tailscale, login provider,
  password sign-in and instance name are seeded the first time the server
  starts with them set. After that, change them on the admin page or with
  the new `stoop admin setting` command. Changing `.env` does nothing, and
  the server logs a warning naming the variable. If you cleared one of
  these fields on the admin page and relied on `.env` to fill it in, set
  it again: an empty saved value now means empty. See
  [configuration.md](https://github.com/getstoop/stoop/blob/v0.4.0/docs/self-hosting/configuration.md).
- **Text-only servers.** `STOOP_VOICE=false`, with `bundled-livekit`
  taken out of `COMPOSE_PROFILES`, runs without voice; see
  [voice.md → Running without voice](https://github.com/getstoop/stoop/blob/v0.4.0/docs/self-hosting/voice.md#running-without-voice).
  The new `.env.example` sets `STOOP_VOICE=true`, so `stoop upgrade` lists
  it as a setting your `.env` lacks; adding it changes nothing.
- **Background jobs.** The sweeps and outgoing webhook deliveries run on
  a job queue inside the server, as before. To run them in their own
  container, set `STOOP_JOBS=external` and add `jobs` to
  `COMPOSE_PROFILES`; see
  [install.md → Running background jobs apart](https://github.com/getstoop/stoop/blob/v0.4.0/docs/self-hosting/install.md#running-background-jobs-apart).
  The `stoop` service now gets 15 seconds to stop, so in-flight work
  finishes or is handed back. Server admin → Diagnostics → Health gains a
  `jobs_runner` row.
- **`stoop admin` no longer migrates the database.** Run against a
  database with migrations pending, it refuses with exit status 3. Start
  the new server (or `stoop migrate up`) first.
- **`stoop upgrade rollback` keeps the files it replaces as
  `.rolledback`**, where a later upgrade won't pick them up.
- **When the server can't check a sign-in, it answers 503**, not 401:
  the API, the live connection, file downloads and uploads, and provider
  sign-in, which shows "Sign-in failed — please try again." Only a
  missing or revoked sign-in is answered as signed out.
- **API changes for scripts.** A personal token can no longer open the
  live connection (`/ws` refuses it with 403, as it already refused a bot
  token) or join voice (a bot token still can). An old personal token that
  lists the voice grant keeps it, but it does nothing. `stoop version --json` is gone, and `GET /version` no longer
  carries the migration and floor numbers; `stoop migrate status --json`
  has them. An upload that stops sending is ended after 30 seconds.
- **Channel names that differ only by case** are made unique: in each
  space the oldest keeps its name and later ones get `-2`, `-3`, … added.

**Schema.** Migrations 00043 to 00052 run at startup. Three are contract
migrations: `00046_delivery_log` replaces the webhook delivery queue
columns that 0.3.x reads, `00049_sessions_unkept` stops clearing the
legacy sessions table that only 0.1.0 reads, and
`00052_floor_after_delivery_log` raises the schema floor to 46. After
them, 0.4.0 and later can start against the database.

**Pinned alongside this release:** LiveKit v1.13.6, Postgres 16 and
`cloudflared` 2026.9.3, all unchanged from 0.3.1.

**Known issues.**

- A few webhook receivers that answer slowly (seconds per delivery) can
  hold every job worker. Other hooks' deliveries and the sweeps wait until
  the slow backlog drains; nothing is lost.
- A webhook whose receiver is down is retried indefinitely instead of
  being switched off after 20 failed deliveries in a row. A receiver
  answering `410 Gone` is still switched off at once.
- Each password sign-in takes about 64 MiB of memory while it checks the
  password, with no limit on how many run at once: 64 at the same moment
  took a test server to 3.3 GB.

Report problems in [GitHub issues](https://github.com/getstoop/stoop/issues);
security problems go through
[private reporting](https://github.com/getstoop/stoop/security/advisories/new).

The list below is every change merged since 0.3.1.

Changes since 0.3.1:

- Docs: the release token is named without its permissions (a90b615)
- Docs: the release doc does not mention the token (9b99135)
- Release: the draft carries its notes (49e1757)
- Docs: the release doc is the four steps and the version rule (2677a58)
- Voice: STOOP_VOICE=false runs a text-only server (STOOP-90) (0106476)
- Voice: a space can turn voice off for itself (STOOP-90) (7d2e3cb)
- Compose: LiveKit is the bundled-livekit profile (STOOP-90) (fdae518)
- E2E: the settings spec names the invite toggle (e75f155)
- Voice: a hidden voice channel is not found by id (f6e14ab)
- Voice: the repeated checks are helpers, and names say what they hold (79b3c81)
- Docs: no single-character names, in the agents doc (5cea5a1)
- Voice: a reopened room is not closed by the earlier close's repeat (baa3dec)
- Compose: the profile docs say what Compose does to a running sidecar (ed6940a)
- Auth: a malformed user id is not found on every admin and profile path (8ba0a55)
- Upgrade: rollback refuses the flags it ignores instead of rolling back (60d1aa8)
- CLI: an unknown command prints usage instead of starting the server (0e8f0a1)
- Chat: closing a space channel as a conversation answers not found (d9271b2)
- Chat: a ban drops the member's space mute like a kick does (4c261c1)
- Files: an upload takes its in-flight slot before its body is read (e419cef)
- Auth: a password reset returns the account with its new password (cb336d7)
- Apierr: naming a field on a refusal no longer changes the refusal (0253caa)
- Chat: an ownership transfer checks the new owner was promoted (c11f6f6)
- Chat: an instance admin joining a space they are already in is not announced again (3e130f3)
- Chat: setting a member's role to owner answers in role wording (1124de6)
- Webhooks: a receiver's reply no longer makes an accepted delivery repeat (b3d0941)
- Webhooks: a database error no longer dead-letters a live delivery (5d633f5)
- Webhooks: deleting a webhook with a malformed id says not found (c415a49)
- Webhooks: "Send test" returns the delivery it queued (4a338bb)
- Realtime: client frames over a per-connection limit are dropped unread (f84234a)
- Presence: a second connection announces online to the spaces it adds (7326feb)
- Upgrade: rollback refuses --to and --file even when their value is empty (90958ca)
- Files: a test that an upload gives its slot back (ec22882)
- Realtime: the limit's comment says frames are dropped before decoding (15cfbe4)
- Presence: take back the announcement for a wider second connection (5f5b1ca)
- Realtime: only a session opens the live connection (9251ac0)
- Files: an upload that stops sending is ended after 30 seconds (5e3f618)
- Queries: four that nothing called are removed (d3ec489)
- Auth: a procedure with no access rule is refused even when no table is set (8d2f678)
- Apierr: the instance-admin gate is one function, used by three modules (03fdfb9)
- Events: topic names are built in one place (0b9391a)
- Voice: the relay options only tests set are gone (b65856d)
- Settings: the environment and the admin page share one set of rules (586694c)
- Releases: the index address, its shape and version comparison live in one place (bca132c)
- Voice: parseToken, which only tests call, lives in a test file (3f79075)
- Database: MigrateTo, which only a test calls, lives in a test file (a07f931)
- Diag: Counter.Add, which only its test called, is removed (87ad3f9)
- Instance: WebhooksAvailable, which nothing calls, is removed (63d4ac3)
- Chat: DefaultActivityRetention, which nothing references, is removed (ea0669f)
- Integrations: a pool field nothing reads is removed (abee16f)
- Link previews: unused fetcher state and two error aliases are removed (35b95aa)
- App: the node address writer is a local, not a field (c60f823)
- Ids: a new id is made, and a malformed one refused, in one place (2a7a89c)
- Settings: the start-up test checks which variable was refused (b6299fe)
- Docs: the data doc names the function that makes an id (a0cc6ec)
- Docs: the support-package lists name rowid, release, apierr and diag (19e8cfb)
- Errors: "no rows" becomes "not found" in one place (61afdc6)
- Errors: Postgres error codes have names (60b6f09)
- Chat: transactions go through one helper (35404e9)
- Sign-in: transactions go through one helper (2f15002)
- Files: the quota transaction goes through the helper (c574e87)
- Docs: the data doc names the transaction helper (76f3be4)
- Sign-in: a count only tests used lives in a test file (e9dce2d)
- Sign-in: two provider claims nothing read are no longer collected (f941503)
- Sign-in: two provider settings nothing read are dropped (326b217)
- Sign-in: the login cookie no longer carries a version number (1434787)
- Channels: the update query loses an argument nothing set (17547ff)
- Sign-in: tokens are made and hashed in one place (e1dc2dc)
- Sign-in: optional timestamps use the helper that already existed (efb0c89)
- Chat: page sizes are clamped in one place (98e5f38)
- Sign-in: the token test computes the expected hash itself (3deffae)
- kv: a keyed store with a cap and an expiry (2e7b874)
- Sign-in: desktop attempts and codes live in kv stores (e5511ab)
- kv: eviction samples the store, nil reads as zero, a cap under one refuses (522d4d4)
- Sign-in: the lockout guard keeps its counts in a kv store (070b42c)
- Sign-in: tests that a claim or a preview never extends a desktop deadline (e65b0d1)
- Sign-in: a test that a failing guard store refuses the sign-in (26feef5)
- Rate limiter: token buckets live in a kv store (cba72a0)
- Rate limiter: the clock is read under the lock, and a failing store is tested (3447a06)
- Sign-in: a locked handle and a throttled address get the same short refusal (c731a1a)
- Text shaping: one package for one-line and rune-budget cuts (STOOP-385) (a447235)
- Optional timestamps: one package renders them (STOOP-385) (120d2c2)
- Tests: the shared text and timestamp helpers, end to end (STOOP-385) (3390dde)
- Proposal: one background job runner for the sweeps and the webhooks (3c8fd28)
- Proposal: Scheduler.Perform queues for now; no PerformLater (4d169c3)
- Proposal: Scheduler is Enqueue and EnqueueAt (3255776)
- Proposal: jobs open questions settled; attempts log on the row (5f8ab59)
- Proposal: retries keep the count and the latest attempt only (4e544f8)
- Jobs: the module contract (441506b)
- Jobs: SweepFiles enqueues, Clean now says so, docs name the module (bef5fcc)
- Jobs: the six sweeps run as scheduled jobs (5217605)
- Jobs: app schedules sweep_jobs too (c1a934f)
- Jobs: tables and queries (3c77137)
- Jobs: the module behind the contract (a54c108)
- Jobs: a schedule carries its next run before it first runs (857afd4)
- Jobs: parameters say what they hold (a372a4a)
- Jobs: parameters say what they hold (bf8c23e)
- Jobs: parameters say what they hold (e3c8f5b)
- Jobs: history sweep always runs; activity sweep off with nothing to retain (19c8b97)
- Jobs: Clean now refreshes the usage and forgets the last note (b49e341)
- Jobs: a live performer keeps its lease, a stale one writes nothing (c161469)
- Jobs: one lease, never shortened (f08c9e3)
- Jobs: the phase 2 contract (3d7674e)
- Jobs: lanes, the lane-safe lease and a free release (56bdaa7)
- Jobs: point lanes at the runtime doc (c58ddb4)
- Jobs: deliver_webhook replaces the webhook queue and worker (441334e)
- Jobs: the delivery POST is post, not attempt (b9b136d)
- Docs: deliveries as jobs, no webhook worker (1e5ae9c)
- Jobs: delete the diag.Job recorder (2fe249a)
- Docs: webhook troubleshooting points at the health row (7849b46)
- Jobs: the backlog's oldest due row is one the dispatcher could lease (adcbdf1)
- Jobs: the backlog test counts its lane rows (676ac81)
- Jobs: a succeeded job keeps no arguments (bdef716)
- Jobs: the outgoing switch is not the receiver's failure (5f339ec)
- Jobs: gofmt the outgoing tests (be0ed6d)
- Jobs: shutdown takes over in-flight rows before cancelling their workers (e2b1928)
- Jobs: the port for a delivery's job state (STOOP-389) (0bf822d)
- Webhooks: a delivery whose job is lost is finished as dead (STOOP-389) (8555945)
- Jobs: a discarded lane drops its arguments (STOOP-389) (d377735)
- Jobs: shutdown stays inside the ten-second budget (STOOP-389) (b95453d)
- Jobs: the heartbeat rows and the notify channel name (STOOP-389) (ef026b1)
- Jobs: STOOP_JOBS and the runner's constructor (STOOP-389) (6549915)
- Jobs: an enqueue wakes the dispatcher, and a jobs runner health row (STOOP-389) (35cb20e)
- Jobs: stoop jobs runs the dispatcher as its own process (STOOP-389) (5443428)
- Jobs: the stoop jobs subcommand (STOOP-389) (ced3829)
- Jobs: the jobs compose service and the operator docs (STOOP-389) (2bdc00e)
- Webhooks: an index for the sweep's unfinished-delivery scan (STOOP-389) (325f7dc)
- Jobs: voice closes inside the shutdown budget, and the test names it (STOOP-389) (3a032c8)
- Jobs: the listener's close overlaps the dispatcher's shutdown (STOOP-389) (c707c9f)
- Jobs: the runner test's cleanup is bounded (STOOP-389) (467fa62)
- Jobs: regenerate dbgen for the InsertJob comment (STOOP-389) (7613422)
- Jobs: the heartbeat keeps up between polls (STOOP-389) (e621f2e)
- Webhooks: the jobs adapter embeds the service (STOOP-389) (b0960e4)
- Jobs: the runner's age never reads as the future, and the listener logs the wait it takes (STOOP-389) (71d869c)
- Jobs: the child supervisor logs the wait it takes (STOOP-389) (be96789)
- Jobs: Options gains MaxInFlight, the per-kind concurrency cap (STOOP-390) (f1d13b2)
- Files: the normalise_image contract and the pending state (STOOP-390) (f166f6a)
- Jobs: queries to lock a kind's leasing and count its live leases (STOOP-390) (34f44d3)
- Jobs: a capped kind is leased under its lock, up to its cap (STOOP-390) (f646d5f)
- Docs: how a MaxInFlight cap is kept (STOOP-390) (4316f01)
- Diagnostics: the jobs runner check is named jobs_runner (STOOP-390) (d2825f2)
- Jobs: the dispatcher heartbeat is an upsert (STOOP-390) (a4fc0e7)
- Jobs: the child runner dies with the server on Linux (STOOP-390) (6ead84c)
- DB: migrations run under an advisory lock (STOOP-390) (2d335b5)
- Files: split processImage and share the quota insert (STOOP-390) (ef39aeb)
- Chat: SetSpaceIcon no longer re-checks the caller (STOOP-390) (7df2af5)
- Files: avatars and icons are normalised by a normalise_image job (STOOP-390) (06613a9)
- Web: memberUpdated refetches our own and a bot's avatar (STOOP-390) (1b85e9c)
- Compose: the jobs container runs with GOMEMLIMIT=400MiB (STOOP-390) (1dda98e)
- Docs: the jobs proposal is built; its decisions live in the architecture docs (STOOP-390) (82a9f37)
- Jobs: bound the worker count before it is written as int32 (STOOP-390) (548390f)
- Jobs: one bounded narrowing for the int32 columns (STOOP-390) (419e31a)
- Jobs: resolve the lease merge; leaseDue stays (STOOP-390) (0ca255a)
- Jobs: the lease LIMITs go through int32Column (STOOP-390) (487d486)
- DB: the migration lock sits on a connection outside the pool (STOOP-390) (5d8323a)
- Jobs: capped kinds are leased first; a negative cap is refused (STOOP-390) (a6ddcdd)
- Docs: the cap is a constant; lanes order uploads as the server received them (STOOP-390) (dd1f944)
- Files: sequence at arrival, the uploader's own devices hear the swap, no delete of a referenced file (STOOP-390) (f6f2b51)
- Files: normalise_image runs one at a time (STOOP-390) (8bd335d)
- Docs: normalise_image runs one at a time (STOOP-390) (6b64e65)
- Docs: rewrap one line (STOOP-390) (7c3e887)
- Relay bus events from `stoop jobs` to the server (STOOP-393) (d604206)
- Refuse an animated WebP beside the picker (STOOP-394) (a3a842e)
- Relay an event over one NOTIFY payload as pieces (STOOP-393) (0d7978e)
- Test the animated WebP refusal through an upload (STOOP-394) (26bdb90)
- Hold one unfinished relayed event at most (STOOP-393) (e8b6a50)
- Jobs: a due schedule of an unregistered kind is disabled (0b71f6d)
- Webhooks: one hook's failed enqueue spares the space's other hooks (e254366)
- Files: the admin who set a bot's avatar hears the swap (9285eb9)
- Webhooks: a hook's failed enqueue is logged once, not returned (c03a52d)
- Jobs: a finished capped or laned job wakes the dispatcher (ee266de)
- Webhooks: one fan-out job per event, in a lane per space (1d98870)
- Webhooks: a fan-out run twice queues each delivery once (5605e58)
- Webhooks: test a fan-out that fails part-way, faked and real (3126d3b)
- Version: drop stoop version --json and migration/floor on GET /version (978b2b3)
- Proxies: refuse STOOP_TRUST_PROXY=true at start-up (98f538f)
- Auth: drop the legacy sessions table, floor to 37 (9f5370b)
- Channels: unique name per space as an index, with a rename backfill (4543f3b)
- Docs: GET /version no longer serves the upgrade tool (6abfd64)
- Auth: keep the sessions table for 0.2.0 to 0.3.x (79b3f79)
- Channels: rename folded twins oldest first (f25129e)
- CLI: stoop admin refuses a database behind it instead of migrating (STOOP-376) (022d1b9)
- CLI: test stoop admin's refusal end to end, and name the floor case exactly (1f8bf2f)
- Settings: the environment seeds, the database decides (STOOP-377, STOOP-357) (c237cb9)
- Warn at start when .env disagrees with a saved setting (STOOP-411) (4616b5e)
- stoop admin setting: change seeded settings from the shell (STOOP-410) (656a411)
- Settings: restore the .env login provider to a legacy empty list (47e2baa)
- EnvDrift: judge by whether .env sets a variable, not by its value (b1b5396)
- stoop admin setting: safe round trips, guarded reset, honest list (6106eca)
- Settings: run the pre-seed repairs once, on the upgrade (94b7f42)
- Compose: leave the seeded switches empty so their defaults aren't "set" (a16d3aa)
- stoop admin setting: reset says to restart for start-time groups (bdab69c)
- EnvDrift: read variables as Load does (7793b18)
- stoop admin setting: refuse a provider kind the page refuses (ac3426d)
- EnvDrift: a list variable of only blanks is unset (a4c62e4)
- STOOP-383: personal tokens can't join voice (ec813c7)
- STOOP-368: config.Load reports every bad variable at once (adbbf17)
- Config: a refused STOOP_TAILSCALE doesn't also blame the funnel (c408fd3)
- STOOP-370: one message hydrator, which keeps the order it is given (0fac5ad)
- STOOP-367: app.New closes the pool on every failure, and app.go splits by concern (2919574)
- App: test that a failed start-up closes the pool (e86786b)
- STOOP-366: break up Gateway.ServeHTTP without changing who runs what (33bd240)
- Realtime: a connection announces the spaces it newly counts (cc58be3)
- Realtime: announce only spaces still counted after the connect lookup (f4e9138)
- STOOP-366 + STOOP-361: one goroutine owns each connection's state (f79ce94)
- Realtime: bound a client event's lookup on the main loop (5720c44)
- Realtime: stuck-lookup test waits for the lookup, not a sleep (31c204a)
- STOOP-357: a refused profile, rename or bot save changes nothing (1d776a2)
- Auth: test that a failed later write rolls the username back (aa4337a)
- STOOP-412: Ready carries presences only, read in one pass (322fcc8)
- STOOP-373: move the quota, idle body and delete code into their own files (b00c557)
- STOOP-370: one user lookup and one unknown-author placeholder in chat (c4483cb)
- STOOP-370: one helper removes a member, tells the space and ends their voice (e767226)
- STOOP-365: the status and reachability read every setting in one query (201019e)
- STOOP-373: one helper to store a file, one to delete it, one 507 (973458a)
- STOOP-373: name the upload handler's writer and request (103c853)
- STOOP-369: stoop verbs write refusals to a writer they are given (edffbc2)
- STOOP-370: a direct message send lists its participants once (a73ab60)
- STOOP-370: rewrap the resolveMentions comment (a64149b)
- STOOP-412: keep sending online_user_ids for one release (2def78a)
- STOOP-369: unknown-command tests compare the whole message (0fb790f)
- STOOP-365: test that a save returns the status read after it (75bb57d)
- STOOP-362: keep rolled-back files where an upgrade never looks (83a4a8e)
- STOOP-359: Deleting or rotating an incoming webhook cleans up after itself (365ed59)
- STOOP-356: Stop reporting a saved message as failed (10cfa92)
- STOOP-360: restart a Tailscale node that stops on its own (99cc855)
- STOOP-358: tell a failed sign-in check from no session on the server (4a031ad)
- STOOP-358: sign out in the web app only when the server says so (602774c)
- STOOP-364: A delivery that can't read its hook no longer uses up its tries (9c897aa)
- STOOP-362: keep a parked companion a rollback does not replace (198c5fb)
- STOOP-359: Hook cleanup survives a step that fails (f2a9070)
- STOOP-358: close the socket as retryable when its session can't be checked (b772acb)
- STOOP-360: close the node before waiting for the media forwarder (7d4131f)
- STOOP-364: A handed-back job keeps its attempt count rising (3e31c65)
- Jobs: keep a finished job excluded from leasing until its outcome is written (eae698b)
- Jobs: free a finished job's slot before waking the dispatcher (cc5e74b)
- STOOP-370: deliver activity in a few queries, not a few per person (c920c21)
- STOOP-370: read messages with their reply quote from one view (8bae26e)
- STOOP-370: write a message's mention rows in one statement (daadfd2)
- STOOP-370: the query-count test asserts the exact counts (b415fe4)
- STOOP-365: one table per enum setting; one write path; Seed sets no fallback (03e821c)
- STOOP-365: move each instance setting into a file of its own (493a912)
- STOOP-365: the save RPCs ask each setting to validate its own field (e00d5f2)
- STOOP-365: pin every enum setting's stored string to its wire value (454106a)
- STOOP-369: the CLI's by-name verbs share one lookup in auth (671970b)
- STOOP-369: one refusal for a database ahead of the binary; migrate up checks it once (300a23a)
- STOOP-369: two Migrate calls in one process no longer race on goose's globals (269547e)
- STOOP-369: name the backup files, the default Postgres major and the plan exit codes (545a336)
- STOOP-369: run docker compose one way, and share the report, up and logs steps (3065d2b)
- STOOP-369: split resolve into stage and checkTarget, and pass switchTo one plan (0b08c88)
- STOOP-369: say that Options.Index and Options.Wait are for the tests (99fe9af)
- STOOP-375: check Connect codes in tests with one helper (80cb864)
- STOOP-371: registration checks names and passwords with the shared rules (5a487d5)
- STOOP-371: one provider lookup for the sign-in round trip; a failed check is not a bad sign-in (dc24b7e)
- STOOP-371: a download or upload whose credential can't be checked gets 503, not 401 (76d217a)
- STOOP-375: give the chat tests one setup helper (ef88e68)
- STOOP-375: move the integrations fixture to helpers_test.go (3cc588e)
- STOOP-375: move the files fixture to helpers_test.go (4618ad3)
- STOOP-375: move the voice test helpers to helpers_test.go (fdc89df)
- STOOP-371: desktop sign-in start reads its provider through the same check (9a73fc1)
- STOOP-375: build the app's test configuration in one place (8118ba2)
- STOOP-375: name the one-letter variables in the test files this touched (a1fb876)
- STOOP-371: a browser link checks the session before reading the provider (923df5f)
- STOOP-375: say what dbtest.NewUser's password is (153aa24)
- STOOP-414: raise the schema floor to 46, so 0.3.x refuses a 0.4.0 database (4232231)
