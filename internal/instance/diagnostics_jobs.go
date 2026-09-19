package instance

import (
	"context"
	"log/slog"

	"google.golang.org/protobuf/types/known/durationpb"
	"google.golang.org/protobuf/types/known/timestamppb"

	instancev1 "github.com/getstoop/stoop/gen/stoop/instance/v1"
	"github.com/getstoop/stoop/internal/diag"
)

// The Background work panel: every job the modules record into
// internal/diag, plus the webhook queue through a port on integrations.
// See docs/architecture/diagnostics.md.

// QueueStats is the webhook queue by state; Hooks is how many outgoing
// webhooks exist, so the health check can say "off" rather than "empty".
type QueueStats struct {
	Queued, Leased, Dead, DeadLastHour int64
	Hooks                              int64
}

// UseWebhookQueue wires the queue port. Without one the panel reports
// an empty queue.
func (s *Service) UseWebhookQueue(fn func(ctx context.Context) (QueueStats, error)) {
	s.webhookQueue = fn
}

func (s *Service) listJobs(ctx context.Context) *instancev1.ListJobsResponse {
	recs := diag.Default.Jobs()
	resp := &instancev1.ListJobsResponse{Jobs: make([]*instancev1.Job, 0, len(recs))}
	for _, r := range recs {
		resp.Jobs = append(resp.Jobs, toProtoJob(r))
	}
	var q QueueStats
	if s.webhookQueue != nil {
		var err error
		if q, err = s.webhookQueue(ctx); err != nil {
			slog.Default().Warn("webhook queue stats", "err", err)
			q = QueueStats{}
		}
	}
	resp.Webhooks = &instancev1.QueueStats{
		Queued: q.Queued, Leased: q.Leased, Dead: q.Dead, DeadLastHour: q.DeadLastHour,
	}
	return resp
}

func toProtoJob(r diag.JobRecord) *instancev1.Job {
	j := &instancev1.Job{
		Name:           r.Name,
		LastDurationMs: int32(r.LastDuration.Milliseconds()),
		LastOutcome:    toProtoOutcome(r.Outcome),
		LastError:      r.LastError,
		Counters:       r.Counters,
	}
	if !r.Continuous && r.Interval > 0 {
		j.Interval = durationpb.New(r.Interval)
	}
	if !r.LastStarted.IsZero() {
		j.LastStarted = timestamppb.New(r.LastStarted)
	}
	if !r.NextDue.IsZero() {
		j.NextDue = timestamppb.New(r.NextDue)
	}
	return j
}

func toProtoOutcome(o diag.Outcome) instancev1.JobOutcome {
	switch o {
	case diag.NeverRan:
		return instancev1.JobOutcome_JOB_OUTCOME_NEVER_RAN
	case diag.Succeeded:
		return instancev1.JobOutcome_JOB_OUTCOME_SUCCEEDED
	case diag.Failed:
		return instancev1.JobOutcome_JOB_OUTCOME_FAILED
	case diag.Running:
		return instancev1.JobOutcome_JOB_OUTCOME_RUNNING
	}
	return instancev1.JobOutcome_JOB_OUTCOME_UNSPECIFIED
}
