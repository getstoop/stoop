# Server admin: a Spaces page

Status: decided 2026-09-18; built in one pull request (STOOP-18). This
file is the text of a design page with live renderings that lives in the
maintainer's private tooling; the reasoning is all here, and the
decisions are at the end. The table component it is built from is
[data-table.md](data-table.md).

## The problem

An instance admin inherits `admin` in every space, but inheritance is a
permission check rather than a membership row
([../architecture/permissions.md](../architecture/permissions.md)). A
space they have not joined is therefore nowhere in their rail: no pill,
no entry in `ListSpaces`, no way to open it. They can act on it through
the API and cannot find it in the app.

Hit while testing the access model, and it is the one place where "the
operator can fix things" fails for want of a door rather than a
permission.

## The shape

A sixth tab in Server admin, **Spaces**, after Accounts: the two tabs
that answer "what is on this server" sit together, and Hosting onwards is
configuration. One `DataTable` fills it.

| Column | Width | Cell | Sorts by |
| --- | --- | --- | --- |
| Space | what's left | Icon, name, a `joined` badge; the description beneath | name |
| Owner | 22% | Display name, falling back to the username; a deleted account takes `DeletedMark` | the same text |
| Members | 13%, `align: end` | The count | the count |
| Created | 15% | `toLocaleDateString()`, as Accounts prints Joined | the timestamp |
| (actions) | 150px | **Open** or **Join**, then the row menu | — |

- **Default sort is Space ascending**, matching the query's own
  `ORDER BY name, id`.
- **Search** over the space name and the owner's name and username.
- **One inline action, one menu.** The chip is **Open** when the admin is
  a member and **Join** when they are not; the two are never both
  available. Delete lives in the row menu — a destructive chip on every
  row of a list of other people's spaces is a misclick waiting to happen.
- **Open is a link to `/s/{id}`**, not an RPC: membership already exists,
  so it is the same navigation the rail does.
- **Join** confirms, then calls `JoinSpace` by id — the path
  `joinAsInstanceAdmin` already serves, which enters as a plain member,
  not as an admin. **Delete** is the exact dialog the space's own Owner
  tab uses: type the name, then `DeleteSpace`. Same words in both places.

## The RPC

`ListAllSpaces` returns its own `SpaceSummary` rather than the `Space`
message, for two reasons. `Space` rides every realtime event, and
`member_count` and `viewer_is_member` are wanted on one admin page.
And `Space.my_role` reports `ADMIN` for a space an instance admin is not
in, so it cannot answer "am I a member" — which is the whole question
this page asks.

`ListSpaces{all:true}` stays where it is, serving bot placement. Two ways
to list every space is one more than wanted; migrating those callers and
dropping the `all` flag is filed separately rather than smuggled in here.

Counts and membership come back with the rows in one query, so there is
no query per space; owners are resolved in one batch through the existing
`UserDirectory` port, so no new port and no new module boundary. There is
no per-space bound to apply: `instance.read` is an instance action, so a
bounded credential fails the permission check rather than being shown the
spaces it reaches.

## Decisions

1. A new RPC with its own summary type, not more fields on `Space`.
2. Both listings kept; the cleanup is its own ticket.
3. Joining does not navigate. An admin joining three spaces in a row
   should stay on the list; the row's chip becomes **Open**.
4. Joining confirms. It is reversible, but the space's members see the
   arrival and the admin is arriving uninvited.
5. Leaving is not offered here. It lives on the space, and a fourth verb
   in a list whose job is finding spaces that are missing from the rail
   earns nothing.
