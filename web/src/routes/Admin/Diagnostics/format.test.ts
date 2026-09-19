import { describe, expect, it } from "vitest";
import {
  agoWords,
  countersSentence,
  formatDuration,
  formatEvery,
  formatTook,
  jobLabel,
  queueSentence,
  untilWords,
} from "./format";

const MIN = 60_000;
const HOUR = 60 * MIN;

describe("jobLabel", () => {
  it("names the seven jobs and passes the rest through", () => {
    expect(jobLabel("file_sweep")).toBe("File sweep");
    expect(jobLabel("webhook_worker")).toBe("Webhook worker");
    expect(jobLabel("moon_phase")).toBe("moon_phase");
  });
});

describe("spans", () => {
  it("says an interval in its largest unit", () => {
    expect(formatEvery(6 * HOUR)).toBe("6 h");
    expect(formatEvery(HOUR)).toBe("1 h");
    expect(formatEvery(90 * MIN)).toBe("1.5 h");
    expect(formatEvery(5 * MIN)).toBe("5 min");
    expect(formatEvery(30_000)).toBe("30 s");
    expect(formatEvery(undefined)).toBe("continuous");
  });
  it("counts back and forward", () => {
    expect(agoWords(12 * MIN)).toBe("12 min ago");
    expect(agoWords(3000)).toBe("3 s ago");
    expect(agoWords(2 * 86400_000)).toBe("2 d ago");
    expect(untilWords(4 * HOUR)).toBe("in 4 h");
    expect(untilWords(0)).toBe("due now");
    expect(untilWords(-MIN)).toBe("due now");
  });
  it("says how long a pass took", () => {
    expect(formatTook(1234)).toBe("1.2 s");
    expect(formatTook(340)).toBe("340 ms");
    expect(formatTook(0)).toBe("0 ms");
  });
});

describe("countersSentence", () => {
  it("reads the file sweep's counters in order", () => {
    expect(
      countersSentence({
        stray_blobs_removed: 0n,
        bytes_freed: 1_800_000n,
        files_removed: 3n,
      }),
    ).toBe("removed 3 files · freed 2 MB · 0 stray blobs");
  });
  it("uses the singular", () => {
    expect(countersSentence({ messages_removed: 1n })).toBe(
      "removed 1 message",
    );
    expect(countersSentence({ credentials_expired: 2n })).toBe(
      "expired 2 credentials",
    );
  });
  it("says nothing to remove when every counter is zero", () => {
    expect(countersSentence({ rows_trimmed: 0n })).toBe("nothing to remove");
    expect(countersSentence({})).toBe("nothing to remove");
  });
  it("shows a counter it has no phrase for", () => {
    expect(countersSentence({ zebras: 2n, files_removed: 1n })).toBe(
      "removed 1 file · zebras 2",
    );
  });
});

describe("queueSentence", () => {
  it("reads the three queue counts", () => {
    expect(queueSentence({ queued: 4n, leased: 1n, dead: 0n })).toBe(
      "4 queued · 1 in flight · 0 dead-lettered",
    );
  });
});

describe("formatDuration", () => {
  it("keeps one decimal under 10 ms", () => {
    expect(formatDuration(0)).toBe("0 ms");
    expect(formatDuration(400)).toBe("0.4 ms");
    expect(formatDuration(6000)).toBe("6 ms");
    expect(formatDuration(6400)).toBe("6.4 ms");
    expect(formatDuration(9960)).toBe("10 ms");
  });

  it("rounds whole milliseconds up to a second", () => {
    expect(formatDuration(48_400)).toBe("48 ms");
    expect(formatDuration(999_400)).toBe("999 ms");
  });

  it("switches to seconds with one decimal, then whole", () => {
    expect(formatDuration(1_000_000)).toBe("1 s");
    expect(formatDuration(1_200_000)).toBe("1.2 s");
    expect(formatDuration(12_300_000)).toBe("12 s");
  });

  it("never goes negative", () => {
    expect(formatDuration(-5)).toBe("0 ms");
  });
});
