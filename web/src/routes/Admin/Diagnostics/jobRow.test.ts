import { create } from "@bufbuild/protobuf";
import { timestampFromMs } from "@bufbuild/protobuf/wkt";
import { describe, expect, it } from "vitest";
import {
  JobOutcome,
  JobSchema,
  QueueStatsSchema,
} from "../../../gen/stoop/instance/v1/diagnostics_pb";
import { toRow } from "./jobRow";

const MIN = 60_000;
const now = Date.parse("2026-09-19T12:00:00Z");

describe("toRow", () => {
  it("reads a sweeper on its timer", () => {
    const row = toRow(
      create(JobSchema, {
        name: "file_sweep",
        interval: { seconds: 3600n },
        lastStarted: timestampFromMs(now - 12 * MIN),
        lastDurationMs: 340,
        lastOutcome: JobOutcome.SUCCEEDED,
        counters: { files_removed: 2n },
        nextDue: timestampFromMs(now + 48 * MIN),
      }),
      undefined,
      now,
    );
    expect(row.every).toBe("1 h");
    expect(row.lastRun).toBe("12 min ago");
    expect(row.took).toBe("340 ms");
    expect(row.badge?.label).toBe("ok");
    expect(row.result).toBe("removed 2 files");
    expect(row.next).toBe("in 48 min");
  });

  it("says off, with dashes, for a sweeper that is switched off", () => {
    const row = toRow(
      create(JobSchema, {
        name: "activity_retention",
        lastOutcome: JobOutcome.NEVER_RAN,
      }),
      undefined,
      now,
    );
    expect(row.label).toBe("Activity retention");
    expect(row.every).toBe("off");
    expect(row.lastRun).toBe("—");
    expect(row.took).toBe("—");
    expect(row.result).toBe("—");
    expect(row.next).toBe("—");
    expect(row.badge).toBeUndefined();
    expect(row.everyMs).toBeUndefined();
  });

  it("keeps the worker continuous and reads the queue", () => {
    const row = toRow(
      create(JobSchema, {
        name: "webhook_worker",
        continuous: true,
        lastStarted: timestampFromMs(now - 3000),
        lastOutcome: JobOutcome.SUCCEEDED,
      }),
      create(QueueStatsSchema, { queued: 4n, leased: 1n, dead: 0n }),
      now,
    );
    expect(row.every).toBe("continuous");
    expect(row.lastRun).toBe("3 s ago");
    expect(row.result).toBe("4 queued · 1 in flight · 0 dead-lettered");
    expect(row.next).toBe("—");
  });

  it("is never for a worker that has not run yet", () => {
    const row = toRow(
      create(JobSchema, { name: "webhook_worker", continuous: true }),
      undefined,
      now,
    );
    expect(row.every).toBe("continuous");
    expect(row.lastRun).toBe("never");
  });
});
