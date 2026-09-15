# Presence, and do not disturb

Status: proposed and decided 2026-09-15. Supersedes STOOP-252 and the
status half of [app-settings-and-status.md](app-settings-and-status.md).

## The decision

- **Presence is a fact the server knows: online or offline.** Online means
  a connection is open. A computer that sleeps drops its socket and goes
  offline within a ping (30 seconds).
- **Away is gone.** Nothing sets it by hand or by idleness. A person with
  Stoop in a background tab, or behind other windows, still gets
  notifications and can answer them, so they are online.
- **Do not disturb is the one thing a person chooses.** It says "don't
  bother me, Stoop": others see it, and it silences that person's own
  alerts. It belongs to the account, not to a browser or an app, and can
  end on its own.
- **"Status" is freed** for something a person writes, such as a status line
  or emoji, later. The code is renamed as well, so the old meaning does not
  linger.

## Why Away goes

Automatic Away guessed "they left the device" from input reaching one
page. That guess is wrong whenever someone works in another tab or
another server. The server also takes the last status any of a person's
connections sent, so an idle tab or a phone left open overrides the one
they are using. Presence plus a deliberate do not disturb says what
someone asking "will they answer?" needs, without the guessing.

## The dot

| Presence | Do not disturb | Dot |
| --- | --- | --- |
| Offline | either | Offline |
| Online | off | Online |
| Online | on | Do not disturb |

The profile card says "On do not disturb" whether or not the person is
online.

## Data model

Do not disturb lives on `users`, which the auth module owns:

```sql
ALTER TABLE users
  ADD COLUMN dnd boolean NOT NULL DEFAULT false,
  ADD COLUMN dnd_until timestamptz,
  ADD CONSTRAINT users_dnd_until_needs_dnd CHECK (dnd OR dnd_until IS NULL),
  ADD CONSTRAINT users_bot_never_dnd CHECK (kind = 'person' OR NOT dnd);
```

| `dnd` | `dnd_until` | Meaning |
| --- | --- | --- |
| false | NULL | Off |
| true | NULL | On until turned off |
| true | future | On until then |
| true | past | Expired: reads as off |

- **On** is `dnd AND (dnd_until IS NULL OR dnd_until > now())`, computed
  once in the auth module. An expired row keeps `dnd = true` until the
  next write, and nothing sweeps it.
- **A column, not a table.** It is one value per person, read with the
  person. Mutes have their own tables because a person has many of them.
- **Bots cannot be on do not disturb.** The constraint follows
  `users_bot_never_admin`.

## Setting it

- `AuthService.SetDoNotDisturb({ on, until? })` returns the updated `User`.
  It sits beside `UpdateProfile` and needs the same action,
  `ProfileManage`.
  - Turning it on writes both columns. Turning it off writes `false, NULL`.
  - An `until` in the past is refused.
- `User` gains `dnd` and `dnd_until`, so `GetMe` and profile cards carry
  them.
- After the write, auth publishes a change event to `user:<id>`.

## Every device agrees

Do not disturb belongs to the account, so every device a person uses
follows it. The server is the only place it is set; devices never keep
their own copy.

- **Turning it on stops alerts everywhere.** The change event goes to
  `user:<id>`, which every connection a person has already subscribes to
  (`realtime/gateway.go`). Each device updates its own flag on arrival
  and holds its alerts from then on. Today every alert is raised by a
  client from a realtime event, so a connected device goes quiet at once.
- **A device that was asleep catches up on reconnect.** Its `Ready`
  includes the person's own presence, `dnd` included, and `GetMe` carries
  `dnd` and `dnd_until`. It must not act on a stale cached copy.
- **Signing in on a new device adopts do not disturb.** Connecting makes a
  person online, and that has nothing to do with do not disturb. The dot
  stays on do not disturb, and the new device holds its alerts. Only
  turning it off, or `dnd_until` passing, ends it.
- **Nothing a device does by connecting can clear it.** In particular, the
  desktop app applies its switch only when the person changes it, or when
  a page loads while the switch is **on**. A page that loads while the
  switch is off leaves the server alone. Otherwise, opening the desktop
  app would wipe do not disturb set from a phone.
- **Alerts are held if either says so.** Inside the desktop app a banner is
  held while the app's switch is on, or while that page's server says do
  not disturb. Setting it from a phone silences that server's banners on
  the desktop too, even though the app's switch doesn't show it.
- **Later push notifications check the server.** When push arrives
  (STOOP-88), the server decides whether to send, from `dnd` and
  `dnd_until`. No client is involved.

## Presence in the gateway

The gateway stays in memory and never touches the database.

- **On connect** it asks through a port it owns,
  `DoNotDisturb(ctx, userID) (on bool, until *time.Time, err error)`, wired
  to auth in `internal/app`.
- **On a change event** it updates the person's presence entry. Only the
  first update that changes something broadcasts `PresenceChanged` to the
  person's spaces, however many connections they have.
- **Expiry** is a timer only where `until` is set and in the future. When it
  fires, the gateway broadcasts and drops it. Do not disturb with no end
  starts no timer. A restart loses the timers, and each reconnect's lookup
  rebuilds them.

## Wire

- `PresenceStatus` and the client event `SetStatus` are removed. The
  removed names and numbers are reserved.
- `UserPresence` becomes `{ user_id, dnd }`, and `PresenceChanged` becomes
  `{ user_id, online, dnd }`. An end time travels only where a client needs
  it: `User` for the person themself, and the card.
- A client silences its own alerts while `dnd` is on and `until` has not
  passed. It checks `until` locally, so alerts come back on time without
  waiting for the server.

## Web

- `api/status.ts` loses the idle watch and the Online/Away/Do not disturb
  choice. What remains is presence display and do not disturb.
- The Status section in account settings becomes a **Do not disturb**
  switch under Notifications. Ending at a chosen time comes later, with no
  schema change.
- Presence styles and labels drop `away`.

## Desktop app

In the app, do not disturb means "don't bother me, Stoop", across every
server.

- The App settings switch is the app's own setting, kept in its settings
  file with its optional end.
- Turning it on or off tells every server page to set its own server. A
  server added or reloaded while it is on sets it too.
- The app holds its own desktop banners at once, without waiting for any
  server.
- **The bridge changes before it ships.** `status` and `onStatus` become
  `dnd` and `onDnd`: the app's setting, and changes to it. Level 3 has not
  been announced, so nothing needs to stay compatible.
- `StatusWatch` and its idle polling are deleted.
- Changing do not disturb in a browser on one server can put that server
  out of step with the app until the app next applies its setting. That is
  accepted.

## Tickets

- STOOP-252 is superseded.
- STOOP-278 (presence shapes) narrows to online, offline and do not disturb.
- STOOP-144 (the status menu on the rail avatar) becomes a do not disturb
  toggle.

## Not in scope

- A status line or status emoji: the word is reserved for it.
- Preset durations ("for an hour", "until tomorrow"): the column is ready
  for them.
- Push notifications (STOOP-88) respecting do not disturb: this makes it
  possible, since the server now knows.
