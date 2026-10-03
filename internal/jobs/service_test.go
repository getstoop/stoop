package jobs

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/getstoop/stoop/internal/db/dbtest"
)

type greetArgs struct {
	Name string `json:"name"`
}

func TestArgsCountersAndExtendReachTheRow(t *testing.T) {
	pool := dbtest.New(t)
	clock := newFakeClock()
	ctx := context.Background()
	service, registry := newTestService(pool, clock, testConfig())

	type greeted struct {
		name                 string
		attempt, maxAttempts int
	}
	seen := make(chan greeted, 1)
	Register(registry, "greet", func(_ context.Context, job *Job, args greetArgs) error {
		seen <- greeted{name: args.Name, attempt: job.Attempt, maxAttempts: job.MaxAttempts}
		job.Record(Counters{"greeted": 1, "bytes": 10})
		job.Record(Counters{"bytes": 20})
		return nil
	}, Options{MaxAttempts: 7})
	extended := make(chan struct{})
	release := make(chan struct{})
	t.Cleanup(func() { close(release) })
	Register(registry, "extends", func(ctx context.Context, job *Job, _ NoArgs) error {
		if err := job.Extend(ctx, 3*time.Hour); err != nil {
			return err
		}
		close(extended)
		<-release
		return nil
	}, Options{})

	greet := mustEnqueue(t, service, "greet", greetArgs{Name: "casey"})
	extends := mustEnqueue(t, service, "extends", nil)
	if string(readJob(t, pool, extends).Args) != "{}" {
		t.Errorf("nil args stored as %s", readJob(t, pool, extends).Args)
	}
	startDispatcher(t, service)

	row := waitForState(t, pool, greet, StateSucceeded, 1)
	if got := <-seen; got != (greeted{name: "casey", attempt: 1, maxAttempts: 7}) {
		t.Errorf("performer saw %+v", got)
	}
	if row.LeasedUntil != nil || row.Error != "" {
		t.Errorf("succeeded row: leased_until %v error %q", row.LeasedUntil, row.Error)
	}
	run, err := service.GetRun(ctx, greet)
	if err != nil || run.State != StateSucceeded || len(run.Counters) != 2 || run.Counters["bytes"] != 20 || run.Counters["greeted"] != 1 {
		t.Errorf("GetRun = %+v, %v", run, err)
	}

	<-extended
	row = readJob(t, pool, extends)
	sameInstant(t, "extended leased_until", row.LeasedUntil, clock.Now().Add(3*time.Hour))
	if row.State != string(StateRunning) {
		t.Errorf("state while extended = %s", row.State)
	}
}

func TestGetRunNotFound(t *testing.T) {
	pool := dbtest.New(t)
	service, _ := newTestService(pool, newFakeClock(), testConfig())
	ctx := context.Background()
	for _, id := range []string{"not-a-uuid", "", "00000000-0000-7000-8000-000000000009"} {
		if _, err := service.GetRun(ctx, id); !errors.Is(err, ErrNotFound) {
			t.Errorf("GetRun(%q) = %v, want ErrNotFound", id, err)
		}
	}
}

func TestNewAppliesDefaults(t *testing.T) {
	registry := NewRegistry()
	service := New(nil, registry, Config{}, nil)
	if service.cfg.Workers != DefaultWorkers || service.cfg.Poll != DefaultPoll || service.cfg.ShutdownGrace != DefaultShutdownGrace {
		t.Errorf("defaults not applied: %+v", service.cfg)
	}
	if service.cfg.Host == "" {
		t.Error("host left empty")
	}
	if kinds := registry.Kinds(); len(kinds) != 1 || kinds[0] != SweepJobsKind {
		t.Errorf("kinds = %v", kinds)
	}
	defer func() {
		if recover() == nil {
			t.Error("registering a kind twice did not panic")
		}
	}()
	Register(registry, SweepJobsKind, func(context.Context, *Job, NoArgs) error { return nil }, Options{})
}
