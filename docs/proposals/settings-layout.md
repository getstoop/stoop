# Settings pages: a wider frame

Status: decided 2026-09-02, option A as mocked up; shipped 2026-09-03 in
four pull requests (#18 frame, #19 setting rows, #20 list grids, #21
Hosting rows). The rendered version
with live mockups is the "Stoop Settings Frame" artifact
(https://claude.ai/code/artifact/930cd4dc-09df-478d-90ed-0121df80c101);
this file is the text of it so the reasoning survives. Decisions are at
the end.

## The problem

Profile, space settings and server admin share one frame
(`styles/settings.css`): a header, a row of tabs, and a single column of
cards capped at 520px, centred in whatever is left of the window. It was
designed for the phone and it is right there. On a desktop it is not.

Measured on a 1440px window, dark theme, seeded data:

| Page | Columns to the left | Column used | Window used |
| --- | --- | --- | --- |
| Server admin | rail 68px | 520px | 36% |
| Profile | rail 68px | 520px | 36% |
| Space settings | rail 68px + channel sidebar 244px | 520px | 36% |

What that costs, section by section:

- **People lists** (Accounts, Members, Banned) are a name on one line,
  handle, badges and join date on a second, and actions pushed to the
  right or wrapped underneath. Three people fill the 30vh scroll cap, so
  a list of eight is a list you scroll inside a page you also scroll.
- **Channels** carry five chips per row; at 520px the chips take more
  width than the channel name and topic.
- **Hint text** wraps to two or three lines under every control. A
  setting that is one sentence of explanation and one select becomes a
  100px card.
- **Hosting** is a long form of groups with a 560px cap, one Save at the
  bottom, and its own headings inside a card that already has a heading.
- **Appearance** shows two theme cards per row; ten themes is five rows.
- **Space settings** keeps the channel sidebar beside it, so the reader
  has two navigation columns and neither is about settings.

The card itself is fine. The problem is a fixed narrow column, and that
every section is boxed the same way whether it is a callout or a form.

## Goals

1. Use the desktop's width: a content column up to about 960px, so a
   list can be a table and a setting can sit beside its explanation.
2. Stay one DOM at every size (`docs/architecture/web.md`, Layout on
   small screens). Phone layout comes from `mobile.css`, never from
   width logic in JSX.
3. Keep the kit. Nothing here adds a control; it adds a frame and two
   layouts (a setting row and a list grid) to `settings.css`, and phone
   overrides to `mobile.css`. No colour literals, tokens only.
4. Keep the URLs. `?tab=` keeps working; nav items are the same links
   with the same `data-tab`, so the specs that click them keep working.
5. Keep sections as they are split today. `routes/Admin/*Section.tsx`
   and friends are already one file per section; the frame decides
   where they go, not how they are written.

## The frame

Three parts, all in `settings.css`:

**A settings nav column** in the slot the channel sidebar occupies:
232px, `--panel`, a header (the page title, or the space's icon and name
with "Back to space"), then one link per section. On the phone the same
`<nav>` becomes a horizontal strip of chips under the header that scrolls
sideways, which is what the tab row is today with a scroll instead of a
wrap.

**A content column** that grows to `min(960px, 100%)` with 32px 40px
padding, left-aligned against the nav rather than centred in the window.
Sections are groups: a heading, a hint, a rule between groups. `.card`
stays on the section element (specs select on it) but inside the frame
it stops drawing a box. Boxes are spent on what needs to stand out: the
danger zone, a temporary password, the voice reading on Hosting.

**Two layouts inside a group:**

- `.setting-row`: a grid of `minmax(200px, 2fr) 3fr`. Title and
  description on the left, the control on the right, aligned to the
  first line. This is what turns "select + three lines of hint" into one
  40px row. Below 768px it is one column, description above control.
- `.list.table`: the existing `ul.user-list` with grid columns instead
  of a flex row per item: person, role, joined, actions. Header row in
  `--text-xs` caps. Below 768px the columns stack into today's two-line
  row, and the header hides.

### Navigation per page

| Page | Today | Proposed |
| --- | --- | --- |
| Account (`/profile`) | Profile · Appearance · Notifications · Security | Same four. Security splits Blocked out only if it grows. |
| Server admin (`/admin`) | Server · Hosting · Login · Storage | Server · Accounts · Hosting · Login · Storage. Accounts earns its own page as a table. |
| Space settings | Space · Members | General · About · Channels · Members · Banned · Owner (owner only). Each is one group, so the page stops being a scroll. |

The nav column replaces the channel sidebar while on `/s/:id/settings`.
The rail still shows which space you are in, and the nav header carries
the name and the way back.

## Options considered

**A. Nav column + wide content + rows and tables.** Chosen. It is
the layout every settings surface people already know (Discord, Slack,
GitHub) and it fits the app's own three-column rhythm: rail, list,
content. The phone version is the current page with a scrolling tab
strip, so nothing is lost there.

**B. Keep the tab row, widen the column, add rows and tables.** The
smallest step: change `.profile-card` from 520px to 960px and add the two
layouts. Worth doing first if A is deferred; everything in A builds on
it. The tab row wraps at four labels on a phone today and would still.

**C. Two-column card grid.** Cards flow into two columns on wide
screens. Rejected: cards have uneven heights so the reading order is
ambiguous, a list still lives in a half-width card, and the phone view
gains nothing.

**D. One `/settings` route with account and server sections in one
nav.** Tempting for admins, but a member sees a nav with a "Server"
group they cannot open, or a nav that changes by role. Keep three entry
points sharing one frame; revisit if a fourth settings page appears.

## Phone behaviour

Below 768px, in `mobile.css`:

- The nav column becomes a horizontal chip strip under the page header
  (`overflow-x: auto`, no wrap, the active chip scrolled into view).
- Setting rows stack: title, description, control, full width.
- List grids collapse to the two-line row with actions on the right,
  which is the row we ship today.
- Padding drops to 12px 8px as it does now.

The channel sidebar and rail are already off-canvas here, so the space
settings page loses nothing it had.

## Rollout

Each step is a PR that leaves the page working:

1. Frame: nav column, wide content, flat groups, phone strip. No section
   changes. Space layout swaps the channel sidebar for the nav on
   `/settings`.
2. Setting rows in the simple sections: registration, space creation,
   password sign-in, default channel, upload limits, notifications.
3. List grids: Accounts, Members, Banned, Channels, Muted, Linked
   accounts.
4. Hosting: the form's groups become nav-less rows with the voice
   reading as a callout beside the Save.

`settings.css` is 150 lines; the frame and two layouts add about 120.
If it passes 300, the list grid moves to `lists.css`.

## Decisions (2026-09-02)

- Option A, as mocked up.
- The settings nav replaces the channel sidebar on `/s/:id/settings`.
  The rail still shows the space; the nav header carries its name and
  "Back to space".
- Banned is its own nav item and section, not the bottom of Members.
- People and channel lists get columns on desktop, as in the mockups:
  Accounts is person, role, joined, actions; Members is person, role,
  actions; Channels is channel, topic, actions. They fold to the
  two-line row below 768px.
