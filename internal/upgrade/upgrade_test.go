package upgrade

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/getstoop/stoop/internal/db"
)

// fakeRunner answers commands by prefix, in order of the script, and
// records every call.
type fakeRunner struct {
	script []scripted
	calls  []string
	envs   []string
}

type scripted struct {
	prefix string
	res    Result
	do     func()
}

func (f *fakeRunner) Run(_ context.Context, c Cmd) Result {
	call := c.Name + " " + strings.Join(c.Args, " ")
	f.calls = append(f.calls, call)
	f.envs = append(f.envs, c.Env...)
	for _, s := range f.script {
		if strings.HasPrefix(call, s.prefix) {
			if s.do != nil {
				s.do()
			}
			if c.Stdout != nil && s.res.Stdout != "" {
				_, _ = c.Stdout.Write([]byte(s.res.Stdout))
				return Result{Code: s.res.Code}
			}
			return s.res
		}
	}
	return Result{Code: 127, Stderr: "unscripted: " + call}
}

func (f *fakeRunner) answer(prefix string, res Result) {
	for i := range f.script {
		if f.script[i].prefix == prefix {
			f.script[i].res = res
			return
		}
	}
	panic("no scripted " + prefix)
}

func (f *fakeRunner) called(prefix string) bool {
	for _, c := range f.calls {
		if strings.HasPrefix(c, prefix) {
			return true
		}
	}
	return false
}

type fakeFetcher map[string][]byte

func (f fakeFetcher) Fetch(_ context.Context, url string) ([]byte, error) {
	if b, ok := f[url]; ok {
		return b, nil
	}
	return nil, errors.New("404")
}

const (
	oldCompose = "services:\n  stoop:\n    image: ghcr.io/getstoop/stoop:0.2.0\n  postgres:\n    image: postgres:16-alpine\n"
	newCompose = "services:\n  stoop:\n    image: ghcr.io/getstoop/stoop:0.3.0\n  postgres:\n    image: postgres:16-alpine\n"
	oldEnv     = "POSTGRES_PASSWORD=secret\n# STOOP_PORT=8080\n"
	newExample = "COMPOSE_PROFILES=bundled-postgres\nPOSTGRES_PASSWORD=change-me\nSTOOP_PUBLIC_URL=\n# STOOP_PORT=8080\n"
)

func reportJSON(t *testing.T, p db.Plan) string {
	t.Helper()
	b, err := json.Marshal(p.Report("0.3.0"))
	if err != nil {
		t.Fatal(err)
	}
	return string(b) + "\n"
}

// install lays out an install directory and an Upgrader over fakes.
func install(t *testing.T, runner *fakeRunner, fetch fakeFetcher) (*Upgrader, *bytes.Buffer) {
	t.Helper()
	dir := t.TempDir()
	if err := os.WriteFile(filepath.Join(dir, composeFile), []byte(oldCompose), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, envFile), []byte(oldEnv), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "livekit.yaml"), []byte("old livekit\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	var out bytes.Buffer
	u := &Upgrader{
		Options: Options{Dir: dir, Yes: true, Repo: "https://example.test/stoop", API: "https://api.test/latest", Wait: "600"},
		Run:     runner,
		Fetch:   fetch,
		Out:     &out,
		In:      strings.NewReader(""),
		Now:     func() time.Time { return time.Date(2026, 9, 25, 18, 0, 0, 0, time.UTC) },
	}
	return u, &out
}

func releaseFetcher() fakeFetcher {
	return fakeFetcher{
		"https://api.test/latest": []byte(`{"tag_name":"v0.3.0"}`),
		"https://example.test/stoop/releases/download/v0.3.0/docker-compose.yml": []byte(newCompose),
		"https://example.test/stoop/releases/download/v0.3.0/env.example":        []byte(newExample),
		"https://example.test/stoop/releases/download/v0.3.0/livekit.yaml":       []byte("new livekit\n"),
	}
}

func happyRunner(t *testing.T, u **Upgrader, plan db.Plan, version string) *fakeRunner {
	t.Helper()
	r := &fakeRunner{}
	r.script = []scripted{
		{prefix: "docker compose version", res: Result{}},
		{prefix: "docker compose -f docker-compose.yml.next run --rm --no-deps -T stoop migrate plan --json", res: Result{Stdout: reportJSON(t, plan), Code: 2}},
		{prefix: "docker compose ps -q postgres", res: Result{Stdout: "pg1\n"}},
		{prefix: "docker compose exec -T postgres pg_dump -U stoop -Fc stoop", res: Result{Stdout: "PGDMP..."}},
		{prefix: "docker compose ps -q stoop", res: Result{Stdout: "app1\n"}},
		{prefix: "docker run --rm --volumes-from app1 -v ", do: func() {
			dir := filepath.Join((*u).Dir, "backups", "20260925-180000-0.2.0-to-0.3.0")
			_ = os.WriteFile(filepath.Join(dir, "stoop-data.tar"), []byte("tar"), 0o644)
		}},
		{prefix: "docker compose up -d --remove-orphans --wait --wait-timeout 600", res: Result{}},
		{prefix: "docker compose exec -T stoop stoop version", res: Result{Stdout: "stoop " + version + " (abc1234)\n"}},
		{prefix: "docker compose logs --tail 40 stoop", res: Result{}},
		{prefix: statusCmd, res: Result{Stdout: reportJSON(t, db.Plan{Applied: 42, Newest: 42})}},
	}
	return r
}

const statusCmd = "docker compose run --rm --no-deps -T stoop migrate status --json"

// withRelease adds a tagged release to the table for one test, so a floor
// raised past 0.2.0 has a release that can start against it.
func withRelease(t *testing.T, version string, migration int64) {
	t.Helper()
	prev := db.Releases
	db.Releases = append(append([]db.Release{}, prev...), db.Release{Version: version, Migration: migration})
	t.Cleanup(func() { db.Releases = prev })
}

// floorPast020 is a status answer after a contract migration raised the
// floor to 42: only 0.3.0 starts, so 0.2.0 needs the restore.
func floorPast020(t *testing.T) Result {
	t.Helper()
	return Result{Stdout: reportJSON(t, db.Plan{Applied: 45, Newest: 45, Floor: 42, FloorAfter: 42})}
}

var pendingPlan = db.Plan{Applied: 37, Newest: 42, Pending: []db.Migration{{Version: 38, Name: "session_user_agent"}, {Version: 42, Name: "message_fk_indexes"}}}

func TestUpgrade(t *testing.T) {
	var u *Upgrader
	r := happyRunner(t, &u, pendingPlan, "0.3.0")
	u, out := install(t, r, releaseFetcher())
	if err := u.Upgrade(context.Background()); err != nil {
		t.Fatalf("upgrade: %v\n%s", err, out.String())
	}
	for _, want := range []string{
		"== fetching the 0.3.0 compose bundle",
		"== upgrade 0.2.0 -> 0.3.0",
		"pending    2",
		"after up   floor stays at 0; 0.1.0 and later can start",
		"== settings 0.3.0 expects that .env does not have",
		"  COMPOSE_PROFILES=bundled-postgres",
		"== backing up to backups/20260925-180000-0.2.0-to-0.3.0",
		"== upgraded 0.2.0 -> 0.3.0",
		"If something is wrong: stoop upgrade rollback",
	} {
		if !strings.Contains(out.String(), want) {
			t.Errorf("missing %q in:\n%s", want, out.String())
		}
	}
	if strings.Contains(out.String(), "POSTGRES_PASSWORD") || strings.Contains(out.String(), "STOOP_PORT") {
		t.Errorf("a setting .env has, or an empty one, should not be listed:\n%s", out.String())
	}
	now, _ := os.ReadFile(filepath.Join(u.Dir, composeFile))
	prev, _ := os.ReadFile(filepath.Join(u.Dir, prevFile))
	if string(now) != newCompose || string(prev) != oldCompose {
		t.Errorf("files after the switch: compose=%q prev=%q", now, prev)
	}
	dumpPath := filepath.Join(u.Dir, "backups", "20260925-180000-0.2.0-to-0.3.0", "stoop.dump")
	dump, _ := os.ReadFile(dumpPath)
	if string(dump) != "PGDMP..." {
		t.Errorf("dump = %q", dump)
	}
	if info, err := os.Stat(dumpPath); err != nil || info.Mode().Perm() != 0o600 {
		t.Errorf("the dump should be owner-only, got %v", info.Mode())
	}
	if info, err := os.Stat(filepath.Dir(dumpPath)); err != nil || info.Mode().Perm() != 0o700 {
		t.Errorf("the backup directory should be owner-only, got %v", info.Mode())
	}
	lk, _ := os.ReadFile(filepath.Join(u.Dir, "livekit.yaml"))
	lkPrev, _ := os.ReadFile(filepath.Join(u.Dir, "livekit.yaml.prev"))
	if string(lk) != "new livekit\n" || string(lkPrev) != "old livekit\n" {
		t.Errorf("companion after the switch: livekit.yaml=%q prev=%q", lk, lkPrev)
	}
	if !r.called("docker compose -f docker-compose.yml.next run --rm") {
		t.Errorf("plan should name only the next file when there is no override:\n%s", strings.Join(r.calls, "\n"))
	}
	for _, gone := range []string{nextFile, envNextFile} {
		if _, err := os.Stat(filepath.Join(u.Dir, gone)); err == nil {
			t.Errorf("%s left behind", gone)
		}
	}
	// The backup comes before the switch, and nothing runs the old image's verbs.
	var backupAt, upAt int
	for i, c := range r.calls {
		if strings.HasPrefix(c, "docker compose exec -T postgres pg_dump") {
			backupAt = i
		}
		if strings.HasPrefix(c, "docker compose up") {
			upAt = i
		}
	}
	if backupAt == 0 || upAt < backupAt {
		t.Errorf("order: backup at %d, up at %d\n%s", backupAt, upAt, strings.Join(r.calls, "\n"))
	}
}

func TestUpgradePlanOnly(t *testing.T) {
	var u *Upgrader
	r := happyRunner(t, &u, pendingPlan, "0.3.0")
	u, out := install(t, r, releaseFetcher())
	u.PlanOnly = true
	if err := u.Upgrade(context.Background()); err != nil {
		t.Fatal(err)
	}
	if r.called("docker compose ps") || r.called("docker compose up") {
		t.Errorf("plan only should stop before the backup:\n%s", strings.Join(r.calls, "\n"))
	}
	if !strings.Contains(out.String(), "plan only; nothing was changed") {
		t.Errorf("output:\n%s", out.String())
	}
	now, _ := os.ReadFile(filepath.Join(u.Dir, composeFile))
	if string(now) != oldCompose {
		t.Error("plan only changed the compose file")
	}
	if _, err := os.Stat(filepath.Join(u.Dir, nextFile)); err == nil {
		t.Error("next file left behind")
	}
}

func TestUpgradeDeclined(t *testing.T) {
	var u *Upgrader
	r := happyRunner(t, &u, pendingPlan, "0.3.0")
	u, _ = install(t, r, releaseFetcher())
	u.Yes = false
	u.In = strings.NewReader("n\n")
	if err := u.Upgrade(context.Background()); !errors.Is(err, ErrStopped) {
		t.Fatalf("want ErrStopped, got %v", err)
	}
	if r.called("docker compose ps") {
		t.Error("declined, but the backup ran")
	}
}

func TestUpgradeRefusals(t *testing.T) {
	var u *Upgrader
	r := happyRunner(t, &u, pendingPlan, "0.3.0")
	u, _ = install(t, r, releaseFetcher())

	same := filepath.Join(u.Dir, "same.yml")
	_ = os.WriteFile(same, []byte(oldCompose), 0o644)
	u.File = same
	if err := u.Upgrade(context.Background()); err != nil {
		t.Errorf("same version should be nothing to do, got %v", err)
	}

	older := filepath.Join(u.Dir, "older.yml")
	_ = os.WriteFile(older, []byte(strings.ReplaceAll(oldCompose, "0.2.0", "0.1.0")), 0o644)
	u.File = older
	if err := u.Upgrade(context.Background()); err == nil || !strings.Contains(err.Error(), "older than the installed") {
		t.Errorf("older target: %v", err)
	}

	pg := filepath.Join(u.Dir, "pg17.yml")
	_ = os.WriteFile(pg, []byte(strings.ReplaceAll(newCompose, "postgres:16", "postgres:17")), 0o644)
	u.File = pg
	if err := u.Upgrade(context.Background()); err == nil || !strings.Contains(err.Error(), "moves Postgres from 16 to 17") {
		t.Errorf("postgres major: %v", err)
	}

	u.File = ""
	refused := happyRunner(t, &u, db.Plan{Applied: 999, Newest: 42, Floor: 999, FloorAfter: 999}, "0.3.0")
	refused.script[1].res.Code = 3
	u.Run = refused
	if err := u.Upgrade(context.Background()); err == nil || !strings.Contains(err.Error(), "cannot start against this database") {
		t.Errorf("refused plan: %v", err)
	}
	if _, err := os.Stat(filepath.Join(u.Dir, nextFile)); err == nil {
		t.Error("next file left behind after a refusal")
	}
	if r.called("docker compose up") || refused.called("docker compose up") {
		t.Error("a refusal switched anyway")
	}
}

func TestUpgradeFailure(t *testing.T) {
	var u *Upgrader
	r := happyRunner(t, &u, pendingPlan, "0.2.0") // the old version keeps answering
	u, out := install(t, r, releaseFetcher())
	if err := u.Upgrade(context.Background()); !errors.Is(err, ErrFailed) {
		t.Fatalf("want ErrFailed, got %v", err)
	}
	if !r.called("docker compose logs --tail 40 stoop") {
		t.Error("the log tail was not printed")
	}
	for _, want := range []string{"0.3.0 did not come up healthy (running: 0.2.0)", "Nothing it did stops 0.2.0 from starting", "  stoop upgrade rollback"} {
		if !strings.Contains(out.String(), want) {
			t.Errorf("missing %q in:\n%s", want, out.String())
		}
	}
	prev, _ := os.ReadFile(filepath.Join(u.Dir, prevFile))
	if string(prev) != oldCompose {
		t.Error("the previous file is not there for rollback")
	}

	// A planned contract migration that did run: the floor moved, so the
	// running image says only 0.3.0 starts, and the way back is the restore.
	withRelease(t, "0.3.0", 42)
	contract := db.Plan{Applied: 37, Newest: 45, Floor: 0, FloorAfter: 42, Pending: []db.Migration{{Version: 45, Name: "drop_sessions"}}}
	r2 := happyRunner(t, &u, contract, "0.2.0")
	r2.answer(statusCmd, floorPast020(t))
	u, out = install(t, r2, releaseFetcher())
	if err := u.Upgrade(context.Background()); !errors.Is(err, ErrFailed) {
		t.Fatalf("want ErrFailed, got %v", err)
	}
	for _, want := range []string{
		"has a contract migration: after it, rolling back needs the backup",
		"It ran a contract migration, so 0.2.0 cannot start against the database now.",
		"pg_restore -U stoop -d stoop --no-owner < backups/20260925-180000-0.2.0-to-0.3.0/stoop.dump",
		"mv docker-compose.yml.prev docker-compose.yml && docker compose up -d",
	} {
		if !strings.Contains(out.String(), want) {
			t.Errorf("missing %q in:\n%s", want, out.String())
		}
	}

	// The same plan, but startup failed before the contract migration ran:
	// the floor did not move, so 0.2.0 can start and rollback is the answer.
	r3 := happyRunner(t, &u, contract, "0.2.0")
	u, out = install(t, r3, releaseFetcher())
	if err := u.Upgrade(context.Background()); !errors.Is(err, ErrFailed) {
		t.Fatalf("want ErrFailed, got %v", err)
	}
	if !strings.Contains(out.String(), "Nothing it did stops 0.2.0 from starting") || strings.Contains(out.String(), "pg_restore") {
		t.Errorf("a contract migration that never ran should not send the operator to the restore:\n%s", out.String())
	}

	// And with no answer from the image at all, the plan decides.
	r4 := happyRunner(t, &u, contract, "0.2.0")
	r4.answer(statusCmd, Result{Code: 1, Stderr: "no such image"})
	u, out = install(t, r4, releaseFetcher())
	if err := u.Upgrade(context.Background()); !errors.Is(err, ErrFailed) {
		t.Fatalf("want ErrFailed, got %v", err)
	}
	if !strings.Contains(out.String(), "pg_restore") {
		t.Errorf("with no answer, a planned contract migration should fall back to the restore:\n%s", out.String())
	}
}

func TestUpgradeOwnPostgres(t *testing.T) {
	var u *Upgrader
	r := happyRunner(t, &u, pendingPlan, "0.3.0")
	r.script[2] = scripted{prefix: "docker compose ps -q postgres", res: Result{}}
	r.script = append(r.script, scripted{prefix: "docker run --rm --network host -e STOOP_DATABASE_URL postgres:16-alpine sh -c exec pg_dump", res: Result{Stdout: "PGDMP..."}})
	u, out := install(t, r, releaseFetcher())
	const url = "postgres://me:s3cret@db.lan/stoop"
	_ = os.WriteFile(filepath.Join(u.Dir, envFile), []byte("COMPOSE_PROFILES=\nSTOOP_DATABASE_URL="+url+"\n"), 0o644)
	if err := u.Upgrade(context.Background()); err != nil {
		t.Fatalf("%v\n%s", err, out.String())
	}
	if !r.called("docker run --rm --network host -e STOOP_DATABASE_URL postgres:16-alpine sh -c exec pg_dump") {
		t.Errorf("own postgres should be dumped from a container:\n%s", strings.Join(r.calls, "\n"))
	}
	if strings.Contains(strings.Join(r.calls, "\n"), "s3cret") || !strings.Contains(strings.Join(r.envs, "\n"), "STOOP_DATABASE_URL="+url) {
		t.Errorf("the password must reach pg_dump through the environment only:\ncalls %v\nenvs %v", r.calls, r.envs)
	}

	// A failure on such an install gets a restore it can actually run.
	r2 := happyRunner(t, &u, pendingPlan, "0.2.0")
	r2.script[2] = scripted{prefix: "docker compose ps -q postgres", res: Result{}}
	r2.script = append(r2.script, scripted{prefix: "docker run --rm --network host -e STOOP_DATABASE_URL postgres:16-alpine sh -c exec pg_dump", res: Result{Stdout: "PGDMP..."}})
	withRelease(t, "0.3.0", 42)
	r2.answer(statusCmd, floorPast020(t))
	u, out = install(t, r2, releaseFetcher())
	_ = os.WriteFile(filepath.Join(u.Dir, envFile), []byte("COMPOSE_PROFILES=\nSTOOP_DATABASE_URL="+url+"\n"), 0o644)
	if err := u.Upgrade(context.Background()); !errors.Is(err, ErrFailed) {
		t.Fatalf("want ErrFailed, got %v", err)
	}
	if strings.Contains(out.String(), "docker compose exec -T postgres") || !strings.Contains(out.String(), "pg_restore --clean --if-exists --no-owner") {
		t.Errorf("own postgres restore should not go through the bundled service:\n%s", out.String())
	}
}

func TestUpgradeWithOverride(t *testing.T) {
	var u *Upgrader
	r := happyRunner(t, &u, pendingPlan, "0.3.0")
	r.script[1].prefix = "docker compose -f docker-compose.yml.next -f docker-compose.override.yml run --rm --no-deps -T stoop migrate plan --json"
	u, out := install(t, r, releaseFetcher())
	_ = os.WriteFile(filepath.Join(u.Dir, "docker-compose.override.yml"), []byte("services: {}\n"), 0o644)
	if err := u.Upgrade(context.Background()); err != nil {
		t.Fatalf("%v\n%s", err, out.String())
	}
}

func TestRollback(t *testing.T) {
	var u *Upgrader
	r := happyRunner(t, &u, pendingPlan, "0.3.0")
	u, out := install(t, r, releaseFetcher())
	if err := u.Rollback(context.Background()); err == nil || !strings.Contains(err.Error(), "no docker-compose.yml.prev") {
		t.Errorf("nothing to roll back to: %v", err)
	}

	_ = os.WriteFile(filepath.Join(u.Dir, composeFile), []byte(newCompose), 0o644)
	_ = os.WriteFile(filepath.Join(u.Dir, prevFile), []byte(oldCompose), 0o644)
	_ = os.WriteFile(filepath.Join(u.Dir, "livekit.yaml"), []byte("new livekit\n"), 0o644)
	_ = os.WriteFile(filepath.Join(u.Dir, "livekit.yaml.prev"), []byte("old livekit\n"), 0o644)
	if err := u.Rollback(context.Background()); err != nil {
		t.Fatalf("rollback: %v\n%s", err, out.String())
	}
	now, _ := os.ReadFile(filepath.Join(u.Dir, composeFile))
	kept, _ := os.ReadFile(filepath.Join(u.Dir, nextFile))
	if string(now) != oldCompose || string(kept) != newCompose {
		t.Errorf("files after rollback: compose=%q next=%q", now, kept)
	}
	lk, _ := os.ReadFile(filepath.Join(u.Dir, "livekit.yaml"))
	if string(lk) != "old livekit\n" {
		t.Errorf("companion after rollback: %q", lk)
	}
	if !strings.Contains(out.String(), "== back on 0.2.0; the 0.3.0 file is kept as docker-compose.yml.next") {
		t.Errorf("output:\n%s", out.String())
	}
	if r.called("docker compose -f docker-compose.yml.prev") {
		t.Error("rollback ran the older image")
	}
}

func TestRollbackFailsClosed(t *testing.T) {
	var u *Upgrader
	r := happyRunner(t, &u, pendingPlan, "0.3.0")
	r.answer(statusCmd, Result{Code: 1, Stderr: "no such image"})
	u, _ = install(t, r, releaseFetcher())
	_ = os.WriteFile(filepath.Join(u.Dir, composeFile), []byte(newCompose), 0o644)
	_ = os.WriteFile(filepath.Join(u.Dir, prevFile), []byte(oldCompose), 0o644)
	err := u.Rollback(context.Background())
	if err == nil || !strings.Contains(err.Error(), "could not confirm that 0.2.0 can start") || !strings.Contains(err.Error(), "mv docker-compose.yml.prev docker-compose.yml") {
		t.Errorf("no answer should refuse and name the by-hand step, got %v", err)
	}
	if r.called("docker compose up") {
		t.Error("refused, but restarted anyway")
	}
	r.answer(statusCmd, Result{Stdout: "not json\n"})
	if err := u.Rollback(context.Background()); err == nil || !strings.Contains(err.Error(), "could not confirm") {
		t.Errorf("bad json should refuse, got %v", err)
	}
}

func TestRollbackRefusedPastFloor(t *testing.T) {
	var u *Upgrader
	r := happyRunner(t, &u, pendingPlan, "0.3.0")
	r.script[len(r.script)-1].res.Stdout = reportJSON(t, db.Plan{Applied: 45, Newest: 45, Floor: 37, FloorAfter: 37})
	u, _ = install(t, r, releaseFetcher())
	_ = os.WriteFile(filepath.Join(u.Dir, composeFile), []byte(newCompose), 0o644)
	_ = os.WriteFile(filepath.Join(u.Dir, prevFile), []byte(strings.ReplaceAll(oldCompose, "0.2.0", "0.1.0")), 0o644)
	err := u.Rollback(context.Background())
	if err == nil || !strings.Contains(err.Error(), "only 0.2.0 and later can") {
		t.Errorf("want a refusal naming the floor release, got %v", err)
	}
	if r.called("docker compose up") {
		t.Error("refused, but restarted anyway")
	}
}

func TestHelpers(t *testing.T) {
	for _, c := range []struct {
		a, b string
		want bool
	}{
		{"0.2.0", "0.3.0", true}, {"0.3.0", "0.2.0", false}, {"0.2.0", "0.2.0", false},
		{"0.9.0", "0.10.0", true}, {"0.2", "0.2.1", true}, {"0.2.0", "dev", true}, {"dev", "0.2.0", false}, {"v0.2.0", "0.3.0", true},
	} {
		if got := Older(c.a, c.b); got != c.want {
			t.Errorf("Older(%q, %q) = %v", c.a, c.b, got)
		}
	}
	if got := TagOf("  image: ghcr.io/getstoop/stoop:0.2.0\n"); got != "0.2.0" {
		t.Errorf("TagOf = %q", got)
	}
	if got := TagOf("    image: stoop:dev\n"); got != "dev" {
		t.Errorf("TagOf dev = %q", got)
	}
	if got := TagOf("    image: postgres:16-alpine\n"); got != "" {
		t.Errorf("TagOf postgres = %q", got)
	}
	if got := PostgresMajor(oldCompose); got != "16" {
		t.Errorf("PostgresMajor = %q", got)
	}
	if got := runningVersion("stoop v0.3.0 (abc1234)\n"); got != "0.3.0" {
		t.Errorf("runningVersion = %q", got)
	}
	if got := runningVersion("stoop dev"); got != "dev" {
		t.Errorf("runningVersion dev = %q", got)
	}
	missing := MissingSettings(newExample, oldEnv)
	if len(missing) != 1 || missing[0] != "COMPOSE_PROFILES=bundled-postgres" {
		t.Errorf("MissingSettings = %q", missing)
	}
	if got := MissingSettings(newExample, "# COMPOSE_PROFILES=\nPOSTGRES_PASSWORD=x\n"); len(got) != 0 {
		t.Errorf("a commented key counts as mentioned: %q", got)
	}
	if got := envValue("A=1\nSTOOP_DATABASE_URL= postgres://x \n", "STOOP_DATABASE_URL"); got != "postgres://x" {
		t.Errorf("envValue = %q", got)
	}
}
