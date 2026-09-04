# Security policy

## Reporting a vulnerability

I welcome and appreciate good faith vulnerability reports.

Please do not open a public issue for a security problem. Use GitHub's
private vulnerability reporting: the **Security** tab of this repository →
**Report a vulnerability**. It reaches the maintainer only.

Include what you can: the version (`stoop --version`, or Server admin →
Server), how the instance is exposed (reverse proxy, Cloudflare Tunnel,
Tailscale, plain LAN), and steps to reproduce. A proof of concept against
your own instance is welcome; please don't test against instances you
don't run.

Fixes may ship as a patch release with a note in the release notes crediting the reporter, unless
they prefer otherwise.

## Supported versions

The newest release. Stoop upgrades in place from the release before it
(`docker compose pull && docker compose up -d`), so staying current is
the supported path; there are no long-lived branches.

## Scope

In scope: the Stoop server and web app in this repository, the release
images, and the compose and configuration examples under `deploy/`.

Out of scope: LiveKit, Postgres, Cloudflare, Tailscale and other software
Stoop is deployed alongside (report to them directly), and findings that
require the operator to have already ignored the guidance in
[docs/self-hosting.md](docs/self-hosting.md), such as exposing the server
over plain HTTP to the internet.

## What Stoop's trust model is

The operator runs the box and can read everything on it; that is by
design (docs/self-hosting.md → Privacy). Reports that amount to "the
admin can see the data" are not vulnerabilities. Reports that a *member*
can do something the permission model says they can't are exactly what
this policy is for.
