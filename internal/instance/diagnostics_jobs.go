package instance

import (
	"context"
	"fmt"
	"log/slog"
	"time"

	"connectrpc.com/connect"
	"google.golang.org/protobuf/types/known/durationpb"

	instancev1 "github.com/getstoop/stoop/gen/stoop/instance/v1"
	"github.com/getstoop/stoop/internal/diag"
	"github.com/getstoop/stoop/internal/pbtime"
)

// The Background work panel: every job through a port wired in
// internal/app, plus the webhook queue through a port on integrations.
// See docs/architecture/diagnostics.md.

// QueueStats is the outgoing deliveries by state; Hooks is how many
// outgoing webhooks exist, so the health check can say "off" rather than
// "empty". OldestDue is when the earliest due delivery became due, zero
// when none is.
type QueueStats struct {
	Queued, Leased, Dead, DeadLastHour int64
	Hooks                              int64
	OldestDue                          time.Time
}

// UseWebhookQueue wires the queue port. Without one the panel reports
// an empty queue.
func (s *Service) UseWebhookQueue(fn func(ctx context.Context) (QueueStats, error)) {
	s.webhookQueue = fn
}

// UseJobRecords wires the job list. Without one the panel shows the
// records kept in internal/diag alone.
func (s *Service) UseJobRecords(fn func(ctx context.Context) ([]diag.JobRecord, error)) {
	s.jobRecords = fn
}

func (s *Service) listJobs(ctx context.Context) (*instancev1.ListJobsResponse, error) {
	recs := diag.Default.Jobs()
	if s.jobRecords != nil {
		var err error
		if recs, err = s.jobRecords(ctx); err != nil {
			return nil, connect.NewError(connect.CodeInternal, fmt.Errorf("list jobs: %w", err))
		}
	}
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
	return resp, nil
}

func toProtoJob(r diag.JobRecord) *instancev1.Job {
	j := &instancev1.Job{
		Name:           r.Name,
		LastDurationMs: int32(r.LastDuration.Milliseconds()),
		LastOutcome:    toProtoOutcome(r.Outcome),
		LastError:      r.LastError,
		Counters:       r.Counters,
		Continuous:     r.Continuous,
	}
	if !r.Continuous && r.Interval > 0 {
		j.Interval = durationpb.New(r.Interval)
	}
	j.LastStarted = pbtime.OrZero(r.LastStarted)
	j.NextDue = pbtime.OrZero(r.NextDue)
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
