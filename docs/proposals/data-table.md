# Settings tables: one component

Status: decided 2026-09-18; built in six pull requests
(the component with Members and Banned, Accounts, Channels, the space's
Integrations, the server's Integrations, Profile). This file is the text
of a design page with live renderings that lives in the maintainer's
private tooling; the reasoning is all here, and the decisions are at the
end. How to use the component is in
[../architecture/web.md](../architecture/web.md#tables).

## The problem

Thirteen settings lists were each a `ul.user-list.table` in which every
row, and the header, was its own CSS grid. Rows could not share column
widths, so:

- Channels: the "Topic" header floated off its column, because the
  third track was as wide as the word "Announcement" in the header and
  as wide as a checkbox in the rows; voice rows, with no checkbox,
  shifted again.
- Members and Bots: the actions track was as wide as that row's chips, so
  "Owner", "Admin" and "Member" each started somewhere different, and a
  deactivated bot's standing sat well to the right of the others.
- Outgoing webhooks: a long URL ran into the next column.

Nothing was paged. Accounts and Bots ran to the bottom of the page, nine
deactivated bots padded the list, and every bot's credentials were
always open, each a run-on line.

## The shape

A toolbar (search, a switch for hidden rows, the count), a header, the
body, an optional detail row under a parent, and a footer with the
pager. Small tables render only the header and body.

- A real `<table>` with fixed columns, so rows share the header's tracks.
- Search, sort and paging from TanStack Table, client-side: every list is
  already fully loaded. The same component can go server-side later.
- The first column is the row's identity and the only full-contrast
  text. The last is actions: right-aligned, fixed width, never wraps.
- State is a dot, a word and the reason. An off row dims what it says,
  never the controls that bring it back.
- Identifiers (URLs, key hints) truncate to a line; prose wraps.
- On a phone a row folds into a stack, each cell under its column's
  label, and sorting moves to a select in the toolbar.
- Loading is skeleton rows under the header; empty and no-match each say
  so inside the box; a failed action is reported on its own row.

## Rules

| Question | Rule |
| --- | --- |
| Search? | Tables of people, accounts or bots. Anything else once it can pass one page. |
| Paging? | `pageSize`, default 25; the pager shows only past one page. Pages, not endless scroll: a settings list wants a stable footer. |
| Sort? | Per column, by value (rank, timestamp), not by the printed text. Never on a list whose order is the data. |
| Inline actions | At most two; the rest in the row menu. A single action is always inline. |
| Hidden rows | Dead things (deactivated bots) wait behind a counted switch. Search still finds them. |
| Detail row | Only when a row owns a list. One level deep. |

## Decisions

1. Members: every action in the row menu, nothing inline.
2. The space's incoming webhooks are one row per webhook, the bot a cell:
   in a space nearly every bot has exactly one, so two levels only
   doubled the height.
3. Bots: credentials closed by default on every bot; the row's summary
   ("2 webhooks", "1 off") says whether to open it.
4. Page size is a prop, default 25.
5. Merging a channel's Rename and Topic into one Edit is its own ticket.
