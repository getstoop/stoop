import { Code, ConnectError } from "@connectrpc/connect";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { loadAlertLists } from "../api/alerts";
import { sessionToken } from "../api/servers";
import { waitingOn } from "./useWaiting";

vi.mock("../api/alerts", () => ({ loadAlertLists: vi.fn() }));
vi.mock("../api/servers", () => ({ sessionToken: vi.fn() }));

const SERVER = { id: "aaaaaa", origin: "https://stoop.example", name: "Stoop" };

const token = vi.mocked(sessionToken);
const lists = vi.mocked(loadAlertLists);

type Dm = { unreadCount: number; muted?: boolean; closed?: boolean };

// The server's lists: spaces with their alert counts, and conversations
// with what is unread in each.
function answer(spaces: { alertCount: number; muted?: boolean }[], dms: Dm[]) {
  lists.mockResolvedValue({
    spaces: spaces.map((over) => ({ muted: false, ...over })),
    dms: dms.map(({ closed, ...channel }) => ({
      closed: closed ?? false,
      channel: { muted: false, alertCount: 0, ...channel },
    })),
  } as never);
}

describe("waitingOn", () => {
  beforeEach(() => {
    token.mockReset();
    token.mockResolvedValue("session");
    lists.mockReset();
  });

  it("adds the spaces' counts to one per conversation with unread messages", async () => {
    answer([{ alertCount: 2 }, { alertCount: 60 }], [{ unreadCount: 7 }, { unreadCount: 1 }, { unreadCount: 0 }]);
    expect(await waitingOn(SERVER)).toEqual({ state: "ready", count: 64 });
    expect(lists).toHaveBeenCalledWith(SERVER.origin, "session");
  });

  it("leaves out a muted space and a muted or closed conversation", async () => {
    answer(
      [{ alertCount: 2 }, { alertCount: 5, muted: true }],
      [
        { unreadCount: 3, muted: true },
        { unreadCount: 3, closed: true },
      ],
    );
    expect(await waitingOn(SERVER)).toEqual({ state: "ready", count: 2 });
  });

  it("is zero with nothing waiting", async () => {
    answer([{ alertCount: 0 }], []);
    expect(await waitingOn(SERVER)).toEqual({ state: "ready", count: 0 });
  });

  it("has ended with no session kept, without asking the server", async () => {
    token.mockResolvedValue(null);
    expect(await waitingOn(SERVER)).toEqual({ state: "ended" });
    expect(lists).not.toHaveBeenCalled();
  });

  it("has failed when the keychain won't give up the token, without asking the server", async () => {
    token.mockRejectedValue(new Error("keychain"));
    expect(await waitingOn(SERVER)).toEqual({ state: "failed" });
    expect(lists).not.toHaveBeenCalled();
  });

  it("has ended when the server says it is over", async () => {
    lists.mockRejectedValue(new ConnectError("no", Code.Unauthenticated));
    expect(await waitingOn(SERVER)).toEqual({ state: "ended" });
  });

  it("has failed when the server can't be reached", async () => {
    lists.mockRejectedValue(new ConnectError("down", Code.Unavailable));
    expect(await waitingOn(SERVER)).toEqual({ state: "failed" });
  });
});
