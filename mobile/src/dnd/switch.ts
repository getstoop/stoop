import { DND_DURATIONS, dndEnd } from "@stoop/core/doNotDisturb";

// The phone's do not disturb switch: one for every server the app holds,
// kept on the device, as the desktop app keeps its own
// (docs/architecture/desktop.md → Do not disturb). On carries when it
// ends, or null for no end, and the duration that was picked, for the
// screen to mark.

export type DndDuration = (typeof DND_DURATIONS)[number]["key"];

export type DndSwitch = { on: false } | { on: true; until: number | null; duration: DndDuration };

export const DND_OFF: DndSwitch = { on: false };

// What flipping the switch on picks, until another duration is.
export const FIRST_DURATION: DndDuration = "1h";

const isDuration = (key: unknown): key is DndDuration => DND_DURATIONS.some((d) => d.key === key);

// The switch turned on at now for a duration, which counts from now.
export function turnedOn(duration: DndDuration, now: number): DndSwitch {
  return { on: true, until: dndEnd(duration, new Date(now))?.getTime() ?? null, duration };
}

// The switch as it reads at now: off once its end has passed. The same
// object while nothing has changed.
export function switchAt(held: DndSwitch, now: number): DndSwitch {
  return held.on && held.until !== null && held.until <= now ? DND_OFF : held;
}

// The switch as it was saved. Anything that can't be understood is off:
// off sends nothing, so a bad read never sets a server.
export function parseSwitch(raw: string | null): DndSwitch {
  if (!raw) return DND_OFF;
  try {
    const saved = JSON.parse(raw) as { on?: unknown; until?: unknown; duration?: unknown };
    if (saved.on !== true || !isDuration(saved.duration)) return DND_OFF;
    if (saved.until !== null && typeof saved.until !== "number") return DND_OFF;
    return { on: true, until: saved.until, duration: saved.duration };
  } catch {
    return DND_OFF;
  }
}
