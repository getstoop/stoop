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
  requests?: GetRequestStatsResponse;
  jobs?: ListJobsResponse;
};

export type Report = {
  at: string;
  instance?: string;
  build?: JsonValue;
  health?: JsonValue;
  live?: JsonValue;
  database?: JsonValue;
  requests?: JsonValue;
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
    requests: s.requests && toJson(GetRequestStatsResponseSchema, s.requests),
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
    requests: client.getQueryData(["diag", "requests"]),
    jobs: client.getQueryData(["diag", "jobs"]),
  });
  return JSON.stringify(report, null, 2);
}
