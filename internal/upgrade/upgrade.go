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
)

// Options is what the command line decides.
type Options struct {
	Dir      string // the install directory; "." from the command line
	To       string // a release version; "" is the latest
	File     string // a compose file already on disk, in place of a download
	PlanOnly bool
	Yes      bool
	Repo     string // release downloads: <Repo>/releases/download/v<version>/<file>
	API      string // the releases/latest API endpoint
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
	if o.Repo == "" {
		o.Repo = "https://github.com/getstoop/stoop"
	}
	if o.API == "" {
		o.API = "https://api.github.com/repos/getstoop/stoop/releases/latest"
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
func (u *Upgrader) compose(ctx context.Context, args ...string) Result {
	return u.Run.Run(ctx, Cmd{Name: "docker", Args: append([]string{"compose"}, args...)})
}
func (u *Upgrader) composeStreaming(ctx context.Context, args ...string) Result {
	return u.Run.Run(ctx, Cmd{Name: "docker", Args: append([]string{"compose"}, args...), Stdout: u.Out, Stderr: u.Out})
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
	target, fetched, done, err := u.resolve(ctx, current)
	if err != nil || done {
		return err
	}
	u.say("upgrade %s -> %s", current, target)
	report, err := u.plan(ctx, target)
	if err != nil {
		u.cleanupNext()
		return err
	}
	if u.PlanOnly {
		u.cleanupNext()
		u.say("plan only; nothing was changed")
		return nil
	}
	if err := u.confirm(fmt.Sprintf("Upgrade to %s? A backup is taken first.", target)); err != nil {
		u.cleanupNext()
		return err
	}
	backup, err := u.backup(ctx, current, target)
	if err != nil {
		u.cleanupNext()
		return err
	}
	return u.switchTo(ctx, current, target, backup, report.Contract, fetched)
}

// startable asks the running image which release is the oldest that can
// start against the database now. ok is false when it could not say.
func (u *Upgrader) startable(ctx context.Context) (oldest string, ok bool) {
	res := u.compose(ctx, "run", "--rm", "--no-deps", "-T", "stoop", "migrate", "status", "--json")
	if res.Code != 0 {
		return "", false
	}
	line := strings.TrimSpace(res.Stdout)
	if i := strings.LastIndex(line, "\n"); i >= 0 {
		line = line[i+1:]
	}
	var report db.Report
	if err := json.Unmarshal([]byte(line), &report); err != nil || report.Startable == "" {
		return "", false
	}
	return report.Startable, true
}

func (u *Upgrader) preflight(ctx context.Context) (string, error) {
	if res := u.compose(ctx, "version"); res.Code != 0 {
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
// beside it. done is an upgrade there is nothing to do for.
func (u *Upgrader) resolve(ctx context.Context, current string) (target string, fetched, done bool, err error) {
	if u.File != "" {
		data, err := os.ReadFile(u.File)
		if err != nil {
			return "", false, false, err
		}
		if err := os.WriteFile(u.path(nextFile), data, 0o644); err != nil {
			return "", false, false, err
		}
	} else {
		to := u.To
		if to == "" {
			if to, err = u.latestVersion(ctx); err != nil {
				return "", false, false, err
			}
		}
		to = strings.TrimPrefix(to, "v")
		base := u.Repo + "/releases/download/v" + to
		u.say("fetching the %s compose bundle", to)
		compose, err := u.Fetch.Fetch(ctx, base+"/"+composeFile)
		if err != nil {
			return "", false, false, fmt.Errorf("no release v%s at %s: %w", to, base, err)
		}
		example, err := u.Fetch.Fetch(ctx, base+"/env.example")
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
			data, err := u.Fetch.Fetch(ctx, base+"/"+name)
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
		u.cleanupNext()
		return "", false, false, errors.New("cannot read the stoop image tag from the new compose file")
	}
	if target == current {
		u.cleanupNext()
		u.say("already on %s; nothing to do", target)
		return target, fetched, true, nil
	}
	if Older(target, current) {
		u.cleanupNext()
		return "", false, false, fmt.Errorf("%s is older than the installed %s; going back is: stoop upgrade rollback", target, current)
	}
	old, err := os.ReadFile(u.path(composeFile))
	if err != nil {
		return "", false, false, err
	}
	if now, then := PostgresMajor(string(old)), PostgresMajor(string(next)); now != "" && then != "" && now != then {
		u.cleanupNext()
		return "", false, false, fmt.Errorf("%s moves Postgres from %s to %s, which this tool does not do: docs/self-hosting.md → Supported Postgres and LiveKit versions", target, now, then)
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
