-- +goose Up
-- Owned by the jobs module. The lease query puts the lane whose last job
-- ran quickest first (STOOP-399); this finds a lane's latest finished job
-- without reading its queued ones.
CREATE INDEX jobs_lane_started_idx ON jobs (lane, started_at) WHERE lane IS NOT NULL AND finished_at IS NOT NULL;

-- +goose Down
DROP INDEX jobs_lane_started_idx;
