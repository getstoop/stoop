import { QueryClient, QueryObserver } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";
import { refetch, refetchOlderThan } from "./stale";

// An observed query whose fetches resolve by hand, in order.
function observed(qc: QueryClient, key: string[]) {
  const answers: ((v: number) => void)[] = [];
  const queryFn = vi.fn(
    () => new Promise<number>((resolve) => answers.push(resolve)),
  );
  const observer = new QueryObserver(qc, { queryKey: key, queryFn });
  const unsubscribe = observer.subscribe(() => {});
  const settle = async () => {
    for (let i = 0; i < 10; i++) await Promise.resolve();
  };
  return { queryFn, answers, settle, unsubscribe };
}

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

  it("fetches a first load again once it lands, not on top of it", async () => {
    const qc = new QueryClient();
    const q = observed(qc, ["slow"]);
    await q.settle();
    expect(q.queryFn).toHaveBeenCalledTimes(1);

    const done = refetchOlderThan(qc, Date.now());
    await q.settle();
    expect(
      q.queryFn,
      "nothing restarts while the load is in flight",
    ).toHaveBeenCalledTimes(1);

    q.answers[0]?.(1);
    await q.settle();
    expect(
      q.queryFn,
      "the load is repeated once it has landed",
    ).toHaveBeenCalledTimes(2);
    q.answers[1]?.(2);
    await done;
    expect(qc.getQueryData(["slow"])).toBe(2);
    q.unsubscribe();
  });
});

describe("refetch", () => {
  it("restarts a refetch that already has data", async () => {
    const qc = new QueryClient();
    const q = observed(qc, ["fast"]);
    q.answers[0]?.(1);
    await q.settle();
    const query = qc.getQueryCache().find({ queryKey: ["fast"] });
    if (!query) throw new Error("no query");

    const done = refetch(qc, query);
    await q.settle();
    expect(q.queryFn).toHaveBeenCalledTimes(2);
    q.answers[1]?.(2);
    await done;
    expect(qc.getQueryData(["fast"])).toBe(2);
    q.unsubscribe();
  });
});
