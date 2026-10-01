# Releasing Stoop

A release is four steps on GitHub. Nobody tags by hand.

1. **Cut the release candidate.** Actions → **Cut release candidate** →
   Run workflow, on `main`, with the version (`0.4.0`). It opens the pull
   request "Release 0.4.0".
2. **Review and merge it.** Rewrite `deploy/release-notes.md` in the pull
   request first: what changed for operators, any pin that moved,
   contract migrations by name, known issues.
3. **Wait for Build release.** The merge starts it. It leaves a draft
   release and the image `ghcr.io/getstoop/stoop:0.4.0`.
4. **Publish the draft** from the Releases page. That makes the tag and
   moves `latest`.

Then check what was published: a cold install from the quick start, and
an instance of the previous release upgraded with `stoop upgrade`, rolled
back with `stoop upgrade rollback`, and upgraded again. Anything wrong
becomes the next release.

To drop a release, close the pull request, or delete the draft once it
is built.

The `cloudflared` pin in the two Dockerfiles is moved by hand, in the
release candidate or before it.

## Versions

Semantic-ish, from `v0.1.0`: a minor for features and any schema change, a
patch for fixes that touch neither. While the major is 0 the API and
schema may change between minors, and the release notes say when they do.
What every release promises regardless: it upgrades in place from the
release before it, and it can be rolled back one release
([architecture/data.md → Upgrades and rollback](architecture/data.md#upgrades-and-rollback)).

A release is cut from `main`, so it carries everything merged since the
last one. There are no release branches.
