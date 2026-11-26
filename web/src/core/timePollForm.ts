// The form that creates a time poll ("Find a time"), as both apps hold
// it (docs/architecture/messaging.md → Polls): the question, one choice
// or several, and 2 to 10 times, each held as the picker holds it, a
// local reading "2026-12-03T19:00". The question's rules are the poll
// form's (pollForm.ts). The request turns each reading into an instant by
// this device's zone rules; the server judges the instants by its own
// clock (newTimePoll in internal/chat/poll_times.go), so the checks here
// on past and far times use the device's clock as a guide. The drawing is
// each app's own. Every change returns a new form, so it sits in React
// state as is.

import { type Timestamp, timestampFromDate } from "@bufbuild/protobuf/wkt";
import { localInputValue, parseLocalInput, yearAhead } from "./dates";
import {
  POLL_OPTIONS_MAX,
  POLL_OPTIONS_MIN,
  POLL_QUESTION_MAX,
  type PollTextProblem,
  pollTextProblem,
  trimPollText,
} from "./pollForm";

// One time's row. key is stable for the life of the form, for a list's
// key and for focus. value is "" until a day and a time are picked.
export type TimeSlot = { key: number; value: string };

export type TimePollForm = {
  question: string;
  multiple: boolean;
  slots: TimeSlot[];
  // The key the next row gets.
  nextKey: number;
};

// A form as it opens: several choices (people can usually make more than
// one time), two empty rows, and the question given (the words typed
// after /when), trimmed and cut to the longest question the server takes.
export function newTimePollForm(question = ""): TimePollForm {
  return {
    question: [...trimPollText(question)].slice(0, POLL_QUESTION_MAX).join(""),
    multiple: true,
    slots: [
      { key: 1, value: "" },
      { key: 2, value: "" },
    ],
    nextKey: 3,
  };
}

export const withSlot = (
  form: TimePollForm,
  key: number,
  value: string,
): TimePollForm => ({
  ...form,
  slots: form.slots.map((slot) =>
    slot.key === key ? { ...slot, value } : slot,
  ),
});

export const canAddSlot = (form: TimePollForm): boolean =>
  form.slots.length < POLL_OPTIONS_MAX;

export const canRemoveSlot = (form: TimePollForm): boolean =>
  form.slots.length > POLL_OPTIONS_MIN;

// One more empty row at the end, or the form as it was when it holds ten.
// The new row's key is form.nextKey.
export function addSlot(form: TimePollForm): TimePollForm {
  if (!canAddSlot(form)) return form;
  return {
    ...form,
    slots: [...form.slots, { key: form.nextKey, value: "" }],
    nextKey: form.nextKey + 1,
  };
}

// The form without that row, or as it was when it holds two.
export function removeSlot(form: TimePollForm, key: number): TimePollForm {
  if (!canRemoveSlot(form)) return form;
  return { ...form, slots: form.slots.filter((slot) => slot.key !== key) };
}

// "3 of 10": the rows, filled or not, out of the most a poll takes.
export const slotCount = (form: TimePollForm): string =>
  `${form.slots.length} of ${POLL_OPTIONS_MAX}`;

// Said under Add time once it is off.
export const TIME_SLOTS_FULL = `A poll takes up to ${POLL_OPTIONS_MAX} times. Remove one to add another.`;

// The days a picker offers, as its min and max: today to a year ahead, by
// this device's clock. A picker reads them by day; the time in them is
// not a bound.
export function slotBounds(now: Date): { min: string; max: string } {
  return { min: localInputValue(now), max: localInputValue(yearAhead(now)) };
}

// What is wrong with one row, as the server would judge it by this
// device's clock: not a real date and time, not after now (a time in the
// current minute included), more than a year ahead, or the same minute as
// an earlier row.
export type SlotProblem = "invalid" | "past" | "far" | "duplicate";

export type TimePollFormCheck = {
  question: PollTextProblem | null;
  // By row key; a row with nothing wrong, or empty, is absent.
  slots: Record<number, SlotProblem>;
  // Rows with a time picked, which is what is sent.
  filled: number;
  // Whether Post can be on: a question, two or more times, nothing wrong
  // anywhere. A request in flight is the caller's to add.
  canPost: boolean;
};

// Every row judged at once at now. An empty row is dropped; a time the
// same as an earlier row's is the one marked.
export function checkTimePollForm(
  form: TimePollForm,
  now: Date,
): TimePollFormCheck {
  const question = pollTextProblem(form.question, POLL_QUESTION_MAX);
  const slots: Record<number, SlotProblem> = {};
  const seen = new Set<number>();
  const latest = yearAhead(now).getTime();
  let filled = 0;
  for (const slot of form.slots) {
    if (slot.value === "") continue;
    filled++;
    const at = parseLocalInput(slot.value);
    if (!at) {
      slots[slot.key] = "invalid";
      continue;
    }
    const minute = Math.floor(at.getTime() / 60_000) * 60_000;
    if (minute <= now.getTime()) slots[slot.key] = "past";
    else if (minute > latest) slots[slot.key] = "far";
    else if (seen.has(minute)) slots[slot.key] = "duplicate";
    seen.add(minute);
  }
  const canPost =
    trimPollText(form.question) !== "" &&
    !question &&
    filled >= POLL_OPTIONS_MIN &&
    filled <= POLL_OPTIONS_MAX &&
    Object.keys(slots).length === 0;
  return { question, slots, filled, canPost };
}

// The words under a row for its problem.
export function slotProblemText(problem: SlotProblem): string {
  switch (problem) {
    case "invalid":
      return "Pick a date and a time.";
    case "past":
      return "That time has passed. Pick a later one.";
    case "far":
      return "That's more than a year away. A poll's time can be at most a year ahead.";
    case "duplicate":
      return "This time is already in the list.";
  }
}

// What CreatePoll is sent for a time poll: the question trimmed, and
// each picked time as an instant by this device's zone rules, empty rows
// dropped. Never options alongside: the server refuses both at once.
export type TimePollRequest = {
  channelId: string;
  question: string;
  times: Timestamp[];
  multiple: boolean;
};

export function timePollRequest(
  form: TimePollForm,
  channelId: string,
): TimePollRequest {
  return {
    channelId,
    question: trimPollText(form.question),
    times: form.slots
      .map((slot) => parseLocalInput(slot.value))
      .filter((at): at is Date => at !== null)
      .map((at) => timestampFromDate(at)),
    multiple: form.multiple,
  };
}
