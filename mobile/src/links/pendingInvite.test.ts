import { beforeEach, describe, expect, it } from "vitest";
import { heardInvite, INVITE_WAIT_MS, onInvite, takeInvite } from "./pendingInvite";

const link = "https://chat.example.org/join/k3Xq9TzR";

describe("pendingInvite", () => {
  beforeEach(() => void takeInvite());

  it("hands over the invite once", () => {
    heardInvite(link, 1000);
    expect(takeInvite(1500)).toBe(link);
    expect(takeInvite(1500)).toBeNull();
  });

  it("keeps only the latest", () => {
    heardInvite(link, 1000);
    heardInvite("https://chat.example.org/join/other", 1100);
    expect(takeInvite(1200)).toBe("https://chat.example.org/join/other");
  });

  it("lets go of one nobody took in time", () => {
    heardInvite(link, 1000);
    expect(takeInvite(1000 + INVITE_WAIT_MS + 1)).toBeNull();
  });

  it("tells whoever is listening, until they stop", () => {
    let heard = 0;
    const stop = onInvite(() => {
      heard++;
    });
    heardInvite(link, 1000);
    stop();
    heardInvite(link, 1000);
    takeInvite(1000);
    expect(heard).toBe(1);
  });
});
