import type { PushKeys } from "./keys";

// What the notification service extension needs beside the keys to word
// a push as the app words its own notifications (content.ts): whether
// the text is hidden, each saved server's name, and how many spaces the
// account is in there. The extension cannot ask JavaScript, so the app
// keeps a copy in the app group's store under one key, and the
// extension reads it (PushMirror.swift in
// extensions/notification-service, which also says how it reads what
// is missing).

export const MIRROR_KEY = "push-mirror";

export type PushMirror = {
  // Left out until the saved prefs have been read.
  showText?: boolean;
  // By local server ID; how many there are says whether a push names
  // its server.
  servers: Record<string, { name: string; spaces?: number }>;
};

// What the app knows now. undefined is "not known yet", never "none".
export type MirrorFacts = {
  showText: boolean | undefined;
  servers: { id: string; name: string }[];
  spaces: (serverId: string) => number | undefined;
};

// The store's value as a mirror, or null when it isn't one.
export function parseMirror(value: unknown): PushMirror | null {
  if (typeof value !== "object" || value === null) return null;
  const { showText, servers } = value as Record<string, unknown>;
  if (typeof servers !== "object" || servers === null || Array.isArray(servers)) return null;
  const mirror: PushMirror = { servers: {} };
  if (typeof showText === "boolean") mirror.showText = showText;
  for (const [id, server] of Object.entries(servers)) {
    if (typeof server !== "object" || server === null) continue;
    const { name, spaces } = server as Record<string, unknown>;
    if (typeof name !== "string") continue;
    mirror.servers[id] = typeof spaces === "number" ? { name, spaces } : { name };
  }
  return mirror;
}

// The mirror for what is known now. What isn't known yet keeps the
// value mirrored before, so a launch never trades a good value for a
// guess; a server no longer saved is dropped.
export function nextMirror(previous: PushMirror | null, facts: MirrorFacts): PushMirror {
  const mirror: PushMirror = { servers: {} };
  const showText = facts.showText ?? previous?.showText;
  if (showText !== undefined) mirror.showText = showText;
  for (const { id, name } of facts.servers) {
    const spaces = facts.spaces(id) ?? previous?.servers[id]?.spaces;
    mirror.servers[id] = spaces === undefined ? { name } : { name, spaces };
  }
  return mirror;
}

export type MirrorWriter = {
  // Brings the stored mirror up to what is known now. Resolves once
  // nothing is left to write.
  update: (facts: MirrorFacts) => Promise<void>;
};

// Keeps the stored mirror current: one write at a time, only when it
// would change, and the newest facts last. The stored value is read
// once, before the first write. A read or a write the store refuses (a
// phone not unlocked yet) is left for the next update.
export function mirrorWriter(store: Pick<PushKeys["store"], "get" | "set">): MirrorWriter {
  // undefined until the stored mirror has been read.
  let held: PushMirror | null | undefined;
  let wanted: MirrorFacts | undefined;
  let running: Promise<void> | undefined;

  const run = async () => {
    try {
      while (wanted) {
        const facts = wanted;
        wanted = undefined;
        if (held === undefined) held = parseMirror(await store.get(MIRROR_KEY));
        const next = nextMirror(held, facts);
        if (JSON.stringify(next) === JSON.stringify(held)) continue;
        await store.set(MIRROR_KEY, next);
        held = next;
      }
    } catch {
      wanted = undefined;
    } finally {
      running = undefined;
    }
  };

  return {
    update: (facts) => {
      wanted = facts;
      running ??= run();
      return running;
    },
  };
}
