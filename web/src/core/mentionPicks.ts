import {
  candidateMention,
  type MentionCandidate,
  mentionToken,
} from "./mentions";

// The phone's plain composer field after a pick from the mention list,
// or its @ button: the text, and where the caret goes. The field shows a
// mention as its token until the rich editor draws it as one.
export type Edited = { text: string; caret: number };

// What a picked row writes: its token, or @channel / @here as the words
// they are sent as.
export function pickedWords(candidate: MentionCandidate): string {
  const ref = candidateMention(candidate);
  if (ref) return mentionToken(ref);
  return candidate.kind === "member" ? `@${candidate.member.username}` : "";
}

// The query typed from `start` (its "@" or "#") to the caret replaced by
// the pick and a space, the caret after them.
export function withPick(
  text: string,
  start: number,
  caret: number,
  candidate: MentionCandidate,
): Edited {
  const words = `${pickedWords(candidate)} `;
  return {
    text: text.slice(0, start) + words + text.slice(caret),
    caret: start + words.length,
  };
}

// The character before an "@" that would make it part of a word, as
// mentionQueryAt reads it.
const RUNS_INTO_AT = /[a-z0-9_@]/i;

// An "@" put in at the caret, after a space where the character before
// would run into it, so it starts a query and the list opens.
export function withAt(text: string, caret: number): Edited {
  const before = text[caret - 1];
  const at = before !== undefined && RUNS_INTO_AT.test(before) ? " @" : "@";
  return {
    text: text.slice(0, caret) + at + text.slice(caret),
    caret: caret + at.length,
  };
}
