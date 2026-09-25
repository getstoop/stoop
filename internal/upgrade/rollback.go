package upgrade

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"strings"

	"github.com/getstoop/stoop/internal/db"
)

// Rollback puts the previous compose file back and restarts, when the
// release in it can still start against the database. The running,
// newer image is asked, never the older one: releases up to 0.2.0 treat
// an unknown verb as "serve".
func (u *Upgrader) Rollback(ctx context.Context) error {
	current, err := u.preflight(ctx)
	if err != nil {
		return err
	}
	prev, err := os.ReadFile(u.path(prevFile))
	if err != nil {
		return fmt.Errorf("no %s to roll back to", prevFile)
	}
	target := TagOf(string(prev))
	if target == "" {
		return fmt.Errorf("cannot read the stoop image tag from %s", prevFile)
	}
	u.say("rolling back %s -> %s", current, target)
	res := u.compose(ctx, "run", "--rm", "--no-deps", "-T", "stoop", "migrate", "status", "--json")
	var report db.Report
	if res.Code == 0 {
		line := strings.TrimSpace(res.Stdout)
		if i := strings.LastIndex(line, "\n"); i >= 0 {
			line = line[i+1:]
		}
		_ = json.Unmarshal([]byte(line), &report)
	}
	if report.Startable != "" && Older(target, report.Startable) {
		return fmt.Errorf("%s cannot start against this database: only %s and later can, because an upgrade contained a contract migration.\nRestore the backup taken before that upgrade instead: docs/self-hosting.md → Restoring in place", target, report.Startable)
	}
	if err := u.confirm(fmt.Sprintf("Put %s back and restart?", target)); err != nil {
		return err
	}
	if err := os.Rename(u.path(composeFile), u.path(nextFile)); err != nil {
		return err
	}
	if err := os.Rename(u.path(prevFile), u.path(composeFile)); err != nil {
		return err
	}
	if res := u.composeStreaming(ctx, "up", "-d", "--remove-orphans", "--wait", "--wait-timeout", u.Wait); res.Code != 0 {
		u.composeStreaming(ctx, "logs", "--tail", "40", "stoop")
		return fmt.Errorf("%s did not come up healthy; the %s file is kept as %s", target, current, nextFile)
	}
	u.say("back on %s; the %s file is kept as %s", target, current, nextFile)
	return nil
}
