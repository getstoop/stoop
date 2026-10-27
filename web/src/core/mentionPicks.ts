import {
  candidateMention,
  type MentionCandidate,
  type MentionRef,
  mentionToken,
} from "./mentions";

// What the phone's composer field does for a pick from the mention list,
// or its @ button: the `count` characters before the caret replaced by
// `text`, or by a pill for `mention` and then `text`. The field reads
// only the caret's line up to the caret.
export type Replace = { count: number; text: string; mention?: MentionRef };

// What a picked row writes: its token, or @channel / @here as the words
// they are sent as.
export function pickedWords(candidate: MentionCandidate): string {
  const ref = candidateMention(candidate);
  if (ref) return mentionToken(ref);
  return candidate.kind === "member" ? `@${candidate.member.username}` : "";
}

// The query typed from `start` (its "@" or "#") to the caret replaced by
// the pick and a space: a pill, or @channel / @here as words.
export function pickReplace(
  before: string,
  start: number,
  candidate: MentionCandidate,
): Replace {
  const count = before.length - start;
  const mention = candidateMention(candidate);
  if (mention) return { count, text: " ", mention };
  return { count, text: `${pickedWords(candidate)} ` };
}

// The character before an "@" that would make it part of a word, as
// mentionQueryAt reads it.
const RUNS_INTO_AT = /[a-z0-9_@]/i;

// An "@" put in at the caret, after a space where the character before
// would run into it, so it starts a query and the list opens.
export function atReplace(before: string): Replace {
  const last = before[before.length - 1];
  return {
    count: 0,
    text: last !== undefined && RUNS_INTO_AT.test(last) ? " @" : "@",
  };
}

// The plain field's edits, kept while the composer still holds its own
// text: the text after a pick or the @ button, and where the caret goes.
// They go with the rich field (the composer's pull request).
export type Edited = { text: string; caret: number };

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
