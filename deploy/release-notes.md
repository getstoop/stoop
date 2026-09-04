Stoop 0.1.0 is the first release, and a beta: the core works and is in
daily use, and the API and schema may still change between minor
versions. What will not change from here on is the upgrade path. Every
release upgrades in place from the release before it with
`docker compose pull && docker compose up -d`, and can be rolled back one
release by putting the previous image tag back.

**Install:** the quick start in
[docs/self-hosting.md](https://github.com/getstoop/stoop/blob/v0.1.0/docs/self-hosting.md)
downloads the compose bundle attached below.

**Pinned alongside this release:** LiveKit v1.13.6, Postgres 16.

**Known issues:** none carried over from the security audit; see the
issue tracker for what is open.
