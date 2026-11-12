import { describe, expect, it } from "vitest";
import { afterLoad, awayChanges } from "./reloads";

describe("afterLoad", () => {
  type View = { state: string; spaces?: string[] };
  const ready: View = { state: "ready", spaces: ["books"] };
  const fresh: View = { state: "ready", spaces: ["books", "climbing"] };

  it("keeps a good list when a reload fails", () => {
    expect(afterLoad(ready, { state: "failed" })).toBe(ready);
  });

  it("shows the failure of a first load or a retry", () => {
    expect(afterLoad({ state: "loading" }, { state: "failed" })).toEqual({ state: "failed" });
    expect(afterLoad({ state: "failed" }, { state: "failed" })).toEqual({ state: "failed" });
  });

  it("shows what a reload brought", () => {
    expect(afterLoad(ready, fresh)).toBe(fresh);
    expect(afterLoad({ state: "loading" }, fresh)).toBe(fresh);
  });

  it("lets a session that ended take over a good list", () => {
    expect(afterLoad(ready, { state: "ended" })).toEqual({ state: "ended" });
  });
});

describe("awayChanges", () => {
  it("reloads at once while the tab is in sight, owing nothing", () => {
    const away = awayChanges();
    expect(away.changed(true)).toBe("reload");
    expect(away.returned()).toBe(false);
  });

  it("remembers changes out of sight and owes one reload on return", () => {
    const away = awayChanges();
    expect(away.changed(false)).toBe("wait");
    expect(away.changed(false)).toBe("wait");
    expect(away.returned()).toBe(true);
    expect(away.returned()).toBe(false);
  });

  it("owes nothing after a return with nothing missed", () => {
    const away = awayChanges();
    expect(away.returned()).toBe(false);
    expect(away.changed(false)).toBe("wait");
    expect(away.returned()).toBe(true);
  });
});
