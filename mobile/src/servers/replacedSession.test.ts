import { beforeEach, describe, expect, it, vi } from "vitest";
import { clearFileCaches } from "../api/downloads";
import { sessionToken } from "../api/servers";
import { endSession } from "./endSession";
import { endReplaced, sessionToReplace } from "./replacedSession";

vi.mock("../api/downloads", () => ({ clearFileCaches: vi.fn(async () => {}) }));
vi.mock("../api/servers", () => ({ sessionToken: vi.fn() }));
vi.mock("./endSession", () => ({ endSession: vi.fn() }));

const ORIGIN = "https://stoop.example";
const SAVED = [{ id: "abcdef", origin: ORIGIN, name: "Stoop", session: 1 }];

beforeEach(() => {
  vi.clearAllMocks();
});

describe("sessionToReplace", () => {
  it("is nothing for a server not saved here", async () => {
    expect(await sessionToReplace(SAVED, "https://other.example")).toBeNull();
    expect(sessionToken).not.toHaveBeenCalled();
  });

  it("reads the token of the saved server", async () => {
    vi.mocked(sessionToken).mockResolvedValue("alice");
    expect(await sessionToReplace(SAVED, ORIGIN)).toEqual({ origin: ORIGIN, token: "alice" });
    expect(sessionToken).toHaveBeenCalledWith("abcdef");
  });

  it("still replaces a session when the keychain can't say whose", async () => {
    vi.mocked(sessionToken).mockRejectedValue(new Error("locked"));
    expect(await sessionToReplace(SAVED, ORIGIN)).toEqual({ origin: ORIGIN, token: null });
  });
});

describe("endReplaced", () => {
  it("ends the old session with its own token and forgets the files", async () => {
    await endReplaced({ origin: ORIGIN, token: "alice" }, "bob");
    expect(endSession).toHaveBeenCalledWith(ORIGIN, "alice");
    expect(clearFileCaches).toHaveBeenCalledOnce();
  });

  it("never ends the session just saved", async () => {
    await endReplaced({ origin: ORIGIN, token: "same" }, "same");
    expect(endSession).not.toHaveBeenCalled();
  });

  it("has no session to end without a token, and still forgets the files", async () => {
    await endReplaced({ origin: ORIGIN, token: null }, "bob");
    expect(endSession).not.toHaveBeenCalled();
    expect(clearFileCaches).toHaveBeenCalledOnce();
  });

  it("doesn't let files that won't clear fail the sign-in", async () => {
    vi.mocked(clearFileCaches).mockRejectedValueOnce(new Error("disk"));
    await expect(endReplaced({ origin: ORIGIN, token: "alice" }, "bob")).resolves.toBeUndefined();
  });
});
