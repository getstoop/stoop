Stoop 0.3.0 is still a beta: the API and schema may change between minor
versions. It upgrades in place from 0.2.0 and can be rolled back to 0.2.0
by putting the previous compose file back.

**What's new.** Announcement channels, where only a space's admins, owner
and bots post. Retention: messages and attachments can be deleted after a
set number of days. Your Profile lists where you are signed in and signs
you out everywhere else. A server owner: one admin that no other admin
can demote, deactivate or reset. Server admin gains a Spaces page, to
see, join and delete every space, and a Diagnostics tab. A Cloudflare
Tunnel can be switched on from Server admin → Hosting or the setup
wizard. Channels are reordered by dragging. Join and leave sounds in a
call, and the first keyboard shortcuts. A refused form shows its error
beside the field and keeps what you typed. Server admin says when a newer
release exists. A new mark.

**For operators.**

- **Coming from 0.2.0, add `COMPOSE_PROFILES=bundled-postgres` to `.env`
  before upgrading.** The bundled Postgres is now a compose profile.
  Without the line it does not start, and the log says
  `lookup postgres: no such host`. Take all three bundle files from this
  release (`docker-compose.yml`, `livekit.yaml`, `livekit-entrypoint.sh`),
  not only the compose file. The compose file needs Docker Compose 2.20 or
  newer.
- **`stoop upgrade`.** The binary can now upgrade a compose install: it
  shows what the new release's migrations will do, backs up the database
  and the uploads, swaps the bundle files and starts, and
  `stoop upgrade rollback` goes back. Fetch the binary for the host once;
  see
  [install.md → Upgrading](https://github.com/getstoop/stoop/blob/v0.3.0/docs/self-hosting/install.md#upgrading).
  The archives are now named without the version
  (`stoop_linux_amd64.tar.gz`).
- **The update check is on by default.** The server reads the release
  list on getstoop.org so Server admin → About can say a newer release
  exists, or that this one is no longer supported. Nothing about the
  server is sent. `STOOP_UPDATE_CHECK=false` turns it off.
- **Server owner.** On upgrade the longest-serving active admin becomes
  the owner. `stoop admin transfer-owner <username>` hands it on.
- **Your own Postgres.** Empty `COMPOSE_PROFILES` and name the database
  in `STOOP_DATABASE_URL`. For the bundled one, `POSTGRES_ARGS` passes
  server flags, and `STOOP_DATABASE_POOL_MAX` caps the connections Stoop
  opens to either.
- **Ports and data paths are set in `.env`.** `STOOP_PORT`,
  `STOOP_LIVEKIT_TCP_PORT` and `STOOP_LIVEKIT_UDP_PORTS` each set a port
  in one place. `STOOP_DATA_PATH`, `POSTGRES_DATA_PATH`, `PUID` and `PGID`
  put the data on a disk of your own. The compose file also caps logs at
  30 MB a service, gives `stoop` a healthcheck and reads `TZ`. See
  [configuration.md](https://github.com/getstoop/stoop/blob/v0.3.0/docs/self-hosting/configuration.md).
- **`STOOP_TRUSTED_PROXIES`** names your proxy's addresses from the
  environment. Setting it together with `STOOP_TRUST_PROXY=true` refuses
  to start.
- **How long a sign-in lasts is a setting:** `STOOP_SESSION_LIFETIME_DAYS`
  (30, as before), also under Server admin → Login. A change applies to
  sign-ins from then on.
- **Retention is off until you set it**, under Server admin → Storage.
  What it deletes cannot be brought back; see
  [storage.md → Retention](https://github.com/getstoop/stoop/blob/v0.3.0/docs/self-hosting/storage.md#retention-deleting-old-messages-and-files).
- **Diagnostics** has a `/metrics` endpoint for Prometheus, read with a
  personal token; see
  [webhooks-and-diagnostics.md → Diagnostics](https://github.com/getstoop/stoop/blob/v0.3.0/docs/self-hosting/webhooks-and-diagnostics.md#diagnostics).
- **Channel names** are now lowercase letters, numbers, `-` and `_`,
  unique per space. Existing names are left as they are.

**Schema.** Migrations 00038 to 00042 run at startup. All of them only
add; none is a contract migration, so the schema floor does not move and
0.2.0 still starts against a 0.3.0 database.

**Pinned alongside this release:** LiveKit v1.13.6 and Postgres 16, both
unchanged from 0.2.0. The image now includes `cloudflared` 2026.9.3.

**Known issues:** none known at release. What turns up goes in
[GitHub issues](https://github.com/getstoop/stoop/issues); security
problems go through
[private reporting](https://github.com/getstoop/stoop/security/advisories/new).

The list below is every change merged since 0.2.0.
