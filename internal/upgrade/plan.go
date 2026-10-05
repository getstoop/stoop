package upgrade

import (
	"context"
	"fmt"
	"os"

	"github.com/getstoop/stoop/internal/db"
)

// plan asks the new image what it will do to the running database, and
// shows the settings the new release expects that .env lacks.
func (u *Upgrader) plan(ctx context.Context, target string) (db.Report, error) {
	u.say("what %s will do to the database", target)
	res := u.compose(ctx, captured, append(u.fileArgs(nextFile), "run", "--rm", "--no-deps", "-T", "stoop", "migrate", "plan", "--json")...)
	report, err := readReport(res.Stdout)
	if err != nil || res.Code < 0 || (res.Code != 0 && res.Code != db.PlanExitPending && res.Code != db.PlanExitRefused) {
		return report, fmt.Errorf("could not read the migration plan (exit %d):\n%s%s", res.Code, res.Stdout, res.Stderr)
	}
	db.WriteReport(u.Out, report, true)
	if report.Refused != "" {
		return report, fmt.Errorf("%s cannot start against this database; it is older than what made it", target)
	}
	if example, err := os.ReadFile(u.path(envNextFile)); err == nil {
		env, _ := os.ReadFile(u.path(envFile))
		if missing := MissingSettings(string(example), string(env)); len(missing) > 0 {
			u.say("settings %s expects that .env does not have (see the release notes):", target)
			for _, line := range missing {
				_, _ = fmt.Fprintf(u.Out, "  %s\n", line)
			}
		}
	}
	if report.Contract {
		u.say("%s has a contract migration: after it, rolling back needs the backup this tool takes, not just the old compose file", target)
	}
	return report, nil
}
