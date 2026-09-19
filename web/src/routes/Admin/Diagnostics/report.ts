import { type JsonValue, toJson } from "@bufbuild/protobuf";
import type { QueryClient } from "@tanstack/react-query";
import {
  type GetDatabaseStatsResponse,
  GetDatabaseStatsResponseSchema,
  type GetHealthResponse,
  GetHealthResponseSchema,
  type GetLiveStatsResponse,
  GetLiveStatsResponseSchema,
  type GetRequestStatsResponse,
  GetRequestStatsResponseSchema,
  type ListJobsResponse,
  ListJobsResponseSchema,
  StatsWindow,
} from "../../../gen/stoop/instance/v1/diagnostics_pb";
import {
  type GetBuildInfoResponse,
  GetBuildInfoResponseSchema,
} from "../../../gen/stoop/instance/v1/instance_pb";

// Copy report: the five panels as the tab last saw them, plus the build
// and the instance name, as one JSON document to paste into an issue.
// A panel the tab has not loaded is left out rather than invented.

export type ReportSources = {
  at: Date;
  instanceName?: string;
  build?: GetBuildInfoResponse;
  health?: GetHealthResponse;
  live?: GetLiveStatsResponse;
  database?: GetDatabaseStatsResponse;
  requestsLast5Minutes?: GetRequestStatsResponse;
  requestsSinceStart?: GetRequestStatsResponse;
  jobs?: ListJobsResponse;
};

export type Report = {
  at: string;
  instance?: string;
  build?: JsonValue;
  health?: JsonValue;
  live?: JsonValue;
  database?: JsonValue;
  requests: { last5Minutes?: JsonValue; sinceStart?: JsonValue };
  jobs?: JsonValue;
};

export function buildReport(s: ReportSources): Report {
  return {
    at: s.at.toISOString(),
    instance: s.instanceName,
    build: s.build && toJson(GetBuildInfoResponseSchema, s.build),
    health: s.health && toJson(GetHealthResponseSchema, s.health),
    live: s.live && toJson(GetLiveStatsResponseSchema, s.live),
    database: s.database && toJson(GetDatabaseStatsResponseSchema, s.database),
    requests: {
      last5Minutes:
        s.requestsLast5Minutes &&
        toJson(GetRequestStatsResponseSchema, s.requestsLast5Minutes),
      sinceStart:
        s.requestsSinceStart &&
        toJson(GetRequestStatsResponseSchema, s.requestsSinceStart),
    },
    jobs: s.jobs && toJson(ListJobsResponseSchema, s.jobs),
  };
}

// reportText reads the panels off the query cache under their
// ["diag", …] keys, so the copy is what the page shows.
export function reportText(
  client: QueryClient,
  head: Pick<ReportSources, "at" | "instanceName" | "build">,
): string {
  const report = buildReport({
    ...head,
    health: client.getQueryData(["diag", "health"]),
    live: client.getQueryData(["diag", "live"]),
    database: client.getQueryData(["diag", "database"]),
    requestsLast5Minutes: client.getQueryData([
      "diag",
      "requests",
      StatsWindow.LAST_5_MINUTES,
    ]),
    requestsSinceStart: client.getQueryData([
      "diag",
      "requests",
      StatsWindow.SINCE_START,
    ]),
    jobs: client.getQueryData(["diag", "jobs"]),
  });
  return JSON.stringify(report, null, 2);
}
