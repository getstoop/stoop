import type { QueryClient } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ShellDnd } from "./platform";

// The app's switch as the bridge hands it over, and what the page asked
// its server to do.
const shell = vi.hoisted(() => ({
  setDnd: vi.fn((_on: boolean, _until?: Date) => Promise.resolve()),
  dnd: undefined as ShellDnd | undefined,
  handler: undefined as ((dnd: ShellDnd) => void) | undefined,
}));

vi.mock("./presence", () => ({
  setDoNotDisturb: (_qc: unknown, on: boolean, until?: Date) =>
    shell.setDnd(on, until),
}));
vi.mock("./platform", () => ({
  shellDnd: () => shell.dnd,
  onShellDnd: (h: (dnd: ShellDnd) => void) => {
    shell.handler = h;
    return () => {
      shell.handler = undefined;
    };
  },
}));

import { startDndBridge } from "./dndBridge";

const queryClient = {} as QueryClient;
const end = 1_800_000_000_000;

beforeEach(() => {
  shell.setDnd.mockClear();
  shell.dnd = undefined;
  shell.handler = undefined;
});

describe("startDndBridge", () => {
  it("sets this server on when the switch is on as the page loads", () => {
    shell.dnd = { on: true, until: null };
    startDndBridge(queryClient);
    expect(shell.setDnd.mock.calls).toEqual([[true, undefined]]);
  });

  it("carries the switch's end", () => {
    shell.dnd = { on: true, until: end };
    startDndBridge(queryClient);
    shell.handler?.({ on: true, until: end + 1 });
    expect(shell.setDnd.mock.calls).toEqual([
      [true, new Date(end)],
      [true, new Date(end + 1)],
    ]);
  });

  // Opening the app must not clear do not disturb set on a phone.
  it("never turns this server off just because a page loaded", () => {
    shell.dnd = { on: false, until: null };
    startDndBridge(queryClient);
    shell.dnd = undefined;
    startDndBridge(queryClient);
    expect(shell.setDnd).not.toHaveBeenCalled();
  });

  it("follows the switch both ways once the page is open", () => {
    shell.dnd = { on: false, until: null };
    startDndBridge(queryClient);
    shell.handler?.({ on: true, until: null });
    shell.handler?.({ on: false, until: null });
    expect(shell.setDnd.mock.calls).toEqual([
      [true, undefined],
      [false, undefined],
    ]);
  });

  it("stops following when stopped", () => {
    const stop = startDndBridge(queryClient);
    stop();
    expect(shell.handler).toBeUndefined();
  });
});
