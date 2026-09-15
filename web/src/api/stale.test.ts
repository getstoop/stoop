import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";
import { refetchOlderThan } from "./stale";

describe("refetchOlderThan", () => {
  it("marks stale what landed before the cutoff and leaves the rest", async () => {
    const qc = new QueryClient();
    qc.setQueryData(["old"], 1);
    const cutoff = Date.now() + 1;
    await new Promise((r) => setTimeout(r, 2));
    qc.setQueryData(["new"], 2);

    await refetchOlderThan(qc, cutoff);

    expect(qc.getQueryState(["old"])?.isInvalidated).toBe(true);
    expect(qc.getQueryState(["new"])?.isInvalidated).toBe(false);
  });

  it("counts a query still in flight as older", async () => {
    const qc = new QueryClient();
    let resolve: (v: number) => void = () => {};
    const first = qc.fetchQuery({
      queryKey: ["slow"],
      queryFn: () => new Promise<number>((r) => (resolve = r)),
    });

    await refetchOlderThan(qc, Date.now());

    expect(qc.getQueryState(["slow"])?.isInvalidated).toBe(true);
    resolve(1);
    await first.catch(() => {});
  });
});
