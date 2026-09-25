package main

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"os"

	"github.com/getstoop/stoop/internal/buildinfo"
	"github.com/getstoop/stoop/internal/config"
	"github.com/getstoop/stoop/internal/db"
)

const migrateUsage = `usage: stoop migrate <command> [--json]

  status   what the database has, what this binary carries, what is pending
  plan     status, plus what up would mean for rolling back; exits 2 when
           there is something to run and 3 when this binary is too old
           for the database
  up       apply the pending migrations and exit; the step the server
           runs at startup

Talks to the database in STOOP_DATABASE_URL directly. status and plan
change nothing, and are meant to be run from the release you are about to
upgrade to, before starting it; --json is what stoop upgrade reads.
docs/self-hosting.md → Upgrading.
`

// runMigrate implements `stoop migrate ...`. It returns the process exit code.
func runMigrate(ctx context.Context, args []string, out io.Writer) int {
	asJSON := false
	var rest []string
	for _, a := range args {
		if a == "--json" {
			asJSON = true
		} else {
			rest = append(rest, a)
		}
	}
	if len(rest) != 1 || rest[0] == "-h" || rest[0] == "--help" {
		_, _ = fmt.Fprint(out, migrateUsage)
		return 2
	}
	switch rest[0] {
	case "status", "plan", "up":
	default:
		fmt.Fprintf(os.Stderr, "unknown migrate command %q\n\n%s", rest[0], migrateUsage)
		return 2
	}
	cfg, err := config.Load()
	if err != nil {
		fmt.Fprintln(os.Stderr, "invalid configuration:", err)
		return 1
	}
	pool, err := db.Connect(ctx, cfg.DatabaseURL, cfg.DatabasePoolMax)
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		return 1
	}
	defer pool.Close()
	plan, err := db.Inspect(ctx, pool)
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		return 1
	}
	report := plan.Report(buildinfo.Version)
	switch rest[0] {
	case "status":
		writeReport(out, report, false, asJSON)
		return 0
	case "plan":
		writeReport(out, report, true, asJSON)
		return planExit(plan)
	}
	if err := plan.Refused(); err != nil {
		fmt.Fprintln(os.Stderr, err)
		return 3
	}
	if err := db.Migrate(ctx, pool); err != nil {
		fmt.Fprintln(os.Stderr, err)
		return 1
	}
	if len(plan.Pending) == 0 {
		_, _ = fmt.Fprintf(out, "nothing to run; database at migration %d\n", plan.Applied)
	} else {
		_, _ = fmt.Fprintf(out, "applied %d migrations; database at migration %d\n", len(plan.Pending), plan.Newest)
	}
	return 0
}

func writeReport(out io.Writer, r db.Report, after, asJSON bool) {
	if !asJSON {
		db.WriteReport(out, r, after)
		return
	}
	body, err := json.Marshal(r)
	if err != nil {
		panic(err)
	}
	_, _ = fmt.Fprintln(out, string(body))
}

// planExit is plan's exit code: 0 nothing to run, 2 pending, 3 refused.
func planExit(p db.Plan) int {
	switch {
	case p.Refused() != nil:
		return 3
	case len(p.Pending) > 0:
		return 2
	}
	return 0
}
