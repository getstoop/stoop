import { ChannelPostPolicy } from "../gen/stoop/chat/v1/channel_pb";
import type { Message, MessageAuthor } from "../gen/stoop/chat/v1/message_pb";

// The wording of a system message (docs/architecture/messaging.md →
// System messages): a row that records something that happened in its
// channel, with no text anyone wrote. The server sends only the event;
// every word is built here, as parts each client draws its own way, so
// web and mobile say the same thing.

// The glyph in the avatar column, by name: each client maps it to its own
// icon.
export type SystemGlyph =
  | "person-plus"
  | "arrow-in"
  | "arrow-out"
  | "pencil"
  | "text-lines"
  | "pin"
  | "megaphone"
  | "update";

export type SystemPart =
  | { kind: "text"; text: string }
  // Someone named in the row, as the row was sent: each client passes
  // them through its live-name overlay, as it does an author.
  | { kind: "person"; person: MessageAuthor }
  // The people a long list leaves out, as "3 others": drawn as one
  // phrase now, and the control that unfolds them later.
  | { kind: "others"; label: string; people: MessageAuthor[] }
  // A channel's name with its #; current is the name it has now (the new
  // one in a rename), drawn in full ink.
  | { kind: "channel"; name: string; current: boolean }
  // The message a row is about. Its text is the server's excerpt, or
  // "(since deleted)" once the message is gone (deleted).
  | { kind: "excerpt"; messageId: string; text: string; deleted: boolean };

export type SystemLine = { glyph: SystemGlyph; parts: SystemPart[] };

// A kind this client does not know, on a row that is not quiet.
const UNKNOWN: SystemLine = {
  glyph: "update",
  parts: [{ kind: "text", text: "Update Stoop to see this message." }],
};

// Above this many people, a list names the first two and counts the rest.
const NAMED = 3;

// A system message: a row whose event is set, whatever its case.
export function isSystemRow(message: Message): boolean {
  return message.event !== undefined;
}

// A row of a kind this client does not know that is quiet: it shows
// nothing, so the lists leave it out before grouping. (Not isShown in
// the channel log, whose range edges and cap count every row.)
export function isHiddenSystemRow(message: Message): boolean {
  return (
    message.event !== undefined &&
    message.event.kind.case === undefined &&
    message.quiet
  );
}

// The rows a list draws: every row but the hidden system rows. The same
// array back when none is hidden.
export function withoutHiddenSystemRows(messages: Message[]): Message[] {
  return messages.some(isHiddenSystemRow)
    ? messages.filter((message) => !isHiddenSystemRow(message))
    : messages;
}

// What a system message says; null for a hidden row, and for a row that
// is not a system message.
export function systemLine(message: Message): SystemLine | null {
  const event = message.event;
  if (!event) return null;
  const actor = person(message.author);
  const kind = event.kind;
  switch (kind.case) {
    case "membersAdded": {
      const members = kind.value.members;
      if (members.length === 1 && members[0].id === message.author?.id)
        return { glyph: "arrow-in", parts: [actor, text(" joined")] };
      return {
        glyph: "person-plus",
        parts: [actor, text(" added "), ...peopleList(members)],
      };
    }
    case "memberLeft":
      return { glyph: "arrow-out", parts: [actor, text(" left")] };
    case "channelRenamed":
      return {
        glyph: "pencil",
        parts: [
          actor,
          text(" renamed the channel from "),
          { kind: "channel", name: kind.value.oldName, current: false },
          text(" to "),
          { kind: "channel", name: kind.value.newName, current: true },
        ],
      };
    case "topicChanged":
      return kind.value.topic === ""
        ? { glyph: "text-lines", parts: [actor, text(" cleared the topic")] }
        : {
            glyph: "text-lines",
            parts: [actor, text(` set the topic: ${kind.value.topic}`)],
          };
    case "pin": {
      const reference = message.reference;
      if (!reference?.preview)
        return {
          glyph: "pin",
          parts: [
            actor,
            text(" pinned a message "),
            {
              kind: "excerpt",
              messageId: reference?.messageId ?? "",
              text: "(since deleted)",
              deleted: true,
            },
          ],
        };
      return {
        glyph: "pin",
        parts: [
          actor,
          text(" pinned a message: "),
          {
            kind: "excerpt",
            messageId: reference.messageId,
            text: reference.preview,
            deleted: false,
          },
        ],
      };
    }
    case "postPolicyChanged":
      return {
        glyph: "megaphone",
        parts: [
          actor,
          text(
            kind.value.postPolicy === ChannelPostPolicy.ADMINS
              ? " made this an announcement channel"
              : " opened this channel to everyone's messages again",
          ),
        ],
      };
    case undefined:
      return message.quiet ? null : UNKNOWN;
    default:
      return unknownCase(kind);
  }
}

// The line as plain words: names as they are given (a caller wanting the
// live names maps the parts first), a deleted account marked. For a
// screen reader's label, and wherever a row is drawn as text alone.
export function systemText(parts: SystemPart[]): string {
  return parts.map(partText).join("");
}

function partText(part: SystemPart): string {
  switch (part.kind) {
    case "text":
    case "excerpt":
      return part.text;
    case "person":
      return personLabel(part.person);
    case "others":
      return part.label;
    case "channel":
      return `#${part.name}`;
  }
}

// A person as a sentence names them.
export function personLabel(person: MessageAuthor): string {
  const name = person.displayName || person.username || "Someone";
  return person.deleted ? `${name} (deleted)` : name;
}

function text(words: string): SystemPart {
  return { kind: "text", text: words };
}

function person(author: MessageAuthor | undefined): SystemPart {
  return author
    ? { kind: "person", person: author }
    : { kind: "text", text: "Someone" };
}

// "A", "A and B", "A, B and C", "A, B and 3 others".
function peopleList(people: MessageAuthor[]): SystemPart[] {
  if (people.length === 0) return [text("no one")];
  const named = people.length > NAMED ? people.slice(0, 2) : people;
  const parts: SystemPart[] = [];
  named.forEach((member, index) => {
    if (index > 0)
      parts.push(
        text(
          index === named.length - 1 && named.length === people.length
            ? " and "
            : ", ",
        ),
      );
    parts.push(person(member));
  });
  const rest = people.slice(named.length);
  if (rest.length > 0) {
    parts.push(text(" and "));
    parts.push({
      kind: "others",
      label: `${rest.length} others`,
      people: rest,
    });
  }
  return parts;
}

// A case the generated type has and this file does not: the compiler
// refuses it, and at run time a newer client reads it as unknown.
function unknownCase(kind: never): SystemLine {
  void kind;
  return UNKNOWN;
}
