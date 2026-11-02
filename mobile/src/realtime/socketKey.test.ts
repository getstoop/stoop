import { describe, expect, it } from "vitest";
import { socketKey } from "./socketKey";

const alpha = { id: "aaaaaa", origin: "https://a.example", name: "A" };
const beta = { id: "bbbbbb", origin: "https://b.example", name: "B", session: 2 };

describe("socketKey", () => {
  it("stays the same when switching servers reorders the list", () => {
    expect(socketKey([alpha, beta])).toBe(socketKey([beta, alpha]));
  });

  it("changes with a new sign-in under the same ID", () => {
    expect(socketKey([alpha, { ...beta, session: 3 }])).not.toBe(socketKey([alpha, beta]));
  });

  it("changes when a server is added or forgotten", () => {
    expect(socketKey([alpha])).not.toBe(socketKey([alpha, beta]));
  });

  it("reads a server saved before sessions were counted as session 0", () => {
    expect(socketKey([alpha])).toBe(socketKey([{ ...alpha, session: 0 }]));
  });

  it("keeps the ID and origin first on each line, as RealtimeProvider reads them", () => {
    expect(socketKey([beta]).split(" ").slice(0, 2)).toEqual([beta.id, beta.origin]);
  });
});
