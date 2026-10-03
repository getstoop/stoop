package app

import (
	"context"
	"errors"

	"github.com/getstoop/stoop/internal/integrations"
	"github.com/getstoop/stoop/internal/jobs"
)

// deliveryAttempts is how many tries a delivery gets before it is dead,
// on the dispatcher's default ladder.
const deliveryAttempts = 4

// registerDeliveries binds the outgoing-webhook delivery to its kind: one
// attempt per run, the verdict mapped onto the dispatcher's outcomes.
func registerDeliveries(registry *jobs.Registry, hooksSvc *integrations.Service) {
	jobs.Register(registry, integrations.DeliverWebhookKind, func(ctx context.Context, job *jobs.Job, args integrations.DeliveryArgs) error {
		result, err := hooksSvc.DeliverWebhook(ctx, args, job.Attempt, job.MaxAttempts)
		if err != nil {
			return err
		}
		switch {
		case result.Delivered:
			return nil
		case result.Dead:
			return jobs.Discard(errors.New(result.Error))
		case result.RetryAfter > 0:
			return jobs.RetryIn(errors.New(result.Error), result.RetryAfter)
		}
		return errors.New(result.Error)
	}, jobs.Options{MaxAttempts: deliveryAttempts})
}

// deliveryJobs adapts the jobs module onto integrations' port.
type deliveryJobs struct{ jobs *jobs.Service }

func (d deliveryJobs) EnqueueInLane(ctx context.Context, kind string, args any, lane string, sequence int64) (string, error) {
	return d.jobs.EnqueueInLane(ctx, kind, args, lane, sequence)
}

func (d deliveryJobs) DiscardLane(ctx context.Context, lane, reason string) (int64, error) {
	return d.jobs.DiscardLane(ctx, lane, reason)
}

func (d deliveryJobs) JobStatuses(ctx context.Context, ids []string) (map[string]integrations.JobStatus, error) {
	runs, err := d.jobs.GetRuns(ctx, ids)
	if err != nil {
		return nil, err
	}
	statuses := make(map[string]integrations.JobStatus, len(runs))
	for _, run := range runs {
		statuses[run.ID] = integrations.JobStatus{Discarded: run.State == jobs.StateDiscarded, Error: run.Error}
	}
	return statuses, nil
}
