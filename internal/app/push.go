package app

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/getstoop/stoop/internal/instance"
	"github.com/getstoop/stoop/internal/jobs"
	"github.com/getstoop/stoop/internal/push"
)

// Push: the delivery kind, its verdicts mapped onto the dispatcher's
// outcomes, and the Health row that says why phones may be silent.

// registerPush binds one delivery attempt per run to its kind.
func registerPush(registry *jobs.Registry, pushSvc *push.Service, workers int) {
	jobs.Register(registry, push.DeliverPushKind, func(ctx context.Context, job *jobs.Job, args push.DeliveryArgs) error {
		verdict, err := pushSvc.DeliverPush(ctx, args, job.Attempt)
		if err != nil {
			return err
		}
		switch {
		case verdict.Done && verdict.Failure != "":
			return jobs.Discard(errors.New(verdict.Failure))
		case verdict.Done:
			return nil
		}
		return jobs.RetryIn(errors.New(verdict.Failure), verdict.RetryIn)
	}, jobs.Options{MaxAttempts: push.DeliveryAttempts, Backoff: push.DeliveryBackoff, MaxInFlight: deliverySlots(workers), Group: deliveryGroup})
}

// pushFailureRecent is how long a failure keeps the row at warn.
const pushFailureRecent = 24 * time.Hour

func newPushCheck(pushSvc *push.Service) instance.HealthCheck {
	return instance.HealthCheck{Name: "push", Run: func(ctx context.Context) (instance.CheckState, string) {
		stats, err := pushSvc.DeliveryStats(ctx)
		if err != nil {
			return instance.CheckDanger, err.Error()
		}
		return pushState(stats, time.Now())
	}}
}

// pushState is off with no device registered and warn while a device's
// last delivery failed within the day; the detail says why, by reason.
func pushState(stats push.DeliveryStats, now time.Time) (instance.CheckState, string) {
	if stats.Devices == 0 {
		return instance.CheckOff, "no devices registered"
	}
	devices := plural(int64(stats.Devices), "device", "devices")
	if stats.Failing == 0 {
		return instance.CheckOK, devices + " · none failing"
	}
	reasons := make([]string, len(stats.Reasons))
	state := instance.CheckOK
	for index, reason := range stats.Reasons {
		reasons[index] = fmt.Sprintf("%s ×%d, %s ago", reason.Reason, reason.Devices, sinceWords(now.Sub(reason.Latest)))
		if now.Sub(reason.Latest) < pushFailureRecent {
			state = instance.CheckWarn
		}
	}
	return state, fmt.Sprintf("%s · %d failing: %s", devices, stats.Failing, strings.Join(reasons, "; "))
}
