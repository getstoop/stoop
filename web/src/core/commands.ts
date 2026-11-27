// Slash commands, as both apps hold them (docs/architecture/messaging.md →
// Slash commands): the list, what a draft typed so far shows of it, and
// whether a message about to be sent is a command. A command never posts
// by itself: each opens its own form, and the form calls its own RPC.
// The server knows nothing of them.

import { plainText } from "./markdown/text";

// Where the composer is: what decides which commands it offers.
export type CommandPlace = {
  // A thread's composer. A thread takes no poll and no reminder.
  thread: boolean;
  // Whether the person may post here at all.
  canPost: boolean;
  // The commands this app's composer has a form for. A command not named
  // here is neither listed nor read from a send, so an app never offers
  // one it cannot open: its "/name" is sent as an ordinary message.
  opens: readonly CommandName[];
};

// Every command's name, typed after "/" in lower case. A new command is a
// name here and an entry in COMMANDS.
export type CommandName = "poll" | "when" | "remind";

export type Command = {
  name: CommandName;
  // What may follow the name, as shown in the list: "[question]".
  hint: string;
  // One line on what it does.
  description: string;
  offered: (place: CommandPlace) => boolean;
};

// Where a poll can be made: as for web's plus menu, a channel's or a
// conversation's composer, never a thread's. A reminder is offered in the
// same places: it is always posted at the top level.
const pollPlace = (place: CommandPlace) => place.canPost && !place.thread;

export const COMMANDS: readonly Command[] = [
  {
    name: "poll",
    hint: "[question]",
    description: "Create a poll",
    offered: pollPlace,
  },
  // A poll whose options are times.
  {
    name: "when",
    hint: "[question]",
    description: "Find a time",
    offered: pollPlace,
  },
  {
    name: "remind",
    hint: "[what]",
    description: "Set a reminder here",
    offered: pollPlace,
  },
];

export const commandsOffered = (place: CommandPlace): Command[] =>
  COMMANDS.filter(
    (command) => place.opens.includes(command.name) && command.offered(place),
  );

// What the draft so far asks of the list: the letters typed after "/",
// and whether a space has followed them. Null when the list is shut.
export type CommandQuery = { query: string; spaced: boolean };

// The whole draft, not the text before the caret: the list opens only
// while the message is "/" and letters and nothing else ("/po"), and stays
// on once a space follows a name ("/poll Pizza?"), so Enter still opens
// the form. The draft is the Markdown the composer holds, so code ("`/po`"),
// a quote or a list item never opens it.
export function commandQueryAt(draft: string): CommandQuery | null {
  const typed = /^\/([a-z]*)$/i.exec(draft);
  if (typed) return { query: typed[1].toLowerCase(), spaced: false };
  const spaced = /^\/([a-z]+)\s/i.exec(draft);
  if (spaced) return { query: spaced[1].toLowerCase(), spaced: true };
  return null;
}

// The commands the list shows for a query: those whose name starts with
// the letters, or after a space only the one so named.
export function matchingCommands(
  query: CommandQuery,
  place: CommandPlace,
): Command[] {
  return commandsOffered(place).filter((command) =>
    query.spaced
      ? command.name === query.query
      : command.name.startsWith(query.query),
  );
}

// A command and the words that follow it, as plain text for the form's
// first field.
export type ParsedCommand = { command: Command; text: string };

// The words after a command as one plain line: markup dropped, and any
// run of spaces, tabs, line breaks or other control characters made one
// space, so a pasted tab does not trip the form's own checks.
function plainWords(markdown: string): string {
  return plainText(markdown)
    .replace(/[\s\p{Cc}]+/gu, " ")
    .trim();
}

// "/name" at the very start, then a space or the end: the name in lower
// case and the Markdown after the space.
function split(content: string): { name: string; rest: string } | null {
  const found = /^\/([a-z]+)(?:\s|$)/i.exec(content);
  if (!found) return null;
  return {
    name: found[1].toLowerCase(),
    rest: content.slice(found[0].length),
  };
}

// The message about to be sent, as a command offered here: a known name
// right after "/" at the very start of the Markdown, then a space or the
// end. Anything else is a message: an unknown "/word", a path
// ("/usr/local"), text formatted as code, any command in a thread.
export function parseCommand(
  content: string,
  place: CommandPlace,
): ParsedCommand | null {
  const typed = split(content);
  if (!typed) return null;
  const command = commandsOffered(place).find(
    (each) => each.name === typed.name,
  );
  if (!command) return null;
  return { command, text: plainWords(typed.rest) };
}

// The text a command picked from the list carries: the words after its
// name when the draft is that name and a space ("/poll Pizza?"), else
// none ("/po").
export function pickedText(draft: string, command: Command): string {
  const typed = split(draft);
  return typed?.name === command.name ? plainWords(typed.rest) : "";
}
