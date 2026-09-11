import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { canOpenInApp, openLinkForPath, underAutomation } from "./desktopLinks";

const ORIGIN = "https://porch.example.test";
const CHANNEL_PATH = "/s/spc_porch/c/chn_stoop";

beforeEach(() => {
  vi.stubGlobal("location", { origin: ORIGIN });
});
afterEach(() => {
  vi.unstubAllGlobals();
});

// The shell resolves the link's path against the server it names
// (desktop deeplink.ts → targetUrl); read it back the same way.
const target = (link: string) => {
  const deep = new URL(link);
  const server = deep.searchParams.get("server") ?? "";
  return {
    protocol: deep.protocol,
    action: deep.hostname || deep.pathname.replace(/^\/+/, ""),
    server,
    url: new URL(deep.searchParams.get("path") ?? "", `${server}/`),
  };
};

describe("openLinkForPath", () => {
  it("is a stoop://open naming this server and the path", () => {
    const t = target(openLinkForPath(CHANNEL_PATH));
    expect(t.protocol).toBe("stoop:");
    expect(t.action).toBe("open");
    expect(t.server).toBe(ORIGIN);
    expect(t.url.pathname).toBe(CHANNEL_PATH);
  });

  it("carries the query the shared link came with", () => {
    const t = target(openLinkForPath("/join/inv_kdrq7?space=The%20Porch"));
    expect(t.url.pathname).toBe("/join/inv_kdrq7");
    expect(t.url.searchParams.get("space")).toBe("The Porch");
  });

  it("carries a ?m= message link", () => {
    const t = target(openLinkForPath(`${CHANNEL_PATH}?m=msg_7f3a`));
    expect(t.url.pathname).toBe(CHANNEL_PATH);
    expect(t.url.searchParams.get("m")).toBe("msg_7f3a");
  });

  it("escapes the path rather than letting it reshape the link", () => {
    const link = openLinkForPath("/dm/chn_dm_ada?m=msg%20a%26b");
    expect(link).toBe(
      `stoop://open?server=${encodeURIComponent(ORIGIN)}` +
        "&path=%2Fdm%2Fchn_dm_ada%3Fm%3Dmsg%2520a%2526b",
    );
    expect(target(link).url.searchParams.get("m")).toBe("msg a&b");
  });

  // Anything the shell's parser would drop is refused here, so no link
  // fires that goes nowhere.
  it("refuses a path that isn't rooted on this server", () => {
    for (const path of [
      "",
      "s/spc_porch",
      "https://evil.example/s/spc_porch",
      "stoop://open?server=https://evil.example",
      "//evil.example/s/spc_porch", // protocol-relative
      "/s/spc_porch\\..\\admin", // backslashes
      "\\\\evil.example\\share",
    ]) {
      expect(openLinkForPath(path), path).toBe("");
    }
  });
});

describe("canOpenInApp", () => {
  it("is true in a browser for a path the shell can take", () => {
    expect(canOpenInApp(CHANNEL_PATH)).toBe(true);
  });

  it("is false inside the shell, which is already there", () => {
    vi.stubGlobal("window", { stoop: { bridge: 2, platform: "darwin" } });
    expect(canOpenInApp(CHANNEL_PATH)).toBe(false);
  });

  it("is false for a path the shell would drop", () => {
    expect(canOpenInApp("//evil.example/s/spc_porch")).toBe(false);
  });
});

describe("underAutomation", () => {
  it("spots a driven browser", () => {
    vi.stubGlobal("navigator", { webdriver: true });
    expect(underAutomation()).toBe(true);
  });

  it("leaves an ordinary browser alone", () => {
    vi.stubGlobal("navigator", { webdriver: false });
    expect(underAutomation()).toBe(false);
    vi.stubGlobal("navigator", {});
    expect(underAutomation()).toBe(false);
  });
});
