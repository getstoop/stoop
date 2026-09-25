// Package upgrade is `stoop upgrade` on the host: it walks a compose
// install to a newer release and back, running docker compose the way an
// operator would by hand. The judgment about the database comes from the
// target image through `migrate plan --json`, never from this binary.
// See docs/self-hosting.md → Upgrading and docs/proposals/upgrade.md.
package upgrade

import (
	"bytes"
	"context"
	"errors"
	"io"
	"os"
	"os/exec"
)

// Cmd is one host command. With Stdout nil the output is captured into
// the Result; set, it streams there (a pg_dump into a file, compose's
// progress onto the terminal).
type Cmd struct {
	Name   string
	Args   []string
	Env    []string // added to the process environment, for a value that must not be an argument
	Stdout io.Writer
	Stderr io.Writer
}

// Result is what a command left behind. Code is -1 when it could not run.
type Result struct {
	Stdout string
	Stderr string
	Code   int
}

// Runner runs host commands; the tests use one that records them.
type Runner interface {
	Run(ctx context.Context, c Cmd) Result
}

// ExecRunner runs commands for real, in Dir.
type ExecRunner struct {
	Dir string
}

func (r ExecRunner) Run(ctx context.Context, c Cmd) Result {
	cmd := exec.CommandContext(ctx, c.Name, c.Args...)
	cmd.Dir = r.Dir
	if len(c.Env) > 0 {
		cmd.Env = append(os.Environ(), c.Env...)
	}
	var out, errBuf bytes.Buffer
	if c.Stdout == nil {
		cmd.Stdout = &out
	} else {
		cmd.Stdout = c.Stdout
	}
	if c.Stderr == nil {
		cmd.Stderr = &errBuf
	} else {
		cmd.Stderr = c.Stderr
	}
	err := cmd.Run()
	res := Result{Stdout: out.String(), Stderr: errBuf.String()}
	var exit *exec.ExitError
	switch {
	case err == nil:
	case errors.As(err, &exit):
		res.Code = exit.ExitCode()
	default:
		res.Code = -1
		res.Stderr += err.Error()
	}
	return res
}

// Terminal is the stdio a real run uses.
func Terminal() (io.Writer, io.Reader) { return os.Stdout, os.Stdin }
