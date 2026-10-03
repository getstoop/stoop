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

// UseJobRecords wires the job list. Without one the panel is empty.
func (s *Service) UseJobRecords(fn func(ctx context.Context) ([]diag.JobRecord, error)) {
	s.jobRecords = fn
}

func (s *Service) listJobs(ctx context.Context) (*instancev1.ListJobsResponse, error) {
	var records []diag.JobRecord
	if s.jobRecords != nil {
		var err error
		if records, err = s.jobRecords(ctx); err != nil {
			return nil, connect.NewError(connect.CodeInternal, fmt.Errorf("list jobs: %w", err))
		}
	}
	resp := &instancev1.ListJobsResponse{Jobs: make([]*instancev1.Job, 0, len(records))}
	for _, record := range records {
		resp.Jobs = append(resp.Jobs, toProtoJob(record))
	}
	var queue QueueStats
	if s.webhookQueue != nil {
		var err error
		if queue, err = s.webhookQueue(ctx); err != nil {
			slog.Default().Warn("webhook queue stats", "err", err)
			queue = QueueStats{}
		}
	}
	resp.Webhooks = &instancev1.QueueStats{
		Queued: queue.Queued, Leased: queue.Leased, Dead: queue.Dead, DeadLastHour: queue.DeadLastHour,
	}
	return resp, nil
}

func toProtoJob(record diag.JobRecord) *instancev1.Job {
	job := &instancev1.Job{
		Name:           record.Name,
		LastDurationMs: int32(record.LastDuration.Milliseconds()),
		LastOutcome:    toProtoOutcome(record.Outcome),
		LastError:      record.LastError,
		Counters:       record.Counters,
	}
	if record.Interval > 0 {
		job.Interval = durationpb.New(record.Interval)
	}
	job.LastStarted = pbtime.OrZero(record.LastStarted)
	job.NextDue = pbtime.OrZero(record.NextDue)
	return job
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
