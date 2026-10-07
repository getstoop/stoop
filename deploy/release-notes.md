Stoop 0.6.0

Stoop 0.6.0 is still a beta: the API and schema may change between minor
versions. It upgrades in place from 0.5.x, and `stoop upgrade rollback`
can take it back to 0.5.x. Going below 0.5.0 now needs a backup (see
**Schema**).

**What's new.**

- **Push to talk in the browser.** Under Account → Voice, turn it on and,
  while you are muted in a call, hold **Ctrl+`** (the key above Tab, with
  Ctrl on every platform) to talk. Letting go mutes you again 50 ms
  later. While you are unmuted the key does nothing. The choice is kept
  in that browser, and the key works only while the Stoop tab has focus.
  Inside the desktop app the page leaves the key to the app, which holds
  it from any app in its own next release; until then the desktop app
  has no push to talk.
- **Quick webhooks no longer wait behind slow ones.** In 0.5.0, once slow
  receivers filled the delivery slots, every other hook waited for their
  backlog to drain (that release's known issue). The hook whose last
  delivery finished quickest now goes first, so a quick receiver keeps
  getting its deliveries in seconds while slow ones are busy, and slow
  ones still get the rest.

**For operators.**

- **API change for scripts.** A webhook delivery no longer has a
  `response` field. It has been empty since 0.5.0; field 7 and the name
  are reserved.

**Schema.** Migrations 00054 and 00055 run at startup.

- 00054 is a contract migration: it drops `webhook_deliveries.response`,
  which 0.5.0 stopped writing, and raises the schema floor to 53. 0.5.x
  still starts against the result, so `stoop upgrade rollback` to 0.5.x
  works without a restore. 0.4.x and older are refused; going back that
  far means restoring a backup taken before the upgrade.
- 00055 adds an index on `jobs (lane, started_at)`. It is add-only.

**Pinned alongside this release:** LiveKit v1.13.6, Postgres 16 and
`cloudflared` 2026.9.3, all unchanged from 0.5.0.

**Known issues.**

- The mic button looks the same whether or not push to talk is on;
  Account → Voice is where to check.

Report problems in [GitHub issues](https://github.com/getstoop/stoop/issues);
security problems go through
[private reporting](https://github.com/getstoop/stoop/security/advisories/new).

The list below is every change merged since 0.5.0, including a first
attempt at push to talk that was reverted before release.

Changes since 0.5.0:

- STOOP-415: drop webhook_deliveries.response and Delivery.response (7cd1311)
- STOOP-399: the lane whose last job ran quickest is leased first (990971f)
- STOOP-415: regenerate after merging main (da3afe1)
- STOOP-399: index only finished jobs for a lane's last run (0ea93f9)
- STOOP-126: push to talk, held on Ctrl+` (24e0eb2)
- Revert "STOOP-126: push to talk, held on Ctrl+`" (f6074c2)
- STOOP-126: push to talk, a Ctrl+` listener over mute and unmute (3279149)
- STOOP-126: a press inside the release tail unmutes a mic gone quiet (6e33606)
- STOOP-126: a held key's repeats never start a hold (36fa35f)
