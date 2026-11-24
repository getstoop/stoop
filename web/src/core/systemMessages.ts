import { ChannelPostPolicy } from "../gen/stoop/chat/v1/channel_pb";
import type {
  Message,
  MessageAuthor,
  PollWinner,
} from "../gen/stoop/chat/v1/message_pb";

// The wording of a system message (docs/architecture/messaging.md →
// System messages): a row that records something that happened in its
// channel. The server sends the event and every word of the row is built
// here, as parts each client draws its own way, so web and mobile say
// the same thing. (A poll is the kind that carries words someone wrote,
// and the server words the one-line previews of one.) A poll itself is
// drawn as a card (core/polls.ts), not as a line; its closing row is a
// line.

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
  | "poll"
  | "update";

export type SystemPart =
  | { kind: "text"; text: string }
  // Someone named in the row, as the row was sent: each client passes
  // them through its live-name overlay, as it does an author.
  | { kind: "person"; person: MessageAuthor }
  // The people a long list leaves out, as "3 others": the control that
  // unfolds the list (systemLine with unfolded) to name them all.
  | { kind: "others"; label: string; people: MessageAuthor[] }
  // A channel's name with its #; current is the name it has now (the new
  // one in a rename), drawn in full ink.
  | { kind: "channel"; name: string; current: boolean }
  // Words the row stresses, in full ink: a closed poll's winners.
  | { kind: "emphasis"; text: string }
  // The message a row is about, in the server's excerpt ("" when the
  // message has no words to excerpt, or the row words it itself), and
  // the way to it; label names it for a screen reader's View.
  | { kind: "excerpt"; messageId: string; text: string; label?: string };

export type SystemLine = {
  glyph: SystemGlyph;
  parts: SystemPart[];
  // Set only on a line with a list long enough to fold: "folded" while
  // it counts the rest as others, "unfolded" while it names everyone
  // (and the client offers to fold it again).
  fold?: "folded" | "unfolded";
};

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

// A row that shows nothing, so the lists leave it out before grouping: a
// quiet row of a kind this client does not know, and a pin row whose
// message is gone (the server removes the row with it, so this is one
// from before that, or one the retention sweep left). (Not isShown in
// the channel log, whose range edges and cap count every row.)
export function isHiddenSystemRow(message: Message): boolean {
  const event = message.event;
  if (!event) return false;
  if (event.kind.case === "pin") return !referenceLive(message);
  return event.kind.case === undefined && message.quiet;
}

// The message a row is about is still there: the server sends its author
// with it, and only an id (or nothing) once it is gone. Not the excerpt,
// which a live message can lack (an empty code block).
function referenceLive(message: Message): boolean {
  return !!message.reference?.messageId && !!message.reference.author;
}

// The rows a list draws: every row but the hidden system rows. The same
// array back when none is hidden.
export function withoutHiddenSystemRows(messages: Message[]): Message[] {
  return messages.some(isHiddenSystemRow)
    ? messages.filter((message) => !isHiddenSystemRow(message))
    : messages;
}

// What a system message says; null for a hidden row, and for a row that
// is not a system message. A long list of people is folded to "A, B and
// N others" unless unfolded, which names them all.
export function systemLine(
  message: Message,
  unfolded = false,
): SystemLine | null {
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
        parts: [actor, text(" added "), ...peopleList(members, unfolded)],
        ...(members.length > NAMED && {
          fold: unfolded ? "unfolded" : "folded",
        }),
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
      if (!reference || !referenceLive(message)) return null;
      return {
        glyph: "pin",
        parts: [
          actor,
          text(reference.preview ? " pinned a message: " : " pinned a message"),
          {
            kind: "excerpt",
            messageId: reference.messageId,
            text: reference.preview,
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
    // A poll is drawn as a card (core/polls.ts pollOf), never as this
    // line; a client that has no card yet says what it is.
    case "poll":
      return {
        glyph: "poll",
        parts: [actor, text(` posted a poll: ${kind.value.question}`)],
      };
    case "pollClosed":
      return {
        glyph: "poll",
        parts: [
          actor,
          text(` closed the poll: ${sentence(kind.value.question)} `),
          ...outcome(kind.value.winners),
          // Its wording is the row's own snapshot; the reference is only
          // the way back to the poll, while there is one.
          ...(message.reference && referenceLive(message)
            ? [
                {
                  kind: "excerpt" as const,
                  messageId: message.reference.messageId,
                  text: "",
                  label: "View poll",
                },
              ]
            : []),
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
    case "emphasis":
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

// "A", "A and B", "A, B and C", "A, B and 3 others"; unfolded, every
// name: "A, B, C, D and E".
function peopleList(people: MessageAuthor[], unfolded: boolean): SystemPart[] {
  if (people.length === 0) return [text("no one")];
  const named =
    people.length > NAMED && !unfolded ? people.slice(0, 2) : people;
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

// A question as the start of a sentence that goes on: a full stop added
// when it ends without one of its own.
function sentence(question: string): string {
  return /[.?!…:]$/.test(question) ? question : `${question}.`;
}

// A closed poll's outcome: "Winner: A, 3 votes", "Tied: A and B, 3 votes
// each", or "Nobody voted".
function outcome(winners: PollWinner[]): SystemPart[] {
  if (winners.length === 0) return [text("Nobody voted")];
  const votes = winners[0].votes === 1 ? "1 vote" : `${winners[0].votes} votes`;
  const parts: SystemPart[] = [
    text(winners.length === 1 ? "Winner: " : "Tied: "),
  ];
  winners.forEach((winner, index) => {
    if (index > 0)
      parts.push(text(index === winners.length - 1 ? " and " : ", "));
    parts.push({ kind: "emphasis", text: winner.text });
  });
  parts.push(text(winners.length === 1 ? `, ${votes}` : `, ${votes} each`));
  return parts;
}

// A case the generated type has and this file does not: the compiler
// refuses it, and at run time a newer client reads it as unknown.
function unknownCase(kind: never): SystemLine {
  void kind;
  return UNKNOWN;
}
