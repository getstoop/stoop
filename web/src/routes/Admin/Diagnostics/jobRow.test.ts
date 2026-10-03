import { create } from "@bufbuild/protobuf";
import { timestampFromMs } from "@bufbuild/protobuf/wkt";
import { describe, expect, it } from "vitest";
import {
  JobOutcome,
  JobSchema,
} from "../../../gen/stoop/instance/v1/diagnostics_pb";
import { toRow } from "./jobRow";

const MIN = 60_000;
const now = Date.parse("2026-09-19T12:00:00Z");

describe("toRow", () => {
  it("reads a sweeper on its timer", () => {
    const row = toRow(
      create(JobSchema, {
        name: "sweep_files",
        interval: { seconds: 3600n },
        lastStarted: timestampFromMs(now - 12 * MIN),
        lastDurationMs: 340,
        lastOutcome: JobOutcome.SUCCEEDED,
        counters: { files_removed: 2n },
        nextDue: timestampFromMs(now + 48 * MIN),
      }),
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
        name: "sweep_activity",
        lastOutcome: JobOutcome.NEVER_RAN,
      }),
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

  it("shows the error of a failed pass", () => {
    const row = toRow(
      create(JobSchema, {
        name: "sweep_messages",
        interval: { seconds: 3600n },
        lastStarted: timestampFromMs(now - 3000),
        lastDurationMs: 12,
        lastOutcome: JobOutcome.FAILED,
        lastError: "list expired messages: timeout",
        nextDue: timestampFromMs(now + 57 * MIN),
      }),
      now,
    );
    expect(row.lastRun).toBe("3 s ago");
    expect(row.badge?.label).toBe("failed");
    expect(row.result).toBe("list expired messages: timeout");
    expect(row.next).toBe("in 57 min");
  });

  it("keeps the history of a sweeper switched off after it ran", () => {
    const row = toRow(
      create(JobSchema, {
        name: "sweep_activity",
        lastStarted: timestampFromMs(now - 2 * 3600_000),
        lastDurationMs: 40,
        lastOutcome: JobOutcome.SUCCEEDED,
        counters: { rows_trimmed: 0n },
      }),
      now,
    );
    expect(row.every).toBe("off");
    expect(row.lastRun).toBe("2 h ago");
    expect(row.result).toBe("nothing to remove");
    expect(row.next).toBe("—");
  });
});
