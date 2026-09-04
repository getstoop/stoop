Stoop 0.1.0 is the first release, and a beta: the core works and is in
daily use, and the API and schema may still change between minor
versions. What will not change from here on is the upgrade path. Every
release upgrades in place from the release before it, and can be rolled
back one release by putting the previous image tag back.

**What's in it.** Spaces with text and voice channels, direct messages,
replies, reactions, mentions, edits, Markdown, file attachments with
inline images and link previews, an activity feed with per-channel and
per-space mutes, eight themes, and voice and video rooms on LiveKit.
Sign in with a password or any OIDC provider. Reach it through a reverse
proxy you already run, Cloudflare Tunnel with Cloudflare TURN for voice,
or the built-in Tailscale node, which carries voice as well. One static
binary for linux/amd64, linux/arm64 and darwin/arm64, images for both
Linux architectures, and a compose bundle below that pins everything.

**Install.** Follow the quick start in
[docs/self-hosting.md](https://github.com/getstoop/stoop/blob/v0.1.0/docs/self-hosting.md):
it downloads the four files attached to this release and runs
`docker compose up -d`. Upgrading later is fetching the next release's
compose file, then `docker compose pull && docker compose up -d`.

**Pinned alongside this release:** LiveKit v1.13.6 and Postgres 16 in
the compose file. The notes of a later release say when either moves.

**Known issues:** none known at release. What turns up goes in
[GitHub issues](https://github.com/getstoop/stoop/issues); security
problems go through
[private reporting](https://github.com/getstoop/stoop/security/advisories/new).

The list below is every change merged since the repository went public.
