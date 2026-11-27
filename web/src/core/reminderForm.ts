// The form that sets a reminder, as both apps hold it
// (docs/architecture/messaging.md → Reminders): its fields, the rules the
// server applies to them (pollLine in internal/chat/reminders.go and
// reminderTime in reminder_time.go), the four presets, when Set reminder
// is on, the request it sends, how a refusal is said, and the words of
// the notice that confirms it. The drawing is each app's own. Every
// change returns a new form, so it sits in React state as is.
//
// The server's clock decides when a reminder is: the request names a
// preset, or the wall-clock time picked and the device's time zone, and
// never an instant. The device's clock (the `now` a caller passes) is
// used only for what the form shows: the time each preset lands on, the
// picker's bounds, and a picked time that has plainly gone by. The
// notice shows the time the server answers.

import { ReminderPreset as WirePreset } from "../gen/stoop/chat/v1/chat_pb";
import { futureTime } from "./dates";
import {
  type PollTextProblem,
  pollTextProblem,
  trimPollText,
} from "./pollForm";

export const REMINDER_TEXT_MAX = 200;

// The nearest a picked time may be, as the server judges it.
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

// When a preset lands from now, as the form shows it (the server works
// it out again from its own clock): a fixed span for the first three (so
// a daylight-saving change in between moves the clock reading, not the
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

// A day either side of the bounds, for a device clock that is off: the
// picker's bounds are a guide, and the server judges the time.
const DAY_MS = 24 * HOUR_MS;

// The bounds for the date-and-time field: from a day before now to a day
// past a year ahead, by this device's clock. A picker will not offer what
// lies outside them (web's DateTimeField reads them by day), so they are
// kept wide enough that a device clock a few hours off never stops a time
// the server would take.
export function customBounds(now: Date): { min: string; max: string } {
  return {
    min: localInputValue(new Date(now.getTime() - DAY_MS)),
    max: localInputValue(new Date(latestReminderTime(now).getTime() + DAY_MS)),
  };
}

// The time the form names now: a preset's from now, the picked one, or
// null when nothing (or no valid date) is chosen.
export function reminderTime(form: ReminderForm, now: Date): Date | null {
  if (form.choice === null) return null;
  if (form.choice === "custom") return parseLocalInput(form.custom);
  return presetTime(form.choice, now);
}

// What this device's clock makes of a picked time: gone by, less than a
// minute ahead, more than a year ahead. Each is said as a caution and
// none stops Set reminder, since the server's clock, which decides, may
// read the time otherwise; the server's refusal is said if it does.
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
  // A picked time as this device's clock reads it; never set for a
  // preset.
  when: ReminderTimeProblem | null;
  // When it would land by this device's clock, for showing; null with
  // nothing (or no real date and time) chosen.
  at: Date | null;
  // Whether Set reminder can be on: some text, and a preset or a real
  // picked date and time. A request in flight is the caller's to add.
  canSet: boolean;
};

// Both fields judged at once, the text as the server would.
export function checkReminderForm(
  form: ReminderForm,
  now: Date,
): ReminderFormCheck {
  const text = pollTextProblem(form.text, REMINDER_TEXT_MAX);
  const at = reminderTime(form, now);
  const when =
    at && form.choice === "custom" ? reminderTimeProblem(at, now) : null;
  return {
    text,
    when,
    at,
    canSet: trimPollText(form.text) !== "" && !text && !!at,
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
      return "That time has passed by this device's clock. Pick one at least a minute from now.";
    case "soon":
      return "That's less than a minute away by this device's clock. A reminder needs at least a minute.";
    case "far":
      return "That's more than a year away by this device's clock. A reminder can be at most a year ahead.";
  }
}

// Said under the date-and-time field while nothing is wrong with it.
export const REMINDER_CUSTOM_HINT = "From a minute to a year from now.";

// What CreateReminder is sent: exactly one of a preset and the picked
// wall-clock time ("" and UNSPECIFIED for the other), and the device's
// time zone always, which "tomorrow at 9:00" and a picked time are read
// in. Never an instant.
export type ReminderRequest = {
  channelId: string;
  text: string;
  preset: WirePreset;
  localTime: string;
  timeZone: string;
};

const WIRE_PRESETS: Record<ReminderPreset, WirePreset> = {
  "20m": WirePreset.IN_20_MINUTES,
  "1h": WirePreset.IN_1_HOUR,
  "3h": WirePreset.IN_3_HOURS,
  tomorrow: WirePreset.TOMORROW_AT_9,
};

// The request for the form, or null when Set reminder is off. now
// decides nothing the server would take.
export function reminderRequest(
  form: ReminderForm,
  channelId: string,
  now: Date,
  timeZone: string,
): ReminderRequest | null {
  const { choice } = form;
  if (!checkReminderForm(form, now).canSet || choice === null) return null;
  const text = trimPollText(form.text);
  return choice === "custom"
    ? {
        channelId,
        text,
        preset: WirePreset.UNSPECIFIED,
        localTime: form.custom,
        timeZone,
      }
    : {
        channelId,
        text,
        preset: WIRE_PRESETS[choice],
        localTime: "",
        timeZone,
      };
}

// The device's IANA time zone ("America/New_York"), or "" when the
// runtime names none. With none, the server takes the three waits and
// refuses "tomorrow at 9:00" and a picked time, and the form says its
// refusal under When.
export function deviceTimeZone(): string {
  try {
    return plausibleZone(Intl.DateTimeFormat().resolvedOptions().timeZone);
  } catch {
    return "";
  }
}

// A zone name the server can be expected to know: "UTC" or "GMT", or
// Area/Location with an optional third part, of letters, digits, "_",
// "-" and "+". Anything else ("Etc/Unknown", "+05:30", nothing) is sent
// as no zone, so the three waits still work rather than every reminder
// being refused for a zone the server does not know.
export function plausibleZone(zone: unknown): string {
  if (typeof zone !== "string") return "";
  if (zone === "UTC" || zone === "GMT") return zone;
  if (zone === "Etc/Unknown") return "";
  return /^[A-Za-z][\w+-]*\/[\w+-]+(?:\/[\w+-]+)?$/.test(zone) ? zone : "";
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

// Where a reminder posts, as a notice names it when it is shown away
// from there: a channel by its name as given ("#game-night"), a
// conversation by who is in it.
export function reminderPlace(place: {
  conversation: boolean;
  name: string;
}): string {
  return place.conversation
    ? `your conversation with ${place.name}`
    : place.name;
}

// The notice after setting one, with the time as the server stored it
// (rounded down to the minute, so it can read a minute earlier than the
// form said), and where it posts when that is not the view it is shown
// in (reminderPlace).
export const reminderSetText = (at: Date, now: Date, where?: string): string =>
  where
    ? `Reminder set in ${where} for ${futureTime(at, now)}`
    : `Reminder set for ${futureTime(at, now)}`;

// The notice after Undo.
export const REMINDER_REMOVED = "Reminder removed";

// Undo answered "not found" on its first try: the reminder was posted
// meanwhile.
export const REMINDER_ALREADY_POSTED = "That reminder has already been posted";

// Undo answered "not found" after an earlier try failed: that try may
// have reached the server and lost its answer, so this does not say it
// was posted.
export const REMINDER_NO_LONGER_WAITING = "That reminder is no longer waiting";

// Undo failed for another reason; Undo stays.
export const REMINDER_UNDO_FAILED = "Couldn't remove the reminder";

// How long the notice stays on its own, and after Undo.
export const REMINDER_NOTICE_MS = 6000;
export const REMINDER_NOTICE_AFTER_MS = 3000;
