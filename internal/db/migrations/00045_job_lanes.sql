-- +goose Up
-- Lanes: the lease query looks up a lane's unfinished rows by sequence,
-- and a row has a lane exactly when it has a sequence.
CREATE INDEX jobs_lane_idx ON jobs (lane, sequence) WHERE state IN ('queued', 'running');
ALTER TABLE jobs ADD CONSTRAINT jobs_lane_sequence_check CHECK ((lane IS NULL) = (sequence IS NULL));

-- +goose Down
ALTER TABLE jobs DROP CONSTRAINT jobs_lane_sequence_check;
DROP INDEX jobs_lane_idx;
