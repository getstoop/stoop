import { afterEach, describe, expect, it, vi } from "vitest";
import { isDesktop, shellNotifications, shellStatus } from "./platform";

// The seam the shell injects. There is no window at all under the node
// suite, which is the browser case; the rest stub one.
const hosted = (stoop: unknown) => vi.stubGlobal("window", { stoop });

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("isDesktop", () => {
  it("is false with no bridge on the page", () => {
    expect(isDesktop()).toBe(false);
    vi.stubGlobal("window", {});
    expect(isDesktop()).toBe(false);
  });

  it("is true for any bridge at all", () => {
    hosted({ bridge: 1 });
    expect(isDesktop()).toBe(true);
  });
});

describe("shellStatus", () => {
  // Undefined is the answer that means "nobody else is keeping a status,
  // so this page keeps its own" — it decides whether the page offers a
  // status control, so a shell too old to have one must reach it.
  it("is undefined in a browser and on a bridge that has no status", () => {
    expect(shellStatus()).toBeUndefined();
    hosted({ bridge: 2 });
    expect(shellStatus()).toBeUndefined();
  });

  it("passes the three it knows straight through", () => {
    for (const said of ["online", "away", "dnd"] as const) {
      hosted({ bridge: 3, status: said });
      expect(shellStatus()).toBe(said);
    }
  });

  it("is undefined for anything else a bridge might say", () => {
    for (const bad of ["", "busy", "ONLINE", 2, null, {}]) {
      hosted({ bridge: 3, status: bad });
      expect(shellStatus()).toBeUndefined();
    }
  });
});

describe("shellNotifications", () => {
  // Silence is not a no. A browser answers for itself through the
  // Notification permission, and a shell without the switch has no
  // opinion to impose.
  it("is allowed wherever nothing can say otherwise", () => {
    expect(shellNotifications()).toBe(true);
    hosted({ bridge: 2 });
    expect(shellNotifications()).toBe(true);
  });

  it("follows the shell's switch", () => {
    hosted({ bridge: 3, notificationsAllowed: () => false });
    expect(shellNotifications()).toBe(false);
    hosted({ bridge: 3, notificationsAllowed: () => true });
    expect(shellNotifications()).toBe(true);
  });

  // Asked every time rather than read once, because App settings can flip
  // it while the page is open.
  it("asks again on every call", () => {
    let on = true;
    hosted({ bridge: 3, notificationsAllowed: () => on });
    expect(shellNotifications()).toBe(true);
    on = false;
    expect(shellNotifications()).toBe(false);
  });
});
