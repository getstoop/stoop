import { afterEach, describe, expect, it, vi } from "vitest";
import {
  isDesktop,
  onShellVoiceAction,
  reportVoice,
  shellDnd,
  shellDrawsVoice,
  shellNotifications,
} from "./platform";

describe("the voice members", () => {
  // Their presence is what hides the rail pill, so an older shell must
  // leave it showing.
  it("leave the page drawing its own indicator without setVoice", () => {
    expect(shellDrawsVoice()).toBe(false);
    hosted({ bridge: 2 });
    expect(shellDrawsVoice()).toBe(false);
    hosted({ bridge: 3, setVoice: () => {} });
    expect(shellDrawsVoice()).toBe(true);
  });

  it("report through the shell, and do nothing without one", () => {
    const setVoice = vi.fn();
    expect(() => reportVoice(null)).not.toThrow();
    hosted({ bridge: 3, setVoice });
    reportVoice(null);
    expect(setVoice).toHaveBeenCalledWith(null);
  });

  it("hand back an unsubscribe even from a shell without actions", () => {
    hosted({ bridge: 2 });
    expect(typeof onShellVoiceAction(() => {})).toBe("function");
    const off = vi.fn();
    hosted({ bridge: 3, onVoiceAction: () => off });
    onShellVoiceAction(() => {})();
    expect(off).toHaveBeenCalled();
  });
});

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

describe("shellDnd", () => {
  // Undefined means no switch, which is what leaves do not disturb to
  // account settings.
  it("is undefined in a browser and on a bridge without the switch", () => {
    expect(shellDnd()).toBeUndefined();
    hosted({ bridge: 3 });
    expect(shellDnd()).toBeUndefined();
    hosted({ bridge: 3, dnd: true });
    expect(shellDnd()).toBeUndefined();
    hosted({ bridge: 3, dnd: { on: "yes" } });
    expect(shellDnd()).toBeUndefined();
  });

  it("passes the switch and its end through", () => {
    hosted({ bridge: 3, dnd: { on: true, until: 1_800_000_000_000 } });
    expect(shellDnd()).toEqual({ on: true, until: 1_800_000_000_000 });
    hosted({ bridge: 3, dnd: { on: true, until: null } });
    expect(shellDnd()).toEqual({ on: true, until: null });
    hosted({ bridge: 3, dnd: { on: false } });
    expect(shellDnd()).toEqual({ on: false, until: null });
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
