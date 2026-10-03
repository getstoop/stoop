package app

import (
	"context"
	"fmt"
	"log/slog"
	"time"

	"github.com/getstoop/stoop/internal/auth"
	"github.com/getstoop/stoop/internal/chat"
	"github.com/getstoop/stoop/internal/config"
	"github.com/getstoop/stoop/internal/diag"
	"github.com/getstoop/stoop/internal/files"
	"github.com/getstoop/stoop/internal/integrations"
	"github.com/getstoop/stoop/internal/jobs"
)

// Background jobs: the six sweeps as kinds on the jobs module, their
// schedules, and the one list of job records the Diagnostics tab, the
// jobs health row and a metrics scrape read.

// registerSweeps binds each module's sweep to its kind.
func registerSweeps(registry *jobs.Registry, cfg config.Config, log *slog.Logger,
	authSvc *auth.Service, chatSvc *chat.Service, filesSvc *files.Service, hooksSvc *integrations.Service) {
	jobs.Register(registry, files.SweepFilesKind, func(ctx context.Context, job *jobs.Job, _ jobs.NoArgs) error {
		report, err := filesSvc.Sweep(ctx)
		job.Record(jobs.Counters{
			"files_removed": int64(report.Files), "bytes_freed": report.Bytes,
			"stray_blobs_removed": int64(report.StrayBlobs),
		})
		return err
	}, jobs.Options{})
	jobs.Register(registry, files.SweepAttachmentsKind, func(ctx context.Context, job *jobs.Job, _ jobs.NoArgs) error {
		removed, err := filesSvc.SweepAttachments(ctx, time.Now())
		job.Record(jobs.Counters{"attachments_removed": removed})
		return err
	}, jobs.Options{})
	jobs.Register(registry, chat.SweepActivityKind, func(ctx context.Context, job *jobs.Job, _ jobs.NoArgs) error {
		trimmed, err := chatSvc.SweepActivity(ctx, cfg.ActivityRetention)
		job.Record(jobs.Counters{"rows_trimmed": trimmed})
		return err
	}, jobs.Options{})
	jobs.Register(registry, chat.SweepMessagesKind, func(ctx context.Context, job *jobs.Job, _ jobs.NoArgs) error {
		removed, err := chatSvc.SweepMessages(ctx, time.Now())
		job.Record(jobs.Counters{"messages_removed": removed})
		return err
	}, jobs.Options{})
	jobs.Register(registry, auth.SweepCredentialsKind, func(ctx context.Context, job *jobs.Job, _ jobs.NoArgs) error {
		expired, err := authSvc.SweepCredentials(ctx)
		job.Record(jobs.Counters{"credentials_expired": expired})
		return err
	}, jobs.Options{})
	jobs.Register(registry, integrations.SweepHooksKind, func(ctx context.Context, job *jobs.Job, _ jobs.NoArgs) error {
		return sweepHooks(ctx, job, hooksSvc, cfg.WebhookDeliveryRetention, log)
	}, jobs.Options{})
}

// sweepHooks runs the hook sweeps and returns the first error.
func sweepHooks(ctx context.Context, job *jobs.Job, hooksSvc *integrations.Service, retention time.Duration, log *slog.Logger) error {
	var failed error
	keep := func(err error) {
		if failed == nil {
			failed = err
		}
	}
	if revoked, err := hooksSvc.SweepOrphanHooks(ctx); err != nil {
		keep(err)
	} else if revoked > 0 {
		log.Info("revoked orphaned hook credentials", "count", revoked)
	}
	if disabled, err := hooksSvc.SweepRemovedBotHooks(ctx); err != nil {
		keep(err)
	} else if disabled > 0 {
		log.Info("turned off hooks of bots removed from their space", "count", disabled)
	}
	lost, err := hooksSvc.SweepLostDeliveries(ctx)
	keep(err)
	removed, err := hooksSvc.SweepDeliveries(ctx, retention)
	keep(err)
	job.Record(jobs.Counters{"deliveries_lost": lost, "deliveries_removed": removed})
	return failed
}

// scheduleSweeps makes the six sweeps and the module's own history sweep
// periodic; an interval of 0, or nothing to retain, leaves the row disabled.
func scheduleSweeps(ctx context.Context, jobsSvc *jobs.Service, cfg config.Config) error {
	activitySweep := cfg.FileSweepInterval
	if cfg.ActivityRetention == 0 {
		activitySweep = 0
	}
	for _, schedule := range []struct {
		kind  string
		every time.Duration
	}{
		{files.SweepFilesKind, cfg.FileSweepInterval},
		{chat.SweepActivityKind, activitySweep},
		{auth.SweepCredentialsKind, cfg.FileSweepInterval},
		{integrations.SweepHooksKind, cfg.FileSweepInterval},
		{chat.SweepMessagesKind, chat.RetentionInterval},
		{files.SweepAttachmentsKind, chat.RetentionInterval},
		{jobs.SweepJobsKind, jobs.SweepJobsInterval},
	} {
		if err := jobsSvc.Schedule(ctx, schedule.kind, schedule.every); err != nil {
			return fmt.Errorf("schedule %s: %w", schedule.kind, err)
		}
	}
	return nil
}

// jobReader reads the schedules into the Diagnostics tab's row shape.
func jobReader(jobsSvc *jobs.Service) func(ctx context.Context) ([]diag.JobRecord, error) {
	return func(ctx context.Context) ([]diag.JobRecord, error) {
		schedules, err := jobsSvc.Schedules(ctx)
		if err != nil {
			return nil, err
		}
		now := time.Now()
		records := make([]diag.JobRecord, len(schedules))
		for index, schedule := range schedules {
			records[index] = toJobRecord(schedule, now)
		}
		return records, nil
	}
}

func toJobRecord(schedule jobs.Schedule, now time.Time) diag.JobRecord {
	record := diag.JobRecord{Name: schedule.Kind, LastSuccess: schedule.LastSuccess}
	if schedule.Enabled {
		record.Interval = schedule.Interval
		record.NextDue = schedule.NextDue
	}
	last := schedule.Last
	if last == nil {
		return record
	}
	record.LastStarted = last.StartedAt
	record.LastError = last.Error
	record.Counters = diag.Counters(last.Counters)
	record.Outcome = runOutcome(*last)
	switch {
	case last.StartedAt.IsZero():
	case last.FinishedAt.IsZero():
		record.LastDuration = now.Sub(last.StartedAt)
	default:
		record.LastDuration = last.FinishedAt.Sub(last.StartedAt)
	}
	return record
}

// runOutcome is a row's state as the panel's badge: a queued row that has
// already been tried is a retry waiting, so it reads as failed.
func runOutcome(run jobs.Run) diag.Outcome {
	switch run.State {
	case jobs.StateRunning:
		return diag.Running
	case jobs.StateSucceeded:
		return diag.Succeeded
	case jobs.StateDiscarded:
		return diag.Failed
	case jobs.StateQueued:
		if run.Attempt > 0 {
			return diag.Failed
		}
	}
	return diag.NeverRan
}
