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

// registerDeliveries binds the outgoing-webhook delivery to its kind (one
// attempt per run, the verdict mapped onto the dispatcher's outcomes) and
// the fan-out that queues deliveries to its own.
func registerDeliveries(registry *jobs.Registry, hooksSvc *integrations.Service) {
	jobs.Register(registry, integrations.DeliverWebhookKind, func(ctx context.Context, job *jobs.Job, args integrations.DeliveryArgs) error {
		result, err := hooksSvc.DeliverWebhook(ctx, args, job.Attempt, job.MaxAttempts)
		if integrations.NotSent(err) {
			return jobs.NotAttempted(err)
		}
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
	jobs.Register(registry, integrations.FanOutWebhookEventKind, func(ctx context.Context, _ *jobs.Job, args integrations.OutgoingEvent) error {
		return hooksSvc.FanOutWebhookEvent(ctx, args)
	}, jobs.Options{})
}

// deliveryJobs adapts the jobs module onto integrations' port: the queue
// methods are the module's own, and the job states are mapped.
type deliveryJobs struct{ *jobs.Service }

func (d deliveryJobs) JobStatuses(ctx context.Context, ids []string) (map[string]integrations.JobStatus, error) {
	runs, err := d.GetRuns(ctx, ids)
	if err != nil {
		return nil, err
	}
	statuses := make(map[string]integrations.JobStatus, len(runs))
	for _, run := range runs {
		statuses[run.ID] = integrations.JobStatus{Discarded: run.State == jobs.StateDiscarded, Error: run.Error}
	}
	return statuses, nil
}
