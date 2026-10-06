-- +goose Up
-- Owned by the jobs module. The lease query puts the lane whose last job
-- ran quickest first (STOOP-399); this finds a lane's latest job without
-- a scan.
CREATE INDEX jobs_lane_started_idx ON jobs (lane, started_at) WHERE lane IS NOT NULL;

-- +goose Down
DROP INDEX jobs_lane_started_idx;
