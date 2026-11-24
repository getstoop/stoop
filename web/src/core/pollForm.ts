// The form that creates a poll, as both apps hold it
// (docs/architecture/messaging.md → Polls): its fields, the rules the
// server applies to them (newPoll and pollLine in internal/chat/polls.go),
// when Post is on, and the request it sends. The drawing is each app's
// own. Every change returns a new form, so it sits in React state as is.

export const POLL_QUESTION_MAX = 200;
export const POLL_OPTION_MAX = 80;
export const POLL_OPTIONS_MIN = 2;
export const POLL_OPTIONS_MAX = 10;

// One option field. key is stable for the life of the form, for a list's
// key and for focus; it is not the option's id on the server.
export type PollOptionField = { key: number; text: string };

export type PollForm = {
  question: string;
  multiple: boolean;
  options: PollOptionField[];
  // The key the next option field gets.
  nextKey: number;
};

// A form as it opens: no question, one choice, two empty options.
export function newPollForm(): PollForm {
  return {
    question: "",
    multiple: false,
    options: [
      { key: 1, text: "" },
      { key: 2, text: "" },
    ],
    nextKey: 3,
  };
}

export const withQuestion = (form: PollForm, question: string): PollForm => ({
  ...form,
  question,
});

export const withMultiple = (form: PollForm, multiple: boolean): PollForm => ({
  ...form,
  multiple,
});

export const withOptionText = (
  form: PollForm,
  key: number,
  text: string,
): PollForm => ({
  ...form,
  options: form.options.map((option) =>
    option.key === key ? { ...option, text } : option,
  ),
});

export const canAddOption = (form: PollForm): boolean =>
  form.options.length < POLL_OPTIONS_MAX;

export const canRemoveOption = (form: PollForm): boolean =>
  form.options.length > POLL_OPTIONS_MIN;

// One more empty option field at the end, or the form as it was when it
// holds ten. The new field's key is form.nextKey.
export function addOption(form: PollForm): PollForm {
  if (!canAddOption(form)) return form;
  return {
    ...form,
    options: [...form.options, { key: form.nextKey, text: "" }],
    nextKey: form.nextKey + 1,
  };
}

// The form without that option field, or as it was when it holds two.
export function removeOption(form: PollForm, key: number): PollForm {
  if (!canRemoveOption(form)) return form;
  return {
    ...form,
    options: form.options.filter((option) => option.key !== key),
  };
}

// The option field moved to index (clamped to the list), the others
// keeping their order.
export function moveOption(
  form: PollForm,
  key: number,
  index: number,
): PollForm {
  const from = form.options.findIndex((option) => option.key === key);
  if (from < 0) return form;
  const to = Math.max(0, Math.min(form.options.length - 1, index));
  if (to === from) return form;
  const options = [...form.options];
  const [moved] = options.splice(from, 1);
  options.splice(to, 0, moved);
  return { ...form, options };
}

// "3 of 10": the option fields, filled or not, out of the most a poll
// takes.
export const pollOptionCount = (form: PollForm): string =>
  `${form.options.length} of ${POLL_OPTIONS_MAX}`;

// Said under Add option once it is off.
export const POLL_OPTIONS_FULL = `A poll takes up to ${POLL_OPTIONS_MAX} options. Remove one to add another.`;

// What Go's unicode.IsSpace, and so strings.TrimSpace, treats as space.
// Not JavaScript's trim(): that also takes U+FEFF and leaves U+0085.
// All are in the Basic Multilingual Plane, so one UTF-16 unit each.
const SPACE = new Set<number>([
  0x09, 0x0a, 0x0b, 0x0c, 0x0d, 0x20, 0x85, 0xa0, 0x1680, 0x2000, 0x2001,
  0x2002, 0x2003, 0x2004, 0x2005, 0x2006, 0x2007, 0x2008, 0x2009, 0x200a,
  0x2028, 0x2029, 0x202f, 0x205f, 0x3000,
]);

// A surrogate without its pair. The text reaches the server as UTF-8,
// where one becomes U+FFFD, so the form reads it as that too.
const LONE_SURROGATE =
  /[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/g;

// A line as the server stores it: space trimmed from both ends, in one
// pass from each end however long the line.
export function trimPollText(value: string): string {
  let start = 0;
  let end = value.length;
  while (start < end && SPACE.has(value.charCodeAt(start))) start++;
  while (end > start && SPACE.has(value.charCodeAt(end - 1))) end--;
  return value.slice(start, end).replace(LONE_SURROGATE, "\ufffd");
}

// Its length as the server counts it: code points, after trimming.
export const pollTextLength = (value: string): number =>
  [...trimPollText(value)].length;

// unicode.IsControl (C0, DEL and C1), and the line and paragraph
// separators.
// biome-ignore lint/suspicious/noControlCharactersInRegex: finding them is the point
const CONTROL = /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/u;
// Text-direction overrides, embeddings and isolates.
const DIRECTION = /[\u202a-\u202e\u2066-\u2069]/u;
// Something a person can see: a letter, number, punctuation or symbol.
const VISIBLE = /[\p{L}\p{N}\p{P}\p{S}]/u;

// Why the server would refuse a line, checked in its order: a control
// character or a direction override (whichever comes first), nothing
// visible, then the length. Null for a line it takes, an empty one
// included (the caller judges those).
export type PollTextProblem = "control" | "direction" | "invisible" | "long";

export function pollTextProblem(
  value: string,
  limit: number,
): PollTextProblem | null {
  const line = trimPollText(value);
  if (line === "") return null;
  for (const char of line) {
    if (CONTROL.test(char)) return "control";
    if (DIRECTION.test(char)) return "direction";
  }
  if (!VISIBLE.test(line)) return "invisible";
  if ([...line].length > limit) return "long";
  return null;
}

// What two options are compared by: the trimmed text without invisible
// format characters (category Cf: zero-width space and joiner, the byte
// order mark), in normalisation form C, case folded. The server folds
// with Go's simple case folding; this folds each character through its
// upper case and back, which agrees for most text but not all: it calls
// the dotless ı the same as i where the server does not, and calls some
// pairs different that the server refuses as the same (a Greek letter
// with iota subscript against its title case, U+FB05 against U+FB06).
// The server's refusal is then said in the form.
export function pollOptionKey(value: string): string {
  const stripped = trimPollText(value).replace(/\p{Cf}/gu, "");
  let text = stripped;
  try {
    text = stripped.normalize("NFC");
  } catch {
    // A runtime without normalisation compares the text unnormalised.
  }
  let key = "";
  for (const char of text) {
    const upper = char.toUpperCase();
    const folded = [...upper].length === 1 ? upper.toLowerCase() : char;
    key += [...folded].length === 1 ? folded : char;
  }
  return key;
}

// What is wrong with one field: a line the server refuses, or an option
// that repeats an earlier one.
export type PollFieldProblem = PollTextProblem | "duplicate";

export type PollFormCheck = {
  question: PollFieldProblem | null;
  // By option key; an option with nothing wrong is absent.
  options: Record<number, PollFieldProblem>;
  // Options that are not empty, which is what the server counts.
  filled: number;
  // Whether Post can be on: a question, two or more options, nothing
  // wrong anywhere. A request in flight is the caller's to add.
  canPost: boolean;
};

// Every field judged at once, as the server would: an empty option is
// dropped, and an option the same as an earlier one is the one marked.
export function checkPollForm(form: PollForm): PollFormCheck {
  const question = pollTextProblem(form.question, POLL_QUESTION_MAX);
  const options: Record<number, PollFieldProblem> = {};
  const seen = new Set<string>();
  let filled = 0;
  for (const option of form.options) {
    if (trimPollText(option.text) === "") continue;
    filled++;
    const problem = pollTextProblem(option.text, POLL_OPTION_MAX);
    const key = pollOptionKey(option.text);
    if (problem) options[option.key] = problem;
    else if (seen.has(key)) options[option.key] = "duplicate";
    seen.add(key);
  }
  const canPost =
    trimPollText(form.question) !== "" &&
    !question &&
    filled >= POLL_OPTIONS_MIN &&
    filled <= POLL_OPTIONS_MAX &&
    Object.keys(options).length === 0;
  return { question, options, filled, canPost };
}

// The words under a field for its problem.
export function pollProblemText(
  problem: PollFieldProblem,
  field: "question" | "option",
): string {
  switch (problem) {
    case "duplicate":
      return "This option is already in the list.";
    case "long":
      return field === "question"
        ? `A question can be up to ${POLL_QUESTION_MAX} characters.`
        : `An option can be up to ${POLL_OPTION_MAX} characters.`;
    case "control":
      return "Line breaks, tabs and other control characters can't be used.";
    case "direction":
      return "Text direction controls can't be used.";
    case "invisible":
      return "Type at least one letter, number or symbol.";
  }
}

// What CreatePoll is sent: the lines trimmed, empty options dropped.
export type PollRequest = {
  channelId: string;
  question: string;
  options: string[];
  multiple: boolean;
};

export function pollRequest(form: PollForm, channelId: string): PollRequest {
  return {
    channelId,
    question: trimPollText(form.question),
    options: form.options
      .map((option) => trimPollText(option.text))
      .filter((text) => text !== ""),
    multiple: form.multiple,
  };
}
