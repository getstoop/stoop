# Releasing Stoop

A release is a tag on `main`. Pushing it runs the Release workflow, which
turns everything merged since the last tag into binaries, images, and the
compose bundle an operator installs from. Nothing else publishes anything.

## Versions

Semantic-ish, from `v0.1.0`: a minor for features and any schema change, a
patch for fixes that touch neither. While the major is 0 the API and
schema may change between minors, and the release notes say when they do.
What every release promises regardless: it upgrades in place from the
release before it, and it can be rolled back one release
([architecture/data.md → Upgrades and rollback](architecture/data.md#upgrades-and-rollback)).

## A minor release, end to end

1. **Develop on `main`.** One change per PR, green CI, merge. Migrations
   follow expand/contract; a contract migration raises `schema_floor`.
   The changelog writes itself from PR titles, so title PRs for the notes.
2. **The release PR.** Bump the image tag in `deploy/docker-compose.yml`
   to the version about to be cut (the image does not exist yet; it will
   before anyone downloads this file from the release). Rewrite
   `deploy/release-notes.md`: what changed for operators, any LiveKit or
   Postgres pin that moved, contract migrations by name, known issues. The
   generated PR list is appended below it automatically.
3. **Tag.** An annotated tag on the release PR's merge commit, pushed once.
   The tag ruleset lets only repository admins create `v*` tags and nobody
   move or delete one.

   ```sh
   git tag -a v0.2.0 -m "Stoop 0.2.0"
   git push origin v0.2.0
   ```

4. **The workflow** builds the web app, embeds it, and runs GoReleaser:
   linux amd64, linux arm64 and darwin arm64 archives with `checksums.txt`;
   images pushed to `ghcr.io/getstoop/stoop` as `0.2.0`, `0.2` and
   `latest`; the compose bundle (`docker-compose.yml`, `livekit.yaml`,
   `livekit-entrypoint.sh`, `.env.example`) attached to the GitHub
   Release so `releases/latest/download/<file>` serves it.
5. **Verify against what was published.** Cold install from the quick
   start on a clean machine. Upgrade an instance of the previous release
   with data. Roll it back one release by editing the tag, then forward
   again. Anything wrong becomes a patch release; the tag is never moved.
6. **Close.** Plane items to Done with the version noted. Anything this
   release stopped using may be contracted in the next cycle.

## A patch release

For a fix that cannot wait for the next minor while `main` already carries
unreleased changes.

1. **Fix forward on `main` first.** Normal PR, green CI, merged. The next
   minor inherits it; the patch exists so operators need not take the
   unreleased work.
2. **Branch from the tag, on demand.** `git switch -c release/0.2 v0.2.0`
   and push it. The main ruleset covers `release/*`: PR only, green CI,
   no force-push. Only the newest minor gets a branch; older lines are not
   patched ([SECURITY.md](../SECURITY.md)).
3. **Cherry-pick into a PR against the branch.** `git cherry-pick -x` of
   the merged fix, plus the release-PR edits: compose tag `0.2.1`, a notes
   header describing the one fix. If the pick does not apply because
   `main` moved, rewrite the fix on the branch by hand, still after `main`
   has it. Green CI, merge.
4. **Tag `v0.2.1` on the branch head.** The workflow does not care which
   branch a tag is on. `0.2` and `latest` move to the patch, and
   `releases/latest` serves its bundle.
5. **Verify** the upgrade `0.2.0 → 0.2.1` and back; with no schema change
   both are trivial.
6. **Retire the branch** once the next minor ships.

Two rules keep a patch safe:

- **No migrations.** Goose applies files in numeric order and refuses a
  database with a higher number applied and lower ones missing. A hotfix
  migration would be applied on patched instances and then block the
  upgrade to the next minor. A fix that needs the schema is a minor.
- **No dependency majors or pin moves**, unless the pin is the fix. A
  patch is the smallest change that makes the bug go away.

## What the release workflow does not test

CI never runs GoReleaser, so the Dockerfile, the goreleaser config and the
goreleaser action version are exercised only by a tag. Before changing
any of them, run a snapshot locally:

```sh
make build-web
go run github.com/goreleaser/goreleaser/v2@v2.18.0 release --snapshot --clean --skip=publish
```

It builds the archives and the images without publishing; `dist/` and
`docker images | grep getstoop` show the result.
