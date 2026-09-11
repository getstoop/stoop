import { QueryClient } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GetInstanceStatusResponse } from "../gen/stoop/instance/v1/instance_pb";
import { useDialogStore } from "../stores/dialogs";
import {
  channelPath,
  copyShareLink,
  messagePath,
  sharedLinkKind,
  shareOrigin,
  shareUrl,
  spacePath,
} from "./shareLinks";

const SPACE = "spc_porch";
const CHANNEL = "chn_stoop";
const DM = "chn_dm_ada";
const MESSAGE = "msg_7f3a";

// serverOrigin() reads location.origin, which the node environment has
// no answer for.
beforeEach(() => {
  vi.stubGlobal("location", { origin: "https://porch.example.test" });
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe("sharedLinkKind", () => {
  it("recognises an invite", () => {
    expect(sharedLinkKind("/join/inv_kdrq7", "")).toBe("invite");
  });

  it("recognises a space", () => {
    expect(sharedLinkKind(`/s/${SPACE}`, "")).toBe("space");
  });

  it("recognises a channel in a space", () => {
    expect(sharedLinkKind(`/s/${SPACE}/c/${CHANNEL}`, "")).toBe("channel");
  });

  it("recognises a DM as a channel", () => {
    expect(sharedLinkKind(`/dm/${DM}`, "")).toBe("channel");
  });

  it("turns a channel into a message when ?m= names one", () => {
    expect(sharedLinkKind(`/s/${SPACE}/c/${CHANNEL}`, `?m=${MESSAGE}`)).toBe(
      "message",
    );
    expect(sharedLinkKind(`/dm/${DM}`, `?m=${MESSAGE}`)).toBe("message");
  });

  it("ignores ?m= where it means nothing", () => {
    expect(sharedLinkKind(`/s/${SPACE}`, `?m=${MESSAGE}`)).toBe("space");
    expect(sharedLinkKind("/join/inv_kdrq7", `?m=${MESSAGE}`)).toBe("invite");
  });

  it("ignores a query that isn't ?m=", () => {
    expect(sharedLinkKind(`/dm/${DM}`, "?space=The%20Porch")).toBe("channel");
  });

  // Only the presence of m is asked about, so a bare or empty one counts.
  it("takes any ?m at all as a message", () => {
    expect(sharedLinkKind(`/dm/${DM}`, "?m=")).toBe("message");
  });

  it("shrugs off empty path segments", () => {
    expect(sharedLinkKind(`/s/${SPACE}/`, "")).toBe("space");
    expect(sharedLinkKind(`//s//${SPACE}//c//${CHANNEL}`, "")).toBe("channel");
  });

  it("says nothing about the surfaces nobody shares", () => {
    for (const path of ["/", "", "/settings", "/admin/hosting", "/search"]) {
      expect(sharedLinkKind(path, ""), path).toBe("");
    }
  });

  it("says nothing about paths that only look like share links", () => {
    for (const path of [
      "/join", // no code
      "/join/inv_kdrq7/extra",
      "/s", // no space
      `/s/${SPACE}/${CHANNEL}`, // missing the /c/
      `/s/${SPACE}/x/${CHANNEL}`, // …and the wrong separator
      `/s/${SPACE}/c/${CHANNEL}/extra`,
      "/dm",
      `/dm/${DM}/extra`,
      `/spaces/${SPACE}`,
    ]) {
      expect(sharedLinkKind(path, ""), path).toBe("");
    }
  });
});

describe("channelPath", () => {
  it("builds a space channel", () => {
    expect(channelPath(SPACE, CHANNEL)).toBe(`/s/${SPACE}/c/${CHANNEL}`);
  });

  it("builds a DM when there is no space", () => {
    expect(channelPath("", DM)).toBe(`/dm/${DM}`);
  });

  it("round-trips through sharedLinkKind", () => {
    expect(sharedLinkKind(channelPath(SPACE, CHANNEL), "")).toBe("channel");
    expect(sharedLinkKind(channelPath("", DM), "")).toBe("channel");
  });
});

describe("messagePath", () => {
  it("hangs ?m= off the channel it belongs to", () => {
    expect(messagePath(SPACE, CHANNEL, MESSAGE)).toBe(
      `/s/${SPACE}/c/${CHANNEL}?m=${MESSAGE}`,
    );
    expect(messagePath("", DM, MESSAGE)).toBe(`/dm/${DM}?m=${MESSAGE}`);
  });

  // The message id is escaped; the space and channel ids are passed
  // through as they come, so they must stay opaque server ids.
  it("escapes the message id", () => {
    expect(messagePath(SPACE, CHANNEL, "msg a&b")).toBe(
      `/s/${SPACE}/c/${CHANNEL}?m=msg%20a%26b`,
    );
  });

  it("round-trips through sharedLinkKind", () => {
    const path = messagePath(SPACE, CHANNEL, MESSAGE);
    const [pathname, search] = path.split("?");
    expect(sharedLinkKind(pathname, `?${search}`)).toBe("message");
  });
});

describe("spacePath", () => {
  it("round-trips through sharedLinkKind", () => {
    expect(spacePath(SPACE)).toBe(`/s/${SPACE}`);
    expect(sharedLinkKind(spacePath(SPACE), "")).toBe("space");
  });
});

describe("shareUrl", () => {
  it("puts the path on the origin it is given", () => {
    expect(shareUrl(spacePath(SPACE), "https://chat.example.test")).toBe(
      `https://chat.example.test/s/${SPACE}`,
    );
  });

  it("doesn't double the slash on an origin that ends in one", () => {
    expect(shareUrl(spacePath(SPACE), "https://chat.example.test/")).toBe(
      `https://chat.example.test/s/${SPACE}`,
    );
  });

  it("keeps the ?m= that makes it a message link", () => {
    expect(
      shareUrl(
        messagePath(SPACE, CHANNEL, MESSAGE),
        "https://chat.example.test",
      ),
    ).toBe(`https://chat.example.test/s/${SPACE}/c/${CHANNEL}?m=${MESSAGE}`);
  });

  it("falls back to this server when there is no configured address", () => {
    expect(shareUrl(spacePath(SPACE))).toBe(
      `https://porch.example.test/s/${SPACE}`,
    );
    expect(shareUrl(spacePath(SPACE), "")).toBe(
      `https://porch.example.test/s/${SPACE}`,
    );
  });
});

describe("shareOrigin", () => {
  const withStatus = (status?: Partial<GetInstanceStatusResponse>) => {
    const qc = new QueryClient();
    if (status)
      qc.setQueryData(["instance-status"], status as GetInstanceStatusResponse);
    return qc;
  };

  it("prefers the address the instance publishes", () => {
    expect(
      shareOrigin(withStatus({ publicUrl: "https://chat.example.test" })),
    ).toBe("https://chat.example.test");
  });

  it("falls back to this server when the address is unset", () => {
    expect(shareOrigin(withStatus({ publicUrl: "" }))).toBe(
      "https://porch.example.test",
    );
  });

  it("falls back when the status hasn't been fetched yet", () => {
    expect(shareOrigin(withStatus())).toBe("https://porch.example.test");
  });
});

describe("copyShareLink", () => {
  beforeEach(() => {
    useDialogStore.setState({ queue: [] });
  });

  it("hands the url to the clipboard", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    await expect(
      copyShareLink("https://chat.example.test/s/spc_porch"),
    ).resolves.toBe(true);
    expect(writeText).toHaveBeenCalledWith(
      "https://chat.example.test/s/spc_porch",
    );
    expect(useDialogStore.getState().queue).toHaveLength(0);
  });

  it("says so out loud when the clipboard refuses", async () => {
    vi.stubGlobal("navigator", {
      clipboard: { writeText: vi.fn().mockRejectedValue(new Error("denied")) },
    });
    await expect(
      copyShareLink("https://chat.example.test/s/spc_porch"),
    ).resolves.toBe(false);
    expect(useDialogStore.getState().queue.map((r) => r.kind)).toEqual([
      "notice",
    ]);
  });

  it("doesn't throw where there is no clipboard at all", async () => {
    vi.stubGlobal("navigator", {});
    await expect(
      copyShareLink("https://chat.example.test/s/spc_porch"),
    ).resolves.toBe(false);
  });
});
