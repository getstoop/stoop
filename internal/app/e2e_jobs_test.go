package app_test

import (
	"context"
	"io"
	"log/slog"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/getstoop/stoop/internal/app"
	"github.com/getstoop/stoop/internal/config"
	"github.com/getstoop/stoop/internal/db/dbtest"
)

// The sweeps are rows in the jobs module's schedule table, so what the
// Background work panel shows comes from the database: a fresh install is
// due soon after boot, a restart keeps the timers, and an interval of 0 is
// a disabled row rather than a loop that never started.

// scheduledKinds is every periodic kind a default instance schedules.
var scheduledKinds = []string{
	"sweep_activity", "sweep_attachments", "sweep_credentials", "sweep_files",
	"sweep_hooks", "sweep_jobs", "sweep_messages",
}

// Interval-driven kinds: the ones STOOP_FILE_SWEEP_INTERVAL governs.
var fileSweepKinds = []string{"sweep_files", "sweep_activity", "sweep_credentials", "sweep_hooks"}

func TestE2EJobsFreshScheduleIsDueSoon(t *testing.T) {
	h := newHarness(t)
	casey := h.person("casey")
	before := time.Now()

	row := jobsByName(h.rpc(casey, diagnostics+"ListJobs", map[string]any{}).expect(t, "ok"))["sweep_files"]
	if row["lastOutcome"] != "JOB_OUTCOME_NEVER_RAN" {
		t.Errorf("sweep_files lastOutcome = %v, want never ran", row["lastOutcome"])
	}
	due := nextDue(t, row)
	if due.Before(before.Add(time.Minute)) || due.After(time.Now().Add(3*time.Minute)) {
		t.Errorf("sweep_files nextDue = %s, want between one and three minutes from %s", due, before)
	}
}

func TestE2EJobsIntervalZeroDisablesTheRow(t *testing.T) {
	h := newHarness(t, "STOOP_FILE_SWEEP_INTERVAL", "0")
	casey := h.person("casey")

	jobs := jobsByName(h.rpc(casey, diagnostics+"ListJobs", map[string]any{}).expect(t, "ok"))
	for _, name := range fileSweepKinds {
		if row := jobs[name]; row["interval"] != nil {
			t.Errorf("%s = %v, want no interval", name, row)
		}
	}
	if row := jobs["sweep_messages"]; row["interval"] == nil {
		t.Errorf("sweep_messages = %v, want its hourly interval kept", row)
	}
	health := h.rpc(casey, diagnostics+"GetHealth", map[string]any{}).expect(t, "ok")
	if detail := healthDetail(health, "jobs"); !strings.Contains(detail, "4 off") {
		t.Errorf("jobs detail = %q, want it to count 4 off", detail)
	}
}

func TestE2EJobsScheduleSurvivesRestart(t *testing.T) {
	databaseURL := dbtest.NewURL(t)
	first := newHarnessOn(t, databaseURL)
	casey := first.person("casey")
	wasDue := nextDue(t, jobsByName(first.rpc(casey, diagnostics+"ListJobs", map[string]any{}).expect(t, "ok"))["sweep_files"])

	second := newHarnessOn(t, databaseURL)
	nowDue := nextDue(t, jobsByName(second.rpc(casey, diagnostics+"ListJobs", map[string]any{}).expect(t, "ok"))["sweep_files"])
	if !nowDue.Equal(wasDue) {
		t.Errorf("sweep_files nextDue moved on restart: %s, then %s", wasDue, nowDue)
	}
}

func TestE2EJobsMetricsListEveryJobOnce(t *testing.T) {
	h := newHarness(t)
	casey := h.person("casey")

	r := h.metrics(h.pat(casey, "instance.read")).expectStatus(t, http.StatusOK)
	for _, line := range []string{
		"# TYPE stoop_job_last_duration_seconds gauge\n",
		`stoop_job_last_duration_seconds{job="sweep_files"} `,
	} {
		if n := strings.Count(r.raw, line); n != 1 {
			t.Errorf("%q appears %d times, want once:\n%s", line, n, r.raw)
		}
	}
}

// jobsByName indexes a ListJobs reply by job name.
func jobsByName(response reply) map[string]map[string]any {
	jobs := map[string]map[string]any{}
	for _, item := range response.list("jobs") {
		row, _ := item.(map[string]any)
		name, _ := row["name"].(string)
		jobs[name] = row
	}
	return jobs
}

// nextDue parses a job row's nextDue timestamp, failing when it has none.
func nextDue(t *testing.T, row map[string]any) time.Time {
	t.Helper()
	raw, _ := row["nextDue"].(string)
	due, err := time.Parse(time.RFC3339Nano, raw)
	if err != nil {
		t.Fatalf("nextDue %q: %v (row %v)", raw, err, row)
	}
	return due
}

// healthDetail is one check's detail line in a GetHealth reply.
func healthDetail(response reply, check string) string {
	for _, item := range response.list("checks") {
		row, _ := item.(map[string]any)
		if row["name"] == check {
			detail, _ := row["detail"].(string)
			return detail
		}
	}
	return ""
}

func TestE2EJobsActivityRetentionZeroDisablesTheRow(t *testing.T) {
	h := newHarness(t, "STOOP_ACTIVITY_RETENTION", "0")
	casey := h.person("casey")

	jobs := jobsByName(h.rpc(casey, diagnostics+"ListJobs", map[string]any{}).expect(t, "ok"))
	if row := jobs["sweep_activity"]; row["interval"] != nil {
		t.Errorf("sweep_activity = %v, want no interval while nothing is retained", row)
	}
	if row := jobs["sweep_files"]; row["interval"] == nil {
		t.Errorf("sweep_files = %v, want its interval kept", row)
	}
}

// With STOOP_JOBS=external the server runs no dispatcher: a sweep queued
// by hand waits until a `stoop jobs` runner on the same database works it.
func TestE2EJobsExternalRunnerWorksTheQueue(t *testing.T) {
	databaseURL := dbtest.NewURL(t)
	h := newHarnessOn(t, databaseURL, "STOOP_JOBS", "external")
	casey := h.person("casey")
	pool, err := pgxpool.New(context.Background(), databaseURL)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(pool.Close)

	var dispatchers int
	if err := pool.QueryRow(context.Background(), `SELECT count(*) FROM job_dispatchers`).Scan(&dispatchers); err != nil {
		t.Fatal(err)
	}
	if dispatchers != 0 {
		t.Fatalf("%d dispatcher rows with STOOP_JOBS=external, want none", dispatchers)
	}
	jobID := h.rpc(casey, "stoop.files.v1.FileService/SweepFiles", map[string]any{}).expect(t, "ok").str("jobId")
	var state string
	if err := pool.QueryRow(context.Background(), `SELECT state FROM jobs WHERE id = $1`, jobID).Scan(&state); err != nil {
		t.Fatal(err)
	}
	if state != "queued" {
		t.Fatalf("sweep_files is %s with no dispatcher, want queued", state)
	}

	// The runner the operator would start, from the same environment.
	cfg, err := config.Load()
	if err != nil {
		t.Fatal(err)
	}
	runner, err := app.NewRunner(context.Background(), cfg, slog.New(slog.NewTextHandler(io.Discard, nil)))
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan struct{})
	var runErr error
	go func() {
		runErr = runner.Run(ctx)
		close(done)
	}()
	t.Cleanup(func() {
		cancel()
		<-done
	})

	h.awaitJobOutcome(casey, "sweep_files", "JOB_OUTCOME_SUCCEEDED", 15*time.Second)
	cancel()
	select {
	case <-done:
		if runErr != nil {
			t.Errorf("Run returned %v", runErr)
		}
	case <-time.After(12 * time.Second):
		t.Fatal("Run did not return within 12s of cancel")
	}
}
