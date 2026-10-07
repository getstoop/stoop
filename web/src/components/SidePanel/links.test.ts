import { describe, expect, it } from "vitest";
import { panelFromLink } from "./links";
import type { PanelRegistry } from "./registry";

const Nothing = () => null;

const registry: PanelRegistry = {
  thread: {
    component: Nothing,
    link: {
      param: "t",
      also: ["m"],
      params: (search) => {
        const root = search.get("t");
        if (!root) return null;
        const params: Record<string, string> = { root };
        const focus = search.get("m");
        if (focus) params.focus = focus;
        return params;
      },
    },
  },
  profile: { component: Nothing },
};

describe("panelFromLink", () => {
  it("opens the kind whose parameter the link carries and strips what it read", () => {
    expect(panelFromLink("?t=r1&m=m2&q=keep", registry)).toEqual({
      panel: { kind: "thread", params: { root: "r1", focus: "m2" } },
      search: "?q=keep",
    });
  });

  it("leaves an empty search when nothing else was there", () => {
    expect(panelFromLink("?t=r1", registry)).toEqual({
      panel: { kind: "thread", params: { root: "r1" } },
      search: "",
    });
  });

  it("ignores a link that names no panel", () => {
    expect(panelFromLink("?m=m2", registry)).toBeNull();
    expect(panelFromLink("", registry)).toBeNull();
  });

  it("opens nothing when the kind refuses the link", () => {
    expect(panelFromLink("?t=", registry)).toBeNull();
  });
});
