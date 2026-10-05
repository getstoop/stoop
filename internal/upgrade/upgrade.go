package upgrade

import (
	"bufio"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/getstoop/stoop/internal/db"
	"github.com/getstoop/stoop/internal/release"
)

// Options is what the command line decides.
type Options struct {
	Dir      string // the install directory; "." from the command line
	To       string // a release version; "" is the latest
	File     string // a compose file already on disk, in place of a download
	PlanOnly bool
	Yes      bool
	Index    string // the release index
	Wait     string // seconds compose waits for the stack to be healthy
}

// Upgrader runs the sequence. New wires the real world; tests fill the
// fields themselves.
type Upgrader struct {
	Options
	Run   Runner
	Fetch Fetcher
	Out   io.Writer
	In    io.Reader
	Now   func() time.Time
}

// ErrStopped is the operator answering no.
var ErrStopped = errors.New("stopped; nothing was changed")

// ErrFailed is a switch that did not come up; the way back was printed.
var ErrFailed = errors.New("the upgrade did not come up healthy")

func New(o Options) *Upgrader {
	if o.Index == "" {
		o.Index = release.IndexURL
	}
	if o.Wait == "" {
		o.Wait = "600"
	}
	out, in := Terminal()
	return &Upgrader{Options: o, Run: ExecRunner{Dir: o.Dir}, Fetch: HTTPFetcher{}, Out: out, In: in, Now: time.Now}
}

func (u *Upgrader) path(name string) string { return filepath.Join(u.Dir, name) }
func (u *Upgrader) say(format string, args ...any) {
	_, _ = fmt.Fprintf(u.Out, "== "+format+"\n", args...)
}

// output is where a command's stdout and stderr go; a nil one is captured
// into the Result.
type output struct {
	stdout, stderr io.Writer
}

var captured output

func (u *Upgrader) onTerminal() output { return output{stdout: u.Out, stderr: u.Out} }

func (u *Upgrader) compose(ctx context.Context, to output, args ...string) Result {
	return u.Run.Run(ctx, Cmd{Name: "docker", Args: append([]string{"compose"}, args...), Stdout: to.stdout, Stderr: to.stderr})
}

// up starts the stack and waits for it to be healthy.
func (u *Upgrader) up(ctx context.Context) Result {
	return u.compose(ctx, u.onTerminal(), "up", "-d", "--remove-orphans", "--wait", "--wait-timeout", u.Wait)
}

func (u *Upgrader) showLogs(ctx context.Context) {
	u.compose(ctx, u.onTerminal(), "logs", "--tail", "40", "stoop")
}

// readReport is the db.Report a `migrate ... --json` run printed as its
// last line.
func readReport(stdout string) (db.Report, error) {
	line := strings.TrimSpace(stdout)
	if cut := strings.LastIndex(line, "\n"); cut >= 0 {
		line = line[cut+1:]
	}
	var report db.Report
	err := json.Unmarshal([]byte(line), &report)
	return report, err
}
func (u *Upgrader) cleanupNext() {
	_ = os.Remove(u.path(nextFile))
	_ = os.Remove(u.path(envNextFile))
	for _, name := range companions {
		_ = os.Remove(u.path(name + ".next"))
	}
}

// fileArgs is -f for the given compose file plus any override compose
// would load on its own, so an explicit file sees the same stack `up` will.
func (u *Upgrader) fileArgs(compose string) []string {
	args := []string{"-f", compose}
	for _, name := range overrideFiles {
		if _, err := os.Stat(u.path(name)); err == nil {
			args = append(args, "-f", name)
		}
	}
	return args
}

// Upgrade walks the install to the target release.
func (u *Upgrader) Upgrade(ctx context.Context) error {
	current, err := u.preflight(ctx)
	if err != nil {
		return err
	}
	// Until switchTo takes them, the staged files are this run's to remove.
	switched := false
	defer func() {
		if !switched {
			u.cleanupNext()
		}
	}()
	target, fetched, done, err := u.resolve(ctx, current)
	if err != nil || done {
		return err
	}
	u.say("upgrade %s -> %s", current, target)
	report, err := u.plan(ctx, target)
	if err != nil {
		return err
	}
	if u.PlanOnly {
		u.say("plan only; nothing was changed")
		return nil
	}
	if err := u.confirm(fmt.Sprintf("Upgrade to %s? A backup is taken first.", target)); err != nil {
		return err
	}
	backup, err := u.backup(ctx, current, target)
	if err != nil {
		return err
	}
	switched = true
	return u.switchTo(ctx, current, target, backup, report.Contract, fetched)
}

// startable asks the running image which release is the oldest that can
// start against the database now. ok is false when it could not say.
func (u *Upgrader) startable(ctx context.Context) (oldest string, ok bool) {
	res := u.compose(ctx, captured, "run", "--rm", "--no-deps", "-T", "stoop", "migrate", "status", "--json")
	if res.Code != 0 {
		return "", false
	}
	report, err := readReport(res.Stdout)
	if err != nil || report.Startable == "" {
		return "", false
	}
	return report.Startable, true
}

func (u *Upgrader) preflight(ctx context.Context) (string, error) {
	if res := u.compose(ctx, captured, "version"); res.Code != 0 {
		return "", errors.New("docker compose (v2) is not available")
	}
	for _, name := range []string{composeFile, envFile} {
		if _, err := os.Stat(u.path(name)); err != nil {
			return "", fmt.Errorf("no %s here; run this from the install directory", name)
		}
	}
	compose, err := os.ReadFile(u.path(composeFile))
	if err != nil {
		return "", err
	}
	current := TagOf(string(compose))
	if current == "" {
		return "", fmt.Errorf("cannot read the stoop image tag from %s", composeFile)
	}
	return current, nil
}

// resolve puts the new compose file at nextFile and its env example
// beside it. done is an upgrade there is nothing to do for. It starts by
// clearing staged files an earlier run left, which includes the .next
// files a rollback by an older stoop parked.
func (u *Upgrader) resolve(ctx context.Context, current string) (target string, fetched, done bool, err error) {
	var given []byte
	if u.File != "" {
		// Read before clearing: the file given may be a stale nextFile.
		if given, err = os.ReadFile(u.File); err != nil {
			return "", false, false, err
		}
	}
	u.cleanupNext()
	if u.File != "" {
		if err := os.WriteFile(u.path(nextFile), given, 0o644); err != nil {
			return "", false, false, err
		}
	} else {
		to, files, err := u.release(ctx, u.To)
		if err != nil {
			return "", false, false, err
		}
		u.say("fetching the %s compose bundle", to)
		compose, err := u.fetchFile(ctx, files, composeFile)
		if err != nil {
			return "", false, false, fmt.Errorf("could not fetch %s for %s: %w", composeFile, to, err)
		}
		example, err := u.fetchFile(ctx, files, "env.example")
		if err != nil {
			return "", false, false, fmt.Errorf("could not fetch env.example for %s: %w", to, err)
		}
		if err := os.WriteFile(u.path(nextFile), compose, 0o644); err != nil {
			return "", false, false, err
		}
		if err := os.WriteFile(u.path(envNextFile), example, 0o644); err != nil {
			return "", false, false, err
		}
		// The rest of the bundle; a release from before a file existed has none.
		for _, name := range companions {
			data, err := u.fetchFile(ctx, files, name)
			if err != nil {
				continue
			}
			if err := os.WriteFile(u.path(name+".next"), data, 0o644); err != nil {
				return "", false, false, err
			}
		}
		fetched = true
	}
	next, err := os.ReadFile(u.path(nextFile))
	if err != nil {
		return "", false, false, err
	}
	target = TagOf(string(next))
	if target == "" {
		return "", false, false, errors.New("cannot read the stoop image tag from the new compose file")
	}
	if target == current {
		u.say("already on %s; nothing to do", target)
		return target, fetched, true, nil
	}
	if release.Older(target, current) {
		return "", false, false, fmt.Errorf("%s is older than the installed %s; going back is: stoop upgrade rollback", target, current)
	}
	old, err := os.ReadFile(u.path(composeFile))
	if err != nil {
		return "", false, false, err
	}
	if now, then := PostgresMajor(string(old)), PostgresMajor(string(next)); now != "" && then != "" && now != then {
		return "", false, false, fmt.Errorf("%s moves Postgres from %s to %s, which this tool does not do: docs/self-hosting/install.md → Supported Postgres and LiveKit versions", target, now, then)
	}
	return target, fetched, false, nil
}

func (u *Upgrader) confirm(prompt string) error {
	if u.Yes {
		return nil
	}
	_, _ = fmt.Fprintf(u.Out, "%s [y/N] ", prompt)
	answer, _ := bufio.NewReader(u.In).ReadString('\n')
	switch strings.TrimSpace(answer) {
	case "y", "Y", "yes", "YES":
		return nil
	}
	return ErrStopped
}
