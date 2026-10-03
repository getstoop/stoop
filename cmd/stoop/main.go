package main

import (
	"context"
	"fmt"
	"io"
	"log/slog"
	"os"
	"os/signal"
	"syscall"

	"github.com/getstoop/stoop/internal/app"
	"github.com/getstoop/stoop/internal/buildinfo"
	"github.com/getstoop/stoop/internal/config"
)

const usage = `usage: stoop [command]

  (no command)   start the server
  jobs           run the background jobs on their own, for STOOP_JOBS=external or child
  admin          account recovery and settings; stoop admin for the list
  migrate        check or apply database migrations
  upgrade        upgrade the compose install in this directory
  health         exit 0 if the running server answers
  version        print the version
  help           print this text
`

// dispatch runs a subcommand. handled is false for the bare binary, which serves.
func dispatch(ctx context.Context, args []string, out, errOut io.Writer) (code int, handled bool) {
	if len(args) == 0 {
		return 0, false
	}
	switch args[0] {
	case "jobs":
		return runJobs(ctx), true
	case "admin":
		return runAdmin(ctx, args[1:], out), true
	case "migrate":
		return runMigrate(ctx, args[1:], out), true
	case "upgrade":
		return runUpgrade(ctx, args[1:], out), true
	case "health":
		return runHealth(out), true
	case "version", "--version", "-v":
		return runVersion(args[1:], out), true
	case "help", "--help", "-h":
		_, _ = fmt.Fprint(out, usage)
		return 0, true
	}
	_, _ = fmt.Fprintf(errOut, "stoop: unknown command %q\n\n%s", args[0], usage)
	return 2, true
}

// process is what the server and `stoop jobs` both start from: the
// logger, the configuration and a context SIGINT or SIGTERM cancels.
type process struct {
	log  *slog.Logger
	cfg  config.Config
	ctx  context.Context
	stop context.CancelFunc
}

// newProcess sets those up; a bad configuration is logged and returned.
func newProcess(ctx context.Context) (process, error) {
	log := slog.New(slog.NewTextHandler(os.Stderr, nil))
	slog.SetDefault(log)
	log.Info("starting stoop", "version", buildinfo.String())

	cfg, err := config.Load()
	if err != nil {
		log.Error("invalid configuration", "err", err)
		return process{}, err
	}

	ctx, stop := signal.NotifyContext(ctx, os.Interrupt, syscall.SIGTERM)
	return process{log: log, cfg: cfg, ctx: ctx, stop: stop}, nil
}

func main() {
	// Subcommands run and exit; the bare binary serves.
	if code, handled := dispatch(context.Background(), os.Args[1:], os.Stdout, os.Stderr); handled {
		os.Exit(code)
	}

	proc, err := newProcess(context.Background())
	if err != nil {
		os.Exit(1)
	}
	defer proc.stop()

	a, err := app.New(proc.ctx, proc.cfg, proc.log)
	if err != nil {
		proc.log.Error("startup failed", "err", err)
		os.Exit(1)
	}
	if err := a.Run(proc.ctx); err != nil {
		proc.log.Error("server error", "err", err)
		os.Exit(1)
	}
}
