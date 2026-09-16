# Retention

Status: decided 2026-09-16 (STOOP-106, STOOP-112). Every decision below
was settled with the maintainer before the build; the renderings live in a
design page beside it.

Two server-wide settings, both off by default: delete messages after N
days, and delete attachments after N days. The first keeps a server from
holding years of conversation it never meant to keep; the second stops the
storage limit becoming a wall while the conversation stays readable.

## Decisions at a glance

| | |
| --- | --- |
| Level | Instance only, set by an instance admin. 112 first asked for a per-space value with per-channel overrides; dropped. |
| Messages | Deleted with everything that cascades from a message and their attachments' files. |
| Attachments | The blob and the name go; the row stays marked expired. The message shows "Expired attachment · 3.4 MB". |
| DMs | Included. |
| Pinned | Kept, with their files. Unpin and they age out normally. |
| Also kept | Avatars, icons, link preview images (the orphan sweep handles those). |
| Range | 1-3650 days; blank or 0 keeps forever. |
| Grace | None. Saving a shorter period shows the counts it would delete now (`PreviewRetention`) and asks. |
| Environment | No variable; the admin page is the one place. |
| Live updates | None. Swept messages disappear on the next load. |

## Placement

- **Admin → Storage → Retention:** two rows, days and a Save. A shorter
  period confirms with the counts; a longer one or blank doesn't.
- **History head:** "Beginning of #name · messages older than N days are
  deleted", from the public instance status.
- **Expired attachment:** a dashed placeholder with an image or file icon,
  "Expired attachment" and the size. Not clickable.

## Build

- Migration `00041_attachment_expiry.sql`: `files.expired_at` and a partial
  index on attachment age. Messages need no schema.
- `internal/instance/retention.go`: the settings, `PreviewRetention`.
- `internal/chat/retention_sweep.go`: hourly message sweep by UUIDv7 id
  range.
- `internal/files/retention.go`: hourly attachment expiry, `410 Gone`,
  `Attachment.expired`.

See [messaging.md](../architecture/messaging.md#message-retention) and
[files.md](../architecture/files.md#retention) for what the code does.
