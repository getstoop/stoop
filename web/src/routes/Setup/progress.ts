import { type Access, type Progress, STEPS } from "./steps";

const ACCESS: readonly Access[] = ["home", "proxy", "tunnel", "tailscale"];

// Setup progress is kept in this browser, so a reload picks up where it
// left off. Lost with the browser's data, which costs nothing: every
// step after the account is also in Server admin.

const KEY = "stoop:setup";

export function parseProgress(raw: string | null): Progress | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as Progress;
    if (typeof value !== "object" || value === null) return null;
    const steps: Progress["steps"] = {};
    for (const { id } of STEPS) {
      const state = value.steps?.[id];
      if (state === "done" || state === "skipped") steps[id] = state;
    }
    const s = value.space;
    const space =
      s &&
      typeof s.id === "string" &&
      typeof s.channelId === "string" &&
      typeof s.name === "string"
        ? { id: s.id, channelId: s.channelId, name: s.name }
        : undefined;
    const access = ACCESS.find((a) => a === value.access);
    return { steps, space, access };
  } catch {
    return null;
  }
}

export function loadProgress(): Progress | null {
  try {
    return parseProgress(localStorage.getItem(KEY));
  } catch {
    return null;
  }
}

export function saveProgress(progress: Progress): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(progress));
  } catch {
    // No resume after a reload, nothing worse.
  }
}

export function clearProgress(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // Nothing kept, nothing to clear.
  }
}
