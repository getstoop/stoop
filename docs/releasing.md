# Releasing Stoop

A release is four steps, all of them on GitHub. Nothing is run from a
checkout and nobody makes a tag by hand: a pushed tag starts nothing.

1. **Cut the release candidate.** Actions → **Cut release candidate** →
   Run workflow, on `main`, with the version to release (`0.4.0`). It
   opens the pull request "Release 0.4.0", labelled `patch`, `minor` or
   `major`.
2. **Review it and merge it.** Edit `deploy/release-notes.md` in the pull
   request first.
3. **The merge builds the release** and leaves it unpublished: a draft
   release with the archives and the compose bundle, and the image
   `ghcr.io/getstoop/stoop:0.4.0`.
4. **Publish the draft.** That is the release. GitHub makes the tag
   `v0.4.0` on the commit that was built, and `latest` moves to it.

## Versions

Semantic-ish, from `v0.1.0`: a minor for features and any schema change, a
patch for fixes that touch neither. While the major is 0 the API and
schema may change between minors, and the release notes say when they do.
What every release promises regardless: it upgrades in place from the
release before it, and it can be rolled back one release
([architecture/data.md → Upgrades and rollback](architecture/data.md#upgrades-and-rollback)).

A release is cut from `main`, so it carries everything merged since the
last one. There are no release branches.

## 1. The release candidate

The workflow (`.github/workflows/cut-release-candidate.yml`) takes the
version and refuses it unless it is the next one: after 0.3.0 that is
0.3.1, 0.4.0 or 1.0.0. It also refuses when nothing has been merged
since the last release.

The pull request it opens, from a `release-candidate/0.4.0` branch,
changes three files:

- `deploy/docker-compose.yml`: the image pin moves to the version. The
  image does not exist yet; it will before anyone can download this file
  from the release.
- `internal/db/releases.go`: a row for the version and its last
  migration, which is how the binary names releases when it talks about
  the schema. A release that ships no new migration gets no row.
- `deploy/release-notes.md`: the commits on `main` since the last
  release.

It opens the pull request with the `RELEASE_TOKEN` secret, a fine-grained
token for this repository with Contents and Pull requests set to read
and write. With the workflow's own token CI would not run on the pull
request. When the token expires the workflow fails at its checkout, and
the fix is a new token in the same secret.

## 2. Review

Rewrite `deploy/release-notes.md` in the pull request: what changed for
operators, any LiveKit or Postgres pin that moved, contract migrations
by name, known issues. What is in the file when the pull request merges
is what the release says.

The `cloudflared` pin in `deploy/Dockerfile` and
`deploy/Dockerfile.goreleaser` is moved by hand, tag and digest together,
in this pull request or before it.

To drop a candidate, close the pull request and delete its branch.

## 3. The build

Merging a pull request from a `release-candidate/` branch starts
**Build release** (`.github/workflows/build-release.yml`). It checks the
compose file pins the version and that the version is newer than every
release, builds the web app, and runs GoReleaser:

- linux amd64, linux arm64 and darwin arm64 archives, named without the
  version so `releases/latest/download/stoop_linux_amd64.tar.gz` always
  serves the newest, with `checksums.txt`;
- the image, pushed as `ghcr.io/getstoop/stoop:0.4.0` and nothing else;
- a **draft** release holding the archives and the compose bundle
  (`docker-compose.yml`, `livekit.yaml`, `livekit-entrypoint.sh`,
  `env.example`), with `deploy/release-notes.md` as its notes.

Nothing public has moved at this point: there is no tag, `latest` is
still the previous release, and `releases/latest/download/<file>` still
serves the previous bundle. The image can be pulled by anyone who types
its full tag.

A build that fails is run again from its run page. To drop a built
candidate, delete the draft.

## 4. Publishing

Releases → the draft → **Publish release**. GitHub makes the tag on the
commit the draft was built from and marks the release latest, and
**Move latest to release** (`.github/workflows/move-latest.yml`) points
`ghcr.io/getstoop/stoop:latest` at the release's image.

Then check what was published: a cold install from the quick start on a
clean machine, and an instance of the previous release with data
upgraded with `stoop upgrade`, rolled back with `stoop upgrade rollback`,
and upgraded again. Anything wrong becomes the next release; a tag is
never moved.

## What a release does not test

CI never runs GoReleaser, so the Dockerfile, the GoReleaser config and
the action's version are exercised only by a release build. Before
changing any of them, run a snapshot locally:

```sh
make build-web
go run github.com/goreleaser/goreleaser/v2@v2.18.0 release --snapshot --clean --skip=publish
```

It builds the archives and the images without publishing; `dist/` and
`docker images | grep getstoop` show the result.

One thing a snapshot does not check: a real build refuses to run from a
dirty checkout, and the snapshot ignores that. After the workflow's build
steps the tree must be clean, which is why the web build goes through
`make build-web` (it restores the tracked `.gitkeep` in the embed
directory). If a build fails with "git is in a dirty state", the file it
names is what a build step changed.
