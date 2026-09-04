# Instance branding: where the name, icon and blurb go

Status: proposed 2026-09-03. Decided the same day to go incrementally:
`instance_name` shipped first on its own (browser tab title, Server admin
tab, random two-word default so instances aren't all "Stoop"), with the
icon, blurb and their placement on the pre-login pages — the options below —
still open. The rendered version with live mockups is the "Instance Branding
Placement" artifact
(https://claude.ai/code/artifact/fa4b2a90-c36b-4013-b543-cb711d055b39); this
file is the text of it so the reasoning survives.

## The problem

STOOP-104 lets an operator set `instance_name`, `instance_blurb` and an
`instance_icon` (uploaded, admin-only, reusing the space-icon path in
`internal/files`), exposed on `GetInstanceStatusResponse` so the pre-login
pages and the browser `<title>` can use them. Today all four pre-login
shapes hardcode "Stoop" and share one card:

| Shape | Route / mode | What's already at the top |
| --- | --- | --- |
| Pure login | `/login` | "Stoop", "Welcome back.", providers, password form |
| Account creation | `/login` (mode=register) | "Stoop", "Pull up a seat.", same shell + invite code field — identical header treatment to pure login |
| Invite landing | `/login` (invited) | "Stoop", invite copy, then the space's own icon/name/description inside `InviteHero` — a second identity block already at the top of the card |
| First-run setup | `/setup` | "Stoop", a 4-step tracker, then the current step's card — can already read `instance_name` via its env fallback before anyone has logged in |

All four are one `.login-card` shell (`web/src/routes/Login.tsx`,
`web/src/routes/Setup.tsx`, `web/src/styles/login.css`), which is why one
placement decision covers all four — the real question is what replaces the
`<h1>Stoop</h1>` slot, and whether every shape wants all three fields.

## Options considered

**A. In-card header.** Icon + name replace "Stoop" in place, same size and
spot. Blurb becomes a second, smaller line under the name, above whatever the
mode already says. Smallest diff: one row swapped inside the existing card,
nothing added around it.
- Good: zero new layout — reuses the exact slot and spacing "Stoop" already
  has.
- Watch: on invite landing, blurb + invite copy + `InviteHero` stacks three
  text blocks before any field.

**B. Icon-forward hero.** Icon doubled in size and centered, name centered
below it, blurb as a short centered lede underneath. Reads as a splash mark
rather than a wordmark-with-a-favicon — closer to how Ghost or Plausible open
their own login screens. Costs the card some height on every shape.
- Good: the most legible way to say "this is a different, operator-run
  instance" at a glance.
- Watch: on invite landing, two centered icon+name blocks stack — the
  instance's, then `InviteHero`'s for the space — and read as one brand
  repeated twice.

**C. Site header, outside the card.** Icon, name and blurb move above
`.login-card`, sitting on the canvas like a page header; the card drops its
own `<h1>` entirely and opens straight with the mode's own line. Separates
"whose server is this" from "what does this card want from me right now."
- Good: on invite landing, the instance mark and the space's `InviteHero`
  sit at different visual levels instead of stacking as two peers.
- Watch: touches `login.css`'s page wrapper, not just the card, and needs
  its own phone spacing — the only option that isn't a same-slot swap.

## Open questions a decision settles

1. Does `instance_blurb` render on every shape, or is it suppressed on
   invite landing (which already has its own explanatory line and the
   space's own description)? A and B show it everywhere; C shows the
   pattern of dropping it once the page has its own copy.
2. Is the mark meant to read as a wordmark accessory (A), a splash/brand
   moment (B), or a page-level header decoupled from the card (C)?
3. Worth confirming in the admin UI copy that setup can already pick up
   `instance_name` via env var before the first account exists, so a fresh
   install can be pre-branded on first paint rather than only after someone
   visits Server admin.

Favicon and `<title>` are settled separately (not a placement question):
the icon upload already center-crops to a square 512px PNG
(`internal/files/image.go`), so a 32×32 favicon variant is generated from
that same stored file, falling back to Stoop's default favicon when no
instance icon is set.

## Decision

Open — pending sign-off on A, B or C (or a mix, e.g. A on the login shapes
with blurb suppressed on invite landing per question 1).
