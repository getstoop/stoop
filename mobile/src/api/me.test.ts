import { Code, ConnectError } from "@connectrpc/connect";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { authClient } from "./clients";
import { loadSignedInMe } from "./me";
import { sessionToken } from "./servers";

vi.mock("./clients", () => ({ authClient: vi.fn() }));
vi.mock("./servers", () => ({ sessionToken: vi.fn() }));

const SERVER = { id: "aaaaaa", origin: "https://stoop.example", name: "Stoop" };
const USER = { id: "user-1", username: "ada" };

const token = vi.mocked(sessionToken);
const getMe = vi.fn();

describe("loadSignedInMe", () => {
  beforeEach(() => {
    token.mockReset();
    token.mockResolvedValue("session");
    getMe.mockReset();
    vi.mocked(authClient).mockReset();
    vi.mocked(authClient).mockReturnValue({ getMe } as never);
  });

  it("is ready with the account and the token that asked", async () => {
    getMe.mockResolvedValue({ user: USER });
    expect(await loadSignedInMe(SERVER)).toEqual({ state: "ready", token: "session", user: USER });
    expect(authClient).toHaveBeenCalledWith(SERVER.origin, "session");
  });

  it("has ended with no session kept here, without asking the server", async () => {
    token.mockResolvedValue(null);
    expect(await loadSignedInMe(SERVER)).toEqual({ state: "ended" });
    expect(getMe).not.toHaveBeenCalled();
  });

  it("has ended when the server says the session is over", async () => {
    getMe.mockRejectedValue(new ConnectError("no", Code.Unauthenticated));
    expect(await loadSignedInMe(SERVER)).toEqual({ state: "ended" });
  });

  it("has ended when the server names no account", async () => {
    getMe.mockResolvedValue({});
    expect(await loadSignedInMe(SERVER)).toEqual({ state: "ended" });
  });

  it.each([
    ["another refusal", new ConnectError("no", Code.PermissionDenied)],
    ["an unreachable server", new ConnectError("down", Code.Unavailable)],
    ["anything else", new Error("boom")],
  ])("has failed on %s", async (_name, err) => {
    getMe.mockRejectedValue(err);
    expect(await loadSignedInMe(SERVER)).toEqual({ state: "failed" });
  });

  // Not what it should be, only what it is: a keychain that won't give up
  // the token says nothing about the session.
  it("reads a token that can't be read as ended, for now", async () => {
    token.mockRejectedValue(new Error("locked"));
    expect(await loadSignedInMe(SERVER)).toEqual({ state: "ended" });
  });
});
