import { describe, expect, it, vi } from "vitest";
import { authClient } from "../api/clients";
import { endSession } from "./endSession";

vi.mock("../api/clients", () => ({ authClient: vi.fn() }));

describe("endSession", () => {
  it("logs out with the token it was given", () => {
    const logout = vi.fn(async () => ({}));
    vi.mocked(authClient).mockReturnValue({ logout } as never);
    endSession("https://stoop.example", "alice");
    expect(authClient).toHaveBeenCalledWith("https://stoop.example", "alice");
    expect(logout).toHaveBeenCalledOnce();
  });

  it("swallows a refusal, as from a session already over", async () => {
    const unhandled = vi.fn();
    process.on("unhandledRejection", unhandled);
    vi.mocked(authClient).mockReturnValue({
      logout: () => Promise.reject(new Error("unauthenticated")),
    } as never);
    expect(() => endSession("https://stoop.example", "dead")).not.toThrow();
    await new Promise((resolve) => setTimeout(resolve));
    process.off("unhandledRejection", unhandled);
    expect(unhandled).not.toHaveBeenCalled();
  });
});
