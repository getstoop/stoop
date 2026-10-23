import { mentionText, mentionTokenAt } from "./mentions";

// A message's content in a plain text field, and back. The field can't
// hold the tokens a mention or a channel link is stored as
// (docs/architecture/messaging.md → Mentions), so going in each
// <@u:ID:handle>, <@g:ID:handle> and <#ID:name> reads as the @handle or
// #name it shows as, and coming back the tokens are put back by what the
// original had. The phone's composer edits a message this way; web's
// editor holds the tokens itself and has no need of it.
//
// The rule: a @handle or #name the original carried only as a token
// becomes that token again wherever it stands now, so a mention moved
// or repeated keeps its token, one removed stays removed, and a @name
// the original had no token for stays words, as a new message's do
// today. Where the original had the same words in more than one form
// (as a token and as plain text, or as a person's token and a group's)
// the n-th occurrence stays what the n-th was, and any beyond those
// stays as typed; so content put back unchanged comes out unchanged.
// Only tokens are ever written back: words stay spelt as typed. A token
// stuck to a word ("cc<@u:…:ada>", two tokens with nothing between) is
// shown raw, since its words could not be told from the word beside
// them on the way back. Known limit: a person's and a group's token
// with one handle are told apart by position alone, so moving one past
// the other swaps them.

// A plain @handle or #name at a position (sticky), the character before
// it as mentionQueryAt and channelQueryAt bound it, and the character
// after it that would run on into it.
const PLAIN_MENTION = /@[a-z0-9_]+/iy;
const PLAIN_CHANNEL = /#[a-z0-9_-]+/iy;
const BEFORE_MENTION = /[a-z0-9_@]/i;
const BEFORE_CHANNEL = /[a-z0-9_#&/]/i;
const AFTER_MENTION = /[a-z0-9_]/i;
const AFTER_CHANNEL = /[a-z0-9_-]/i;

// How a message's content reads in the field: each token as its words,
// unless a word runs into it on either side.
export function editableText(content: string): string {
  let out = "";
  let at = 0;
  while (at < content.length) {
    const token =
      content[at] === "<" ? mentionTokenAt(content.slice(at)) : null;
    if (!token) {
      out += content[at];
      at++;
      continue;
    }
    const channel = token.mention.kind === "channel";
    const before = channel ? BEFORE_CHANNEL : BEFORE_MENTION;
    const after = channel ? AFTER_CHANNEL : AFTER_MENTION;
    const previous = out.at(-1);
    const next = content[at + token.length];
    const stuck =
      (previous !== undefined && before.test(previous)) ||
      (next !== undefined && after.test(next));
    out += stuck
      ? content.slice(at, at + token.length)
      : mentionText(token.mention);
    at += token.length;
  }
  return out;
}

// One @handle or #name in a text, as a token or as plain words.
type Occurrence = {
  start: number;
  length: number;
  // The words it shows as, lowercased: "@handle" or "#name".
  text: string;
  // How it is written: the token, or the words as typed.
  form: string;
};

function occurrences(content: string): Occurrence[] {
  const found: Occurrence[] = [];
  let at = 0;
  while (at < content.length) {
    const char = content[at];
    if (char === "<") {
      const token = mentionTokenAt(content.slice(at));
      if (token) {
        found.push({
          start: at,
          length: token.length,
          text: mentionText(token.mention),
          form: content.slice(at, at + token.length),
        });
        at += token.length;
        continue;
      }
    } else if (char === "@" || char === "#") {
      const plain = char === "@" ? PLAIN_MENTION : PLAIN_CHANNEL;
      const before = char === "@" ? BEFORE_MENTION : BEFORE_CHANNEL;
      plain.lastIndex = at;
      const match = plain.exec(content);
      if (match && !(at > 0 && before.test(content[at - 1]))) {
        found.push({
          start: at,
          length: match[0].length,
          text: match[0].toLowerCase(),
          form: match[0],
        });
        at += match[0].length;
        continue;
      }
    }
    at++;
  }
  return found;
}

// The edited text with the original's tokens put back, by the rule above.
export function withTokensRestored(edited: string, original: string): string {
  // Each @handle or #name the original had, with its forms in order.
  const had = new Map<string, string[]>();
  for (const { text, form } of occurrences(original)) {
    const forms = had.get(text);
    if (forms) forms.push(form);
    else had.set(text, [form]);
  }
  for (const [text, forms] of had) {
    if (!forms.some((form) => form.startsWith("<"))) had.delete(text);
  }
  if (had.size === 0) return edited;

  const out: string[] = [];
  const seen = new Map<string, number>();
  let last = 0;
  for (const { start, length, text, form } of occurrences(edited)) {
    const forms = had.get(text);
    if (!forms) continue;
    const nth = seen.get(text) ?? 0;
    seen.set(text, nth + 1);
    const oneForm = forms.every((candidate) => candidate === forms[0]);
    const wanted = oneForm ? forms[0] : nth < forms.length ? forms[nth] : form;
    if (wanted === form || !wanted.startsWith("<")) continue;
    out.push(edited.slice(last, start), wanted);
    last = start + length;
  }
  out.push(edited.slice(last));
  return out.join("");
}
