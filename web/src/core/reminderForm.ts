// The form that sets a reminder, as both apps hold it
// (docs/architecture/messaging.md → Reminders): its fields, the rules the
// server applies to them (pollLine and reminderTime in
// internal/chat/reminders.go), the four preset times, when Set reminder
// is on, the request it sends, how a refusal is said, and the words of
// the notice that confirms it. The drawing is each app's own. Every
// change returns a new form, so it sits in React state as is.
//
// Times are judged against a `now` the caller passes. A preset's time is
// worked out again from the clock when the form is sent, never kept from
// when it was shown, so a form left open sends the time it says then.

import { futureTime } from "./dates";
import {
  type PollTextProblem,
  pollTextProblem,
  trimPollText,
} from "./pollForm";

export const REMINDER_TEXT_MAX = 200;

// The nearest and furthest a reminder may be, as the server judges them.
export const REMINDER_MIN_LEAD_MS = 60_000;

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;

// The four ways to say when without picking a date.
export type ReminderPreset = "20m" | "1h" | "3h" | "tomorrow";

export const REMINDER_PRESETS: readonly ReminderPreset[] = [
  "20m",
  "1h",
  "3h",
  "tomorrow",
];

// The hour of the "tomorrow" preset, in the person's own time.
const TOMORROW_HOUR = 9;

// When a preset lands from now: a fixed span for the first three (so a
// daylight-saving change in between moves the clock reading, not the
// wait), and 9:00 on the next calendar day in local time for the last.
export function presetTime(preset: ReminderPreset, now: Date): Date {
  switch (preset) {
    case "20m":
      return new Date(now.getTime() + 20 * MINUTE_MS);
    case "1h":
      return new Date(now.getTime() + HOUR_MS);
    case "3h":
      return new Date(now.getTime() + 3 * HOUR_MS);
    case "tomorrow":
      return new Date(
        now.getFullYear(),
        now.getMonth(),
        now.getDate() + 1,
        TOMORROW_HOUR,
        0,
      );
  }
}

// What a preset is called: "In 20 minutes", "Tomorrow at 9:00 AM" (the
// hour in the reader's locale).
export function presetLabel(preset: ReminderPreset): string {
  switch (preset) {
    case "20m":
      return "In 20 minutes";
    case "1h":
      return "In 1 hour";
    case "3h":
      return "In 3 hours";
    case "tomorrow": {
      const nine = new Date(2000, 0, 1, TOMORROW_HOUR, 0);
      const time = nine.toLocaleTimeString([], {
        hour: "numeric",
        minute: "2-digit",
      });
      return `Tomorrow at ${time}`;
    }
  }
}

export type ReminderChoice = ReminderPreset | "custom";

export type ReminderForm = {
  text: string;
  // Nothing is chosen when the form opens.
  choice: ReminderChoice | null;
  // The picked date and time as a date-and-time field holds it,
  // "2026-12-02T09:00" in local time, or "" for none. Kept while a
  // preset is chosen, so going back to it finds it as it was.
  custom: string;
};

// A form as it opens: nothing chosen, and the text given (the words typed
// after /remind), trimmed and cut to the longest the server takes.
export function newReminderForm(text = ""): ReminderForm {
  return {
    text: [...trimPollText(text)].slice(0, REMINDER_TEXT_MAX).join(""),
    choice: null,
    custom: "",
  };
}

export const withText = (form: ReminderForm, text: string): ReminderForm => ({
  ...form,
  text,
});

export const withChoice = (
  form: ReminderForm,
  choice: ReminderChoice,
): ReminderForm => ({ ...form, choice });

// A value from the date-and-time field; choosing a time chooses "custom".
export const withCustom = (
  form: ReminderForm,
  custom: string,
): ReminderForm => ({ ...form, choice: "custom", custom });

const pad = (value: number) => String(value).padStart(2, "0");

// A local date and time as a date-and-time field holds it, to the minute:
// "2026-12-02T09:00".
export function localInputValue(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// The instant a date-and-time field's value names in local time, or null
// for a value that is not one. A time a daylight-saving change skips
// (2:30 on the morning clocks go forward) is read as the clock would show
// it after the change; one it repeats is read as the first.
export function parseLocalInput(value: string): Date | null {
  const found = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(
    value,
  );
  if (!found) return null;
  const [year, month, day, hour, minute, second] = found
    .slice(1)
    .map((part) => Number(part ?? 0));
  const d = new Date(year, month - 1, day, hour, minute, second);
  if (Number.isNaN(d.getTime())) return null;
  // Out-of-range parts roll over in Date; a field never sends those, and
  // anything else is not a time.
  if (d.getMonth() !== month - 1 || d.getDate() !== day) return null;
  return d;
}

// The furthest a reminder may be from now: a year ahead on the calendar,
// as the server's AddDate(1, 0, 0) counts it.
export function latestReminderTime(now: Date): Date {
  const latest = new Date(now.getTime());
  latest.setFullYear(latest.getFullYear() + 1);
  return latest;
}

// The bounds for the date-and-time field: from the first whole minute at
// least a minute away to the last whole minute within a year.
export function customBounds(now: Date): { min: string; max: string } {
  const soonest = new Date(
    Math.ceil((now.getTime() + REMINDER_MIN_LEAD_MS) / MINUTE_MS) * MINUTE_MS,
  );
  return {
    min: localInputValue(soonest),
    max: localInputValue(latestReminderTime(now)),
  };
}

// The time the form names now: a preset's from now, the picked one, or
// null when nothing (or no valid date) is chosen.
export function reminderTime(form: ReminderForm, now: Date): Date | null {
  if (form.choice === null) return null;
  if (form.choice === "custom") return parseLocalInput(form.custom);
  return presetTime(form.choice, now);
}

// Why the server would refuse a time: before now, less than a minute
// ahead, more than a year ahead. Judged as sent, before the server rounds
// it down to the minute.
export type ReminderTimeProblem = "past" | "soon" | "far";

export function reminderTimeProblem(
  at: Date,
  now: Date,
): ReminderTimeProblem | null {
  if (at.getTime() <= now.getTime()) return "past";
  if (at.getTime() < now.getTime() + REMINDER_MIN_LEAD_MS) return "soon";
  if (at.getTime() > latestReminderTime(now).getTime()) return "far";
  return null;
}

export type ReminderTextProblem = PollTextProblem;

export type ReminderFormCheck = {
  text: ReminderTextProblem | null;
  when: ReminderTimeProblem | null;
  // The time it would send now, or null.
  at: Date | null;
  // Whether Set reminder can be on: some text, a valid time, nothing
  // wrong. A request in flight is the caller's to add.
  canSet: boolean;
};

// Both fields judged at once, as the server would.
export function checkReminderForm(
  form: ReminderForm,
  now: Date,
): ReminderFormCheck {
  const text = pollTextProblem(form.text, REMINDER_TEXT_MAX);
  const at = reminderTime(form, now);
  const when = at ? reminderTimeProblem(at, now) : null;
  return {
    text,
    when,
    at,
    canSet: trimPollText(form.text) !== "" && !text && !!at && !when,
  };
}

// The words under the text field for its problem.
export function reminderTextProblemText(problem: ReminderTextProblem): string {
  switch (problem) {
    case "long":
      return `A reminder can be up to ${REMINDER_TEXT_MAX} characters.`;
    case "control":
      return "Line breaks, tabs and other control characters can't be used.";
    case "direction":
      return "Text direction controls can't be used.";
    case "invisible":
      return "Type at least one letter, number or symbol.";
  }
}

// The words under the date-and-time field for its problem.
export function reminderTimeProblemText(problem: ReminderTimeProblem): string {
  switch (problem) {
    case "past":
      return "That time has passed. Pick one at least a minute from now.";
    case "soon":
      return "That's less than a minute away. Pick one at least a minute from now.";
    case "far":
      return "That's more than a year away. Pick one within a year from now.";
  }
}

// Said under the date-and-time field while nothing is wrong with it.
export const REMINDER_CUSTOM_HINT = "From a minute to a year from now.";

// What CreateReminder is sent, with the time worked out from now: null
// when the form is not one the server takes at this moment.
export type ReminderRequest = {
  channelId: string;
  text: string;
  remindAt: Date;
};

export function reminderRequest(
  form: ReminderForm,
  channelId: string,
  now: Date,
): ReminderRequest | null {
  const check = checkReminderForm(form, now);
  if (!check.canSet || !check.at) return null;
  return { channelId, text: trimPollText(form.text), remindAt: check.at };
}

// A refusal as the form says it, and the field it is about (null: above
// the actions). said is the server's own words when its answer is one
// meant for the person (a rule it holds: a line it would not take, a
// time, the cap, a channel they can't post in), null for anything that
// may pass on a second try.
export type ReminderRefusal = { field: "text" | "when" | null; text: string };

export function reminderRefusal(said: string | null): ReminderRefusal {
  const lead = "Couldn't set the reminder.";
  const words = said?.trim() ?? "";
  if (!words) return { field: null, text: `${lead} Try again.` };
  const sentence = words[0].toUpperCase() + words.slice(1);
  const text = /[.!?]$/.test(sentence) ? sentence : `${sentence}.`;
  // The server's words about a time name it: "a reminder's time …",
  // "a reminder needs a time".
  if (/^a reminder('s time| needs a time)/i.test(words))
    return { field: "when", text };
  if (/^a reminder\b/i.test(words)) return { field: "text", text };
  return { field: null, text: `${lead} ${text}` };
}

// The notice after setting one, with the time as the server stored it
// (rounded down to the minute, so it can read a minute earlier than the
// form said).
export const reminderSetText = (at: Date, now: Date): string =>
  `Reminder set for ${futureTime(at, now)}`;

// The notice after Undo.
export const REMINDER_REMOVED = "Reminder removed";

// Undo answered "not found": the reminder was posted meanwhile (or taken
// back elsewhere, which only its setter can do).
export const REMINDER_ALREADY_POSTED = "That reminder has already been posted";

// Undo failed for another reason; Undo stays.
export const REMINDER_UNDO_FAILED = "Couldn't remove the reminder";

// How long the notice stays on its own, and after Undo.
export const REMINDER_NOTICE_MS = 6000;
export const REMINDER_NOTICE_AFTER_MS = 3000;
