import { create } from "@bufbuild/protobuf";
import { timestampFromDate } from "@bufbuild/protobuf/wkt";
import { describe, expect, it } from "vitest";
import {
  CheckState,
  GetDatabaseStatsResponseSchema,
  GetHealthResponseSchema,
  GetLiveStatsResponseSchema,
  GetRequestStatsResponseSchema,
  ListJobsResponseSchema,
} from "../../../gen/stoop/instance/v1/diagnostics_pb";
import { GetBuildInfoResponseSchema } from "../../../gen/stoop/instance/v1/instance_pb";
import { buildReport } from "./report";

describe("buildReport", () => {
  it("lays out every panel as plain JSON and leaves out what it lacks", () => {
    const at = new Date("2026-09-19T10:00:00Z");
    const report = buildReport({
      at,
      instanceName: "The Stoop",
      build: create(GetBuildInfoResponseSchema, {
        version: "0.9.0",
        commit: "abc1234",
      }),
      health: create(GetHealthResponseSchema, {
        checks: [
          { name: "postgres", state: CheckState.OK, detail: "3 of 8 in pool" },
        ],
        serverStartedAt: timestampFromDate(at),
      }),
      live: create(GetLiveStatsResponseSchema, {
        gauges: [{ name: "connections", value: 2, series: [1, 2] }],
        stepSeconds: 10,
      }),
      database: create(GetDatabaseStatsResponseSchema, {
        poolMax: 8,
        databaseBytes: 9_007_199_254_740_993n,
      }),
      requests: create(GetRequestStatsResponseSchema, {
        procedures: [
          { procedure: "ChatService.ListMessages", calls: 40n, p95Us: 1200 },
        ],
      }),
      jobs: create(ListJobsResponseSchema, {
        jobs: [{ name: "file_sweep", counters: { files_removed: 3n } }],
      }),
    });

    expect(report.at).toBe("2026-09-19T10:00:00.000Z");
    expect(report.instance).toBe("The Stoop");
    expect(report.build).toEqual({ version: "0.9.0", commit: "abc1234" });
    expect(report.health).toEqual({
      checks: [
        { name: "postgres", state: "CHECK_STATE_OK", detail: "3 of 8 in pool" },
      ],
      serverStartedAt: "2026-09-19T10:00:00Z",
    });
    expect(report.live).toEqual({
      gauges: [{ name: "connections", value: 2, series: [1, 2] }],
      stepSeconds: 10,
    });
    expect(report.database).toEqual({
      poolMax: 8,
      databaseBytes: "9007199254740993",
    });
    expect(report.requests).toEqual({
      procedures: [
        { procedure: "ChatService.ListMessages", calls: "40", p95Us: 1200 },
      ],
    });
    expect(report.jobs).toEqual({
      jobs: [{ name: "file_sweep", counters: { files_removed: "3" } }],
    });
    expect(() => JSON.stringify(report)).not.toThrow();
  });
});
