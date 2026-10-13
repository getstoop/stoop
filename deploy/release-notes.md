Stoop 0.10.0

Stoop 0.10.0 is still a beta: the API and schema may change between minor
versions. It upgrades in place from 0.9.0 with no schema change, and
`stoop upgrade rollback` can take it back to 0.9.x, 0.8.x, 0.7.x, 0.6.x
or 0.5.x. Going below 0.5.0 needs a backup, as before.

**What's new.**

- **Images and videos open in the app.** Clicking an image in chat opens
  a preview inside Stoop, not a new browser window. It has a Download
  button, and arrows (or the arrow keys) step through the images and
  videos in the channel or thread. An uploaded video is now a small
  still with a play badge in chat, and plays in the same preview.
- **A muted channel leaves the sidebar.** Muting a text channel takes
  its row out of the list. A "Muted channels" bar on top of the members
  list opens them in the side panel, where a channel's name opens it
  and its bell unmutes it. Mentions in a muted channel still reach
  Activity. Muting a space, a voice channel or a conversation works as
  before. Screen readers are told when a channel is muted or unmuted.
- **Link previews for long pages.** A link to a page over 1 MB, a
  YouTube video for one, used to get no card. The server now reads the
  start of the page, 2 MB by default, and makes the card from that.
- **Link previews through a proxy.** Preview fetches can go out through
  a SOCKS5 proxy, so linked sites see the proxy's address and not your
  server's. See [What linked sites see](https://github.com/getstoop/stoop/blob/v0.10.0/docs/self-hosting/reaching-your-server.md#what-linked-sites-see).
- **Writing on a phone.** On a device with an on-screen keyboard, Return
  breaks the line and a send button beside the field sends. Editing a
  message gets Save and Cancel buttons. Desktop is unchanged: Enter
  sends.
- **The thread header's channel name is a link.** It opens the channel
  at the message the thread started from.
- **Smaller things.** Formatting buttons and the paperclip have
  tooltips. A channel opened at the bottom stays there while its images
  load. The message toolbar shows only on the message under the cursor,
  and chat scrollbars only in the pane under it. The invite page shows
  the space's icon to someone not signed in. The password reset email
  states the account's username. A refused upload's reason fits inside
  its chip. Page headers are one height, and the search field no longer
  grows when clicked.

**For operators.**

- **Link previews are off on a new server.** An admin turns them on
  under Server admin → Link previews. With them on, the server fetches
  every posted link from its own address, a tunnel does not hide that,
  and any member can learn the address by linking to a site of theirs.
- **An upgraded server keeps its previews.** At the first start on
  0.10.0, a server that has accounts and no `STOOP_LINK_PREVIEWS` in its
  environment gets the switch saved as on. A server whose environment
  says `STOOP_LINK_PREVIEWS=false` stays off.
- **`STOOP_LINK_PREVIEWS` changed meaning.** It defaults to `false`, and
  it is now only the value used until the switch is saved on the admin
  page. A saved switch overrides it, including turning previews on where
  the variable says `false`.
- **The Link previews tab** has three settings, and nothing applies
  until Save: the switch, the page size (1 to 16 MB), and the proxy,
  written `socks5://host:port`. A change applies to links posted from
  then on, with no restart. HTTP proxies and a SOCKS5 username and
  password are not supported.
- **With a proxy set**, site names are looked up over HTTPS at a public
  resolver, through the proxy, and that resolver sees every linked
  hostname. If the proxy or the resolver is down, links get no card;
  nothing falls back to a direct fetch. Outgoing webhooks still go out
  directly.
- **New variables.** `STOOP_LINK_PREVIEW_HTML_MB` (default `2`) and
  `STOOP_LINK_PREVIEW_PROXY` are used until a value is saved on the
  admin page. `STOOP_LINK_PREVIEW_RESOLVER` is the resolver used with a
  proxy, `https://1.1.1.1/dns-query` by default.
- **The private-address check is stricter.** Link previews and outgoing
  webhooks now refuse IPv6 addresses that carry an IPv4 address inside
  them: `::/96`, NAT64 (`64:ff9b::/96`, `64:ff9b:1::/48`) and 6to4
  (`2002::/16`). A server with no IPv4 of its own, reaching IPv4 sites
  only through NAT64, gets no previews for those sites and cannot
  deliver webhooks to them.
- **Rolling back to 0.9.0 turns direct fetches back on.** 0.9.0 does not
  know the switch or the proxy: previews follow `STOOP_LINK_PREVIEWS`,
  which is on by default there, and every fetch goes out from the
  server's own address. Set `STOOP_LINK_PREVIEWS=false` before a
  rollback if you rely on either.
- **API additions for scripts.** `UpdateSettings` takes `link_previews`,
  `link_preview_html_mb` and `link_preview_proxy`. The instance status
  carries `link_previews` and `link_preview_html_mb`, and
  `GetReachability` carries `link_preview_proxy`. Nothing was removed.

**Schema.** No migrations. 0.9.0 and 0.10.0 share schema 61, and the
schema floor stays at 53.

**Pinned alongside this release:** LiveKit v1.13.6, Postgres 16 and
`cloudflared` 2026.9.3, all unchanged from 0.9.0.

**Known issues.**

- A link that failed to get a card stays without one for a week, so
  links posted while a proxy was down, or to a long page before the
  upgrade, don't get a card straight away.
- The preview's arrows step through the messages already loaded in the
  channel; they don't fetch older history.
- A video's still and playback in the preview were not checked in
  Safari, or with MP4 and `.mov` files.
- A mail relay with a self-signed certificate is not supported over
  STARTTLS or TLS.
- On the new space's first-run card, "Set up" beside a skipped Email
  step opens Hosting. Email is its own tab in Server admin.
- On a phone, picking a channel from the drawer while a thread is open,
  or following the thread header's link to the channel you are already
  in, leaves one extra step in the browser's history, so Back stays on
  the same page once.

Report problems in [GitHub issues](https://github.com/getstoop/stoop/issues);
security problems go through
[private reporting](https://github.com/getstoop/stoop/security/advisories/new).

Changes since 0.9.0:

- Bump source-map-js from 1.2.1 to 1.2.2 in /web (3455492)
- Invites: the invite page shows the space's icon (2981e87)
- Password reset: the email states the username (4976b12)
- Files: the invite icon test asks through the route (b65cc4b)
- Bump vite from 6.4.3 to 8.3.3 in /web (5aba680)
- Web: a muted channel leaves the sidebar (STOOP-480) (66d56ff)
- Web: muted list rows take a hover state and an icon to unmute (5d213db)
- Web: the muted list's unmute is the red muted bell (d39ce6e)
- Web: over the unmute bell, only the bell is highlighted (0060d14)
- Web: the muted channel being read is listed last (4ac8365)
- Web: the open muted channel's row carries the muted bell (662516a)
- Web: a thread from a muted channel says so beside the channel's name (2cce197)
- Web: no thread mute on a thread from a muted channel (89614c2)
- Web: the thread header's muted bell is dimmed like the sidebar's (486184e)
- Web: the thread header's muted bell explains itself on hover (e8f598b)
- Web: keyboard focus follows a mute, and a muted channel's thread says so on its button (5087ae9)
- Web: muting a channel is announced to screen readers (624e262)
- Web: composer tooltips, list icons, and a send button for on-screen keyboards (f281814)
- Web: the thread header's channel name opens the channel on the thread's root (4ff5460)
- Web: a jump to an open thread's root scrolls to it without the flash (7386004)
- Web: page headers keep one height, and Activity fills the desktop shell's corner (5b350da)
- Web: the message hover toolbar's buttons are larger (e581375)
- Web: a grouped message's hover toolbar no longer repeats the time (a4d36e7)
- Web: the thread composer's "Also send to" checkbox lines up with its label (82932fd)
- Web: the "Also send to" checkbox and its label show a pointer (141c149)
- Web: the "Also send to" checkbox and its label are a little larger (305ad6c)
- Web: the "Also send to" label is body-sized (e72d1a6)
- Web: the "Also send to" checkbox is drawn in the app's own style (5c2d129)
- Web: clicking an image in chat opens a preview in the app (5efd3dc)
- Web: a browser spec for the image preview (bd85721)
- Web: the preview's arrows sit beside the image's edges (80677ee)
- Web: the preview's arrows go back to the window's sides, 24px in (ef532e0)
- Web: the preview's arrow buttons are a little larger (65e906f)
- Web: an uploaded video plays in the preview, not in chat (d0a230d)
- Link previews: a long page is read up to a cap the admin can set (9502d97)
- Link previews: a switch on the Server admin tab turns them off and on (c0b94a3)
- Web: the registration spec saves the Server form by name (c648fe1)
- Link previews: fetches can go through a SOCKS5 proxy (0a41e04)
- Link previews: a proxied fetch looks the name up through the proxy (971df67)
- Web: link previews get their own Server admin tab (615b1d5)
- Chat: an edit made while link previews are off drops a removed link's card (f20e4ee)
- Test: the preview cap test waits for the first fetch before raising the cap (90ec478)
- Chat: dropRemovedLinks names its queries parameter (66a0775)
- Web: the link preview proxy can be set while previews are off (6c4fd5f)
- Link previews: a redirect from the name resolver is refused (095befa)
- Web: the link previews switch waits for Save (b57de3a)
- Egress guard: IPv6 addresses that embed an IPv4 one are refused (f0c6144)
- Web: the dropdown arrow sits in from the border (6ccf0af)
- Link previews are off on a new server (cab1bff)
- Web: a kit Select draws the dropdown chevron in the theme's colour (22ff331)
- Link previews: the upgrade default never overwrites a saved choice (9326c13)
- Web: a channel opened at the bottom stays there as its media loads (e44f99d)
- Web: the message toolbar and the chat scrollbars follow the cursor (77e15d8)
- Web: a video's caption shows on hover, and a failed upload's reason fits its chip (ded4b5e)
- Web: a video's caption stays over its still (205f3cc)
