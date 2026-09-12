import { afterEach, describe, expect, it, vi } from "vitest";
import { PresenceStatus } from "../gen/stoop/realtime/v1/realtime_pb";
import { useConnectionStore } from "../stores/connection";
import {
  effectiveStatus,
  loadStatusPreference,
  presenceClass,
  presenceLabel,
} from "./status";

// api/clients.ts, reached through api/ws.ts, builds its transport from
// location.origin as it loads, and the unit suite runs in node.
vi.hoisted(() => {
  Object.assign(globalThis, { location: new URL("http://localhost:8091") });
});

const KEY = "stoop.status";

// Enough of the Storage interface for the preference read.
const fakeStorage = (stored: Record<string, string>) => ({
  getItem: (k: string) => stored[k] ?? null,
});

afterEach(() => {
  vi.unstubAllGlobals();
  useConnectionStore.setState({ myStatus: PresenceStatus.ONLINE });
});

describe("loadStatusPreference", () => {
  it("reads a stored Away or Do not disturb", () => {
    vi.stubGlobal("localStorage", fakeStorage({ [KEY]: "2" }));
    expect(loadStatusPreference()).toBe(PresenceStatus.AWAY);
    vi.stubGlobal("localStorage", fakeStorage({ [KEY]: "3" }));
    expect(loadStatusPreference()).toBe(PresenceStatus.DND);
  });

  it("is online when nothing is stored", () => {
    vi.stubGlobal("localStorage", fakeStorage({}));
    expect(loadStatusPreference()).toBe(PresenceStatus.ONLINE);
  });

  // Only Away and DND are honoured, so a stale or hand-edited value
  // cannot leave someone permanently unspecified.
  it("is online for any other stored value", () => {
    for (const v of ["0", "1", "4", "", "away", "2.5"]) {
      vi.stubGlobal("localStorage", fakeStorage({ [KEY]: v }));
      expect(loadStatusPreference()).toBe(PresenceStatus.ONLINE);
    }
  });

  it("is online where there is no storage at all", () => {
    vi.stubGlobal("localStorage", undefined);
    expect(loadStatusPreference()).toBe(PresenceStatus.ONLINE);
  });
});

// A shell hands its choice over on window.stoop; the page has no window
// at all under the node suite, so one is stubbed for these.
const shellSaying = (status: unknown) =>
  vi.stubGlobal("window", { stoop: { status } });

describe("loadStatusPreference inside a shell", () => {
  // The shell keeps one status for every server it holds, so whatever a
  // particular server's page once wrote for itself no longer decides.
  it("takes the shell's status over anything stored", () => {
    vi.stubGlobal("localStorage", fakeStorage({ [KEY]: "3" }));
    shellSaying("away");
    expect(loadStatusPreference()).toBe(PresenceStatus.AWAY);
  });

  it("maps each of the three the shell can say", () => {
    vi.stubGlobal("localStorage", fakeStorage({}));
    for (const [said, want] of [
      ["online", PresenceStatus.ONLINE],
      ["away", PresenceStatus.AWAY],
      ["dnd", PresenceStatus.DND],
    ] as const) {
      shellSaying(said);
      expect(loadStatusPreference()).toBe(want);
    }
  });

  // A bridge-2 shell has no status at all, and a malformed one is not
  // worth trusting: either way the page decides for itself, as a browser
  // does, rather than silently reporting Online.
  it("falls back to the stored choice when the shell says nothing it knows", () => {
    vi.stubGlobal("localStorage", fakeStorage({ [KEY]: "3" }));
    for (const bad of [undefined, "", "busy", 2, null]) {
      shellSaying(bad);
      expect(loadStatusPreference()).toBe(PresenceStatus.DND);
    }
  });
});

describe("effectiveStatus", () => {
  it("reports the chosen status while there is activity", () => {
    for (const s of [
      PresenceStatus.ONLINE,
      PresenceStatus.AWAY,
      PresenceStatus.DND,
    ]) {
      useConnectionStore.setState({ myStatus: s });
      expect(effectiveStatus()).toBe(s);
    }
  });
});

describe("presenceClass", () => {
  it("names the status", () => {
    expect(presenceClass(PresenceStatus.AWAY)).toBe("away");
    expect(presenceClass(PresenceStatus.DND)).toBe("dnd");
    expect(presenceClass(PresenceStatus.ONLINE)).toBe("online");
  });

  // A dot only renders for someone online, so an absent or unspecified
  // status is the plain one rather than a fourth appearance.
  it("falls back to online", () => {
    expect(presenceClass(undefined)).toBe("online");
    expect(presenceClass(PresenceStatus.UNSPECIFIED)).toBe("online");
  });
});

describe("presenceLabel", () => {
  it("spells out the status of someone online", () => {
    expect(presenceLabel(true, PresenceStatus.AWAY)).toBe("away");
    expect(presenceLabel(true, PresenceStatus.DND)).toBe("do not disturb");
    expect(presenceLabel(true, PresenceStatus.ONLINE)).toBe("online");
    expect(presenceLabel(true, undefined)).toBe("online");
  });

  // A status can linger in the store after the connection drops; offline
  // wins over it.
  it("says offline whatever the status", () => {
    expect(presenceLabel(false, PresenceStatus.DND)).toBe("offline");
    expect(presenceLabel(false, PresenceStatus.AWAY)).toBe("offline");
    expect(presenceLabel(false, undefined)).toBe("offline");
  });
});
