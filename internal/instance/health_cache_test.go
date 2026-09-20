package instance

import (
	"context"
	"testing"
	"time"
)

func TestCachedCheckTimeout(t *testing.T) {
	c := &cachedCheck{timeout: 50 * time.Millisecond, check: HealthCheck{Name: "hung", Run: func(ctx context.Context) (CheckState, string) {
		<-ctx.Done()
		time.Sleep(time.Hour)
		return CheckOK, "never"
	}}}
	got := c.result(context.Background())
	if got.State != CheckDanger || got.Detail != "no answer in 50ms" {
		t.Errorf("hung check = %+v", got)
	}
	if c.last.Detail != got.Detail {
		t.Error("a timeout is a real answer and should be cached")
	}
}

// A caller leaving does not abort the probe, and what it saw is not
// cached: the next caller gets the probe's real answer.
func TestCachedCheckCallerLeaves(t *testing.T) {
	release := make(chan struct{})
	aborted := make(chan bool, 1)
	c := &cachedCheck{timeout: time.Second, check: HealthCheck{Name: "slow", Run: func(ctx context.Context) (CheckState, string) {
		<-release
		aborted <- ctx.Err() != nil
		return CheckOK, "fine"
	}}}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if got := c.result(ctx); got.State != CheckDanger || got.Name != "slow" {
		t.Errorf("cancelled caller = %+v", got)
	}
	if !c.last.CheckedAt.IsZero() {
		t.Errorf("cached after the caller left: %+v", c.last)
	}
	close(release)
	if <-aborted {
		t.Error("the caller leaving cancelled the probe")
	}
	if got := c.result(context.Background()); got.State != CheckOK || got.Detail != "fine" {
		t.Errorf("next call = %+v", got)
	}
}
