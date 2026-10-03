package jobs

import "time"

// SweepJobsKind removes finished rows older than Config.Retention and
// dispatcher rows not seen for an hour. The module registers and
// schedules it itself.
const SweepJobsKind = "sweep_jobs"

const SweepJobsInterval = time.Hour
