import type { QueryClient } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";

// The app's switch as the bridge hands it over, and what the page asked
// its server to do.
const shell = vi.hoisted(() => ({
  setDnd: vi.fn((_on: boolean) => Promise.resolve()),
  dnd: undefined as boolean | undefined,
  handler: undefined as ((on: boolean) => void) | undefined,
}));

vi.mock("./presence", () => ({
  setDoNotDisturb: (_qc: unknown, on: boolean) => shell.setDnd(on),
}));
vi.mock("./platform", () => ({
  shellDnd: () => shell.dnd,
  onShellDnd: (h: (on: boolean) => void) => {
    shell.handler = h;
    return () => {
      shell.handler = undefined;
    };
  },
}));

import { startDndBridge } from "./dndBridge";

const queryClient = {} as QueryClient;

beforeEach(() => {
  shell.setDnd.mockClear();
  shell.dnd = undefined;
  shell.handler = undefined;
});

describe("startDndBridge", () => {
  it("sets this server on when the switch is on as the page loads", () => {
    shell.dnd = true;
    startDndBridge(queryClient);
    expect(shell.setDnd.mock.calls).toEqual([[true]]);
  });

  // Opening the app must not clear do not disturb set on a phone.
  it("never turns this server off just because a page loaded", () => {
    shell.dnd = false;
    startDndBridge(queryClient);
    shell.dnd = undefined;
    startDndBridge(queryClient);
    expect(shell.setDnd).not.toHaveBeenCalled();
  });

  it("follows the switch both ways once the page is open", () => {
    shell.dnd = false;
    startDndBridge(queryClient);
    shell.handler?.(true);
    shell.handler?.(false);
    expect(shell.setDnd.mock.calls).toEqual([[true], [false]]);
  });

  it("stops following when stopped", () => {
    const stop = startDndBridge(queryClient);
    stop();
    expect(shell.handler).toBeUndefined();
  });
});
