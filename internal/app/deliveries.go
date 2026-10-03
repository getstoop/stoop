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
